"""Read-only public analytics computation, isolated from the live collector.

Never instantiate Store/Context/Coverage: their constructors migrate/write/start
operational state. Copy only the explicit monitoring tables to process memory,
release the source read transaction, and run existing read rules on that copy.
"""
import copy
import functools
import hashlib
from collections import OrderedDict
from datetime import datetime
from zoneinfo import ZoneInfo
import json
import sqlite3
import sys
import time
from pathlib import Path

TABLES = ('rooms', 'messages', 'episodes', 'context_messages', 'episode_links',
          'photos', 'mention_corrections', 'conversation_reviews', 'review_history',
          'feedback_notes', 'gaps', 'collection_intervals', 'collection_recoveries',
          'bookmarks', 'daily_briefings', 'alias_decisions')
SETTINGS = ('keywords', 'exclude_keywords', 'keyword_groups')
RESULTS = OrderedDict()
DETAILS = OrderedDict()
GROUPS = OrderedDict()
GROUPED = OrderedDict()
READ_VERSIONS = {}

def retain(cache, key, value, limit):
    cache[key] = value
    cache.move_to_end(key)
    while len(cache) > limit: cache.popitem(last=False)
    return value

def digest(value):
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,separators=(',',':'),sort_keys=True).encode()).hexdigest()



def file_version(filename):
    result=[]
    for suffix in ('','-wal','-journal'):
        file=Path(str(filename)+suffix)
        try:
            stat=file.stat();result.append((stat.st_dev,stat.st_ino,stat.st_size,stat.st_mtime_ns,stat.st_ctime_ns))
        except FileNotFoundError:result.append(None)
    return tuple(result)

def result_key(root,fingerprint,endpoint,params):
    history=root/'state/monitor/classification-history.jsonl'
    version=(history.stat().st_size,history.stat().st_mtime_ns) if history.exists() else None
    return (str(root),fingerprint,datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat(),endpoint,json.dumps(params,sort_keys=True),version,int(time.time()//60) if endpoint=='/api/aliases' else None)

def retained_result(key,root,endpoint):
    RESULTS.move_to_end(key)
    result=copy.deepcopy(RESULTS[key])
    if endpoint == '/api/briefing':result['image_available']=(root/'uploads/briefings'/('briefing-'+result['report']['day']+'.png')).is_file()
    return result

def load_public_snapshot(filename):
    before_version=file_version(filename)
    started = time.perf_counter()
    source = sqlite3.connect(Path(filename).resolve().as_uri() + '?mode=ro', uri=True, timeout=0.2)
    snapshot = {}
    memory = sqlite3.connect(':memory:')
    memory.row_factory = sqlite3.Row
    try:
        source.execute('PRAGMA query_only=ON')
        source.execute('BEGIN')
        for table in (*TABLES, 'settings'):
            schema = source.execute('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?', (table,)).fetchone()
            if not schema:
                raise ValueError('MISSING_ANALYTICS_TABLE')
            rows = source.execute('SELECT * FROM settings WHERE key IN (?,?,?)', SETTINGS).fetchall() if table == 'settings' else source.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall()
            snapshot[table] = (schema[0],rows)
        source.rollback()
    except Exception:
        memory.close()
        raise
    finally:
        source.close()
    read_ms = (time.perf_counter()-started)*1000
    after_version=file_version(filename)
    for table,(schema,rows) in snapshot.items():
        memory.execute(schema)
        if rows:memory.executemany('INSERT INTO '+table+' VALUES ('+','.join('?' for _ in rows[0])+')',rows)
    # Scope only the disposable analytics copy. Collector/guide data and send
    # receipts remain intact; excluded rooms cannot leak back through campaign
    # anchor materialization into public analysis.
    for table in TABLES:
        if table in ('rooms','gaps'):continue
        columns={row[1] for row in memory.execute('PRAGMA table_info('+table+')')}
        if 'room_id' in columns:
            memory.execute('DELETE FROM '+table+' WHERE room_id IN (SELECT id FROM rooms WHERE excluded=1)')
    memory.executescript('''
      CREATE INDEX projection_context_text ON context_messages(room_id,text);
      CREATE INDEX projection_links_episode ON episode_links(episode_id);
      CREATE INDEX projection_episodes_room ON episodes(room_id,anchor_ms);
      CREATE INDEX projection_reviews_anchor ON conversation_reviews(anchor_id,updated_at);
      CREATE INDEX projection_review_history ON review_history(episode_id,undone,id);
      CREATE INDEX projection_messages_time ON messages(sort_at);
    ''')
    memory.commit()
    memory.execute('PRAGMA query_only=ON')
    fingerprint=digest(snapshot)
    if before_version==after_version and before_version[2] is None:
        READ_VERSIONS[str(Path(filename).resolve())]=(before_version,fingerprint)
    return memory, read_ms, fingerprint


def compute(root, endpoint, params):
    request_started = time.perf_counter()
    sys.path.insert(0, str(root))
    from monitor import context, context_selection, conversations, store, analytics, workspace, rules, keyword_groups, substance
    from monitor.coverage import Coverage
    from monitor.classifications import Classifications
    filename=root/'state/monitor/monitor.sqlite3'
    current_version=file_version(filename)
    previous=READ_VERSIONS.get(str(filename.resolve()))
    if previous and previous[0]==current_version and current_version[2] is None:
        key=result_key(root,previous[1],endpoint,params)
        if key in RESULTS:
            return retained_result(key,root,endpoint),{'readMs':0,'computeMs':0,'detailComputations':0,'cached':True,'fastCache':True,'totalMs':round((time.perf_counter()-request_started)*1000,1)}
    database, read_ms, fingerprint = load_public_snapshot(filename)
    settings = {row['key']:json.loads(row['value']) for row in database.execute('SELECT * FROM settings')}
    key=result_key(root,fingerprint,endpoint,params)
    if key in RESULTS:
        result=retained_result(key,root,endpoint)
        database.close()
        return result,{'readMs':round(read_ms,1),'computeMs':0,'detailComputations':0,'cached':True,'fastCache':False,'totalMs':round((time.perf_counter()-request_started)*1000,1)}
    room_inputs={row['id']:[('room',row['name'])] for row in database.execute('SELECT id,name FROM rooms')}
    episode_rooms={row['id']:row['room_id'] for row in database.execute('SELECT id,room_id FROM episodes')}
    for table in ('messages','episodes','context_messages','episode_links','photos','mention_corrections','conversation_reviews','review_history','feedback_notes','gaps'):
        for row in database.execute('SELECT * FROM '+table):
            value=dict(row)
            room=value.get('room_id') or episode_rooms.get(value.get('anchor_id') or value.get('episode_id'))
            room_inputs.setdefault(room,[]).append((table,tuple(row)))
    room_versions={room:digest([settings,values]) for room,values in room_inputs.items()}
    detail_misses=0

    # These caches are process-local pure-function reuse; live collector modules
    # and rules are never changed or hot-loaded.
    @functools.lru_cache(maxsize=20000)
    def match_cached(text, keywords, numeric):
        return tuple(rules.matches(text, keywords, numeric=numeric))
    def matches(text, keywords, *, numeric=False):
        return list(match_cached(text, tuple(keywords), numeric))
    originals = []
    def patch(module, name, value):
        originals.append((module,name,getattr(module,name)))
        setattr(module,name,value)
    for module in (context, context_selection, conversations, store, analytics, keyword_groups):
        patch(module, 'matches', matches)
    original_useful, original_category, original_dialogue, original_tokens = substance.useful, context_selection.category, context_selection.dialogue, context_selection.tokens
    def message_key(message):
        return (message.get('type',1),message.get('text',message.get('summary','')),message.get('author_name'))
    def unpack(key): return dict(zip(('type','text','author_name'),key))
    @functools.lru_cache(maxsize=20000)
    def useful_cached(key): return original_useful(unpack(key))
    for module in (context,context_selection):patch(module,'useful',lambda message:useful_cached(message_key(message)))
    @functools.lru_cache(maxsize=20000)
    def category_cached(key): return original_category(unpack(key))
    patch(context_selection,'category',lambda message:category_cached(message_key(message)))
    @functools.lru_cache(maxsize=20000)
    def dialogue_cached(key): return original_dialogue(unpack(key))
    for module in (context_selection,conversations):patch(module,'dialogue',lambda message:dialogue_cached(message_key(message)))
    @functools.lru_cache(maxsize=20000)
    def tokens_cached(text): return frozenset(original_tokens(text))
    patch(context_selection,'tokens',lambda text:set(tokens_cached(text)))

    class PublicStore:
        def __init__(self):
            self.db = database
            self.directory = root/'state/monitor'
        def setting(self, key, default):
            if key not in SETTINGS:
                raise ValueError('SETTING_NOT_ALLOWED')
            return settings.get(key, default)
        keyword_groups = store.Store.keyword_groups
        eligible = store.Store.eligible
        keyword_overview = store.Store.keyword_overview

    public = PublicStore()
    database.create_function('keyword_match', 1, lambda text: int(public.eligible(text)))
    class ReadContext(context.Context):
        def __init__(self):
            self.store, self.db = public, database
        @functools.lru_cache(maxsize=20000)
        def allowed(self, text):
            return super().allowed(text)
        @functools.lru_cache(maxsize=10000)
        def cached_detail(self, episode):
            nonlocal detail_misses
            room=episode_rooms.get(episode)
            key=(str(root),room_versions.get(room),episode)
            if key in DETAILS:
                DETAILS.move_to_end(key)
                return DETAILS[key]
            detail_misses+=1
            return retain(DETAILS,key,super().detail(episode),2500)
        def detail(self, episode):
            return copy.deepcopy(self.cached_detail(episode))
    public.context = ReadContext()
    public.coverage = Coverage.__new__(Coverage)
    public.coverage.store, public.coverage.db = public, database
    original_groups = conversations.group_episodes
    def room_groups(episodes,keywords):
        by_room_day={}
        order={episode['id']:index for index,episode in enumerate(episodes)}
        # Native detail resolves episodes within one KST anchor date. Matching
        # that boundary prevents a global snapshot from inventing another
        # canonical ID/signature for the same detail and review receipt.
        for episode in episodes:
            day=datetime.fromtimestamp(episode['anchor_ms']/1000,ZoneInfo('Asia/Seoul')).date().isoformat()
            by_room_day.setdefault((episode['room_id'],day),[]).append(episode)
        result=[]
        for (room,day),members in by_room_day.items():
            key=(str(root),room_versions.get(room),day,tuple(e['id'] for e in members),tuple(keywords))
            if key not in GROUPS:retain(GROUPS,key,original_groups(members,keywords),32)
            else:GROUPS.move_to_end(key)
            result.extend(copy.deepcopy(GROUPS[key]))
        return sorted(result,key=lambda group:(-group['anchor_ms'],order[group['members'][0]['id']]))
    patch(conversations,'group_episodes',room_groups)
    original_grouped = analytics.grouped
    def grouped(day, service):
        group_key=(str(root),fingerprint,day,service)
        if group_key not in GROUPED:retain(GROUPED,group_key,original_grouped(public,day,service),2)
        else:GROUPED.move_to_end(group_key)
        # The only consumers here are the existing read-only trends/briefing
        # functions; neither mutates episodes/groups. No cache escapes this worker.
        return GROUPED[group_key]
    patch(analytics, 'grouped', lambda _store, day=None, service='': grouped(day,service))
    insights = None
    def call(method, path, data=None):
        nonlocal insights
        if method != 'GET' or path != '/api/insights':
            raise ValueError('PROJECTION_PATH_NOT_ALLOWED')
        if insights is None:
            _,groups=grouped(None,'')
            fields=('id','room','anchor_ms','services','evaluations','keyword_counts','message_count','evidence_signature')
            def preview(group):
                meaningful=[m for m in group['messages'] if m.get('relation') not in ('unrelated','ignored_noise') and context_selection.dialogue(m)]
                words=[keyword for entry in public.keyword_groups() if entry['name'] in group['services'] for keyword in entry['keywords']]
                anchors=[i for i,m in enumerate(meaningful) if m.get('role')=='anchor'] or [i for i,m in enumerate(meaningful) if matches(m['text'],words)]
                if anchors:
                    start=max(0,min(anchors[0]-1,len(meaningful)-3))
                    excerpt=meaningful[start:start+3]
                else:
                    excerpt=[]
                connected=[m['time_ms'] for m in meaningful if m.get('role')=='anchor' or m.get('relation')=='related' or matches(m['text'],words)]
                return {'last_message_ms':max(connected,default=group['anchor_ms']),
                        'context_preview':[{'id':str(m['log_id']),'author':m.get('author_name') or '참여자','text':m['text'][:180],'at':m['time_ms'],'own':bool(m.get('own')),'truncated':len(m['text'])>180} for m in excerpt]}
            insights={'conversations':[{**{k:group[k] for k in fields},**preview(group),'members':[{k:member[k] for k in ('id','title')} for member in group['members']]} for group in groups],
                      'keyword_groups':public.keyword_overview()}
        return insights
    started = time.perf_counter()
    try:
        if endpoint == '/api/insights':
            result = copy.deepcopy(call('GET',endpoint))
            # Presentation metadata only; never change the evaluation objects used
            # to calculate collector correction conflict tokens.
            from monitor.classifications import token
            for group in result['conversations']:
                for evaluation in group['evaluations'].values():
                    evaluation['expected']=token({'signature':group['evidence_signature'],'evaluation':evaluation})
                ids=[member['id'] for member in group['members']]
                if not ids or not any(e.get('needs_review') for e in group['evaluations'].values()):continue
                reviews=database.execute('SELECT * FROM conversation_reviews WHERE anchor_id IN ('+','.join('?' for _ in ids)+') ORDER BY updated_at DESC,rowid DESC',ids).fetchall()
                for service,evaluation in group['evaluations'].items():
                    previous=next((dict(row) for row in reviews if row['service']==service),None)
                    if evaluation.get('needs_review') and previous:
                        evaluation['previous_verdict']=previous['verdict']
                        evaluation['previous_origin']='ai' if previous['summary'].startswith('[AI 확정] ') else 'human'
            result['coverage_summary'] = public.coverage.snapshot(limit=0)['counts']
            # No claim of a live connection from a DB snapshot.
            result['status'] = 'snapshot'
        elif endpoint == '/api/trends':
            result = analytics.trends(public,params.get('from'),params.get('to'),params.get('target',''))
        elif endpoint == '/api/briefing':
            result = workspace.get_briefing(public,params.get('day'))
            result['image_available'] = (root/'uploads/briefings'/('briefing-'+result['report']['day']+'.png')).is_file()
        elif endpoint == '/api/aliases':
            sys.path.insert(0,str(Path(__file__).resolve().parent))
            from alias_evidence import discover_candidates
            result=discover_candidates(public,int(params.get('days','14')))
        elif endpoint == '/api/classifications':
            result = Classifications(public.directory,call).listing(page=int(params.get('page','1')))
        else:
            raise ValueError('PROJECTION_PATH_NOT_ALLOWED')
        if endpoint == '/api/insights':
            result={key:result[key] for key in ('conversations','keyword_groups','coverage_summary','status')}
        retain(RESULTS,key,copy.deepcopy(result),16)
        return result, {'readMs':round(read_ms,1), 'computeMs':round((time.perf_counter()-started)*1000,1), 'detailComputations':detail_misses,'cached':False,'totalMs':round((time.perf_counter()-request_started)*1000,1)}
    finally:
        for module,name,original in reversed(originals):setattr(module,name,original)
        database.close()

if __name__ == '__main__':
    try:
        for line in sys.stdin:
            request=json.loads(line)
            try:
                result, metrics=compute(Path(request['legacyRoot']).resolve(),request['endpoint'],request.get('params',{}))
                print(json.dumps({'ok':True,'data':result,'metrics':metrics},ensure_ascii=False),flush=True)
            except Exception as error:
                print(json.dumps({'ok':False,'code':type(error).__name__,'status':400 if type(error) is ValueError and str(error) not in ('MISSING_ANALYTICS_TABLE','SETTING_NOT_ALLOWED','PROJECTION_PATH_NOT_ALLOWED') else 502,'message':'분석 조회를 완료하지 못했습니다.'}),flush=True)
    except Exception as error:
        print(json.dumps({'ok':False,'code':type(error).__name__,'message':'분석 조회를 완료하지 못했습니다.'}))
        sys.exit(1)

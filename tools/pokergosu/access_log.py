"""Read-only operational log projection; never fetches pages or reads message text."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
from zoneinfo import ZoneInfo


def category(event):
    if event.get('access'):
        return event['access']['kind']
    if event['outcome']=='success':return 'normal'
    reason=event.get('reason') or ''
    if reason in ('BOT_CHALLENGE','ACCESS_DENIED','RATE_LIMITED','ACCOUNT_RESTRICTION_NOTICE'):
        return {'BOT_CHALLENGE':'bot_challenge','ACCESS_DENIED':'access_denied','RATE_LIMITED':'rate_limited','ACCOUNT_RESTRICTION_NOTICE':'account_restriction_notice'}[reason]
    if reason=='ACCESS_RESTRICTED':return 'access_restricted_unknown'
    if reason=='USER_STOP':return 'user_stop'
    if reason.startswith('LOCAL_'):return 'local_error'
    if reason in ('WORKER_INTERRUPTED','NAVIGATION_FAILED','NAVIGATION_TIMEOUT'):return 'execution_error'
    if reason in ('TAB_CLOSED','TAB_CHANGED_OR_PERMISSION_LOST'):return 'tab_or_permission_change'
    if reason in ('BOARD_MARKUP_UNKNOWN','THREAD_MARKUP_UNKNOWN','COMMENT_COVERAGE_UNKNOWN','COMMENT_ID_OR_TEXT_UNKNOWN'):return 'content_validation_error'
    if event['outcome']=='inflight':return 'in_progress'
    return 'unclassified_error'


def timestamp(value):
    return datetime.fromtimestamp(value/1000,ZoneInfo('Asia/Seoul')).isoformat(timespec='seconds') if value is not None else None


def report(directory):
    filename=Path(directory).resolve()/'monitor.sqlite3'
    db=sqlite3.connect(filename.as_uri()+'?mode=ro',uri=True,timeout=1)
    try:
        db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        rows=db.execute("SELECT key,value FROM state WHERE key GLOB 'extension_monitor_event:*'").fetchall()
        snapshots={key.split(':',1)[1]:json.loads(value) for key,value in db.execute("SELECT key,value FROM state WHERE key GLOB 'extension_monitor:*'")}
        trial=db.execute("SELECT value FROM state WHERE key='extension_trial'").fetchone()
    finally:db.close()
    parsed=[]
    for key,value in rows:
        _,run_id,_=key.split(':')
        parsed.append((run_id,json.loads(value)))
    parsed.sort(key=lambda pair:(pair[1].get('startedAt') or 0,pair[0],pair[1]['sequence']))
    labels={'normal':'정상 저장','bot_challenge':'봇·사람 확인 화면','access_denied':'접근 거부 화면','rate_limited':'요청 제한 화면','account_restriction_notice':'계정 제한 안내','access_restricted_unknown':'접근 제한(유형 미확인)','user_stop':'사용자 중지','local_error':'로컬 수집기 오류','execution_error':'실행·연결 오류','tab_or_permission_change':'탭·권한 변경','content_validation_error':'본문·댓글 검증 실패','in_progress':'진행 중','unclassified_error':'분류되지 않은 오류'}
    successes=Counter();failures=Counter();events=[]
    for ordinal,(run_id,event) in enumerate(parsed,1):
        kind=category(event)
        evidence=event.get('access') or {}
        item={'record_type':'navigation','run_id':run_id,'request_number':event['sequence'],'cycle':event['cycle'],
              'started_at':timestamp(event.get('startedAt')),'finished_at':timestamp(event.get('finishedAt')),
              'page_type':'board_list' if event['url'].split('?')[0].rstrip('/').endswith('/free') else 'post',
              'url':event['url'],'outcome':event['outcome'],'category':kind,'category_label':labels.get(kind,'분류되지 않은 상태'),'reason':event.get('reason'),
              'successful_requests_before':successes[run_id],'all_runs_request_number':ordinal,
              'page_title':evidence.get('title'),'indicators':evidence.get('indicators',[]),
              'http_status':None,'basis':evidence.get('basis','successful-extraction-and-save' if kind=='normal' else 'runtime-state'),
              'account_ban_confirmed':False}
        if event.get('finishedAt') is not None and event.get('startedAt') is not None:item['duration_seconds']=round((event['finishedAt']-event['startedAt'])/1000,3)
        if 'comment_summary' in event:item['comment_summary']=event['comment_summary']
        events.append(item)
        if event['outcome']=='success':successes[run_id]+=1
        elif event['outcome']!='inflight':failures[run_id]+=1
    runs=[]
    for run_id,state in snapshots.items():
        run_events=[e for e in events if e['run_id']==run_id]
        issues=[e for e in run_events if e['category'] not in ('normal','in_progress')]
        first_issue=issues[0] if issues else None
        if first_issue is None and state['status'] in ('paused','stopped') and state.get('reason'):
            first_issue={'record_type':'run_pause','run_id':run_id,'request_number':None,
                         'after_request_number':state['navigations'],'successful_requests_before':successes[run_id],
                         'category':category({'outcome':'stopped','reason':state['reason']}),
                         'reason':state['reason'],'finished_at':timestamp(state.get('finishedAt')),
                         'account_ban_confirmed':False}
        runs.append({'run_id':run_id,'status':state['status'],'requests':state['navigations'],
                     'successful_requests':successes[run_id],'finished_issues':failures[run_id],
                     'threads_saved':state['threadsSaved'],'cycles_completed':state['cyclesCompleted'],
                     'discovery_gaps':state.get('discoveryGaps',0),'last_gap_at':timestamp(state.get('lastGapAt')),
                     'started_at':timestamp(state.get('startedAt')),'finished_at':timestamp(state.get('finishedAt')),
                     'phase':state['phase'],'in_flight':state['inFlight'],
                     'next_at':timestamp(state.get('nextAt')),'reason':state.get('reason'),
                     'first_issue':first_issue})
    return {'generated_at':datetime.now(timezone.utc).isoformat(timespec='seconds'),
            'runs':runs,'category_counts':dict(Counter(e['category'] for e in events)),
            'events':events,'previous_trial':json.loads(trial[0]) if trial else None,
            'limitations':['Page evidence does not establish an account ban.','No HTTP response status is observed by this extension.','Legacy ACCESS_RESTRICTED has no detailed page evidence.']}


def append_snapshot(db, directory, state, events=None):
    """Append a deduplicated projection after the canonical DB commit.

    A crash after file flush but before the marker commit may repeat an event ID;
    the SQLite archive remains authoritative and the ID supports deduplication.
    """
    import fcntl
    import hashlib
    import os
    path=Path(directory)/'collection-events.jsonl'
    records=[]
    for event in state['history'] if events is None else events:
        evidence=event.get('access') or {}
        records.append(('collection_log_nav:'+state['id']+':'+str(event['sequence']),
            {'record_type':'navigation','run_id':state['id'],'request_number':event['sequence'],
             'cycle':event['cycle'],'url':event['url'],'started_at':timestamp(event.get('startedAt')),
             'finished_at':timestamp(event.get('finishedAt')),'outcome':event['outcome'],
             'category':category(event),'reason':event.get('reason'),'page_title':evidence.get('title'),
             'indicators':evidence.get('indicators',[]),'http_status':None,'account_ban_confirmed':False}))
    for (_,record),event in zip(records,state['history'] if events is None else events):
        if 'comment_summary' in event:record['comment_summary']=event['comment_summary']
    records.append(('collection_log_run:'+state['id'],
        {'record_type':'run_state','run_id':state['id'],'status':state['status'],'phase':state['phase'],
         'requests':state['navigations'],'thread_reads':state['threadsSaved'],'completed_cycles':state['cyclesCompleted'],
         'discovery_gaps':state.get('discoveryGaps',0),'last_gap_at':timestamp(state.get('lastGapAt')),
         'reason':state.get('reason'),'next_at':timestamp(state.get('nextAt')),'finished_at':timestamp(state.get('finishedAt'))}))
    fd=os.open(path,os.O_RDWR|os.O_CREAT|os.O_APPEND,0o600)
    try:
        fcntl.flock(fd,fcntl.LOCK_EX)
        for key,record in records:
            encoded=json.dumps(record,ensure_ascii=False,sort_keys=True,separators=(',',':'))
            digest=hashlib.sha256(encoded.encode()).hexdigest()
            marker=db.execute('SELECT value FROM state WHERE key=?',(key,)).fetchone()
            if marker and marker[0]==digest:continue
            record['event_id']=digest
            record['recorded_at']=datetime.now(timezone.utc).isoformat(timespec='seconds')
            size=os.lseek(fd,0,os.SEEK_END)
            if size:
                os.lseek(fd,-1,os.SEEK_END)
                if os.read(fd,1)!=b'\n':os.write(fd,b'\n')
            content=(json.dumps(record,ensure_ascii=False)+'\n').encode()
            while content:
                written=os.write(fd,content)
                if written<=0:raise OSError('INCOMPLETE_LOG_WRITE')
                content=content[written:]
            os.fsync(fd)
            db.execute('INSERT OR REPLACE INTO state VALUES (?,?)',(key,digest))
            db.commit()
    finally:
        os.close(fd)


def backfill(directory):
    directory=Path(directory).resolve()
    if not (directory/'monitor.sqlite3').exists():return
    db=sqlite3.connect((directory/'monitor.sqlite3').as_uri()+'?mode=rw',uri=True,timeout=1)
    try:
        snapshots={key.split(':',1)[1]:json.loads(value) for key,value in db.execute("SELECT key,value FROM state WHERE key GLOB 'extension_monitor:*'")}
        groups={run:[] for run in snapshots}
        for key,value in db.execute("SELECT key,value FROM state WHERE key GLOB 'extension_monitor_event:*'"):
            run=key.split(':')[1]
            if run in groups:groups[run].append(json.loads(value))
        for run,state in snapshots.items():
            append_snapshot(db,directory,state,sorted(groups[run],key=lambda e:e['sequence']))
    finally:db.close()

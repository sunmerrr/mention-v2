import copy
"""Differential tests using original analytics code and only synthetic state."""
import hashlib
import importlib.util
import json
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

legacy=Path(sys.argv[1]);sys.path.insert(0,str(legacy))
from monitor.store import Store,KST
from monitor.context import Context
from monitor.coverage import Coverage
from monitor.classifications import Classifications
from monitor import analytics,workspace,conversations
spec=importlib.util.spec_from_file_location('projection',Path(__file__).parents[1]/'apps/read-api/src/adapters/projection_source.py')
projection=importlib.util.module_from_spec(spec);spec.loader.exec_module(projection)
checks=0
with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);state=root/'state/monitor';store=Store(state)
    store.rooms([{'chat_id':'1','name':'Synthetic A'},{'chat_id':'2','name':'Synthetic B'}])
    stamp=int(time.time())-86400
    def ingest(room,lid,text,offset=0,author='8'):
        store.ingest(room,{'log_id':str(lid),'type':1,'text':text,'author_id':author,'sent_at':str(stamp+offset)},'live')
    for room in ('1','2'):
        ingest(room,1,'APL 티켓 가격이 궁금합니다')
        ingest(room,2,'가격이 부담돼요',1)
        ingest(room,3,'룰루 가성비가 좋아요',2)
        ingest(room,4,'반갑습니다',3)
        ingest(room,5,'공식 안내 신규 가입 바로가기 https://example.invalid',4)
        ingest(room,6,'개츠비 이용은 어때요?',4000)
    day=datetime.fromtimestamp(stamp,KST).date().isoformat()
    group=store.context.insights()['conversations'][0]
    service=group['services'][0]
    conversations.review_conversation(store.context,group['id'],service,'negative','사람이 수정한 합성 평가')
    store.db.execute("INSERT INTO settings VALUES ('private_token','\"SYNTHETIC-SECRET-NEVER-READ\"')")
    store.db.execute('CREATE TABLE private_sentinel(text)')
    store.db.execute("INSERT INTO private_sentinel VALUES ('SYNTHETIC-PRIVATE-NEVER-READ')");store.db.commit()
    def compute(endpoint,params={}):
        before=hashlib.sha256((state/'monitor.sqlite3').read_bytes()).hexdigest()
        with patch.object(Store,'__init__',side_effect=AssertionError('Operational constructor called')),patch.object(Context,'__init__',side_effect=AssertionError('Context constructor called')),patch.object(Coverage,'__init__',side_effect=AssertionError('Coverage constructor called')):
            result,metrics=projection.compute(root,endpoint,params)
        assert before==hashlib.sha256((state/'monitor.sqlite3').read_bytes()).hexdigest(),'Source was modified'
        assert 'SYNTHETIC-SECRET' not in json.dumps(result) and 'SYNTHETIC-PRIVATE' not in json.dumps(result)
        return result,metrics
    def compare():
        global checks
        expected=store.context.insights();actual,_=compute('/api/insights')
        assert actual['keyword_groups']==expected['keyword_groups']
        compact=[]
        for group in expected['conversations']:
            compact.append({**{k:group[k] for k in ('id','room','anchor_ms','services','evaluations','keyword_counts','message_count','evidence_signature')},'members':[{k:m[k] for k in ('id','title')} for m in group['members']]})
        baseline=copy.deepcopy(actual['conversations'])
        for group in baseline:
            for evaluation in group['evaluations'].values():
                previous=evaluation.pop('previous_verdict',None)
                origin=evaluation.pop('previous_origin',None)
                if previous is not None:
                    assert evaluation['needs_review'] and previous in ('positive','negative','neutral','mixed','uncertain')
                    assert origin in ('ai','human')
        assert [{k:v for k,v in g.items() if k not in ('context_preview','last_message_ms')} for g in baseline]==compact,'Conversations differ'
        for group in actual['conversations']:
            assert len(group['context_preview'])<=3
            expected_group=next(g for g in expected['conversations'] if g['id']==group['id'])
            for preview in group['context_preview']:
                row=store.db.execute('SELECT text,time_ms,author_name FROM context_messages WHERE room_id=? AND log_id=?',(expected_group['room_id'],preview['id'])).fetchone()
                assert row and row['text'].startswith(preview['text']) and row['time_ms']==preview['at'],'Fabricated excerpt'
                assert preview['author']==(row['author_name'] or '참여자')
        checks+=1
        expected=analytics.trends(store,day,day);actual,_=compute('/api/trends',{'from':day,'to':day})
        assert actual==expected,'Trends differ';checks+=1
        expected=Classifications(state,lambda *_:store.context.insights()).listing();actual,_=compute('/api/classifications')
        assert actual==expected,'Classifications or evidence tokens differ';checks+=1
        expected=workspace.get_briefing(store,day);actual,_=compute('/api/briefing',{'day':day})
        actual.pop('image_available');expected.pop('generated_at');actual.pop('generated_at')
        assert actual==expected,'Briefing differs';checks+=1
    compare()
    _,warm=compute('/api/insights');assert warm['cached'] and warm['fastCache'] and warm['detailComputations']==0;checks+=1
    store.db.execute("UPDATE private_sentinel SET text='CHANGED-PRIVATE-NEVER-READ'");store.db.commit()
    _,private_change=compute('/api/insights');assert private_change['cached'];checks+=1
    ingest('1',7,'APL 가성비가 더 좋아졌나요?',4001)
    _,incremental=compute('/api/insights')
    assert 0<incremental['detailComputations']<len(store.context.listing()),'Unchanged room details were rebuilt'
    checks+=1
    compare()
    store.set_room_exclusions(['2'],True);compare()
    workspace.refresh_briefing(store,day);compare()
    store.configure(['2'],['APL','룰루','개츠비'],['APL 티켓 가격']);compare()
    memory,_read,_digest=projection.load_public_snapshot(state/'monitor.sqlite3')
    assert set(r[0] for r in memory.execute('SELECT key FROM settings'))<=set(projection.SETTINGS)
    assert not memory.execute("SELECT name FROM sqlite_master WHERE name='private_sentinel'").fetchall()
    try:memory.execute("INSERT INTO settings VALUES ('forbidden','true')")
    except Exception:pass
    else:raise AssertionError('Memory analytics DB accepted a write')
    memory.close();checks+=1
    store.db.close()
print(json.dumps({'checks':checks,'source_writes':0,'operational_constructors':0}))

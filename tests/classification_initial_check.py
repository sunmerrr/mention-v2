import sys,tempfile
from pathlib import Path
sys.path.insert(0,sys.argv[1])
sys.path.insert(0,str(Path('apps/read-api/src/adapters').resolve()))
from monitor.store import Store
from monitor.conversations import conversation,review_conversation
from monitor.classifications import Classifications
from classification_initial import options,save
with tempfile.TemporaryDirectory() as directory:
    store=Store(Path(directory));store.rooms([{'chat_id':'1','name':'Synthetic'}])
    store.ingest('1',{'log_id':'100','type':1,'text':'APL 티켓 가격은 어떤가요','author_id':'8','sent_at':'1794186000'},'live')
    group=store.context.insights()['conversations'][0]
    def call(method,path,data=None):
        if method=='GET':return conversation(store.context,group['id'])
        review_conversation(store.context,data['id'],data['service'],data['verdict'],data['summary']);return {'ok':True}
    audit=Classifications(directory,call)
    item=options(audit,group)[0]
    assert item['label']=='unreviewed' and item['origin'] is None
    data={'id':item['conversationId'],'service':item['target'],'verdict':'neutral','summary':'','expected':item['expected'],'request_id':'synthetic-first-choice'}
    try:save(audit,{**data,'expected':'wrong'})
    except ValueError as error:assert str(error)=='REVIEW_CONFLICT'
    else:raise AssertionError('Conflict accepted')
    save(audit,data);assert save(audit,data)['replayed']
    assert len([r for r in audit.records() if r['state']=='saved'])==1
    now=options(audit,call('GET','/api/conversation'))[0]
    assert now['label']=='neutral' and now['origin']=='human' and now['summary']==''
    save(audit,{**data,'expected':now['expected'],'request_id':'synthetic-note','summary':'Optional note'})
    assert call('GET','/api/conversation')['evaluations'][item['target']]['summary']=='Optional note'
    assert len([r for r in audit.records() if r['state']=='saved'])==2
    posts=[]
    def uncertain_call(method,path,data=None):
        if method=='GET':return group
        posts.append(data);raise OSError('Synthetic uncertain transport')
    uncertain=Classifications(Path(directory)/'uncertain',uncertain_call)
    try:save(uncertain,{**data,'request_id':'synthetic-uncertain'})
    except OSError:pass
    else:raise AssertionError('Uncertain send accepted')
    try:save(uncertain,{**data,'request_id':'synthetic-uncertain'})
    except ValueError as error:assert str(error)=='SAVE_RESULT_UNCERTAIN'
    else:raise AssertionError('Uncertain result replayed')
    assert len(posts)==1
print('first classification, optional memo, conflict and replay verified')

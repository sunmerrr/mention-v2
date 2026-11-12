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

# AI publication uses exact evidence and keeps its own attribution on pristine
# and stale-AI source snapshots. Human state is never imported as AI.
from copy import deepcopy
from monitor.classifications import AI_PREFIX

def ai_fixture():
    return {'id':'synthetic-ai-anchor','members':[{'id':'synthetic-ai-anchor'}],
            'evidence_signature':'synthetic-signature-1','room':'Synthetic room','anchor_ms':1794186000000,
            'messages':[{'log_id':'101','text':'APL 티켓 수령이 복잡해요','relation':'pending'}],
            'evaluations':{'APL':{'verdict':'unreviewed','summary':'','needs_review':False,'source':'mention'}}}

with tempfile.TemporaryDirectory() as directory:
    current_group=ai_fixture();posts=[]
    def ai_call(method,path,data=None):
        if method=='GET':return deepcopy(current_group)
        posts.append(deepcopy(data))
        current_group['evaluations']['APL'].update(verdict=data['verdict'],summary=data['summary'],needs_review=False,source='conversation_review')
        return {'ok':True}
    audit=Classifications(directory,ai_call)
    original=options(audit,current_group)[0]
    ai_data={'id':original['conversationId'],'service':'APL','verdict':'negative','summary':'티켓 수령 절차가 복잡하다는 불편을 말했습니다.','expected':original['expected'],'request_id':'synthetic-ai-first','origin':'ai','evidence':[{'log_id':'101','quote':'티켓 수령이 복잡해요'}]}
    for evidence in (None,[],[{'log_id':'101','quote':'없는 문장'}],[{'log_id':'999','quote':'APL'}]):
        try:save(audit,{**ai_data,'evidence':evidence})
        except ValueError as error:assert str(error)=='INVALID_EVIDENCE'
        else:raise AssertionError('AI evidence accepted without exact source')
    assert not posts and not audit.records()
    save(audit,ai_data);assert save(audit,ai_data)['replayed'];assert len(posts)==1
    try:save(audit,{**ai_data,'expected':'different-payload'})
    except ValueError as error:assert str(error)=='REVIEW_CONFLICT'
    else:raise AssertionError('AI request ID accepted different evidence token')
    assert current_group['evaluations']['APL']['summary']==AI_PREFIX+ai_data['summary']
    assert options(audit,current_group)[0]['origin']=='ai'
    current_group['evidence_signature']='synthetic-signature-2'
    current_group['evaluations']['APL'].update(verdict='unreviewed',needs_review=True)
    stale=options(audit,current_group)[0];assert stale['origin']=='ai' and stale['stale']
    save(audit,{**ai_data,'expected':stale['expected'],'request_id':'synthetic-ai-stale','summary':'추가 맥락에서도 절차 불편이 확인됩니다.'})
    assert len(posts)==2 and all(row['origin']=='ai' for row in audit.records())
    human=options(audit,current_group)[0]
    save(audit,{**ai_data,'origin':'human','expected':human['expected'],'request_id':'synthetic-human-after-ai','summary':'사람이 확인한 판단'})
    current_group['evidence_signature']='synthetic-signature-3'
    current_group['evaluations']['APL'].update(verdict='unreviewed',needs_review=True)
    latest=options(audit,current_group)[0]
    try:save(audit,{**ai_data,'expected':latest['expected'],'request_id':'synthetic-ai-after-human'})
    except ValueError as error:assert str(error)=='HUMAN_REVIEW_EXISTS'
    else:raise AssertionError('AI replaced stale human decision')
    assert len(posts)==3

with tempfile.TemporaryDirectory() as directory:
    snapshot=ai_fixture();posts=[]
    def uncertain_ai_call(method,path,data=None):
        if method=='GET':return deepcopy(snapshot)
        posts.append(data);raise OSError('Synthetic uncertain AI write')
    audit=Classifications(directory,uncertain_ai_call)
    expected=options(audit,snapshot)[0]['expected']
    data={**ai_data,'expected':expected,'request_id':'synthetic-ai-uncertain'}
    try:save(audit,data)
    except OSError:pass
    else:raise AssertionError('AI uncertain write accepted')
    for request in ('synthetic-ai-uncertain','synthetic-ai-new-request'):
        try:save(audit,{**data,'request_id':request})
        except ValueError as error:assert str(error)=='SAVE_RESULT_UNCERTAIN'
        else:raise AssertionError('AI uncertain write was repeated')
    assert len(posts)==1
print('AI origin, exact quotes, stale-AI refresh, human precedence and uncertain no-replay verified')

for note in ('','Legacy manual note without a web audit'):
    with tempfile.TemporaryDirectory() as directory:
        snapshot=ai_fixture();snapshot['evaluations']['APL'].update(verdict='unreviewed',needs_review=True,summary=note,source='individual_reviews')
        posts=[]
        def legacy_human_call(method,path,data=None):
            if method=='GET':return deepcopy(snapshot)
            posts.append(data);raise AssertionError('Must not overwrite native human review')
        audit=Classifications(directory,legacy_human_call)
        option=options(audit,snapshot)[0]
        assert option['origin']=='human' and option['stale']
        try:save(audit,{**ai_data,'expected':option['expected'],'request_id':'synthetic-old-native-human'})
        except ValueError as error:assert str(error)=='HUMAN_REVIEW_EXISTS'
        else:raise AssertionError('AI replaced native stale human without audit history')
        assert not posts

with tempfile.TemporaryDirectory() as directory:
    snapshot=ai_fixture()
    snapshot['evaluations']['APL'].update(verdict='neutral',summary=AI_PREFIX+'Synthetic existing AI summary',needs_review=False)
    audit=Classifications(directory,lambda *args: deepcopy(snapshot))
    audit.append({'request_id':'synthetic-prior-human','anchor_id':snapshot['id'],'service':'APL','origin':'human','state':'saved','next':{'verdict':'neutral','summary':'Human decision'}})
    assert options(audit,snapshot)[0]['origin']=='human'
    assert not options(audit,snapshot)[0]['stale']

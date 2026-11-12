"""Evidence-bound AI publication and audited first manual classifications."""
from datetime import datetime, timezone
from monitor.classifications import AI_PREFIX, VERDICTS, LOCK, token

def options(classifications, group):
    events=classifications.records()
    result=[]
    members={member['id'] for member in group['members']}
    from monitor.classifications import token,clean_summary
    for service,evaluation in group['evaluations'].items():
        history=[event for event in events if event.get('anchor_id') in members and event.get('service')==service and event.get('state')=='saved']
        label=evaluation['verdict']
        if label=='unreviewed' and evaluation['needs_review'] and history:label=history[-1]['next']['verdict']
        origin=None if label=='unreviewed' else ('ai' if evaluation['summary'].startswith(AI_PREFIX) else 'human')
        if evaluation['needs_review']:
            # A stale native conversation review still has an author even when
            # it predates the web audit. An empty non-AI note is human too.
            origin='ai' if evaluation['summary'].startswith(AI_PREFIX) else 'human'
        if any(event.get('origin')!='ai' for event in history):origin='human'
        result.append({'id':group['id']+':'+service,'conversationId':group['id'],'target':service,'label':label,'summary':clean_summary(evaluation['summary']),'origin':origin,'stale':evaluation['needs_review'],'expected':token({'signature':group['evidence_signature'],'evaluation':evaluation}),'room':group['room'],'at':group['anchor_ms'],'history':[]})
    return result

def _save_ai(classifications, data):
    """Publish only against current evidence; never overwrite a human decision."""
    fields=('id','service','verdict','summary','request_id','expected')
    if (not all(isinstance(data.get(key),str) for key in fields)
            or data['verdict'] not in VERDICTS or not data['summary'].strip()
            or len(data['summary'])>2800 or not 8<=len(data['request_id'])<=100):
        raise ValueError('INVALID_CLASSIFICATION')
    with LOCK:
        records=classifications.records()
        previous=[row for row in records if row.get('request_id')==data['request_id']]
        if previous:
            saved=next((row for row in previous if row.get('state')=='saved'),None)
            if saved is None:raise ValueError('SAVE_RESULT_UNCERTAIN')
            if (saved.get('origin')=='ai' and saved.get('requested_id',saved['anchor_id'])==data['id']
                    and saved['service']==data['service']
                    and saved['next']=={'verdict':data['verdict'],'summary':data['summary']}
                    and saved.get('evidence',[])==data.get('evidence',[])
                    and data['expected']==token({'signature':saved['signature'],'evaluation':saved['previous']})):
                return {'ok':True,'replayed':True}
            raise ValueError('REVIEW_CONFLICT')
        group,evaluation,expected=classifications.current(data['id'],data['service'])
        if data['expected']!=expected:raise ValueError('REVIEW_CONFLICT')
        members={member['id'] for member in group['members']}
        attempts={}
        for row in records:
            if row.get('service')==data['service'] and (row.get('requested_id')==data['id'] or row.get('anchor_id') in members):attempts[row['request_id']]=row
        if any(row.get('state') in ('saving','unknown') for row in attempts.values()):raise ValueError('SAVE_RESULT_UNCERTAIN')
        history=[row for row in records if row.get('state')=='saved' and row.get('anchor_id') in members and row.get('service')==data['service']]
        if (any(row.get('origin')!='ai' for row in history)
                or (evaluation.get('needs_review') and not evaluation.get('summary','').startswith(AI_PREFIX))
                or (evaluation.get('source')=='conversation_review' and not evaluation.get('summary','').startswith(AI_PREFIX))
                or (evaluation['verdict']!='unreviewed' and not evaluation.get('summary','').startswith(AI_PREFIX))):
            raise ValueError('HUMAN_REVIEW_EXISTS')
        evidence=data.get('evidence')
        messages={message['log_id']:message['text'] for message in group['messages'] if message.get('relation') not in ('unrelated','ignored_noise')}
        if not isinstance(evidence,list) or not 1<=len(evidence)<=5:raise ValueError('INVALID_EVIDENCE')
        for item in evidence:
            if (not isinstance(item,dict) or not isinstance(item.get('quote'),str) or not item['quote']
                    or len(item['quote'])>2000 or not isinstance(item.get('log_id'),str) or item.get('log_id') not in messages
                    or item['quote'] not in messages[item['log_id']]):raise ValueError('INVALID_EVIDENCE')
        record={'request_id':data['request_id'],'requested_id':data['id'],'anchor_id':group['id'],'service':data['service'],'origin':'ai','at':datetime.now(timezone.utc).isoformat(),'signature':group['evidence_signature'],'previous':evaluation,'next':{'verdict':data['verdict'],'summary':data['summary']},'evidence':evidence}
        classifications.append({**record,'state':'saving'})
        summary=AI_PREFIX+data['summary']
        try:
            classifications.call('POST','/conversation-review',{'id':group['id'],'service':data['service'],'verdict':data['verdict'],'summary':summary})
            checked,current,_=classifications.current(group['id'],data['service'])
            if checked['evidence_signature']!=group['evidence_signature'] or current['verdict']!=data['verdict'] or current['summary']!=summary:raise ValueError('SAVE_RESULT_UNCERTAIN')
        except Exception:
            classifications.append({**record,'state':'unknown'});raise
        classifications.append({**record,'state':'saved'})
        return {'ok':True,'id':group['id'],'verdict':data['verdict'],'origin':'ai'}


def save(classifications, data):
    if data.get('origin')=='ai':return _save_ai(classifications,data)
    try:return classifications.save(data,'human')
    except ValueError as error:
        if str(error)!='NO_CONFIRMED_LABEL':raise
    # save() already validated payload and request replay/conflict before rejecting
    # a pristine evaluation. Recheck current evidence before this first decision.
    group,evaluation,expected=classifications.current(data['id'],data['service'])
    if data['expected']!=expected:raise ValueError('REVIEW_CONFLICT')
    if evaluation['verdict']!='unreviewed' or evaluation['needs_review']:raise ValueError('REVIEW_CONFLICT')
    record={'request_id':data['request_id'],'requested_id':data['id'],'anchor_id':group['id'],'service':data['service'],'origin':'human','at':datetime.now(timezone.utc).isoformat(),'signature':group['evidence_signature'],'previous':evaluation,'next':{'verdict':data['verdict'],'summary':data['summary']},'evidence':[]}
    classifications.append({**record,'state':'saving'})
    try:
        classifications.call('POST','/conversation-review',{'id':group['id'],'service':data['service'],'verdict':data['verdict'],'summary':data['summary']})
        checked,current,_=classifications.current(group['id'],data['service'])
        if checked['evidence_signature']!=group['evidence_signature'] or current['verdict']!=data['verdict'] or current['summary']!=data['summary']:raise ValueError('SAVE_RESULT_UNCERTAIN')
    except Exception:
        classifications.append({**record,'state':'unknown'});raise
    classifications.append({**record,'state':'saved'})
    return {'ok':True,'id':group['id'],'verdict':data['verdict'],'origin':'human'}

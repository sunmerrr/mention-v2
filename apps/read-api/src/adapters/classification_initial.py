"""Audited first human classification through the existing collector IPC contract."""
from datetime import datetime, timezone
from monitor.classifications import AI_PREFIX

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
        if history and evaluation['needs_review']:origin=history[-1]['origin']
        result.append({'id':group['id']+':'+service,'conversationId':group['id'],'target':service,'label':label,'summary':clean_summary(evaluation['summary']),'origin':origin,'stale':evaluation['needs_review'],'expected':token({'signature':group['evidence_signature'],'evaluation':evaluation}),'room':group['room'],'at':group['anchor_ms'],'history':[]})
    return result

def save(classifications, data):
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

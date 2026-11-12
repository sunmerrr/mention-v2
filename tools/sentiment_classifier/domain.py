"""Sentiment queue policy, independent of transport, scheduling and models."""
import hashlib
import json

DECISIONS={'positive','negative','neutral','mixed','uncertain','excluded'}

def human_owned(evaluation):
    return evaluation.get('origin')=='human' or (evaluation.get('previous') or {}).get('origin')=='human'

def eligible(conversation,target,previous_expected=None,now_ms=None,settle_ms=120000):
    evaluation=conversation.get('evaluations',{}).get(target)
    if not evaluation or human_owned(evaluation):return False
    if now_ms is not None and conversation.get('lastAt',conversation['at'])>now_ms-settle_ms:return False
    pending=evaluation.get('label')=='unreviewed' or evaluation.get('stale')
    changed_ai=evaluation.get('origin')=='ai' and previous_expected is not None and previous_expected!=evaluation.get('expected')
    return bool(pending or changed_ai)

def job_key(identifier,target,expected):
    return hashlib.sha256(json.dumps([identifier,target,expected],ensure_ascii=False).encode()).hexdigest()

def validate(proposal,item):
    if proposal.get('id')!=item['id'] or proposal.get('target')!=item['target']:raise ValueError('TARGET_MISMATCH')
    if proposal.get('verdict') not in DECISIONS:raise ValueError('INVALID_VERDICT')
    summary=proposal.get('summary')
    if not isinstance(summary,str) or not summary.strip() or len(summary)>2800:raise ValueError('INVALID_REASON')
    evidence=proposal.get('evidence')
    if not isinstance(evidence,list) or not 1<=len(evidence)<=5:raise ValueError('INVALID_EVIDENCE')
    messages={m['id']:m for m in item['messages']}
    for entry in evidence:
        message=messages.get(entry.get('log_id'))
        quote=entry.get('quote')
        if not message or message.get('relation') in ('unrelated','ignored_noise') or not isinstance(quote,str) or not quote or len(quote)>2000 or quote not in message.get('text',''):raise ValueError('INVALID_EVIDENCE')
    return {key:proposal[key] for key in ('verdict','summary','evidence')}

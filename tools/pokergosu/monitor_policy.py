"""Validation of local browser monitoring state; no persistence or networking."""
import math
from domain import access_evidence, comment_summary
import re
from urllib.parse import urlparse


def monitor_url(value):
    if not isinstance(value,str) or len(value)>200:
        raise ValueError('INVALID_MONITOR_URL')
    url=urlparse(value)
    if url.scheme!='https' or url.netloc!='www.pokergosu.com' or url.fragment:
        raise ValueError('INVALID_MONITOR_URL')
    if url.path.rstrip('/')=='/free' and url.query in ('','page=1','page=2','page=3','page=4','page=5'):
        return value
    if re.fullmatch(r'/free/[1-9][0-9]{0,18}',url.path) and not url.query:
        return value
    raise ValueError('INVALID_MONITOR_URL')


def monitor_record(value):
    if not isinstance(value,dict) or not isinstance(value.get('id'),str) or not re.fullmatch(r'[a-f0-9-]{36}',value['id']):
        raise ValueError('INVALID_MONITOR')
    clean={'id':value['id']}
    for key in ('tabId','page','cycle','cyclesCompleted','cycleRequests','navigations','threadsSaved','matchedThreads','metadataWarnings','pendingThreads','discoveryGaps','index'):
        number=value.get(key)
        if type(number) is not int or not 0<=number<=10**12:
            raise ValueError('INVALID_MONITOR_COUNTER')
        clean[key]=number
    if not 1<=clean['page']<=5 or clean['cycle']<1 or clean['cyclesCompleted']>clean['cycle'] or clean['cycleRequests']>12 or clean['matchedThreads']>clean['threadsSaved'] or clean['threadsSaved']>clean['navigations'] or clean['metadataWarnings']>clean['threadsSaved']:
        raise ValueError('INVALID_MONITOR_BUDGET')
    for key,allowed in (('status',('running','paused','stopped')),('phase',('board','thread','return','rest'))):
        if value.get(key) not in allowed:raise ValueError('INVALID_MONITOR_STATE')
        clean[key]=value[key]
    clean['expectedUrl']=monitor_url(value.get('expectedUrl'))
    for key in ('startedAt','finishedAt','nextAt','lastGapAt','cycleStartedAt'):
        stamp=value.get(key)
        if stamp is not None and (type(stamp) not in (int,float) or not math.isfinite(stamp) or not 0<=stamp<9e15):
            raise ValueError('INVALID_MONITOR_TIME')
        clean[key]=stamp
    if type(value.get('inFlight')) is not bool:raise ValueError('INVALID_MONITOR_STATE')
    clean['inFlight']=value['inFlight']
    if type(value.get('schedulePolicy',1)) is not int or value.get('schedulePolicy',1) not in (1,2):raise ValueError('INVALID_SCHEDULE_POLICY')
    clean['schedulePolicy']=value.get('schedulePolicy',1)
    if type(value.get('discoveryOverlap',False)) is not bool:raise ValueError('INVALID_MONITOR_OVERLAP')
    clean['discoveryOverlap']=value.get('discoveryOverlap',False)
    reason=value.get('reason')
    if reason is not None and (not isinstance(reason,str) or len(reason)>100):raise ValueError('INVALID_MONITOR_REASON')
    clean['reason']=reason
    if clean['status']!='running' and (clean['inFlight'] or clean['nextAt'] is not None):raise ValueError('INVALID_MONITOR_STOP')
    if clean['status']=='running' and not clean['inFlight'] and clean['nextAt'] is None:raise ValueError('INVALID_MONITOR_SCHEDULE')
    for key in ('previousHeadIds','currentHeadIds'):
        ids=value.get(key)
        if not isinstance(ids,list) or len(ids)>300 or any(not isinstance(x,str) or not re.fullmatch(r'[1-9][0-9]{0,18}',x) for x in ids):raise ValueError('INVALID_MONITOR_HEAD')
        clean[key]=ids
    queue=value.get('queue')
    if not isinstance(queue,list) or len(queue)>6 or clean['index']>len(queue):raise ValueError('INVALID_MONITOR_PLAN')
    clean['queue']=[]
    for post in queue:
        if not isinstance(post,dict) or not isinstance(post.get('id'),str) or not re.fullmatch(r'[1-9][0-9]{0,18}',post['id']) or post.get('url')!='https://www.pokergosu.com/free/'+post['id']:
            raise ValueError('INVALID_MONITOR_PLAN')
        clean['queue'].append({'id':post['id'],'url':post['url']})
    if len({p['id'] for p in clean['queue']})!=len(queue) or (clean['phase']=='thread' and clean['index']>=len(queue)):
        raise ValueError('INVALID_MONITOR_PLAN')
    history=value.get('history')
    if not isinstance(history,list) or len(history)!=min(50,clean['navigations']):raise ValueError('INVALID_MONITOR_HISTORY')
    clean['history']=[]
    for sequence,event in enumerate(history,clean['navigations']-len(history)+1):
        if not isinstance(event,dict) or event.get('sequence')!=sequence or event.get('outcome') not in ('inflight','success','stopped','unknown'):
            raise ValueError('INVALID_MONITOR_HISTORY')
        e={key:event.get(key) for key in ('sequence','cycle','startedAt','finishedAt','outcome','reason')}
        if type(e['cycle']) is not int or not 1<=e['cycle']<=clean['cycle']:raise ValueError('INVALID_MONITOR_HISTORY')
        for key in ('startedAt','finishedAt'):
            if e[key] is not None and (type(e[key]) not in (int,float) or not math.isfinite(e[key]) or not 0<=e[key]<9e15):raise ValueError('INVALID_MONITOR_TIME')
        if e['reason'] is not None and (not isinstance(e['reason'],str) or len(e['reason'])>100):raise ValueError('INVALID_MONITOR_REASON')
        e['url']=monitor_url(event.get('url'))
        if event.get('comment_summary') is not None:e['comment_summary']=comment_summary(event['comment_summary'])
        if event.get('access') is not None:e['access']=access_evidence(event['access'])
        if e['outcome']=='inflight' and sequence!=clean['navigations']:raise ValueError('INVALID_MONITOR_HISTORY')
        clean['history'].append(e)
    if clean['inFlight']!=bool(history and history[-1]['outcome']=='inflight'):raise ValueError('INVALID_MONITOR_INFLIGHT')
    return clean


def monitor_transition(previous, current):
    if not previous:return
    if previous['status']!='running' and previous!=current:raise ValueError('MONITOR_ALREADY_FINISHED')
    if current['tabId']!=previous['tabId'] or current['startedAt']!=previous['startedAt']:
        raise ValueError('MONITOR_IDENTITY_CONFLICT')
    if current['navigations']<previous['navigations'] or current['navigations']>previous['navigations']+1:
        raise ValueError('MONITOR_COUNTER_REGRESSION')
    for key in ('threadsSaved','matchedThreads','cyclesCompleted','discoveryGaps'):
        if current[key]<previous[key]:raise ValueError('MONITOR_COUNTER_REGRESSION')

"""Reuse the existing collector's public HTTP contract without its retired web UI."""
import base64
import json
import sys
from pathlib import Path
from urllib.parse import parse_qs,urlparse

request=json.load(sys.stdin)
root=Path(request['legacyRoot']).resolve()
sys.path.insert(0,str(root))
from monitor.ipc import CollectorConnection
from monitor.classifications import Classifications

endpoint=urlparse(request['path']);query=parse_qs(endpoint.query)
allowed={'/api/keyword-processing','/api/insights','/api/conversation','/api/keywords','/api/rooms','/api/guide','/api','/api/trends','/api/campaigns','/api/campaign-comparison','/api/briefing','/api/briefing-delivery','/api/bookmarks','/api/aliases','/api/operations','/api/episode','/results.json'}
actions={'/keyword-settings','/keyword-check','/room-settings','/guide-settings','/bookmark-save','/bookmark-archive','/alias-decision','/briefing-refresh','/briefing-recipient','/briefing-delivery-settings','/briefing-send','/backup-create','/backup-verify','/campaign-start','/campaign-send','/campaign-stop','/context-expand','/episode-review','/episode-quality','/conversation-review','/conversation-message-review','/review-undo','/mention-correction','/feedback-review'}
local_actions={'/briefing-recipient','/briefing-delivery-settings','/briefing-send','/backup-create','/backup-verify','/campaign-send'}
class ResponseError(Exception):
    def __init__(self,status,message):self.status=status;self.message=message

def call(method,path,data=None):
    parsed=urlparse(path)
    import re
    binary=bool(re.fullmatch(r'/photo/[1-9][0-9]{0,18}/[1-9][0-9]{0,18}/[0-9]{1,3}|/download/(?:context-)?[0-9]{4}-[0-9]{2}-[0-9]{2}\.csv|/download/briefing-[0-9]{4}-[0-9]{2}-[0-9]{2}\.png',parsed.path))
    if method=='GET' and parsed.path not in allowed and not binary:raise ValueError('READ_PATH_NOT_ALLOWED')
    if method=='POST' and (not request.get('writesEnabled') or parsed.path not in actions or (parsed.path in local_actions and not request.get('local'))):raise ValueError('WRITES_DISABLED')
    connection=CollectorConnection(root/'state/monitor/collector.sock',timeout=125)
    try:
        connection.request(method,path,json.dumps(data,ensure_ascii=False).encode() if data is not None else None,{'Host':'127.0.0.1:8766','Origin':'http://127.0.0.1:8766','X-Monitor-Public':'0' if request.get('local') else '1','Content-Type':'application/json'})
        response=connection.getresponse();body=response.read()
        if response.status==404 and parsed.path=='/api/keyword-processing':return {'supported':False}
        if response.status not in (200,202):
            try:message=json.loads(body).get('message','입력 값과 현재 상태를 확인해 주세요.')
            except ValueError:message='입력 값과 현재 상태를 확인해 주세요.'
            raise ResponseError(response.status,message)
        if binary or parsed.path=='/results.json':return {'binary':base64.b64encode(body).decode(),'contentType':response.getheader('Content-Type','application/octet-stream'),'disposition':response.getheader('Content-Disposition','')}
        return json.loads(body)
    finally:connection.close()

try:
    if endpoint.path=='/api/classifications':
        data=Classifications(root/'state/monitor',call).listing(page=int(query.get('page',['1'])[0]))
    elif endpoint.path=='/api/classifications-for-conversation':
        from classification_initial import options
        from urllib.parse import quote
        group=call('GET','/api/conversation?id='+quote(query.get('id',[''])[0],safe=''))
        data=options(Classifications(root/'state/monitor',call),group)
    elif endpoint.path=='/classification-save'  and request.get('writesEnabled'):
        import fcntl,os
        fd=os.open(root/'state/monitor/classification-write.lock',os.O_CREAT|os.O_WRONLY,0o600)
        with os.fdopen(fd,'w') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX)
            from classification_initial import save
            data=save(Classifications(root/'state/monitor',call),request['input'])
    else:data=call('POST' if request.get('input') is not None else 'GET',request['path'],request.get('input'))
    if endpoint.path=='/api/conversation' and request.get('input') is None:
        from monitor.context_selection import annotate
        summary=annotate(data.get('messages',[]))
        data['context_summary']=summary
        data['dialogue_phase_counts']={phase:counts['dialogue'] for phase,counts in summary['phases'].items()}
    print(json.dumps({'ok':True,'data':data},ensure_ascii=False))
except Exception as error:
    conflict_codes={'REVIEW_CONFLICT','HUMAN_REVIEW_EXISTS','SOURCE_CHANGED','SAVE_RESULT_UNCERTAIN','AI_REVIEW_UNKNOWN'}
    status=409 if isinstance(error,ValueError) and str(error) in conflict_codes else 400 if isinstance(error,ValueError) else getattr(error,'status',502)
    print(json.dumps({'ok':False,'code':str(error) if isinstance(error,ValueError) else type(error).__name__,'status':status,'message':getattr(error,'message','요청을 완료하지 못했습니다.')}))
    sys.exit(1)

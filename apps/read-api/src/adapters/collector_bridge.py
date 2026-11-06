"""Reuse the existing collector's public HTTP contract without its retired web UI."""
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
allowed={'/api/insights','/api/conversation','/api/runtime'}
def call(method,path,data=None):
    parsed=urlparse(path)
    if method=='GET' and parsed.path not in allowed:raise ValueError('READ_PATH_NOT_ALLOWED')
    if method=='POST' and (not request.get('writesEnabled') or parsed.path!='/conversation-review'):raise ValueError('WRITES_DISABLED')
    connection=CollectorConnection(root/'state/monitor/collector.sock',timeout=18)
    try:
        connection.request(method,path,json.dumps(data,ensure_ascii=False).encode() if data is not None else None,{'Host':'127.0.0.1:8766','Origin':'http://127.0.0.1:8766','X-Monitor-Public':'1','Content-Type':'application/json'})
        response=connection.getresponse();body=response.read()
        if response.status!=200:raise ValueError('COLLECTOR_REQUEST_FAILED')
        return json.loads(body)
    finally:connection.close()

try:
    if endpoint.path=='/api/classifications':
        data=Classifications(root/'state/monitor',call).listing(page=int(query.get('page',['1'])[0]))
    elif endpoint.path=='/classification-save' and request.get('writesEnabled'):
        data=Classifications(root/'state/monitor',call).save(request['input'],'human')
    else:data=call('GET',request['path'])
    print(json.dumps({'ok':True,'data':data},ensure_ascii=False))
except Exception as error:
    print(json.dumps({'ok':False,'code':str(error) if isinstance(error,ValueError) else type(error).__name__}))
    sys.exit(1)

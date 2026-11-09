"""Alias discovery checks with synthetic messages only."""
import json
from pathlib import Path
import sys
import tempfile
import time
from unittest.mock import patch
sys.path.insert(0,sys.argv[1]);sys.path.insert(0,str(Path(__file__).parents[1]/'apps/read-api/src/adapters'))
from monitor.store import Store
from monitor import alias_discovery
from alias_evidence import conversational_records,discover_candidates
stamp=int(time.time()*1000)
def row(text,index,author=None):return {'room_id':'1','room':'Synthetic','log_id':str(index),'type':1,'text':text,'author_id':author or str(index),'author_name':'Synthetic','event_ms':stamp+index,'time_ms':stamp+index,'own':0}
ads=[row(f'APL 공식 안내 신규 가입 많은 참여 에이피엘 Poker Lulu 추천문구 {i} https://example.invalid/{i}',i) for i in range(1,4)]
ordinary=[row('에이피엘 가격이 비싸요?',10),row('룰루 별칭 룰로 맞나요?',11),row('APL 티켓 10만원이면 너무 비싸요?',12),row('APL 티켓 20만원이면 너무 비싸요?',13),row('APL 공식 안내 신규 가입 혜택이 왜 이렇게 비싸요?',14)]
schedule=row('APL GTD 상금 보장 바이인 엔트리 일정 https://example.invalid',20)
pool=ads+ordinary+[schedule]
filtered=conversational_records(pool)
assert filtered==ordinary,'Promotions were retained or meaningful questions removed'
with tempfile.TemporaryDirectory() as directory:
 store=Store(directory);store.configure([],['APL','룰루'])
 with patch.object(alias_discovery,'records',return_value=pool):
  original=alias_discovery.discover(store)
  result=discover_candidates(store)
 assert result['promotion_messages_excluded']==4
 assert result['scanned']==len(ordinary)
 candidates={c['token']:c for c in result['candidates']}
 assert 'Poker Lulu' not in candidates,'Promotion-only alias survived'
 apl=candidates['에이피엘'];assert apl['group_name']=='APL' and apl['occurrences']==1
 assert all('example.invalid' not in example['text'] for candidate in result['candidates'] for example in candidate['examples'])
 assert {c['token_key'] for c in result['candidates']}<={c['token_key'] for c in original['candidates']},'Would bypass collector alias validation'
 store.db.close()
print(json.dumps({'checks':7,'source_writes':0}))

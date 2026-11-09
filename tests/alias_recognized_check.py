"""Existing collector recognition must suppress unnecessary alias suggestions."""
import sys,json,tempfile,time
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,sys.argv[1]);sys.path.insert(0,str(Path(__file__).parents[1]/'apps/read-api/src/adapters'))
from monitor.store import Store
from monitor.rules import matches
from monitor import alias_discovery
from alias_evidence import discover_candidates
keywords=['APL','에이피엘','룰루','루루','개츠비','포커룰루','길드']
covered=['apl줌','apl티켓','APL은','ＡＰＬ줌','개츠비님','개츠비로','개츠비2','룰루야','포커룰루지','길드원','개츠비결정']
novel=['ap1','에이필엘','룰로','Poker Lulu']
assert all(matches(token,keywords) for token in covered)
assert all(not matches(token,keywords) for token in novel)
with tempfile.TemporaryDirectory() as directory:
 store=Store(directory);store.configure([],keywords)
 group=next(g for g in store.keyword_groups() if g['name']=='APL')
 candidates=[{'token':token,'token_key':alias_discovery.identity(token),'method':'spelling','group_id':group['id'],'group_name':'APL','occurrences':1,'examples':[]} for token in covered+novel]
 def discovery(*_):return {'candidates':[dict(c) for c in candidates],'total':len(candidates),'scanned':0,'groups':[],'decisions':[]}
 with patch.object(alias_discovery,'discover',side_effect=discovery),patch.object(alias_discovery,'records',return_value=[]):
  result=discover_candidates(store)
 assert [c['token'] for c in result['candidates']]==novel,'New spellings were lost or covered derivatives survived'
 assert result['already_recognized_excluded']==len(covered)
 assert store.setting('keywords',[])==keywords,'Collection rules changed'
 # Verify the real discovery pipeline also suppresses the reported production case.
 stamp=int(time.time()*1000)
 def row(text,i):return {'room_id':'1','room':'Synthetic','log_id':str(i),'type':1,'text':text,'author_id':str(i),'author_name':'Synthetic','event_ms':stamp+i,'time_ms':stamp+i,'own':0}
 pool=[row('Kk 대회권 apl줌?',1),row('APL은 개츠비님한테 물어봤나요?',2),row('APL 말고 ap1이라고 쓴 건가요?',3)]
 with patch.object(alias_discovery,'records',return_value=pool):
  baseline=alias_discovery.discover(store);result=discover_candidates(store)
 assert any(c['token']=='apl줌' for c in baseline['candidates']),'Reported failure was not reproduced'
 assert all(not matches(c['token'],keywords) for c in result['candidates'])
 assert any(c['token']=='ap1' for c in result['candidates']),'A real unrecognized spelling disappeared'
 store.db.close()
print(json.dumps({'covered':len(covered),'preserved':len(novel),'real_pipeline':True,'collection_rules_changed':False}))

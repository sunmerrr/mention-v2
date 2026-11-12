"""Synthetic APIs only: scheduling, exact evidence, human priority and replay safety."""
import copy,json,tempfile,time,unittest
from pathlib import Path
from tools.sentiment_classifier.domain import eligible,validate
from tools.sentiment_classifier.service import Queue

class FakeApi:
    def __init__(self):
        self.rows=[{'id':'synthetic','at':1,'lastAt':1,'evaluations':{'포커룰루':{'label':'unreviewed','origin':None,'expected':'v1'}}}]
        self.calls=[];self.fail=False;self.receipts={}
    def listing(self,target):return copy.deepcopy(self.rows)
    def snapshot(self,id,target):
        e=self.rows[0]['evaluations'][target]
        return {'id':id,'target':target,'expected':e['expected'],'current':dict(e),'conversation':copy.deepcopy(self.rows[0]),'messages':[{'id':'1','text':'길드 가입은 어떻게 하나요?','relation':'pending'}],'limited':False}
    def call(self,path,payload=None):
        if path.startswith('/api/classifications/request-state/'):
            return {'state':self.receipts.get(path.rsplit('/',1)[-1],'not_found')}
        self.calls.append(copy.deepcopy(payload))
        if self.fail:raise OSError('synthetic uncertain outcome')
        self.rows[0]['evaluations'][payload['service']].update(label=payload['verdict'],origin='ai',summary=payload['summary'],expected='saved-v1')
        self.receipts[payload['request_id']]='saved'
        return {'saved':True}

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.api=FakeApi();self.q=Queue(self.temp.name,self.api)
        self.q.write('config.json',{'enabled':True,'target':'포커룰루','batch_size':1,'settle_seconds':0})
    def tearDown(self):self.q.close();self.temp.cleanup()
    def prepare(self):
        batch=self.q.scan(False)['batch'];item=self.q.claim(batch)['items'][0]
        return batch,{'id':item['id'],'target':item['target'],'verdict':'excluded','summary':'가입 절차 문의로 서비스 평가가 없습니다.','evidence':[{'log_id':'1','quote':'길드 가입은 어떻게 하나요?'}]}
    def test_no_duplicate_batch_and_no_replay_after_save(self):
        batch,p=self.prepare();self.assertEqual(self.q.scan(False)['batch'],batch)
        self.q.submit(batch,[p]);self.q.submit(batch,[p]);self.assertEqual(len(self.api.calls),1)
        self.assertEqual(self.q.scan(False)['state'],'idle')
        self.api.rows[0]['evaluations']['포커룰루']['expected']='new-context'
        self.assertEqual(self.q.scan(False)['state'],'ready')
    def test_changed_ai_token_is_not_consumed_during_quiet_window(self):
        batch,p=self.prepare();self.q.submit(batch,[p])
        config=self.q.config();config['settle_seconds']=120;self.q.write('config.json',config)
        self.api.rows[0]['lastAt']=int(time.time()*1000)
        self.api.rows[0]['evaluations']['포커룰루']['expected']='new-context'
        self.assertEqual(self.q.scan(False)['state'],'idle')
        self.assertEqual(self.q.db.execute('SELECT expected FROM observed').fetchone()[0],'saved-v1')
        self.api.rows[0]['lastAt']=1
        self.assertEqual(self.q.scan(False)['state'],'ready')
    def test_all_targets_are_processed_sequentially_and_independently(self):
        self.api.rows[0]['evaluations']['APL']={'label':'unreviewed','origin':None,'expected':'apl-v1'}
        self.q.write('config.json',{'enabled':True,'target':'*','batch_size':12,'settle_seconds':0})
        batch,p=self.prepare();self.assertEqual(p['target'],'APL')
        self.q.submit(batch,[p])
        self.assertEqual(self.api.rows[0]['evaluations']['포커룰루']['label'],'unreviewed')
        batch,p=self.prepare();self.assertEqual(p['target'],'포커룰루')
        self.q.submit(batch,[p]);self.assertEqual(self.q.scan(False)['state'],'idle')
        self.assertEqual([p['service'] for p in self.api.calls],['APL','포커룰루'])
    def test_busy_first_target_does_not_starve_other_targets(self):
        for target in ('APL','SENT'):
            self.api.rows[0]['evaluations'][target]={'label':'unreviewed','origin':None,'expected':target+'-v1'}
        self.q.write('config.json',{'enabled':True,'target':'*','batch_size':1,'settle_seconds':0})
        batch,p=self.prepare();self.assertEqual(p['target'],'APL');self.q.submit(batch,[p])
        self.api.rows[0]['evaluations']['APL']['expected']='new-apl-context'
        batch,p=self.prepare();self.assertEqual(p['target'],'SENT')
    def test_human_and_stale_human_are_preserved(self):
        for e in [{'origin':'human'},{'origin':None,'stale':True,'previous':{'origin':'human'}}]:
            self.api.rows[0]['evaluations']['포커룰루'].update(e)
            self.assertEqual(self.q.scan(False)['state'],'idle')
        self.assertEqual(self.api.calls,[])
    def test_invalid_quote_can_be_fixed_before_any_write(self):
        batch,p=self.prepare();bad=copy.deepcopy(p);bad['evidence'][0]['quote']='not in source'
        self.assertEqual(self.q.submit(batch,[bad])['results'][0]['state'],'invalid')
        self.assertEqual(self.api.calls,[])
        self.q.submit(batch,[p]);self.assertEqual(len(self.api.calls),1)
    def test_uncertain_write_is_never_replayed_with_another_request(self):
        batch,p=self.prepare();self.api.fail=True
        self.q.submit(batch,[p]);self.assertEqual(self.q.status()['jobs']['unknown'],1)
        self.q.submit(batch,[p]);self.q.scan(False);self.assertEqual(len(self.api.calls),1)
    def test_timeout_can_only_resolve_from_a_saved_receipt(self):
        batch,p=self.prepare();self.api.fail=True;self.q.submit(batch,[p])
        job=self.q.db.execute('SELECT * FROM jobs').fetchone()
        payload=json.loads(job['proposal']);self.api.fail=False
        self.api.rows[0]['evaluations']['포커룰루'].update(label='excluded',origin='ai',summary=payload['summary'],expected='saved-v1')
        self.api.receipts[job['request_id']]='saved'
        self.q.reconcile();self.assertEqual(self.q.status()['jobs']['saved'],1)
        self.assertEqual(len(self.api.calls),1)
    def test_waits_for_quiet_window_and_rejects_unrelated_evidence(self):
        c=copy.deepcopy(self.api.rows[0]);c['lastAt']=1000
        self.assertFalse(eligible(c,'포커룰루',now_ms=1001))
        item=self.api.snapshot('synthetic','포커룰루');item['messages'][0]['relation']='unrelated'
        with self.assertRaises(ValueError):validate({'id':'synthetic','target':'포커룰루','verdict':'neutral','summary':'synthetic','evidence':[{'log_id':'1','quote':'길드'}]},item)

if __name__=='__main__':unittest.main()

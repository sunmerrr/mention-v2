"""Synthetic search strategy, provenance, queue and boundary contracts."""
import copy,json,sys,tempfile,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokergosu'))
from search_policy import strategy,search_url,configure_today
from monitor_policy import monitor_url
from extension_bridge import CaptureService
from adapters import Repository
from pokergosu_monitor_check import Source,snapshot

class SearchTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.directory=Path(self.temp.name);self.service=CaptureService(self.directory,Source())
    def tearDown(self):self.temp.cleanup()
    def config(self):
        value={'enabled':True,'startsAt':1000000,'expiresAt':2000000,'terms':['포커룰루','APL'],'startCycle':3}
        (self.directory/'search-policy.json').write_text(json.dumps(value));return value
    def test_rotation_expiry_and_native_double_encoding(self):
        self.assertEqual(strategy(self.directory,3,1100),{'mode':'board'});self.config()
        self.assertEqual(strategy(self.directory,2,1100),{'mode':'board'})
        a=strategy(self.directory,3,1100);self.assertEqual(a['term'],'포커룰루');self.assertIn('%25ED',a['url']);self.assertEqual(search_url(a['url'])['term'],'포커룰루')
        self.assertEqual(strategy(self.directory,4,1100)['term'],'APL')
        self.assertEqual(strategy(self.directory,5,1100)['scope'],'4')
        self.assertEqual(strategy(self.directory,7,1100)['scope'],'1')
        self.assertEqual(strategy(self.directory,3,2000),{'mode':'board'})
        self.assertEqual(strategy(self.directory,3,999),{'mode':'board'})
    def test_today_policy_expires_at_korean_midnight_and_does_not_resume_monitor(self):
        import datetime
        now=datetime.datetime(2026,11,13,12,0,tzinfo=datetime.timezone(datetime.timedelta(hours=9))).timestamp()
        value=configure_today(self.directory,['APL','룰루'],4,now)
        self.assertEqual(value['expiresAt'],datetime.datetime(2026,11,14,0,0,tzinfo=datetime.timezone(datetime.timedelta(hours=9))).timestamp()*1000)
        self.assertEqual(strategy(self.directory,4,now)['term'],'APL')
        self.assertEqual(strategy(self.directory,4,value['expiresAt']/1000),{'mode':'board'})
        self.assertEqual((self.directory/'search-policy.json').stat().st_mode & 0o777,0o600)
        with self.assertRaisesRegex(ValueError,'INVALID_SEARCH_TERM'):configure_today(self.directory,['A'],4,now)
        self.assertEqual(json.loads((self.directory/'search-policy.json').read_text()),value)

    def test_url_and_config_boundaries(self):
        self.config();url=strategy(self.directory,3,1100)['url'];self.assertEqual(monitor_url(url),url)
        for bad in [url+'&s=4',url+'&page=2',url.replace('s=1','s=5'),url.replace('/free/search','/news/search'),url.replace('https:','http:'),url+'#x','https://www.pokergosu.com/free/search?s=1&v=A']:
            with self.subTest(bad=bad),self.assertRaises((ValueError,UnicodeError)):monitor_url(bad)
        value=self.config();value['expiresAt']=value['startsAt']+86400001;(self.directory/'search-policy.json').write_text(json.dumps(value))
        with self.assertRaisesRegex(ValueError,'INVALID_SEARCH_POLICY'):strategy(self.directory,3,1100)
    def test_result_provenance_and_queue_exclude_unrelated_backlog_and_failed_body(self):
        url='https://www.pokergosu.com/free/search?s=1&v=APL'
        posts=[{'id':str(i),'url':f'https://www.pokergosu.com/free/{i}'} for i in range(101,110)]
        self.service.capture({'operation':'list','page_url':url,'data':posts})
        r=Repository(self.directory)
        try:
            r.discover([{'id':'999','url':'https://www.pokergosu.com/free/999'}],time.time());r.save({'id':'109','eligible':True},time.time())
            with r.db:r.db.execute("INSERT INTO thread_read_errors VALUES ('108','THREAD_MARKUP_UNKNOWN',1,'old',1)")
            result=self.service.search_plan({'url':url,'ids':[p['id'] for p in posts]+['999']})
            self.assertEqual([p['id'] for p in result['queue']],['107','106','105','104','103','102']);self.assertEqual(result['pending_threads'],7)
            for p in result['queue']:r.save({'id':p['id'],'eligible':True},time.time())
            self.assertEqual(self.service.search_plan({'url':url,'ids':[p['id'] for p in posts]})['queue'][0]['id'],'101')
        finally:r.close()
    def test_search_markup_failure_is_audited_without_hiding_access_or_fake_body(self):
        from access_log import category
        url='https://www.pokergosu.com/free/search?s=1&v=APL'
        state=snapshot();state.update(navigations=1,cycleRequests=1,expectedUrl=url,searchDisabled=True,searchFallbackCycle=1,searchWarning='SEARCH_MARKUP_UNKNOWN_USING_BOARD')
        event={'sequence':1,'cycle':1,'startedAt':1000,'finishedAt':2000,'outcome':'skipped','reason':'BOARD_MARKUP_UNKNOWN','url':url}
        state['history']=[event]
        self.service.capture({'operation':'monitor','page_url':'https://www.pokergosu.com/free','data':state})
        self.assertEqual(category(event),'search_fallback')
        self.assertEqual(self.service.status()['threads'],0)
        r=Repository(self.directory)
        try:self.assertEqual(r.db.execute('select count(*) from thread_read_errors').fetchone()[0],0)
        finally:r.close()
        state['history'][0]['access']={'kind':'bot_challenge'}
        with self.assertRaisesRegex(ValueError,'INVALID_THREAD_SKIP'):self.service.capture({'operation':'monitor','page_url':'https://www.pokergosu.com/free','data':state})

    def test_empty_search_and_audit_accept_without_discovery_gap(self):
        url='https://www.pokergosu.com/free/search?s=4&v=APL'
        self.service.capture({'operation':'list','page_url':url,'data':[]})
        self.assertEqual(self.service.search_plan({'url':url,'ids':[]}),{'queue':[],'pending_threads':0})
        with self.assertRaisesRegex(ValueError,'INVALID_LIST'):self.service.capture({'operation':'list','page_url':'https://www.pokergosu.com/free','data':[]})
        state=snapshot();state['search']={'url':url,'term':'APL','scope':'4','expiresAt':2000000};state['expectedUrl']=url
        self.service.capture({'operation':'monitor','page_url':'https://www.pokergosu.com/free','data':state})
        state['search']['term']='other'
        with self.assertRaisesRegex(ValueError,'INVALID_SEARCH_STATE'):self.service.capture({'operation':'monitor','page_url':'https://www.pokergosu.com/free','data':state})

if __name__=='__main__':unittest.main()

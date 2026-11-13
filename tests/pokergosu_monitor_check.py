"""Synthetic monitor planning, immutable navigation audit and include-only intake."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokergosu'))
from adapters import Repository
from extension_bridge import CaptureService
from domain import Settings


class Source:
    keywords=('APL',)
    def read(self):return Settings(self.keywords,lambda text,keys:[k for k in keys if k in text])


def snapshot():
    return {'id':'12345678-1234-1234-1234-123456789abc','status':'running','tabId':7,
        'expectedUrl':'https://www.pokergosu.com/free','startedAt':1000,'finishedAt':None,'reason':None,
        'phase':'board','page':1,'cycle':1,'cyclesCompleted':0,'cycleRequests':0,'navigations':0,
        'threadsSaved':0,'matchedThreads':0,'metadataWarnings':0,'pendingThreads':0,
        'discoveryGaps':0,'lastGapAt':None,'previousHeadIds':[],'currentHeadIds':['101'],
        'queue':[],'index':0,'inFlight':False,'nextAt':31000,'history':[]}


def capture_payload(identity='101'):
    return {'operation':'thread','page_url':'https://www.pokergosu.com/free/'+identity,'data':{
        'id':identity,'url':'https://www.pokergosu.com/free/'+identity,'title':'synthetic topic','body':'ordinary',
        'comments':[{'id':'42','text':'APL 광고'}], 'expected_comments':1,'comment_coverage':'visible-complete'}}


class MonitorTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.source=Source();self.service=CaptureService(self.temp.name,self.source)
    def tearDown(self):self.temp.cleanup()
    def save(self,value):return self.service.capture({'operation':'monitor','page_url':'https://www.pokergosu.com/free','data':value})

    def test_plan_prioritizes_newest_unread_then_fills_with_comment_rechecks(self):
        repository=Repository(self.temp.name);now=time.time()
        try:
            for i in range(100,112):repository.discover([{'id':str(i),'url':f'https://www.pokergosu.com/free/{i}'}],now)
            repository.discover([{'id':'1','url':'https://www.pokergosu.com/free/1'}],now-73*3600)
            for i in range(10,13):
                post={'id':str(i),'url':f'https://www.pokergosu.com/free/{i}'};repository.discover([post],now)
                repository.save({**post,'eligible':False},now+i)
            plan=repository.monitor_plan(now)
            self.assertEqual([p['id'] for p in plan['queue']],['111','110','109','108','107','106'])
            self.assertEqual(len(plan['queue']),6);self.assertEqual(plan['pending_threads'],12);self.assertEqual(plan['historical_pending_threads'],1)
            for i in range(101,112):
                repository.save({'id':str(i),'eligible':False},now+i)
            plan=repository.monitor_plan(now)
            self.assertEqual(plan['queue'][0]['id'],'100')
            self.assertEqual([p['id'] for p in plan['queue'][1:]],['10','11','12','101','102'])
            self.assertEqual(plan['pending_threads'],1)
            repository.save({'id':'100','eligible':False},now+200)
            self.assertEqual([p['id'] for p in repository.monitor_plan(now)['queue']],['10','11','12','101','102','103'])

        finally:repository.close()

    def test_real_service_plan_contract(self):
        self.service.capture({'operation':'list','page_url':'https://www.pokergosu.com/free','data':[{'id':'101','url':'https://www.pokergosu.com/free/101'}]})
        plan=self.service.plan();self.assertEqual(plan['queue'][0]['id'],'101');self.assertEqual(plan['max_threads'],6)

    def test_comments_match_independently_and_metadata_is_explicit(self):
        result=self.service.capture(capture_payload());self.assertTrue(result['eligible']);self.assertEqual(result['matched_comments'],1)
        self.assertTrue(result['metadata_missing']);self.assertEqual(self.service.status()['threads'],1)
        other=capture_payload('102');other['data']['metadata_text']='APL author header'
        other['data']['comments'][0].update(text='ordinary comment',metadata_text='APL comment author')
        result=self.service.capture(other);self.assertFalse(result['eligible'])
        repository=Repository(self.temp.name)
        try:self.assertEqual(json.loads(repository.db.execute('SELECT payload FROM threads WHERE id=?',('102',)).fetchone()[0])['metadata_text'],'APL author header')
        finally:repository.close()

    def test_media_and_unreadable_comments_are_saved_without_false_completeness(self):
        value=capture_payload()
        value['data'].update(comment_coverage='partial',expected_comments=4,reported_comments=4,
                             skipped_comments=[{'id':'43','reason':'EMPTY_OR_UNREADABLE'}],unavailable_comments=1)
        value['data']['comments'].append({'id':'44','text':'','has_media':True,'content_kind':'media_only'})
        result=self.service.capture(value)
        self.assertEqual(result['comment_summary'],{'saved':2,'media_only':1,'skipped':1,'unavailable':1,'coverage':'partial'})
        self.assertTrue(result['eligible'])
        repository=Repository(self.temp.name)
        try:
            saved=repository.results()['threads'][0]
            self.assertEqual(saved['comments'][1]['match']['included'],[])
            self.assertEqual(saved['skipped_comments'][0]['reason'],'EMPTY_OR_UNREADABLE')
        finally:repository.close()
        value['data'].update(comment_coverage='unknown',expected_comments=None,unavailable_comments=None,reported_comments=None)
        result=self.service.capture(value);self.assertEqual(result['comment_summary']['coverage'],'unknown')

    def test_unchanged_keywords_do_not_reclassify_all_content_per_thread(self):
        with patch('extension_bridge.Repository.reclassify') as reclassify:
            self.service.capture(capture_payload());self.service.capture(capture_payload('102'))
            self.assertEqual(reclassify.call_count,1)
            self.source.keywords=('룰루',);self.service.capture(capture_payload('103'))
            self.assertEqual(reclassify.call_count,2)

    def test_audit_rejects_counter_and_source_changes_and_preserves_old_trial(self):
        repository=Repository(self.temp.name);trial={'status':'stopped','attempted':4};repository.set('extension_trial',trial);repository.close()
        value=snapshot();self.save(value);previous=copy.deepcopy(value)
        value.update(navigations=1,cycleRequests=1,inFlight=True,nextAt=None)
        value['history']=[{'sequence':1,'cycle':1,'url':'https://www.pokergosu.com/free/101','startedAt':31000,'finishedAt':None,'outcome':'inflight','reason':None}];self.save(value)
        value.update(inFlight=False,nextAt=62000,expectedUrl='https://www.pokergosu.com/free/101',threadsSaved=1,matchedThreads=1)
        value['history'][0].update(outcome='success',finishedAt=32000);self.save(value)
        with self.assertRaisesRegex(ValueError,'MONITOR_COUNTER_REGRESSION'):self.save(previous)
        invalid=copy.deepcopy(value);invalid['history'][0]['url']='https://evil.invalid/free/101'
        with self.assertRaisesRegex(ValueError,'INVALID_MONITOR_URL'):self.save(invalid)
        invalid=copy.deepcopy(value);invalid['history'][0]['startedAt']=30000
        with self.assertRaisesRegex(ValueError,'MONITOR_EVENT_CONFLICT'):self.save(invalid)
        self.assertEqual(self.service.status()['trial'],trial)

    def test_budget_and_queue_do_not_accept_unbounded_or_foreign_navigation(self):
        from monitor_policy import monitor_url
        self.assertEqual(monitor_url('https://www.pokergosu.com/free?page=7'),'https://www.pokergosu.com/free?page=7')
        with self.assertRaisesRegex(ValueError,'INVALID_MONITOR_URL'):monitor_url('https://www.pokergosu.com/free?page=8')
        value=snapshot();value['discoveryOverlap']='true'
        with self.assertRaisesRegex(ValueError,'INVALID_MONITOR_OVERLAP'):self.save(value)
        value=snapshot();value['discoveryOverlap']=True;self.save(value)
        repository=Repository(self.temp.name)
        self.assertTrue(repository.get('extension_monitor')['discoveryOverlap'])
        repository.close()
        value=snapshot();value['cycleRequests']=15
        with self.assertRaisesRegex(ValueError,'INVALID_MONITOR_BUDGET'):self.save(value)
        value=snapshot();value['queue']=[{'id':'1','url':'https://evil.invalid/free/1'}]
        with self.assertRaisesRegex(ValueError,'INVALID_MONITOR_PLAN'):self.save(value)

    def test_failed_thread_is_skipped_without_success_or_repeat_planning(self):
        repository=Repository(self.temp.name);now=time.time()
        for identity in ('101','102'):repository.discover([{'id':identity,'url':f'https://www.pokergosu.com/free/{identity}'}],now)
        value=snapshot();value.update(phase='return',index=1,queue=[{'id':'101','url':'https://www.pokergosu.com/free/101'}],navigations=1,cycleRequests=1,expectedUrl='https://www.pokergosu.com/free/101')
        value['history']=[{'sequence':1,'cycle':1,'url':'https://www.pokergosu.com/free/101','startedAt':31000,'finishedAt':32000,'outcome':'skipped','reason':'THREAD_MARKUP_UNKNOWN'}]
        self.save(value)
        self.assertEqual(repository.get('extension_monitor')['status'],'running')
        self.assertEqual([p['id'] for p in repository.monitor_plan(now)['queue']],['102'])
        self.assertIsNone(repository.db.execute("select payload from threads where id='101'").fetchone()[0])
        repository.backfill_read_errors();repository.backfill_read_errors()
        self.assertEqual(repository.db.execute('select count(*) from thread_read_errors').fetchone()[0],1)
        repository.save({'id':'101','eligible':False},now)
        repository.backfill_read_errors();self.save(value)
        self.assertEqual(repository.db.execute('select count(*) from thread_read_errors').fetchone()[0],0)
        repository.close()

    def test_skip_cannot_hide_an_access_restriction_or_list_failure(self):
        for reason,url in [('BOT_CHALLENGE','https://www.pokergosu.com/free/101'),('THREAD_MARKUP_UNKNOWN','https://www.pokergosu.com/free')]:
            value=snapshot();value.update(navigations=1,cycleRequests=1)
            value['history']=[{'sequence':1,'cycle':1,'url':url,'startedAt':31000,'finishedAt':32000,'outcome':'skipped','reason':reason}]
            with self.assertRaisesRegex(ValueError,'INVALID_THREAD_SKIP'):self.save(value)

    def test_long_run_retains_events_outside_the_extension_window_and_stays_terminal(self):
        value=snapshot();self.save(value)
        for sequence in range(1,53):
            value.update(navigations=sequence,cycleRequests=(sequence-1)%10+1,cycle=(sequence-1)//10+1)
            value['history'].append({'sequence':sequence,'cycle':value['cycle'],'url':'https://www.pokergosu.com/free','startedAt':31000*sequence,'finishedAt':31000*sequence+100,'outcome':'success','reason':None})
            value['history']=value['history'][-50:];self.save(value)
        repository=Repository(self.temp.name)
        try:
            self.assertEqual(repository.get('extension_monitor_event:'+value['id']+':1')['outcome'],'success')
            self.assertEqual(len(repository.get('extension_monitor')['history']),50)
        finally:repository.close()
        value.update(status='paused',nextAt=None,finishedAt=2000000,reason='ACCESS_RESTRICTED');self.save(value)
        value.update(status='running',nextAt=3000000,finishedAt=None,reason=None)
        with self.assertRaisesRegex(ValueError,'MONITOR_ALREADY_FINISHED'):self.save(value)


if __name__=='__main__':unittest.main()

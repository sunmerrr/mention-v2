"""Synthetic operational log evidence; no live service or website requests."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokergosu'))
from access_log import report,category
from domain import access_evidence
from adapters import Repository
from extension_bridge import CaptureService
from pokergosu_monitor_check import Source,snapshot


class LogTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.service=CaptureService(self.temp.name,Source());self.state=snapshot()
        self.save()
    def tearDown(self):self.temp.cleanup()
    def save(self):return self.service.capture({'operation':'monitor','page_url':'https://www.pokergosu.com/free','data':self.state})
    def event(self,number,outcome='success',reason=None,access=None):
        value=self.state
        value.update(navigations=number,cycleRequests=(number-1)%10+1,cycle=(number-1)//10+1)
        event={'sequence':number,'cycle':value['cycle'],'url':'https://www.pokergosu.com/free/101','startedAt':number*100000,'finishedAt':number*100000+100,'outcome':outcome,'reason':reason}
        if access:event['access']=access
        value['history'].append(event);value['history']=value['history'][-50:]
        if outcome!='success':value.update(status='paused',reason=reason,nextAt=None,finishedAt=event['finishedAt'])
        self.save()

    def test_challenge_records_exact_request_number_and_successes_before(self):
        self.event(1);self.event(2)
        evidence={'kind':'bot_challenge','title':'Just a moment...','indicators':['challenge-page-title'],'basis':'visible-page','http_status':None,'account_ban_confirmed':False}
        self.event(3,'stopped','BOT_CHALLENGE',evidence)
        result=report(self.temp.name);issue=result['runs'][0]['first_issue']
        self.assertEqual(issue['request_number'],3);self.assertEqual(issue['successful_requests_before'],2)
        self.assertEqual(issue['category'],'bot_challenge');self.assertFalse(issue['account_ban_confirmed'])
        self.assertIsNone(issue['http_status']);self.assertTrue(issue['started_at'].endswith('+09:00'))
        self.assertEqual(result['category_counts'],{'normal':2,'bot_challenge':1})

    def test_legacy_unknown_does_not_become_a_ban_or_challenge(self):
        self.event(1,'stopped','ACCESS_RESTRICTED')
        event=report(self.temp.name)['events'][0]
        self.assertEqual(event['category'],'access_restricted_unknown');self.assertEqual(event['indicators'],[])
        self.assertFalse(event['account_ban_confirmed'])

    def test_parser_user_and_runtime_failures_are_separate(self):
        for reason,expected in [('COMMENT_COVERAGE_UNKNOWN','content_validation_error'),('USER_STOP','user_stop'),('LOCAL_UNAVAILABLE','local_error'),('WORKER_INTERRUPTED','execution_error'),('TAB_CLOSED','tab_or_permission_change')]:
            self.assertEqual(category({'outcome':'stopped','reason':reason}),expected)
        self.state.update(status='paused',reason='LOCAL_UNAVAILABLE',nextAt=None,finishedAt=2000);self.save()
        issue=report(self.temp.name)['runs'][0]['first_issue']
        self.assertIsNone(issue['request_number']);self.assertEqual(issue['after_request_number'],0)
        self.assertEqual(issue['category'],'local_error')

    def test_evidence_drops_unapproved_data_and_rejects_invented_http_status(self):
        value={'kind':'access_denied','title':'Access denied','indicators':['access-denied-error-page'],'basis':'visible-page','http_status':None,'account_ban_confirmed':False,'cookies':'synthetic-sensitive-value'}
        self.assertNotIn('synthetic-sensitive-value',json.dumps(access_evidence(value)))
        value['http_status']=403
        with self.assertRaisesRegex(ValueError,'INVALID_ACCESS_EVIDENCE'):access_evidence(value)

    def test_report_is_read_only_and_omits_content_and_settings(self):
        self.event(1)
        repository=Repository(self.temp.name)
        try:repository.set('private_setting','synthetic-sensitive-value');repository.db.execute("INSERT INTO threads(id,url,discovered_at,payload) VALUES (?,?,?,?)",('999','https://www.pokergosu.com/free/999',1,'synthetic-message-text'));repository.db.commit()
        finally:repository.close()
        filename=Path(self.temp.name)/'monitor.sqlite3';before=filename.read_bytes()
        output=json.dumps(report(self.temp.name))
        self.assertNotIn('synthetic-sensitive-value',output);self.assertNotIn('synthetic-message-text',output)
        self.assertEqual(filename.read_bytes(),before)

    def test_live_jsonl_is_automatic_idempotent_and_has_stable_ids(self):
        self.event(1)
        filename=Path(self.temp.name)/'collection-events.jsonl'
        before=filename.read_bytes();self.save();self.assertEqual(filename.read_bytes(),before)
        rows=[json.loads(line) for line in before.decode().splitlines()]
        event=next(row for row in rows if row['record_type']=='navigation')
        self.assertEqual(event['request_number'],1);self.assertEqual(event['category'],'normal')
        self.assertEqual(len({row['event_id'] for row in rows}),len(rows))
        with patch('access_log.append_snapshot',side_effect=OSError('synthetic disk error')):
            self.event(2)
        repository=Repository(self.temp.name)
        try:self.assertEqual(repository.get('collection_log_error')['code'],'OSError')
        finally:repository.close()
        self.assertEqual(len(report(self.temp.name)['events']),2)

    def test_report_retains_request_count_beyond_chrome_history_window(self):
        for number in range(1,53):self.event(number)
        result=report(self.temp.name)
        self.assertEqual(len(result['events']),52);self.assertEqual(result['events'][-1]['successful_requests_before'],51)
        self.assertEqual(result['runs'][0]['successful_requests'],52)


if __name__=='__main__':unittest.main()

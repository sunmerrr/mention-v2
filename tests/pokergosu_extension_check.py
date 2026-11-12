"""Synthetic extension intake and loopback boundary tests, without Kakao/site access."""
import http.client
from http.server import HTTPServer
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/pokergosu'))
from extension_bridge import CaptureService, make_handler, prepare, MAX_BYTES
from adapters import Repository
from domain import Settings


class Source:
    def read(self):
        return Settings(('APL',), lambda value, keys: [k for k in keys if k in value])


def payload():
    return {'operation': 'thread', 'page_url': 'https://www.pokergosu.com/free/123', 'data': {
        'id': '123', 'url': 'https://www.pokergosu.com/free/123', 'title': 'synthetic', 'body': 'ordinary',
        'comments': [{'id': '42', 'text': 'APL 광고', 'author': 'synthetic author'}],
        'expected_comments': 1, 'comment_coverage': 'visible-complete'}}


class ExtensionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = CaptureService(self.temp.name, Source())

    def tearDown(self):
        self.temp.cleanup()

    def test_matching_comment_saved_without_exclusions_and_deduplicated(self):
        result = self.service.capture(payload())
        self.assertTrue(result['eligible'])
        self.assertEqual(result['matched_comments'], 1)
        self.service.capture(payload())
        self.assertEqual(self.service.status()['threads'], 1)
        repository = Repository(self.temp.name)
        try:
            saved = repository.results()['threads'][0]
            self.assertFalse(saved['match']['eligible'])
            self.assertTrue(saved['comments'][0]['match']['eligible'])
            self.assertEqual(saved['capture_method'], 'extension-active-tab')
            self.assertEqual(repository.db.execute('SELECT count(*) FROM revisions').fetchone()[0], 1)
        finally:
            repository.close()

    def test_unknown_partial_comments_do_not_write(self):
        value = payload()
        value['data']['expected_comments'] = 3
        with self.assertRaisesRegex(ValueError, 'INCOMPLETE_COMMENTS'):
            self.service.capture(value)
        self.assertEqual(self.service.status()['threads'], 0)

    def test_wrong_page_and_duplicate_comment_ids_rejected(self):
        value = payload()
        value['page_url'] = 'https://www.pokergosu.com/free/999'
        with self.assertRaisesRegex(ValueError, 'CAPTURE_PAGE_MISMATCH'):
            self.service.capture(value)
        value = payload()
        value['data']['comments'] *= 2
        value['data']['expected_comments'] = 2
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_COMMENT_ID'):
            self.service.capture(value)
        value['page_url'] = 'https://www.pokergosu.com/login'
        with self.assertRaisesRegex(ValueError, 'INVALID_PAGE_URL'):
            self.service.capture(value)

    def test_structure_diagnostic_drops_unrecognized_fields(self):
        self.service.capture({'operation': 'diagnostic', 'page_url': 'https://www.pokergosu.com/free/123',
                             'reason': 'THREAD_MARKUP_UNKNOWN', 'structure': {
                                 'url':'https://www.pokergosu.com/free/123', 'headings':['synthetic'],
                                 'cookies': 'must-not-persist', 'nodes':[{'tag':'DIV', 'id':'post', 'classes':'body', 'parent':'MAIN', 'value':'must-not-persist'}]}})
        repository = Repository(self.temp.name)
        try:
            self.assertNotIn('must-not-persist', json.dumps(repository.get('extension_diagnostic')))
        finally:
            repository.close()

    def test_board_list_discovers_without_fetching_threads(self):
        self.service.capture({'operation':'list', 'page_url':'https://www.pokergosu.com/free',
                              'data':[{'id':'123','url':'https://www.pokergosu.com/free/123'}]})
        self.assertEqual(self.service.status()['threads'], 0)
        repository = Repository(self.temp.name)
        try:
            self.assertEqual(repository.pending_count(), 1)
        finally:
            repository.close()

    def test_preparation_keeps_secret_out_of_source_and_reuses_token(self):
        folder, token = prepare(self.temp.name)
        self.assertTrue((folder/'manifest.json').exists())
        self.assertEqual(prepare(self.temp.name)[1], token)
        manifest = json.loads((folder/'manifest.json').read_text())
        self.assertNotIn('cookies', manifest['permissions'])
        self.assertIn('alarms', manifest['permissions'])
        self.assertTrue((folder/'trial.mjs').exists())
        self.assertNotIn('content_scripts', manifest)
        self.assertEqual(manifest['host_permissions'], ['http://127.0.0.1/*'])
        self.assertEqual(json.loads((folder/'connection.json').read_text())['token'], token)
        self.assertEqual((folder/'connection.json').stat().st_mode & 0o777, 0o600)

    def test_finite_trial_audit_and_monotonic_history(self):
        value = {'id':'12345678-1234-1234-1234-123456789abc','tabId':7,'limit':15,
                 'attempted':0,'successful':0,'status':'running','inFlight':False,
                 'startedAt':1000,'nextAt':901000,'finishedAt':None,'reason':None,'history':[]}
        def save():
            return self.service.capture({'operation':'trial','page_url':'https://www.pokergosu.com/free','data':value})
        save()
        value.update(attempted=1,inFlight=True,nextAt=None)
        value['history']=[{'sequence':1,'startedAt':901000,'finishedAt':None,'outcome':'inflight','reason':None}]
        save()
        value.update(successful=1,inFlight=False,nextAt=1801000)
        value['history'][0].update(finishedAt=902000,outcome='success')
        save()
        value['history'][0]['startedAt']=900000
        with self.assertRaisesRegex(ValueError,'TRIAL_HISTORY_CONFLICT'): save()
        value['history'][0]['startedAt']=901000
        value.update(status='stopped',nextAt=None,finishedAt=903000,reason='USER_STOP')
        save()
        value.update(status='running',nextAt=1801000,finishedAt=None,reason=None)
        with self.assertRaisesRegex(ValueError,'TRIAL_ALREADY_FINISHED'): save()

    def test_trial_rejects_more_than_fifteen_and_false_completion(self):
        value = {'id':'12345678-1234-1234-1234-123456789abc','tabId':7,'limit':16,
                 'attempted':0,'successful':0,'status':'running','inFlight':False,
                 'startedAt':1000,'nextAt':901000,'finishedAt':None,'reason':None,'history':[]}
        def save():
            return self.service.capture({'operation':'trial','page_url':'https://www.pokergosu.com/free','data':value})
        with self.assertRaisesRegex(ValueError,'INVALID_TRIAL_LIMIT'): save()
        value.update(limit=15,status='completed',nextAt=None,finishedAt=2000)
        with self.assertRaisesRegex(ValueError,'INVALID_TRIAL_COMPLETION'): save()

    def test_image_references_are_validated_and_not_downloaded(self):
        value=payload()
        value['data']['images']=[{'url':'https://www.ipokergosu.com/files/photo.png','alt':'synthetic','width':600,'height':400}]
        result=self.service.capture(value)
        self.assertTrue(result['saved'])
        repository=Repository(self.temp.name)
        stored=json.loads(repository.db.execute('SELECT payload FROM threads WHERE id=?',(value['data']['id'],)).fetchone()[0])
        repository.close()
        self.assertEqual(stored['images'][0]['width'],600)
        self.assertFalse((Path(self.temp.name)/'media').exists())
        value['data']['images'][0]['url']='javascript:alert(1)'
        with self.assertRaisesRegex(ValueError,'INVALID_IMAGE_URL'):self.service.capture(value)
        value['data']['images'][0]['url']='https://www.ipokergosu.com/files/photo.png'
        value['data']['images'][0]['width']=-1
        with self.assertRaisesRegex(ValueError,'INVALID_IMAGE_DIMENSIONS'):self.service.capture(value)

    def test_http_auth_origin_host_and_payload_limits(self):
        server = HTTPServer(('127.0.0.1', 0), make_handler(self.service, 'synthetic-token'))
        port = server.server_port
        server.RequestHandlerClass = make_handler(self.service, 'synthetic-token', port)
        worker = threading.Thread(target=server.serve_forever, daemon=True)
        worker.start()
        def request(method, path='/status', headers=None, body=None):
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
            try:
                connection.request(method, path, body=body, headers=headers or {})
                response = connection.getresponse()
                data = response.read()
                return response.status, data
            finally:
                connection.close()
        auth = {'Authorization':'Bearer synthetic-token', 'X-Mention-Extension':'a'*32,
                'Origin':'chrome-extension://'+'a'*32, 'Content-Type':'application/json'}
        try:
            self.assertEqual(request('GET')[0], 403)
            self.assertEqual(request('GET', headers=auth)[0], 200)
            self.assertEqual(request('GET', headers={**auth,'Origin':'https://evil.invalid'})[0], 403)
            self.assertEqual(request('GET', headers={**auth,'Host':'evil.invalid'})[0], 403)
            self.assertEqual(request('POST','/capture',auth,json.dumps(payload()))[0], 200)
            self.assertEqual(request('POST','/capture',{**auth,'Content-Length':str(MAX_BYTES+1)}, '{}')[0], 413)
            self.assertEqual(request('POST','/capture',auth,'{"operation":"unknown"}')[0], 400)
            self.assertEqual(request('GET','/capture',auth)[0], 404)
            from control import ControlStore
            store = ControlStore(self.service.directory)
            command = store.enqueue('start')
            store.close()
            poll = {'instance':'12345678-1234-1234-1234-123456789abc',
                    'version':'0.4.0','permission':True,'enabled':True}
            self.assertEqual(request('POST','/control/poll',{},json.dumps(poll))[0],403)
            status, data = request('POST','/control/poll',auth,json.dumps(poll))
            self.assertEqual(status,200)
            self.assertEqual(json.loads(data)['command']['id'],command['id'])
            ack = {'instance':poll['instance'],'id':command['id'],
                   'result':{'ok':True,'code':'STARTED'}}
            self.assertEqual(request('POST','/control/ack',auth,json.dumps(ack))[0],200)
            ack['instance']='12345678-1234-1234-1234-123456789def'
            self.assertEqual(request('POST','/control/ack',auth,json.dumps(ack))[0],400)

        finally:
            server.shutdown()
            server.server_close()
            worker.join(timeout=3)


if __name__ == '__main__':
    unittest.main()

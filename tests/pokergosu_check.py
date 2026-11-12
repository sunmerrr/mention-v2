"""Synthetic contract tests: never read source messages or access the site."""
import json
from pathlib import Path
import random
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/pokergosu'))
from adapters import KeywordSource, Repository
from domain import Paused, Settings, TemporaryFailure, evaluate_thread, next_delay
import collect
from service import Collector


def match(text, keys, numeric=False):
    return [key for key in keys if key.lower() in text.lower()]


def settings():
    return Settings(('APL', '룰루'), match)


def thread(identity='100', text='ordinary', comments=None):
    return {'id': identity, 'url': f'https://www.pokergosu.com/free/{identity}',
            'title': 'subject', 'body': text, 'comments': comments or []}


class FakeSource:
    def read(self):
        return settings()


class FakeBrowser:
    def __init__(self, posts=None, replies=None, robots='User-agent: *\nAllow: /'):
        self.posts = posts or [{'id': '100', 'url': 'https://www.pokergosu.com/free/100', 'pinned': False}]
        self.replies = replies or {}
        self.calls = []
        self.robots = robots

    def request(self, operation, **args):
        self.calls.append((operation, args))
        if operation == 'robots': return {'status': 200, 'text': self.robots}
        if operation == 'list': return self.posts
        return self.replies.get(args['id'], thread(args['id']))


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Repository(self.temp.name)
        self.now = 1000000

    def tearDown(self):
        self.repo.close()
        self.temp.cleanup()

    def cycle(self, browser):
        return Collector(FakeSource(), self.repo, browser, lambda: self.now, lambda _: None).cycle()

    def test_include_matches_remain_eligible_despite_advertising_text(self):
        value = evaluate_thread(thread(text='APL 광고', comments=[{'id':'1','text':'룰루 후기'}, {'id':'2','text':'APL 광고'}]), settings())
        self.assertTrue(value['eligible'])
        self.assertTrue(value['match']['eligible'])
        self.assertEqual(value['match']['excluded'], [])
        self.assertTrue(value['comments'][0]['match']['eligible'])
        self.assertTrue(value['comments'][1]['match']['eligible'])

    def test_jitter_bounds_and_variation(self):
        rng = random.Random(7)
        values = [next_delay(rng) for _ in range(100)]
        self.assertTrue(all(900 <= x <= 1800 for x in values))
        self.assertEqual(len(set(values)), 100)

    def test_idempotency_and_revision_history(self):
        value = evaluate_thread(thread(text='APL'), settings())
        self.repo.discover([value], self.now)
        self.repo.save(value, self.now)
        self.repo.save(value, self.now+1)
        self.assertEqual(self.repo.db.execute('SELECT count(*) FROM revisions').fetchone()[0], 1)
        value['comments'] = [{'id':'12','text':'룰루'}]
        self.repo.save(value, self.now+2)
        self.assertEqual(self.repo.db.execute('SELECT count(*) FROM revisions').fetchone()[0], 2)

    def test_later_comments_on_previously_unmatched_post(self):
        self.cycle(FakeBrowser())
        self.assertEqual(self.repo.results()['threads'], [])
        browser = FakeBrowser(replies={'100':thread(comments=[{'id':'1','text':'룰루 후기'}])})
        self.now += 1200
        self.cycle(browser)
        self.assertEqual(len(self.repo.results()['threads']), 1)
        self.assertEqual([x[0] for x in browser.calls], ['list','thread'])

    def test_robot_disallow_prevents_board_fetch(self):
        browser = FakeBrowser(robots='User-agent: *\nDisallow: /free')
        with self.assertRaisesRegex(Paused, 'ROBOTS_DISALLOWED'): self.cycle(browser)
        self.assertEqual(len(browser.calls), 1)

    def test_bounded_discovery_and_gap(self):
        self.repo.set('frontier','1')
        result = self.cycle(FakeBrowser())
        self.assertEqual(result['requests'], 5)
        self.assertEqual(result['discovery_gap']['after_id'], '1')
        self.assertIsNotNone(self.repo.get('discovery_gap'))

    def test_request_budget_and_rechecks_not_starved(self):
        old = thread('1')
        self.repo.discover([old], self.now)
        self.repo.save(evaluate_thread(old, settings()), self.now)
        posts = [{'id':str(i),'url':f'https://www.pokergosu.com/free/{i}'} for i in range(100, 130)]
        result = self.cycle(FakeBrowser(posts=posts))
        self.assertEqual(result['threads_checked'], 9)
        self.assertEqual(result['pending_threads'], 22)
        self.assertEqual(result['requests'], 11)

    def test_keyword_changes_reclassify_retained_text(self):
        value = evaluate_thread(thread(text='other'), settings())
        self.repo.discover([value], self.now)
        self.repo.save(value, self.now)
        self.repo.reclassify(Settings(('other',), match), evaluate_thread)
        self.assertEqual(len(self.repo.results()['threads']), 1)
        self.assertEqual(self.repo.db.execute('SELECT count(*) FROM revisions').fetchone()[0], 1)

    def test_result_cursor(self):
        for i in range(100, 104):
            value = evaluate_thread(thread(str(i), text='APL'), settings())
            self.repo.discover([value], self.now)
            self.repo.save(value, self.now)
        first = self.repo.results(2)
        second = self.repo.results(2, first['next_before'])
        self.assertEqual([x['id'] for x in first['threads']+second['threads']], ['103','102','101','100'])

    def test_source_reads_only_settings_and_reloads(self):
        root = Path(self.temp.name) / 'legacy'
        (root/'monitor').mkdir(parents=True)
        (root/'monitor/rules.py').write_text('def matches(text,keys,*,numeric=False):\n return [k for k in keys if k in text]\n')
        (root/'state/monitor').mkdir(parents=True)
        filename = root/'state/monitor/monitor.sqlite3'
        c = sqlite3.connect(filename)
        c.execute('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)')
        c.executemany('INSERT INTO settings VALUES (?,?)', [('keywords','["APL"]'),('exclude_keywords','invalid-json-must-not-be-read'),('private_token','"secret"')])
        c.commit()
        before = filename.read_bytes()
        source = KeywordSource(root)
        self.assertEqual(source.read().keywords, ('APL',))
        self.assertEqual(filename.read_bytes(), before)
        self.assertFalse((root/'monitor/__pycache__').exists())
        c.execute('UPDATE settings SET value=? WHERE key=?', ('["룰루"]','keywords'))
        c.commit()
        self.assertEqual(source.read().keywords, ('룰루',))
        c.close()

    def test_pauses_persist_and_prevent_another_browser(self):
        class DeniedBrowser:
            def __init__(self, _): pass
            def request(self, *args, **kwargs): raise Paused('ACCESS_RESTRICTED')
            def close(self): pass
        args = SimpleNamespace(command='once', legacy_root=self.temp.name)
        with patch.object(collect, 'KeywordSource', return_value=FakeSource()), patch.object(collect, 'Browser', DeniedBrowser), patch.object(collect, 'emit'):
            self.assertEqual(collect.execute(args, self.repo), 2)
        self.assertTrue(self.repo.get('status')['paused'])
        with patch.object(collect, 'Browser') as browser, patch.object(collect, 'emit'):
            self.assertEqual(collect.execute(args, self.repo), 2)
            browser.assert_not_called()

    def test_due_time_prevents_manual_poll_bursts(self):
        self.repo.set('next_run_at', collect.time.time()+1800)
        args = SimpleNamespace(command='once', legacy_root=self.temp.name)
        with patch.object(collect, 'KeywordSource') as source, patch.object(collect, 'emit'):
            self.assertEqual(collect.execute(args, self.repo), 0)
            source.assert_not_called()

    def test_transient_failure_backoff_and_third_failure_pause(self):
        args = SimpleNamespace(command='once', legacy_root=self.temp.name)
        with patch.object(collect, 'KeywordSource') as source, patch.object(collect, 'emit'):
            source.return_value.read.side_effect = TemporaryFailure('SOURCE_UNAVAILABLE')
            for expected in range(1,4):
                self.repo.set('next_run_at', 0)
                collect.execute(args, self.repo)
                status = self.repo.get('status')
                self.assertEqual(status['failures'], expected)
                self.assertEqual(status['paused'], expected == 3)
                self.assertGreater(self.repo.get('next_run_at'), collect.time.time()+3500)

    def test_lifecycle_recognizes_extension_receiver_with_no_trailing_arguments(self):
        Path(self.temp.name, 'collector.lock').write_text('12345')
        command = f'python3 {Path(collect.__file__).resolve()} extension-run\n'
        with patch.object(collect.subprocess, 'run', return_value=SimpleNamespace(stdout=command)):
            self.assertEqual(collect.owner(Path(self.temp.name)), 12345)

    def test_recent_window_expiration(self):
        value = evaluate_thread(thread(), settings())
        self.repo.discover([value], self.now)
        self.repo.save(value, self.now)
        self.assertEqual(self.repo.queue(self.now+73*3600), [])


if __name__ == '__main__':
    unittest.main()

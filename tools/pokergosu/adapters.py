"""Read-only keyword source, isolated public-site storage and browser transport."""
import hashlib
import importlib.util
import json
import os
import re
from pathlib import Path
import select
import sqlite3
import subprocess
import time

from domain import Settings, Paused, TemporaryFailure


class KeywordSource:
    def __init__(self, root):
        self.root = Path(root).resolve()
        # Load only the pure matching module, never operational Store constructors.
        spec = importlib.util.spec_from_file_location('pokergosu_keyword_rules', self.root / 'monitor/rules.py')
        self.rules = importlib.util.module_from_spec(spec)
        # Compile directly so importing policy never creates a legacy __pycache__.
        policy = self.root / 'monitor/rules.py'
        exec(compile(policy.read_text(), str(policy), 'exec'), self.rules.__dict__)

    def read(self):
        source = self.root / 'state/monitor/monitor.sqlite3'
        connection = sqlite3.connect(source.as_uri() + '?mode=ro', uri=True, timeout=1)
        try:
            connection.execute('PRAGMA query_only=ON')
            values = {key: json.loads(value) for key, value in connection.execute(
                "SELECT key,value FROM settings WHERE key IN ('keywords','keyword_policy')")}
        finally:
            connection.close()
        for key in ('keywords',):
            value = values.get(key)
            if not isinstance(value, list) or any(not isinstance(x, str) or not x.strip() for x in value):
                raise Paused('INVALID_KEYWORD_SETTINGS')
        policy = values.get('keyword_policy')
        if policy is not None:
            if not isinstance(policy,dict) or policy.get('version')!=1:raise Paused('INVALID_KEYWORD_POLICY')
            words=policy.get('keywords');sources=policy.get('sources',{})
            entry=sources.get('pokergosu',{}) if isinstance(sources,dict) else None
            disabled=entry.get('disabled',[]) if isinstance(entry,dict) else None
            if not isinstance(words,list) or len(words)>100 or any(not isinstance(w,str) or not w.strip() or len(w)>200 for w in words) or not isinstance(disabled,list) or any(w not in words for w in disabled):raise Paused('INVALID_KEYWORD_POLICY')
            return Settings(tuple(w for w in words if w not in disabled),self.rules.matches)
        if not values['keywords']:
            raise Paused('NO_INCLUDE_KEYWORDS')
        return Settings(tuple(values['keywords']), self.rules.matches)


class Repository:
    def __init__(self, directory):
        self.directory = Path(directory).resolve()
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.db = sqlite3.connect(self.directory / 'monitor.sqlite3')
        self.db.row_factory = sqlite3.Row
        self.db.executescript('''
          PRAGMA journal_mode=WAL;
          CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS threads(
            id TEXT PRIMARY KEY, url TEXT NOT NULL, discovered_at REAL NOT NULL,
            checked_at REAL, payload TEXT, eligible INTEGER NOT NULL DEFAULT 0);
          CREATE TABLE IF NOT EXISTS thread_read_errors(
            id TEXT PRIMARY KEY,reason TEXT NOT NULL,at REAL NOT NULL,run_id TEXT NOT NULL,sequence INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS search_results(
            search_url TEXT NOT NULL,id TEXT NOT NULL,seen_at REAL NOT NULL,PRIMARY KEY(search_url,id));
          CREATE TABLE IF NOT EXISTS revisions(
            thread_id TEXT NOT NULL, digest TEXT NOT NULL, observed_at REAL NOT NULL,
            payload TEXT NOT NULL, PRIMARY KEY(thread_id,digest));
          CREATE INDEX IF NOT EXISTS threads_queue ON threads(checked_at,discovered_at);
          CREATE INDEX IF NOT EXISTS threads_matches ON threads(eligible,checked_at,id);
        ''')
        os.chmod(self.directory / 'monitor.sqlite3', 0o600)

    def get(self, key, default=None):
        row = self.db.execute('SELECT value FROM state WHERE key=?', (key,)).fetchone()
        return json.loads(row[0]) if row else default

    def set(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (key, json.dumps(value)))

    def discover(self, posts, now):
        with self.db:
            self.db.executemany('INSERT OR IGNORE INTO threads(id,url,discovered_at) VALUES (?,?,?)',
                                [(p['id'], p['url'], now) for p in posts])

    def queue(self, now, limit=12):
        # Reserve recheck slots so busy boards cannot starve comment monitoring.
        pending = self.db.execute('SELECT id,url FROM threads WHERE checked_at IS NULL AND NOT EXISTS(SELECT 1 FROM thread_read_errors e WHERE e.id=threads.id) ORDER BY discovered_at,id LIMIT ?', (max(1, limit-4),)).fetchall()
        recent = self.db.execute('SELECT id,url FROM threads WHERE checked_at IS NOT NULL AND discovered_at>=? AND NOT EXISTS(SELECT 1 FROM thread_read_errors e WHERE e.id=threads.id) ORDER BY checked_at,id LIMIT ?', (now-72*3600, limit-len(pending))).fetchall()
        return [dict(row) for row in (*pending, *recent)]

    def monitor_plan(self, now):
        cutoff = now - 72*3600
        pending = self.db.execute('SELECT id,url FROM threads WHERE checked_at IS NULL AND discovered_at>=? AND NOT EXISTS(SELECT 1 FROM thread_read_errors e WHERE e.id=threads.id) ORDER BY CAST(id AS INTEGER) DESC LIMIT 6', (cutoff,)).fetchall()
        recent = self.db.execute('SELECT id,url FROM threads WHERE checked_at IS NOT NULL AND discovered_at>=? AND NOT EXISTS(SELECT 1 FROM thread_read_errors e WHERE e.id=threads.id) ORDER BY checked_at,CAST(id AS INTEGER) LIMIT ?', (cutoff,6-len(pending))).fetchall()
        active_pending=self.db.execute('SELECT count(*) FROM threads WHERE checked_at IS NULL AND discovered_at>=? AND NOT EXISTS(SELECT 1 FROM thread_read_errors e WHERE e.id=threads.id)',(cutoff,)).fetchone()[0]
        return {'queue': [dict(row) for row in (*pending,*recent)], 'pending_threads': active_pending,
                'historical_pending_threads': self.pending_count()-active_pending,
                'comment_window_hours': 72, 'max_threads': 6}

    def discover_search(self,posts,url,now):
        self.discover(posts,now)
        with self.db:
            self.db.executemany('INSERT OR REPLACE INTO search_results VALUES (?,?,?)',[(url,p['id'],now) for p in posts])

    def search_plan(self,url,ids):
        if not ids:return {'queue':[],'pending_threads':0}
        placeholders=','.join('?' for _ in ids)
        where=f"s.search_url=? AND t.id IN ({placeholders}) AND NOT EXISTS(SELECT 1 FROM thread_read_errors e WHERE e.id=t.id)"
        rows=self.db.execute(f"SELECT t.id,t.url FROM threads t JOIN search_results s ON s.id=t.id WHERE {where} ORDER BY t.checked_at IS NOT NULL,t.checked_at,CAST(t.id AS INTEGER) DESC LIMIT 6",(url,*ids)).fetchall()
        pending=self.db.execute(f"SELECT count(*) FROM threads t JOIN search_results s ON s.id=t.id WHERE {where} AND t.checked_at IS NULL",(url,*ids)).fetchone()[0]
        return {'queue':[dict(r) for r in rows],'pending_threads':pending}

    def note_read_error(self, event, run_id):
        match=re.fullmatch(r'https://www\.pokergosu\.com/free/([1-9][0-9]{0,18})',event.get('url',''))
        if not match or event.get('reason')!='THREAD_MARKUP_UNKNOWN' or not event.get('finishedAt'):return
        at=event['finishedAt']/1000
        self.db.execute("""INSERT OR IGNORE INTO thread_read_errors SELECT ?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM threads WHERE id=? AND checked_at>=?)""",
                        (match[1],event['reason'],at,run_id,event['sequence'],match[1],at))

    def backfill_read_errors(self):
        with self.db:
            for row in self.db.execute("SELECT key,value FROM state WHERE key GLOB 'extension_monitor_event:*'").fetchall():
                event=json.loads(row['value'])
                if event.get('outcome') in ('skipped','stopped'):self.note_read_error(event,row['key'].split(':')[1])

    def save_monitor(self, value):
        with self.db:
            for event in value['history']:
                if event['outcome']=='skipped':self.note_read_error(event,value['id'])
                key = 'extension_monitor_event:'+value['id']+':'+str(event['sequence'])
                previous = self.get(key)
                if previous and any(previous[k] != event[k] for k in ('sequence','cycle','url','startedAt')):
                    raise ValueError('MONITOR_EVENT_CONFLICT')
                if previous and previous['outcome'] != 'inflight' and previous != event:
                    raise ValueError('MONITOR_EVENT_CONFLICT')
                if previous != event:
                    self.db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (key,json.dumps(event,ensure_ascii=False)))
            for key in ('extension_monitor:'+value['id'], 'extension_monitor'):
                self.db.execute('INSERT OR REPLACE INTO state VALUES (?,?)', (key,json.dumps(value,ensure_ascii=False)))
        self.write_collection_log(value)

    def write_collection_log(self, value):
        from access_log import append_snapshot
        try:
            append_snapshot(self.db, self.directory, value)
            if self.get('collection_log_error'):
                self.set('collection_log_error', None)
        except (OSError, sqlite3.Error) as error:
            # Canonical navigation evidence is already committed. Log failures
            # must be visible without falsely changing the collection outcome.
            try:self.set('collection_log_error', {'at':time.time(),'code':type(error).__name__})
            except sqlite3.Error:pass

    def save(self, thread, now):
        payload = json.dumps(thread, ensure_ascii=False, sort_keys=True)
        digest = hashlib.sha256(payload.encode()).hexdigest()
        with self.db:
            self.db.execute('DELETE FROM thread_read_errors WHERE id=?',(thread['id'],))
            self.db.execute('UPDATE threads SET checked_at=?,payload=?,eligible=? WHERE id=?',
                            (now, payload, int(thread['eligible']), thread['id']))
            self.db.execute('INSERT OR IGNORE INTO revisions VALUES (?,?,?,?)', (thread['id'], digest, now, payload))

    def reclassify(self, settings, evaluate):
        # Existing retained text remains searchable after a settings change.
        with self.db:
            for row in self.db.execute('SELECT id,payload FROM threads WHERE payload IS NOT NULL').fetchall():
                value = evaluate(json.loads(row['payload']), settings)
                self.db.execute('UPDATE threads SET payload=?,eligible=? WHERE id=?',
                                (json.dumps(value, ensure_ascii=False), int(value['eligible']), row['id']))

    def pending_count(self):
        return self.db.execute('SELECT count(*) FROM threads WHERE checked_at IS NULL').fetchone()[0]

    def capture_summary(self):
        return {'threads': self.db.execute('SELECT count(*) FROM threads WHERE payload IS NOT NULL').fetchone()[0],
                'matched': self.db.execute('SELECT count(*) FROM threads WHERE eligible=1').fetchone()[0],
                'last_capture': self.get('extension_status'), 'trial': self.get('extension_trial'), 'monitor': self.get('extension_monitor')}

    def results(self, limit=100, before=None):
        rows = self.db.execute('SELECT id,payload FROM threads WHERE eligible=1 AND (? IS NULL OR CAST(id AS INTEGER)<?) ORDER BY CAST(id AS INTEGER) DESC LIMIT ?', (before, before, limit)).fetchall()
        return {'threads': [json.loads(r['payload']) for r in rows],
                'next_before': rows[-1]['id'] if len(rows) == limit else None}

    def close(self):
        self.db.close()


class Browser:
    def __init__(self, directory):
        self.process = subprocess.Popen(['node', str(Path(__file__).with_name('browser.mjs')), str(directory)],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

    def request(self, operation, **args):
        try:
            self.process.stdin.write(json.dumps({'operation': operation, **args})+'\n')
            self.process.stdin.flush()
            if not select.select([self.process.stdout], [], [], 90)[0]:
                raise TemporaryFailure('BROWSER_TIMEOUT')
            line = self.process.stdout.readline()
            if not line:
                raise TemporaryFailure('BROWSER_EXITED')
            value = json.loads(line)
        except (BrokenPipeError, ValueError) as error:
            raise TemporaryFailure('BROWSER_TRANSPORT') from error
        if value.get('paused'):
            raise Paused(value['paused'])
        if value.get('error'):
            raise TemporaryFailure(value['error'])
        return value['data']

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=8)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                try:
                    self.process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait()

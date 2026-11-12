#!/usr/bin/env python3
"""Single lifecycle entrypoint for the independent Pokergosu public monitor."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import random
import signal
import subprocess
import sys
import threading
import time

from adapters import Browser, KeywordSource, Repository
from domain import Paused, TemporaryFailure, next_delay
from service import Collector

PROJECT = Path(__file__).resolve().parents[2]
STOP = threading.Event()


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def owner(directory):
    try:
        pid = int((directory / 'collector.lock').read_text())
        command = subprocess.run(['ps', '-p', str(pid), '-o', 'command='], capture_output=True, text=True).stdout.strip()
        return pid if str(Path(__file__).resolve()) in command and any(f' {mode} ' in command+' ' for mode in ('run','extension-run')) else None
    except (OSError, ValueError):
        return None


def resolve_root(explicit):
    if explicit:
        return Path(explicit).expanduser().resolve()
    if os.environ.get('MENTION_LEGACY_ROOT'):
        return Path(os.environ['MENTION_LEGACY_ROOT']).expanduser().resolve()
    return Path(json.loads((PROJECT / 'runtime/deployment.json').read_text())['legacyRoot']).resolve()


def execute(args, repository):
    if repository.get('status', {}).get('paused'):
        emit({'error': 'PAUSED', 'status': repository.get('status'), 'action': 'Inspect the reason, then use resume explicitly.'})
        return 2
    browser = None
    try:
        while not STOP.is_set():
            due = repository.get('next_run_at', 0)
            wait = max(0, due-time.time())
            if args.command == 'once' and wait:
                emit({'status': 'not_due', 'next_run_at': due})
                return 0
            if STOP.wait(wait):
                break
            started = time.time()
            try:
                # Read settings before starting any browser or issuing site requests.
                source = KeywordSource(resolve_root(args.legacy_root))
                source.read()
                repository.set('next_run_at', time.time()+next_delay(random))
                browser = Browser(repository.directory)
                def pace(minimum):
                    if STOP.wait(max(minimum, random.uniform(8, 15))):
                        raise InterruptedError()
                result = Collector(source, repository, browser, time.time, pace).cycle()
                status = {'paused': False, 'last_success_at': time.time(), 'failures': 0,
                          'duration_seconds': round(time.time()-started, 2), **result}
                repository.set('status', status)
                repository.set('next_run_at', time.time()+next_delay(random))
            except Paused as error:
                repository.set('status', {**repository.get('status', {}), 'paused': True,
                                           'reason': str(error), 'failed_at': time.time()})
                emit({'status': 'paused', 'reason': str(error)})
                return 2
            except InterruptedError:
                break
            except Exception as error:
                previous = repository.get('status', {})
                failures = previous.get('failures', 0)+1
                # No response bodies, cookies or public post text in operational logs.
                reason = str(error) if isinstance(error, TemporaryFailure) else type(error).__name__
                repository.set('status', {**previous, 'failures': failures, 'paused': failures >= 3,
                                           'reason': reason, 'failed_at': time.time()})
                repository.set('next_run_at', time.time()+min(21600, 1800*2**failures))
                emit({'status': 'failed', 'reason': reason, 'failures': failures})
                if failures >= 3:
                    return 2
            finally:
                if browser:
                    browser.close()
                    browser = None
            if args.command == 'once':
                emit(repository.get('status'))
                return 0 if not repository.get('status', {}).get('failures') else 1
        return 0
    finally:
        if browser:
            browser.close()


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['start', 'run', 'stop', 'status', 'once', 'setup', 'resume', 'export', 'keywords', 'extension-prepare', 'extension-start', 'extension-run', 'extension-stop', 'logs', 'monitor-start', 'monitor-resume', 'monitor-stop', 'extension-reload', 'control-status', 'metadata-repair'])
    parser.add_argument('--legacy-root')
    parser.add_argument('--limit', type=int, default=100)
    parser.add_argument('--before', type=int)
    parser.add_argument('--jsonl', action='store_true')
    args = parser.parse_args()
    directory = (PROJECT / 'runtime/pokergosu').resolve()
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    if args.command == 'metadata-repair':
        from metadata import recover_metadata
        from hashlib import sha256
        repository = Repository(directory)
        changed = 0
        try:
            with repository.db:
                for row in repository.db.execute('SELECT id,payload FROM threads WHERE payload IS NOT NULL').fetchall():
                    original = json.loads(row['payload'])
                    updated = recover_metadata(original)
                    if updated == original:continue
                    updated['metadata_recovered_at'] = time.time()
                    payload = json.dumps(updated, ensure_ascii=False, sort_keys=True)
                    repository.db.execute('UPDATE threads SET payload=? WHERE id=?', (payload, row['id']))
                    repository.db.execute('INSERT OR IGNORE INTO revisions VALUES (?,?,?,?)',
                        (row['id'], sha256(payload.encode()).hexdigest(), time.time(), payload))
                    changed += 1
            emit({'repaired_threads': changed, 'source': 'retained-visible-header', 'site_requests': 0, 'checked_times_preserved': True})
        finally:repository.close()
        return 0
    if args.command in ('monitor-start','monitor-resume','monitor-stop','extension-reload','control-status'):
        from control import ControlStore
        store=ControlStore(directory)
        try:
            if args.command=='control-status':emit(store.status())
            else:
                action={'monitor-start':'start','monitor-resume':'resume','monitor-stop':'stop','extension-reload':'reload'}[args.command]
                version=json.loads((directory/'extension/manifest.json').read_text())['version'] if action=='reload' else None
                emit(store.enqueue(action,version))
        finally:store.close()
        return 0
    if args.command == 'logs':
        from access_log import report
        result=report(directory)
        if args.jsonl:
            for run in result['runs']:emit({'record_type':'run_status',**run})
            for event in result['events']:emit(event)
        else:emit(result)
        return 0
    if args.command == 'extension-prepare':
        from extension_bridge import prepare
        folder, _ = prepare(directory)
        emit({'extension_folder': str(folder), 'auto_visit': False})
        return 0
    if args.command in ('stop', 'extension-stop'):
        pid = owner(directory)
        if pid:
            os.kill(pid, signal.SIGTERM)
        emit({'stop_requested': bool(pid)})
        return 0
    if args.command in ('start', 'extension-start'):
        if owner(directory):
            emit({'status': 'already_running'})
            return 0
        command = [sys.executable, str(Path(__file__).resolve()), 'extension-run' if args.command == 'extension-start' else 'run']
        if args.legacy_root:
            command += ['--legacy-root', args.legacy_root]
        with (directory / 'collector.log').open('a') as log:
            child = subprocess.Popen(command, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        time.sleep(0.5)
        emit({'status': 'started' if child.poll() is None else 'exited', 'pid': child.pid,
              'log': str(directory / 'collector.log')})
        return 0 if child.poll() is None else child.returncode
    if args.command == 'keywords':
        settings = KeywordSource(resolve_root(args.legacy_root)).read()
        emit({'keywords': settings.keywords, 'exclude_keywords': [], 'exclusion_policy': 'ignored'})
        return 0
    if args.command in ('status', 'export'):
        repository = Repository(directory)
        try:
            if args.command == 'status':
                emit({'running': bool(owner(directory)), 'status': repository.get('status'),
                      'next_run_at': repository.get('next_run_at'), 'discovery_gap': repository.get('discovery_gap'),
                      'extension_capture': repository.get('extension_status'),
                      'extension_trial': repository.get('extension_trial'),
                      'extension_monitor': repository.get('extension_monitor'),
                      'collection_log_error': repository.get('collection_log_error'),
                      'extension_diagnostic': repository.get('extension_diagnostic')})
            else:
                if not 1 <= args.limit <= 500:
                    parser.error('--limit must be between 1 and 500')
                emit(repository.results(args.limit, args.before))
        finally:
            repository.close()
        return 0
    with (directory / 'collector.lock').open('a+') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            emit({'error': 'ALREADY_RUNNING'})
            return 1
        lock.seek(0)
        lock.truncate()
        lock.write(str(os.getpid()))
        lock.flush()
        signal.signal(signal.SIGTERM, lambda *_: STOP.set())
        signal.signal(signal.SIGINT, lambda *_: STOP.set())
        if args.command == 'extension-run':
            from extension_bridge import run
            run(directory, KeywordSource(resolve_root(args.legacy_root)), STOP)
            return 0
        if args.command == 'setup':
            return subprocess.call(['node', str(Path(__file__).with_name('browser.mjs')), str(directory), '--setup'])
        repository = Repository(directory)
        try:
            if args.command == 'resume':
                repository.set('status', {**repository.get('status', {}), 'paused': False, 'failures': 0})
                repository.set('next_run_at', time.time()+next_delay(random))
                emit({'status': 'resumed', 'next_run_at': repository.get('next_run_at')})
                return 0
            return execute(args, repository)
        finally:
            repository.close()


if __name__ == '__main__':
    sys.exit(main())

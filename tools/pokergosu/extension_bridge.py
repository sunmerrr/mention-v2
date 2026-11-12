"""Authenticated loopback receiver for explicit activeTab captures.

No website requests or collector lifecycle actions are performed by this server.
"""
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse
import time

from adapters import Repository
from domain import evaluate_thread, keyword_revision
from monitor_policy import monitor_record, monitor_transition

ADDRESS = ('127.0.0.1', 8791)
ORIGIN = 'https://www.pokergosu.com'
ID = r'[1-9][0-9]{0,18}'
MAX_BYTES = 2 * 1024 * 1024


def prepare(directory):
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    secret = directory / 'extension-token'
    if not secret.exists():
        descriptor = os.open(secret, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(descriptor, 'w') as file:
            file.write(secrets.token_urlsafe(32))
    token = secret.read_text().strip()
    if not re.fullmatch(r'[a-zA-Z0-9_-]{40,100}', token):
        raise ValueError('INVALID_EXTENSION_TOKEN')
    target = directory / 'extension'
    target.mkdir(mode=0o700, exist_ok=True)
    source = Path(__file__).parent
    for name in ('manifest.json', 'background.mjs', 'trial.mjs', 'monitor.mjs', 'control.mjs'):
        shutil.copyfile(source / 'extension' / name, target / name)
    shutil.copyfile(source / 'extractor.mjs', target / 'extractor.mjs')
    config = target / 'connection.json'
    config.write_text(json.dumps({'endpoint': 'http://127.0.0.1:8791', 'token': token}))
    os.chmod(config, 0o600)
    return target, token


def text(value, maximum=200000):
    if not isinstance(value, str) or len(value) > maximum:
        raise ValueError('INVALID_TEXT')
    return value


def identity(value):
    if not isinstance(value, str) or not re.fullmatch(ID, value):
        raise ValueError('INVALID_ID')
    return value


def page(value):
    if not isinstance(value, str):
        raise ValueError('INVALID_PAGE_URL')
    parsed = urlparse(value)
    if parsed.netloc != 'www.pokergosu.com' or parsed.scheme != 'https' or parsed.query or parsed.fragment or not re.fullmatch(r'/free(?:/'+ID+r')?/?', parsed.path):
        raise ValueError('INVALID_PAGE_URL')
    return parsed.path


def images(value):
    items=value.get('images',[])
    skipped=value.get('images_skipped',0)
    if not isinstance(items,list) or len(items)>100 or type(skipped) is not int or not 0<=skipped<=100000:raise ValueError('INVALID_IMAGES')
    result=[];seen=set()
    for item in items:
        if not isinstance(item,dict):raise ValueError('INVALID_IMAGE')
        url=text(item.get('url'),2048)
        parsed=urlparse(url)
        if parsed.scheme!='https' or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:raise ValueError('INVALID_IMAGE_URL')
        dimensions={key:item.get(key,0) for key in ('width','height')}
        if any(type(v) not in (int,float) or not math.isfinite(v) or not 0<=v<=100000 for v in dimensions.values()):raise ValueError('INVALID_IMAGE_DIMENSIONS')
        if url not in seen:
            result.append({'url':url,'alt':text(item.get('alt',''),500),**dimensions});seen.add(url)
    return {'images':result,'images_skipped':skipped}


def thread(value):
    if not isinstance(value, dict):
        raise ValueError('INVALID_THREAD')
    result = {key: text(value.get(key), limit) for key, limit in (('id', 19), ('url', 200), ('title', 2000), ('body', 200000))}
    identity(result['id'])
    if result['url'] != f"{ORIGIN}/free/{result['id']}":
        raise ValueError('THREAD_URL_MISMATCH')
    result.update(source='pokergosu', board='free', author=text(value.get('author', ''), 500),
                  metadata_text=text(value.get('metadata_text', ''),1000),
                  published_at=None if value.get('published_at') is None else text(value['published_at'], 100))
    result.update(images(value))
    comments = value.get('comments')
    if not isinstance(comments, list) or len(comments) > 3000:
        raise ValueError('INVALID_COMMENTS')
    coverage=value.get('comment_coverage')
    skipped=value.get('skipped_comments',[])
    if not isinstance(skipped,list) or len(skipped)>3000:raise ValueError('INVALID_SKIPPED_COMMENTS')
    clean_skipped=[]
    for item in skipped:
        if not isinstance(item,dict) or item.get('reason') not in ('MISSING_OR_INVALID_ID','CONTENT_NOT_FOUND','EMPTY_OR_UNREADABLE'):
            raise ValueError('INVALID_SKIPPED_COMMENTS')
        clean_skipped.append({'id':None if item.get('id') is None else identity(item['id']),'reason':item['reason']})
    unavailable=value.get('unavailable_comments',0 if coverage=='visible-complete' else None)
    expected=value.get('expected_comments')
    if coverage in ('visible-complete','partial'):
        if type(expected) is not int or type(unavailable) is not int or not 0<=unavailable<=100000 or expected!=len(comments)+len(skipped)+unavailable:
            raise ValueError('INCOMPLETE_COMMENTS')
        if coverage=='visible-complete' and (skipped or unavailable):raise ValueError('INCOMPLETE_COMMENTS')
    elif coverage=='unknown':
        if expected is not None or unavailable is not None:raise ValueError('INVALID_UNKNOWN_COVERAGE')
    else:raise ValueError('INVALID_COMMENT_COVERAGE')
    result['comments'] = []
    seen = set()
    for comment in comments:
        if not isinstance(comment, dict):
            raise ValueError('INVALID_COMMENT')
        cid = identity(comment.get('id'))
        if cid in seen:
            raise ValueError('DUPLICATE_COMMENT_ID')
        seen.add(cid)
        has_media=comment.get('has_media',False)
        kind=comment.get('content_kind','text')
        if type(has_media) is not bool or kind not in ('text','mixed','media_only'):raise ValueError('INVALID_COMMENT_KIND')
        content=text(comment.get('text'))
        if (kind=='media_only' and (content or not has_media)) or (kind=='mixed' and (not content or not has_media)) or (kind=='text' and (has_media or not content)):raise ValueError('INVALID_COMMENT_KIND')
        result['comments'].append({**images(comment), 'id': cid, 'text': content, 'has_media':has_media, 'content_kind':kind,
                                   'author': text(comment.get('author', ''), 500),
                                   'metadata_text': text(comment.get('metadata_text',''),1000),
                                   'published_at': None if comment.get('published_at') is None else text(comment['published_at'], 100),
                                   'parent_id': None if comment.get('parent_id') is None else identity(comment['parent_id'])})
    if len(result['images'])+sum(len(c['images']) for c in result['comments'])>100:raise ValueError('INVALID_TOTAL_IMAGES')
    for item in clean_skipped:
        if item['id'] is not None:
            if item['id'] in seen:raise ValueError('DUPLICATE_COMMENT_ID')
            seen.add(item['id'])
    reported=value.get('reported_comments',expected)
    if reported is not None and (type(reported) is not int or not 0<=reported<=100000):raise ValueError('INVALID_REPORTED_COUNT')
    result.update(expected_comments=expected, reported_comments=reported, comment_coverage=coverage,
                  skipped_comments=clean_skipped, unavailable_comments=unavailable, capture_method='extension-active-tab')
    from metadata import recover_metadata
    return recover_metadata(result)


def trial_record(value):
    if not isinstance(value, dict) or not isinstance(value.get('id'), str) or not re.fullmatch(r'[a-f0-9-]{36}', value['id']):
        raise ValueError('INVALID_TRIAL')
    for key in ('tabId', 'limit', 'attempted', 'successful'):
        if type(value.get(key)) is not int:
            raise ValueError('INVALID_TRIAL')
    if value['limit'] != 15 or not 0 <= value['successful'] <= value['attempted'] <= 15 or value['tabId'] < 0:
        raise ValueError('INVALID_TRIAL_LIMIT')
    status = value.get('status')
    if status not in ('running', 'completed', 'stopped') or type(value.get('inFlight')) is not bool:
        raise ValueError('INVALID_TRIAL_STATUS')
    clean = {key: value[key] for key in ('id','tabId','limit','attempted','successful','status','inFlight')}
    for key in ('startedAt', 'nextAt', 'finishedAt'):
        stamp = value.get(key)
        if stamp is not None and (type(stamp) not in (int,float) or not math.isfinite(stamp) or not 0 <= stamp < 9e15):
            raise ValueError('INVALID_TRIAL_TIME')
        clean[key] = stamp
    clean['reason'] = None if value.get('reason') is None else text(value['reason'], 100)
    history = value.get('history')
    if not isinstance(history, list) or len(history) != value['attempted']:
        raise ValueError('INVALID_TRIAL_HISTORY')
    clean['history'] = []
    for sequence, entry in enumerate(history, 1):
        if not isinstance(entry, dict) or entry.get('sequence') != sequence or entry.get('outcome') not in ('inflight','success','failed','stopped','unknown'):
            raise ValueError('INVALID_TRIAL_HISTORY')
        record = {'sequence': sequence, 'outcome': entry['outcome'], 'reason': None if entry.get('reason') is None else text(entry['reason'],100)}
        for key in ('startedAt','finishedAt'):
            stamp = entry.get(key)
            if stamp is not None and (type(stamp) not in (int,float) or not math.isfinite(stamp) or not 0 <= stamp < 9e15):
                raise ValueError('INVALID_TRIAL_TIME')
            record[key] = stamp
        if entry['outcome'] == 'inflight' and sequence != len(history):
            raise ValueError('INVALID_TRIAL_HISTORY')
        clean['history'].append(record)
    if value['successful'] != sum(e['outcome']=='success' for e in history):
        raise ValueError('INVALID_TRIAL_SUCCESSES')
    if value['inFlight'] != bool(history and history[-1]['outcome']=='inflight'):
        raise ValueError('INVALID_TRIAL_INFLIGHT')
    if status == 'completed' and (value['successful'] != 15 or value['inFlight'] or value.get('nextAt') is not None):
        raise ValueError('INVALID_TRIAL_COMPLETION')
    if status != 'running' and (value['inFlight'] or value.get('nextAt') is not None):
        raise ValueError('INVALID_TRIAL_STOP')
    if status == 'running' and not value['inFlight'] and value.get('nextAt') is None:
        raise ValueError('INVALID_TRIAL_SCHEDULE')
    return clean


class CaptureService:
    def __init__(self, directory, source):
        self.directory, self.source = Path(directory), source

    def status(self):
        repository = Repository(self.directory)
        try:
            return repository.capture_summary()
        finally:
            repository.close()

    def plan(self):
        repository = Repository(self.directory)
        try:
            return repository.monitor_plan(time.time())
        finally:
            repository.close()

    def capture(self, request):
        if not isinstance(request, dict):
            raise ValueError('INVALID_CAPTURE')
        path = page(request.get('page_url'))
        operation, data = request.get('operation'), request.get('data')
        now = time.time()
        repository = Repository(self.directory)
        try:
            if operation == 'monitor' and path.rstrip('/') == '/free':
                clean = monitor_record(data)
                monitor_transition(repository.get('extension_monitor:'+clean['id']), clean)
                repository.save_monitor(clean)
                result = {'monitor_saved': True, 'status': clean['status'], 'navigations': clean['navigations']}
            elif operation == 'trial' and path.rstrip('/') == '/free':
                clean = trial_record(data)
                key = 'extension_trial:'+clean['id']
                previous = repository.get(key)
                if previous:
                    if previous['status'] != 'running' and clean != previous:
                        raise ValueError('TRIAL_ALREADY_FINISHED')
                    if not previous['attempted'] <= clean['attempted'] <= previous['attempted']+1:
                        raise ValueError('TRIAL_COUNTER_REGRESSION')
                    prefix = previous['history'][:-1] if previous['inFlight'] else previous['history']
                    if clean['history'][:len(prefix)] != prefix:
                        raise ValueError('TRIAL_HISTORY_CONFLICT')
                repository.set(key, clean)
                repository.set('extension_trial', clean)
                result = {'trial_saved': True, 'status': clean['status'], 'attempted': clean['attempted']}
            elif operation == 'diagnostic':
                structure = request.get('structure')
                if not isinstance(structure, dict) or structure.get('url') != request['page_url']:
                    raise ValueError('INVALID_DIAGNOSTIC')
                nodes = structure.get('nodes')
                headings = structure.get('headings')
                if not isinstance(nodes, list) or len(nodes) > 350 or not isinstance(headings, list) or len(headings) > 12:
                    raise ValueError('INVALID_DIAGNOSTIC')
                # Explicit allowlist prevents arbitrary HTML, form values or scripts
                # from crossing the diagnostic boundary.
                clean = {'url': request['page_url'], 'headings': [text(h,160) for h in headings], 'nodes': []}
                for node in nodes:
                    clean['nodes'].append({key: text(node.get(key), limit) for key,limit in (('tag',20),('id',160),('classes',240),('parent',20))})
                reason = text(request.get('reason'), 80)
                repository.set('extension_diagnostic', {'observed_at': now, 'reason': reason, 'structure': clean})
                result = {'diagnostic_saved': True, 'reason': reason}
            elif operation == 'list' and path.rstrip('/') == '/free':
                if not isinstance(data, list) or not 1 <= len(data) <= 300:
                    raise ValueError('INVALID_LIST')
                posts = []
                for item in data:
                    pid = identity(item.get('id'))
                    if item.get('url') != f'{ORIGIN}/free/{pid}':
                        raise ValueError('THREAD_URL_MISMATCH')
                    posts.append({'id': pid, 'url': item['url']})
                repository.discover(posts, now)
                result = {'discovered': len(posts), 'pending_threads': repository.pending_count()}
            elif operation == 'thread':
                value = thread(data)
                if path.rstrip('/') != f"/free/{value['id']}":
                    raise ValueError('CAPTURE_PAGE_MISMATCH')
                settings = self.source.read()
                # Includes only; the authoritative Kakao exclusions are not read.
                value = evaluate_thread(value, settings)
                revision = keyword_revision(settings)
                if repository.get('settings_revision') != revision:
                    repository.reclassify(settings, evaluate_thread)
                    repository.set('settings_revision', revision)
                repository.discover([value], now)
                repository.save(value, now)
                result = {'saved': True, 'eligible': value['eligible'], 'comments': len(value['comments']),
                          'comment_summary': {'saved':len(value['comments']),'media_only':sum(c['content_kind']=='media_only' for c in value['comments']),
                                              'skipped':len(value['skipped_comments']),'unavailable':value['unavailable_comments'],'coverage':value['comment_coverage']},
                          'matched_comments': sum(c['match']['eligible'] for c in value['comments']),
                          'metadata_missing': not value.get('author') or not value.get('published_at') or any(not c.get('author') or not c.get('published_at') for c in value['comments'])}
            else:
                raise ValueError('INVALID_OPERATION')
            repository.set('extension_status', {'observed_at': now, 'operation': operation, **result})
            return result
        finally:
            repository.close()


def make_handler(service, token, port=8791):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def setup(self):
            super().setup()
            self.connection.settimeout(10)

        def respond(self, code, value):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(code)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            origin = self.headers.get('Origin', '')
            if re.fullmatch(r'chrome-extension://[a-p]{32}', origin):
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
            self.end_headers()
            self.wfile.write(body)

        def authorized(self):
            origin = self.headers.get('Origin', '')
            extension = self.headers.get('X-Mention-Extension', '')
            return (self.headers.get('Host') == f'127.0.0.1:{port}'
                    and re.fullmatch(r'[a-p]{32}', extension)
                    and (not origin or origin == 'chrome-extension://'+extension)
                    and hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer '+token))

        def do_OPTIONS(self):
            origin = self.headers.get('Origin', '')
            if self.headers.get('Host') != f'127.0.0.1:{port}' or not re.fullmatch(r'chrome-extension://[a-p]{32}', origin):
                self.respond(403, {'error': 'FORBIDDEN'})
                return
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Access-Control-Allow-Methods', 'GET, POST')
            self.send_header('Access-Control-Allow-Headers', 'authorization,content-type,x-mention-extension')
            self.send_header('Vary', 'Origin')
            self.end_headers()

        def do_GET(self):
            if not self.authorized():
                self.respond(403, {'error': 'FORBIDDEN'})
                return
            if self.path not in ('/status', '/plan'):
                self.respond(404, {'error': 'NOT_FOUND'})
                return
            try:
                self.respond(200, service.plan() if self.path == '/plan' else service.status())
            except Exception:
                self.respond(503, {'error': 'LOCAL_UNAVAILABLE'})

        def do_POST(self):
            if not self.authorized():
                self.respond(403, {'error': 'FORBIDDEN'})
                return
            if self.path not in ('/capture','/control/poll','/control/ack'):
                self.respond(404, {'error': 'NOT_FOUND'})
                return
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if not 0 < length <= MAX_BYTES:
                    self.respond(413, {'error': 'CAPTURE_TOO_LARGE'})
                    return
                if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                    self.respond(415, {'error': 'JSON_REQUIRED'})
                    return
                raw = self.rfile.read(length)
                if len(raw) != length:
                    raise ValueError('INCOMPLETE_REQUEST')
                request=json.loads(raw)
                if self.path in ('/control/poll','/control/ack'):
                    from control import ControlStore
                    store=ControlStore(service.directory)
                    try:
                        owner=self.headers.get('X-Mention-Extension')+':'+request['instance']
                        result=store.poll(owner,request['version'],request['permission'],request['enabled']) if self.path=='/control/poll' else store.ack(owner,request['id'],request['result'])
                    finally:store.close()
                else:result = service.capture(request)
                self.respond(200, result)
            except (ValueError, TypeError, KeyError, AttributeError):
                self.respond(400, {'error': 'INVALID_CAPTURE'})
            except Exception:
                self.respond(503, {'error': 'LOCAL_UNAVAILABLE'})
    return Handler


def run(directory, source, stop):
    _, token = prepare(directory)
    from access_log import backfill
    backfill(directory)
    service = CaptureService(directory, source)
    server = HTTPServer(ADDRESS, make_handler(service, token))
    server.timeout = 0.5
    repository = Repository(directory)
    repository.set('extension_receiver', {'port': ADDRESS[1], 'started_at': time.time()})
    repository.close()
    try:
        while not stop.is_set():
            server.handle_request()
    finally:
        server.server_close()

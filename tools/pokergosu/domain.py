"""Collection policy independent of browsers, HTTP and persistence."""
from dataclasses import dataclass
import hashlib
import json
from typing import Callable


@dataclass(frozen=True)
class Settings:
    keywords: tuple[str, ...]
    match: Callable[..., list[str]]

    def evaluate(self, text):
        included = self.match(text, self.keywords)
        return {'included': included, 'excluded': [], 'eligible': bool(included)}


def next_delay(random):
    return random.uniform(15 * 60, 30 * 60)


def evaluate_thread(thread, settings):
    """Match posts and comments independently using include keywords only."""
    post = settings.evaluate(thread['title'] + '\n' + thread['body'])
    comments = [{**comment, 'match': settings.evaluate(comment['text'])}
                for comment in thread['comments']]
    return {**thread, 'match': post, 'comments': comments,
            'eligible': post['eligible'] or any(c['match']['eligible'] for c in comments)}


class Paused(Exception):
    """Access restrictions and unknown markup require inspection, not retries."""


class TemporaryFailure(Exception):
    pass


def keyword_revision(settings):
    return hashlib.sha256(json.dumps(['include-only-v1', settings.keywords], ensure_ascii=False).encode()).hexdigest()


ACCESS_KINDS = ('bot_challenge','access_denied','rate_limited','account_restriction_notice')


def access_evidence(value):
    if not isinstance(value,dict) or value.get('kind') not in ACCESS_KINDS or value.get('basis')!='visible-page' or value.get('http_status') is not None or value.get('account_ban_confirmed') is not False:
        raise ValueError('INVALID_ACCESS_EVIDENCE')
    title=value.get('title')
    indicators=value.get('indicators')
    if not isinstance(title,str) or len(title)>200 or not isinstance(indicators,list) or not 1<=len(indicators)<=5 or any(not isinstance(x,str) or len(x)>80 for x in indicators):
        raise ValueError('INVALID_ACCESS_EVIDENCE')
    return {'kind':value['kind'],'title':title,'indicators':indicators,'basis':'visible-page','http_status':None,'account_ban_confirmed':False}



def comment_summary(value):
    if not isinstance(value,dict) or value.get('coverage') not in ('visible-complete','partial','unknown'):
        raise ValueError('INVALID_COMMENT_SUMMARY')
    result={'coverage':value['coverage']}
    for key in ('saved','media_only','skipped'):
        number=value.get(key)
        if type(number) is not int or not 0<=number<=3000:raise ValueError('INVALID_COMMENT_SUMMARY')
        result[key]=number
    missing=value.get('unavailable')
    if missing is not None and (type(missing) is not int or not 0<=missing<=100000):raise ValueError('INVALID_COMMENT_SUMMARY')
    if result['media_only']>result['saved']:raise ValueError('INVALID_COMMENT_SUMMARY')
    if result['coverage']=='visible-complete' and (result['skipped'] or missing!=0):raise ValueError('INVALID_COMMENT_SUMMARY')
    if result['coverage']=='unknown' and missing is not None:raise ValueError('INVALID_COMMENT_SUMMARY')
    result['unavailable']=missing
    return result

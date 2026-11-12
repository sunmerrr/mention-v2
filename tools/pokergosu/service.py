"""Bounded discovery and comment refresh through narrow injected adapters."""
from urllib.robotparser import RobotFileParser

from domain import Paused, evaluate_thread, keyword_revision


class Collector:
    def __init__(self, source, repository, browser, clock, pace):
        self.source, self.repository, self.browser = source, repository, browser
        self.clock, self.pace = clock, pace

    def cycle(self):
        settings = self.source.read()
        fingerprint = keyword_revision(settings)
        if fingerprint != self.repository.get('settings_revision'):
            self.repository.reclassify(settings, evaluate_thread)
            self.repository.set('settings_revision', fingerprint)
        requests, captured = 0, 0
        robots = self.repository.get('robots')
        if not robots or self.clock()-robots['checked_at'] > 86400:
            result = self.browser.request('robots')
            requests += 1
            robots = {'checked_at': self.clock(), 'text': result['text']}
            self.repository.set('robots', robots)
            self.pace(0)
        policy = RobotFileParser()
        policy.parse(robots['text'].splitlines())
        if not policy.can_fetch('MentionMonitor', 'https://www.pokergosu.com/free'):
            raise Paused('ROBOTS_DISALLOWED')
        delay = max(policy.crawl_delay('MentionMonitor') or 0, policy.crawl_delay('*') or 0)
        frontier = self.repository.get('frontier')
        newest, reached, discovered = frontier, False, []
        for page in range(1, 4):
            url = f'https://www.pokergosu.com/free?page={page}'
            if not policy.can_fetch('MentionMonitor', url):
                raise Paused('ROBOTS_DISALLOWED')
            self.pace(delay)
            posts = self.browser.request('list', page=page)
            requests += 1
            self.repository.discover(posts, self.clock())
            regular = [int(p['id']) for p in posts if not p.get('pinned')]
            if not regular:
                raise Paused('BOARD_NO_REGULAR_POSTS')
            discovered.extend(regular)
            newest = max([int(newest or 0), *regular])
            reached = frontier is None or min(regular) <= int(frontier)
            if reached:
                break
        # Explicit bounded-gap evidence; never pretend a busy board was fully read.
        gap = None if reached else {'after_id': frontier, 'oldest_visible_id': min(discovered), 'observed_at': self.clock(), 'reason': 'THREE_PAGE_LIMIT'}
        if gap:
            self.repository.set('discovery_gap', gap)
        self.repository.set('last_discovery_gap', gap)
        self.repository.set('frontier', str(newest))
        for candidate in self.repository.queue(self.clock()):
            if not policy.can_fetch('MentionMonitor', candidate['url']):
                raise Paused('ROBOTS_DISALLOWED')
            self.pace(delay)
            thread = self.browser.request('thread', id=candidate['id'])
            requests += 1
            if thread['id'] != candidate['id']:
                raise Paused('THREAD_ID_MISMATCH')
            value = evaluate_thread(thread, settings)
            self.repository.save(value, self.clock())
            captured += 1
        pending = self.repository.pending_count()
        return {'requests': requests, 'threads_checked': captured, 'pending_threads': pending,
                'include_keyword_count': len(settings.keywords), 'discovery_gap': gap,
                'comment_window_hours': 72, 'comment_coverage': 'visible-count-validated'}

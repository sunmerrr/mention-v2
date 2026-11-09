"""Conservative alias evidence filtering; never deletes messages or adds keywords."""
from collections import Counter
from functools import lru_cache
import re


def conversational_records(pool):
    from monitor import context_selection, quality
    from monitor.rules import normalized

    def template(row):
        text = re.sub(r'https?://\S+', '<url>', normalized(row['text']))
        return re.sub(r'\s+', ' ', re.sub(r'\d+', '<n>', text)).strip()

    frequencies = Counter(template(row) for row in pool)
    filtered = []
    for row in pool:
        category = context_selection.category(row)
        anchor = {**row, 'role': 'anchor'}
        repeated = frequencies[template(row)] - 1
        promotional = quality.triage([anchor], repeated)['category'] == 'promotion'
        text = normalized(row['text'])
        schedule_words = sum(word in text for word in ('gtd','바이인','엔트리','레지','프라이즈','상금','참가','보장','일정'))
        opinion = any(word in text for word in quality.OPINION)
        personal = opinion and ('?' in text or '？' in text or '저는' in text or '제가' in text or any(word in text for word in ('불편','비싸','비싼','실망','사기','불만','별로','써봤','해봤')))
        schedule_ad = not personal and schedule_words >= 3 and ('http' in text or len(text) >= 180)
        if category not in ('promotion', 'link', 'deleted') and not promotional and not schedule_ad:
            filtered.append(row)
    return filtered


def discover_candidates(store, days=14):
    from monitor import alias_discovery
    original_records = alias_discovery.records
    original_distance = alias_discovery.distance_one
    pool = original_records(store, days)
    filtered = conversational_records(pool)

    # The live collector still validates alias additions against its existing
    # candidate set. Only display candidates that remain eligible there.
    alias_discovery.distance_one = lru_cache(maxsize=20000)(original_distance)
    try:
        baseline = alias_discovery.discover(store, days)
        valid = {candidate['token_key'] for candidate in baseline['candidates']}
        alias_discovery.records = lambda _store, _days=14, limit=5000: filtered[:limit]
        result = alias_discovery.discover(store, days)
        result['candidates'] = [c for c in result['candidates'] if c['token_key'] in valid]
    finally:
        alias_discovery.records = original_records
        alias_discovery.distance_one = original_distance
    from monitor.rules import matches
    keywords = store.setting('keywords', [])
    recognized = [candidate for candidate in result['candidates'] if matches(candidate['token'], keywords)]
    result['candidates'] = [candidate for candidate in result['candidates'] if not matches(candidate['token'], keywords)]
    result['already_recognized_excluded'] = len(recognized)
    groups = {group['id']:group for group in store.keyword_groups()}
    for candidate in result['candidates']:
        group = groups.get(candidate['group_id'])
        if group and candidate['method'] == 'spelling':
            words = list(dict.fromkeys(group['keywords']+[group['name']]))
            candidate['similar_to'] = [word for word in words if original_distance(alias_discovery.identity(candidate['token']),alias_discovery.identity(word))][:3]
    result['total'] = len(result['candidates'])
    result['promotion_messages_excluded'] = len(pool) - len(filtered)
    result['scanned'] = len(filtered)
    result['note'] = '홍보·링크 안내를 제외한 저장 대화에서 찾은 검토 후보입니다. 이미 현재 키워드로 인식되는 표현은 추천하지 않습니다. 철자 유사성이나 동시 언급만으로 실제 별칭임을 확정하지 않습니다.'
    return result

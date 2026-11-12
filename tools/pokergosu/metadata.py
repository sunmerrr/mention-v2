"""Recover missing fields only from separately retained visible header evidence."""
import re
from datetime import datetime

STAMP = r'(\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}:\d{2})'


def valid_stamp(value):
    try:
        datetime.strptime(value, '%Y.%m.%d %H:%M:%S')
        return True
    except ValueError:
        return False


def recover_metadata(value):
    """Never replace explicit fields or derive metadata from body/comment text."""
    updated = {**value}
    evidence = value.get('metadata_text', '')
    identity = value.get('id', '')
    matches = list(re.finditer(r'조회\s*수\s*[\d,]+\s*추천\s*수\s*[\d,]+' + STAMP +
                      r'(.{1,500}?)\s+https://www\.pokergosu\.com/free/' + re.escape(identity) + r'(?=\s|$|0BB|첨부|목록으로|스크랩)', evidence))
    match = matches[0] if len(matches) == 1 else None
    if match and valid_stamp(match[1]) and not re.search(STAMP, match[2]) and not re.search(r'https?://|조회\s*수|추천\s*수', match[2]):
        if not updated.get('published_at'):updated['published_at'] = match[1]
        if not updated.get('author'):updated['author'] = match[2].strip()
    comments = []
    for original in value.get('comments', []):
        comment = {**original}
        # The retained comment header excludes child comments, content and forms.
        match = re.fullmatch(r'(.{1,500}?)' + STAMP + r'\s*(?:답글달기)?', original.get('metadata_text', '').strip())
        if match and valid_stamp(match[2]):
            if not comment.get('author'):comment['author'] = match[1].strip()
            if not comment.get('published_at'):comment['published_at'] = match[2]
        fields = [key for key in ('author', 'published_at') if comment.get(key) and not original.get(key)]
        if fields:comment['metadata_recovered_fields'] = sorted(set(original.get('metadata_recovered_fields', []) + fields))
        comments.append(comment)
    updated['comments'] = comments
    fields = [key for key in ('author', 'published_at') if updated.get(key) and not value.get(key)]
    if fields:updated['metadata_recovered_fields'] = sorted(set(value.get('metadata_recovered_fields', []) + fields))
    return updated

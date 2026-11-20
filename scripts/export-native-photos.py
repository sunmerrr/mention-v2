"""Copy retained Kakao photos into a private, content-addressed migration bundle."""

import argparse
import errno
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3

MAX_BYTES = 32 * 1024 * 1024


def export(source, target, reuse=None):
    target.mkdir(mode=0o700)
    objects = target / 'objects'
    objects.mkdir(mode=0o700)
    root = (source.parent / 'photos').resolve(strict=True)
    previous = (reuse.resolve(strict=True) / 'objects') if reuse else None
    if previous is not None and (not previous.is_dir() or previous.is_symlink()):
        raise ValueError('INVALID_NATIVE_PHOTO_REUSE_BUNDLE')
    db = sqlite3.connect(':memory:')
    live = sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True, timeout=5)
    try:
        live.backup(db, pages=256)
    finally:
        live.close()
    db.row_factory = sqlite3.Row
    counts = dict(routes=0, objects=0, reused=0, missing=0, unattached=0)
    try:
        with open(target / 'manifest.jsonl', 'x', encoding='utf8', opener=private_open) as out:
            query = '''SELECT p.*,m.text AS message_text,c.text AS context_text
                       FROM photos p LEFT JOIN messages m USING(room_id,log_id)
                       LEFT JOIN context_messages c USING(room_id,log_id)
                       ORDER BY p.room_id,p.log_id'''
            db.execute('PRAGMA query_only=ON')
            db.execute('BEGIN')
            for row in db.execute(query):
                paths = (json.loads(row['paths'] or '[]'), json.loads(row['thumbnails'] or '[]'))
                if row['message_text'] is None and row['context_text'] is None:
                    counts['unattached'] += sum(bool(path) for group in paths for path in group)
                    continue
                for variant, group in enumerate(paths):
                    for index, relative in enumerate(group):
                        if not relative:
                            continue
                        try:
                            path = (source.parent / relative).resolve(strict=True)
                            if not path.is_relative_to(root) or not path.is_file():
                                raise ValueError('INVALID_NATIVE_PHOTO_PATH')
                            with path.open('rb') as photo:
                                data = photo.read(MAX_BYTES + 1)
                        except FileNotFoundError:
                            counts['missing'] += 1
                            continue
                        if not 0 < len(data) <= MAX_BYTES:
                            raise ValueError('INVALID_NATIVE_PHOTO_SIZE')
                        digest = hashlib.sha256(data).hexdigest()
                        obj = objects / digest
                        if not obj.exists():
                            reused = previous is not None and reuse_object(previous / digest, obj, data)
                            if not reused:
                                with open(obj, 'xb', opener=private_open) as destination:
                                    destination.write(data)
                            counts['objects'] += 1
                            counts['reused'] += int(reused)
                        route = f"/photo/{row['room_id']}/{row['log_id']}/{index}"
                        suffix = path.suffix.lower()
                        if not re.fullmatch(r'\.[a-z0-9]{1,12}', suffix):
                            suffix = '.bin'
                        out.write(json.dumps(dict(
                            route=route + ('?thumb=1' if variant else ''), digest=digest,
                            filename=f"photo-{row['log_id']}-{index}{suffix}",
                            messageText=row['message_text'], contextText=row['context_text'],
                        ), ensure_ascii=False) + '\n')
                        counts['routes'] += 1
    finally:
        db.close()
    print(json.dumps(counts))


def reuse_object(source, target, data):
    if not source.is_file() or source.is_symlink():
        return False
    if source.stat().st_size != len(data) or source.read_bytes() != data:
        raise ValueError('CORRUPT_NATIVE_PHOTO_REUSE_OBJECT')
    try:
        os.link(source, target, follow_symlinks=False)
        return True
    except OSError as error:
        if error.errno == errno.EXDEV:
            return False
        raise


def private_open(path, flags):
    return os.open(path, flags, 0o600)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('--reuse-bundle', type=Path)
    args = parser.parse_args()
    export(args.source.resolve(), args.target, args.reuse_bundle)

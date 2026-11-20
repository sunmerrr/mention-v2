#!/usr/bin/env python3
"""Export a consistent analysis database snapshot for import-native-state."""

import argparse
import base64
import contextlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import uuid


TABLES = (
    "ai_review_history", "ai_review_items", "ai_review_jobs", "alias_decisions",
    "alias_history", "bookmark_history", "bookmarks", "briefing_deliveries",
    "briefing_image_deliveries", "campaign_sends", "checkpoints",
    "collection_intervals", "collection_recoveries", "collection_runtime",
    "confirmed_observations", "context_dirty", "context_expansions",
    "context_messages", "conversation_reviews", "correction_history",
    "daily_briefings", "dirty", "episode_evaluation_history", "episode_links",
    "episodes", "feedback_note_history", "feedback_notes", "gaps",
    "guide_entrances", "guide_followup_links", "guide_message_details",
    "guide_messages", "guide_rooms", "keyword_group_review_history",
    "mention_corrections", "messages", "photos", "poster_sends",
    "promotion_reaction_links", "review_history", "rooms", "settings",
)
SETTINGS = (
    "automatic_ad_exclusions_removed", "briefing_delivery", "connection_event_cursor",
    "context_bootstrap_v1", "context_csv_v2", "context_noise_v1", "context_noise_v2",
    "coverage_legacy_v1", "dialogue_event_cursor", "exclude_keywords",
    "exclude_policy_v1", "guide_config", "keyword_groups", "keyword_policy",
    "keyword_processing", "keywords", "promotion_watch_refs_v1", "service_filter_v1",
    "single_character_rule_v1",
)


def encode_blob(value):
    if isinstance(value, bytes):
        return {"$sqlite_blob_base64": base64.b64encode(value).decode("ascii")}
    raise TypeError(type(value).__name__)


def write_line(stream, row):
    stream.write(json.dumps(row, ensure_ascii=False, separators=(",", ":"), default=encode_blob) + "\n")


def table_select(db, table):
    if table != "settings":
        return db.execute(f'SELECT * FROM "{table}"')
    placeholders = ",".join("?" for _ in SETTINGS)
    return db.execute(f'SELECT * FROM settings WHERE key IN ({placeholders})', SETTINGS)


def export(source, output):
    if output.exists():
        raise FileExistsError(output)
    source_uri = source.resolve(strict=True).as_uri() + "?mode=ro"
    with contextlib.closing(sqlite3.connect(source_uri, uri=True, timeout=5)) as original:
        original.execute("PRAGMA query_only=ON")
        with contextlib.closing(sqlite3.connect("")) as snapshot:
            original.backup(snapshot, pages=256, sleep=0.01)
            captured_at = datetime.now(timezone.utc).isoformat()
            snapshot.row_factory = sqlite3.Row
            present = {
                row["name"]
                for row in snapshot.execute("SELECT name FROM sqlite_master WHERE type='table'")
            }
            required = {"settings", "rooms", "messages", "context_messages", "episodes"}
            if not required.issubset(present):
                raise ValueError("The source is missing required analysis tables")
            counts = dict.fromkeys(TABLES, 0)
            for table in TABLES:
                if table not in present:
                    continue
                if table == "settings":
                    counts[table] = sum(1 for _ in table_select(snapshot, table))
                else:
                    counts[table] = snapshot.execute(f'SELECT count(*) FROM "{table}"').fetchone()[0]
            header = {
                "kind": "native-state", "version": 1, "id": str(uuid.uuid4()),
                "capturedAt": captured_at, "counts": counts,
            }
            descriptor, temp_name = tempfile.mkstemp(dir=output.parent, prefix=".native-state-")
            try:
                with os.fdopen(descriptor, "w", encoding="utf8") as stream:
                    write_line(stream, header)
                    for table in TABLES:
                        if not counts[table]:
                            continue
                        for ordinal, row in enumerate(table_select(snapshot, table)):
                            write_line(stream, {"table": table, "ordinal": ordinal, "body": dict(row)})
                    stream.flush()
                    os.fsync(stream.fileno())
                os.link(temp_name, output)
            finally:
                os.unlink(temp_name)
    return {"id": header["id"], "capturedAt": captured_at, "tables": len(TABLES), "rows": sum(counts.values())}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    print(json.dumps(export(args.database, args.output)))

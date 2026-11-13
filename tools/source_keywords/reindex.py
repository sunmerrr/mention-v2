"""Re-evaluate retained forum text locally; never navigate or start a collector."""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'pokergosu'))
from adapters import KeywordSource,Repository
from domain import evaluate_thread,keyword_revision

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--legacy-root',required=True);parser.add_argument('--directory',required=True);args=parser.parse_args()
    directory=Path(args.directory)
    if not (directory/'monitor.sqlite3').is_file():
        print(json.dumps({'state':'not_collected','updated':0}));return
    settings=KeywordSource(args.legacy_root).read();repo=Repository(directory)
    try:
        repo.reclassify(settings,evaluate_thread);repo.set('settings_revision',keyword_revision(settings))
        print(json.dumps({'state':'completed','updated':repo.capture_summary()['threads'],'keywords':list(settings.keywords)}))
    finally:repo.close()
if __name__=='__main__':main()

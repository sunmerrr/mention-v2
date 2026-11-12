"""Mention sentiment automation. Does not control Kakao or send chat messages."""
import argparse
import json
from pathlib import Path
import sys

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
from tools.sentiment_classifier.service import Queue,DEFAULT_STATE

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--state',type=Path,default=DEFAULT_STATE)
    sub=parser.add_subparsers(dest='command',required=True)
    scan=sub.add_parser('scan');scan.add_argument('--no-wake',action='store_true')
    sub.add_parser('status')
    claim=sub.add_parser('claim');claim.add_argument('batch')
    submit=sub.add_parser('submit');submit.add_argument('batch');submit.add_argument('file',type=Path)
    args=parser.parse_args();queue=Queue(args.state)
    try:
        if args.command=='scan':result=queue.scan(not args.no_wake)
        elif args.command=='status':result=queue.status()
        elif args.command=='claim':result=queue.claim(args.batch)
        else:result=queue.submit(args.batch,json.loads(args.file.read_text()))
        print(json.dumps(result,ensure_ascii=False,indent=2))
    finally:queue.close()
if __name__=='__main__':main()

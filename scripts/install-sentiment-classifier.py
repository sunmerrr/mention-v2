"""Install only the Mention classifier timer; never manage Kakao/APL processes."""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]
LABEL='ai.teamlulu.mention-classifier'
STATE=ROOT/'runtime/sentiment-classifier'

def main():
    parser=argparse.ArgumentParser();parser.add_argument('command',choices=('install','status','uninstall'));args=parser.parse_args()
    domain='gui/'+str(os.getuid());service=domain+'/'+LABEL
    path=Path.home()/'Library/LaunchAgents'/f'{LABEL}.plist'
    if args.command=='status':
        result=subprocess.run(['launchctl','print',service],capture_output=True,text=True)
        print(json.dumps({'label':LABEL,'loaded':result.returncode==0,'plist':str(path)}));return
    if args.command=='uninstall':
        subprocess.run(['launchctl','bootout',service],check=True);return
    config=json.loads((STATE/'config.json').read_text())
    if not config.get('thread_id'):raise RuntimeError('Configure the dedicated classifier session first')
    STATE.mkdir(mode=0o700,parents=True,exist_ok=True)
    for name in ('launchd.log','launchd-error.log'):
        p=STATE/name;p.touch(exist_ok=True);p.chmod(0o600)
    value={'Label':LABEL,'ProgramArguments':[sys.executable,str(ROOT/'tools/sentiment_classifier/cli.py'),'scan'],
           'WorkingDirectory':str(ROOT),'RunAtLoad':True,'StartInterval':60,'ProcessType':'Background',
           'StandardOutPath':str(STATE/'launchd.log'),'StandardErrorPath':str(STATE/'launchd-error.log'),
           'EnvironmentVariables':{'PATH':'/Users/we/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin'}}
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.exists() and plistlib.loads(path.read_bytes())!=value:raise RuntimeError('An existing classifier timer differs; inspect before changing it')
    if not path.exists():path.write_bytes(plistlib.dumps(value));path.chmod(0o600)
    result=subprocess.run(['launchctl','print',service],capture_output=True)
    if result.returncode:subprocess.run(['launchctl','bootstrap',domain,str(path)],check=True)
    print(json.dumps({'label':LABEL,'installed':True,'enabled':config.get('enabled',False)}))
if __name__=='__main__':main()

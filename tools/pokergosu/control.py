"""Durable, loopback-only browser commands; never opens a browser itself."""
import json
from pathlib import Path
import re
import sqlite3
import time
import uuid

ACTIONS=('start','resume','stop','reload','inspect-search')


class ControlStore:
    def __init__(self,directory):
        self.directory=Path(directory)
        self.db=sqlite3.connect(self.directory/'monitor.sqlite3',timeout=2)
        self.db.row_factory=sqlite3.Row
        self.db.executescript('''
          CREATE TABLE IF NOT EXISTS state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS control_owner(singleton INTEGER PRIMARY KEY,owner TEXT NOT NULL,expires_at REAL NOT NULL);
          CREATE TABLE IF NOT EXISTS control_commands(
            id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at REAL NOT NULL,
            status TEXT NOT NULL, owner TEXT, expires_at REAL, target_version TEXT,
            result TEXT, finished_at REAL);
          CREATE TABLE IF NOT EXISTS control_events(
            sequence INTEGER PRIMARY KEY, command_id TEXT, at REAL NOT NULL,
            kind TEXT NOT NULL, payload TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS control_heartbeat(
            owner TEXT PRIMARY KEY, at REAL NOT NULL, version TEXT NOT NULL,
            permission INTEGER NOT NULL, enabled INTEGER NOT NULL);
        ''')

    def event(self,command,kind,payload):
        self.db.execute('INSERT INTO control_events(command_id,at,kind,payload) VALUES (?,?,?,?)',
                        (command,time.time(),kind,json.dumps(payload,ensure_ascii=False)))

    def enqueue(self,action,target_version=None):
        if action not in ACTIONS:raise ValueError('INVALID_CONTROL_ACTION')
        if action=='inspect-search' and target_version is not None and not re.fullmatch(r'https://www\.pokergosu\.com/pokergosu/[\w-]+\.js',target_version):raise ValueError('INVALID_SEARCH_ASSET')
        if action=='reload' and (not isinstance(target_version,str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}',target_version)):
            raise ValueError('INVALID_TARGET_VERSION')
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            if action=='stop':
                rows=self.db.execute("SELECT id FROM control_commands WHERE status='queued' AND action IN ('start','resume','reload')").fetchall()
                for row in rows:
                    self.db.execute("UPDATE control_commands SET status='cancelled',finished_at=? WHERE id=?",(time.time(),row['id']))
                    self.event(row['id'],'cancelled',{'reason':'SUPERSEDED_BY_STOP'})
            existing=self.db.execute("SELECT * FROM control_commands WHERE action=? AND status IN ('queued','leased') ORDER BY created_at LIMIT 1",(action,)).fetchone()
            if existing:return dict(existing)
            identity=str(uuid.uuid4())
            self.db.execute("INSERT INTO control_commands(id,action,created_at,status,target_version) VALUES (?,?,?,'queued',?)",(identity,action,time.time(),target_version))
            self.event(identity,'queued',{'action':action,'target_version':target_version})
            return dict(self.db.execute('SELECT * FROM control_commands WHERE id=?',(identity,)).fetchone())

    def poll(self,owner,version,permission,enabled):
        if not re.fullmatch(r'[a-p]{32}:[a-f0-9-]{36}',owner) or not isinstance(version,str) or not re.fullmatch(r'[0-9]+(?:\.[0-9]+){1,3}',version) or type(permission) is not bool or type(enabled) is not bool:
            raise ValueError('INVALID_CONTROL_CLIENT')
        now=time.time()
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            self.db.execute('INSERT OR REPLACE INTO control_heartbeat VALUES (?,?,?,?,?)',(owner,now,version,int(permission),int(enabled)))
            for row in self.db.execute("SELECT id FROM control_commands WHERE status='leased' AND expires_at<?",(now,)).fetchall():
                self.db.execute("UPDATE control_commands SET status='unknown',finished_at=? WHERE id=?",(now,row['id']))
                self.event(row['id'],'unknown',{'reason':'LEASE_EXPIRED_NO_RETRY'})
            # Only one owning Chrome profile may control the single collector.
            active=self.db.execute('SELECT owner,expires_at FROM control_owner WHERE singleton=1').fetchone()
            if active and active['expires_at']>now and active['owner']!=owner:
                return {'command':None,'state':'ANOTHER_CLIENT_CONNECTED'}
            if enabled and permission:
                self.db.execute('INSERT OR REPLACE INTO control_owner VALUES (1,?,?)',(owner,now+90))
            leased=self.db.execute("SELECT id FROM control_commands WHERE status='leased' LIMIT 1").fetchone()
            if leased:return {'command':None,'state':'COMMAND_IN_FLIGHT'}
            row=self.db.execute("SELECT * FROM control_commands WHERE status='queued' ORDER BY CASE WHEN action='stop' THEN 0 ELSE 1 END,created_at LIMIT 1").fetchone()
            if not row:return {'command':None,'state':'IDLE'}
            if not enabled or (not permission and row['action'] in ('start','resume')):
                return {'command':None,'state':'WAITING_FOR_PERMISSION'}
            expires=now+120
            self.db.execute("UPDATE control_commands SET status='leased',owner=?,expires_at=? WHERE id=?",(owner,expires,row['id']))
            self.event(row['id'],'leased',{'owner':owner})
            return {'command':{'id':row['id'],'action':row['action'],'targetVersion':row['target_version'],'createdAt':row['created_at']*1000,'expiresAt':expires*1000},'state':'LEASED'}

    def ack(self,owner,identity,result):
        if not isinstance(result,dict) or type(result.get('ok')) is not bool or not isinstance(result.get('code'),str) or not re.fullmatch(r'[A-Z0-9_]{1,80}',result['code']):raise ValueError('INVALID_CONTROL_RESULT')
        clean={'ok':result['ok'],'code':result['code']}
        with self.db:
            self.db.execute('BEGIN IMMEDIATE')
            row=self.db.execute('SELECT * FROM control_commands WHERE id=?',(identity,)).fetchone()
            if not row or row['owner']!=owner:raise ValueError('CONTROL_OWNER_MISMATCH')
            if row['status'] in ('succeeded','failed'):
                if json.loads(row['result'])!=clean:raise ValueError('CONTROL_RECEIPT_CONFLICT')
                return {'acknowledged':True}
            if row['status'] not in ('leased','unknown'):raise ValueError('INVALID_CONTROL_STATE')
            status='succeeded' if clean['ok'] else 'failed'
            self.db.execute('UPDATE control_commands SET status=?,result=?,finished_at=? WHERE id=?',(status,json.dumps(clean),time.time(),identity))
            self.event(identity,'receipt',clean)
            return {'acknowledged':True}

    def status(self):
        now=time.time()
        return {'clients':[{**dict(row),'online':now-row['at']<90} for row in self.db.execute('SELECT * FROM control_heartbeat ORDER BY at DESC')],
                'commands':[dict(row) for row in self.db.execute('SELECT * FROM control_commands ORDER BY created_at DESC LIMIT 20')]}

    def close(self):self.db.close()

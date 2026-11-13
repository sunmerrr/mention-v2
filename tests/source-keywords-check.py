"""Synthetic source settings isolation; never opens real collector state."""
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokergosu'))
from adapters import KeywordSource
class SourceKeywords(unittest.TestCase):
    def test_forum_scope_uses_master_even_when_kakao_has_no_active_aliases(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'monitor').mkdir();(root/'state/monitor').mkdir(parents=True)
            (root/'monitor/rules.py').write_text('def matches(text,keys,*,numeric=False):\n return [k for k in keys if k in text]\n')
            db=sqlite3.connect(root/'state/monitor/monitor.sqlite3');db.execute('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)')
            policy={'version':1,'keywords':['APL','룰루'],'sources':{'kakao':{'disabled':['APL','룰루']},'pokergosu':{'disabled':['룰루']}}}
            db.executemany('INSERT INTO settings VALUES (?,?)',[('keywords','[]'),('keyword_policy',json.dumps(policy)),('exclude_keywords','must-not-be-read')]);db.commit()
            self.assertEqual(KeywordSource(root).read().keywords,('APL',))
            policy['sources']['pokergosu']['disabled']=['APL','룰루'];db.execute('UPDATE settings SET value=? WHERE key=?',(json.dumps(policy),'keyword_policy'));db.commit()
            self.assertEqual(KeywordSource(root).read().keywords,());db.close()
if __name__=='__main__':unittest.main()

"""Synthetic retained-header recovery; no network, browser or legacy source."""
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokergosu'))
from metadata import recover_metadata
from adapters import Repository
import collect


def sample():
    return {'id':'123','title':'synthetic','body':'body author 1999.01.01 00:00:00',
            'author':'','published_at':None,'eligible':False,
            'metadata_text':'synthetic 조회 수 30추천 수 02026.11.12 18:18:00합성작성자 https://www.pokergosu.com/free/1230BB0BB목록으로',
            'comments':[{'id':'44','text':'comment','author':'','published_at':None,'metadata_text':'합성댓글2026.11.12 18:19:09 답글달기'}]}

class MetadataTests(unittest.TestCase):
    def test_exact_visible_headers_recover_post_and_comment_fields(self):
        value=recover_metadata(sample())
        self.assertEqual(value['author'],'합성작성자');self.assertEqual(value['published_at'],'2026.11.12 18:18:00')
        self.assertEqual(value['comments'][0]['author'],'합성댓글');self.assertEqual(value['comments'][0]['published_at'],'2026.11.12 18:19:09')
        self.assertEqual(value['metadata_recovered_fields'],['author','published_at'])
    def test_existing_fields_and_retained_evidence_are_preserved(self):
        value=sample();value.update(author='기존 작성자',published_at='기존 시각');value['comments'][0]['author']='기존 댓글작성자'
        result=recover_metadata(value)
        self.assertEqual(result['author'],'기존 작성자');self.assertEqual(result['published_at'],'기존 시각');self.assertEqual(result['comments'][0]['author'],'기존 댓글작성자');self.assertEqual(result['metadata_text'],value['metadata_text'])
    def test_body_dates_and_foreign_post_links_are_not_evidence(self):
        value=sample();value['metadata_text']='';value['comments'][0]['metadata_text']=''
        self.assertFalse(recover_metadata(value)['author']);self.assertIsNone(recover_metadata(value)['published_at'])
        value=sample();value['metadata_text']=value['metadata_text']+' '+value['metadata_text'];self.assertFalse(recover_metadata(value)['author'])
        value=sample();value['id']='999';self.assertFalse(recover_metadata(value)['author'])
    def test_invalid_calendar_and_ambiguous_comment_text_are_not_guessed(self):
        value=sample();value['metadata_text']=value['metadata_text'].replace('11.12','02.31');value['comments'][0]['metadata_text']+=' extra body text'
        result=recover_metadata(value);self.assertIsNone(result['published_at']);self.assertFalse(result['comments'][0]['author'])
    def test_repair_is_idempotent_and_keeps_capture_time_and_old_revision(self):
        with tempfile.TemporaryDirectory() as temp:
            directory=Path(temp)/'runtime/pokergosu';repository=Repository(directory);value=sample()
            repository.discover([{'id':'123','url':'https://www.pokergosu.com/free/123'}],100)
            repository.save(value,200);repository.close()
            with patch.object(collect,'PROJECT',Path(temp)),patch.object(sys,'argv',['collect.py','metadata-repair']),contextlib.redirect_stdout(io.StringIO()) as out:
                self.assertEqual(collect.main(),0)
            self.assertEqual(json.loads(out.getvalue())['repaired_threads'],1)
            repository=Repository(directory)
            self.assertEqual(repository.db.execute("select checked_at from threads where id='123'").fetchone()[0],200)
            self.assertEqual(repository.db.execute("select count(*) from revisions").fetchone()[0],2)
            repository.close()
            with patch.object(collect,'PROJECT',Path(temp)),patch.object(sys,'argv',['collect.py','metadata-repair']),contextlib.redirect_stdout(io.StringIO()) as out:collect.main()
            self.assertEqual(json.loads(out.getvalue())['repaired_threads'],0)

if __name__=='__main__':unittest.main()

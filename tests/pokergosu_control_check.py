"""Synthetic command leases/receipts and manual-stop precedence, no Chrome/site IO."""
from pathlib import Path
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools/pokergosu'))
from control import ControlStore

OWNER='a'*32+':'+'12345678-1234-1234-1234-123456789abc'
OTHER='b'*32+':'+'12345678-1234-1234-1234-123456789def'

class ControlTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.store=ControlStore(self.temp.name)
    def tearDown(self):self.store.close();self.temp.cleanup()
    def poll(self,permission=True,owner=OWNER):return self.store.poll(owner,'0.4.0',permission,True)

    def test_permission_gates_start_and_duplicate_requests_coalesce(self):
        first=self.store.enqueue('start');self.assertEqual(self.store.enqueue('start')['id'],first['id'])
        self.assertEqual(self.poll(False)['state'],'WAITING_FOR_PERMISSION')
        leased=self.poll()['command'];self.assertEqual(leased['id'],first['id'])
        self.assertIsNotNone(leased['createdAt']);self.assertEqual(self.poll()['state'],'COMMAND_IN_FLIGHT')

    def test_only_owner_can_ack_and_receipts_are_idempotent(self):
        cmd=self.store.enqueue('start');self.poll()
        with self.assertRaisesRegex(ValueError,'CONTROL_OWNER_MISMATCH'):self.store.ack(OTHER,cmd['id'],{'ok':True,'code':'STARTED'})
        result={'ok':True,'code':'STARTED'};self.store.ack(OWNER,cmd['id'],result);self.store.ack(OWNER,cmd['id'],result)
        self.assertEqual(self.store.status()['commands'][0]['status'],'succeeded')
        with self.assertRaisesRegex(ValueError,'CONTROL_RECEIPT_CONFLICT'):self.store.ack(OWNER,cmd['id'],{'ok':False,'code':'FAILED'})

    def test_expired_lease_is_not_replayed_and_accepts_its_late_receipt(self):
        with patch('control.time.time',return_value=1000):
            command=self.store.enqueue('resume');self.poll()
        with patch('control.time.time',return_value=1121):
            self.assertIsNone(self.poll()['command'])
            self.assertEqual(self.store.status()['commands'][0]['status'],'unknown')
            self.store.ack(OWNER,command['id'],{'ok':False,'code':'INTERRUPTED_UNKNOWN_NO_RETRY'})
        self.assertEqual(self.store.status()['commands'][0]['status'],'failed')

    def test_stop_cancels_pending_starts_and_is_prioritized(self):
        first=self.store.enqueue('start');stop=self.store.enqueue('stop')
        self.assertEqual(self.poll(False)['command']['id'],stop['id'])
        row=self.store.db.execute('SELECT status FROM control_commands WHERE id=?',(first['id'],)).fetchone()
        self.assertEqual(row['status'],'cancelled')

    def test_second_profile_does_not_steal_the_active_client(self):
        self.poll();self.assertEqual(self.poll(owner=OTHER)['state'],'ANOTHER_CLIENT_CONNECTED')
        self.assertEqual(self.poll()['state'],'IDLE')

    def test_reload_target_and_action_validation(self):
        manifest=json.loads((Path(__file__).resolve().parents[1]/'tools/pokergosu/extension/manifest.json').read_text())
        self.assertEqual(manifest['optional_host_permissions'],['https://www.pokergosu.com/*'])
        self.assertEqual(manifest['host_permissions'],['http://127.0.0.1/*'])
        with self.assertRaisesRegex(ValueError,'INVALID_CONTROL_ACTION'):self.store.enqueue('eval')
        with self.assertRaisesRegex(ValueError,'INVALID_TARGET_VERSION'):self.store.enqueue('reload','https://evil.invalid')
        with self.assertRaisesRegex(ValueError,'INVALID_SEARCH_ASSET'):self.store.enqueue('inspect-search','https://www.pokergosu.com/api/private')
        command=self.store.enqueue('reload','0.4.1');self.assertEqual(self.poll()['command']['targetVersion'],'0.4.1')
        self.assertEqual(command['status'],'queued')

if __name__=='__main__':unittest.main()

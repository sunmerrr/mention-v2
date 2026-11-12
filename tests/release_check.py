"""Exercise promotion/rollback using only a temporary env and fake Docker/HTTP."""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('release', 'scripts/deploy-image.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
sha = 'a' * 40
previous = 'b' * 40
assert module.validate_image('mention-web:' + sha)
for image in ('mention-web:latest', 'mention-web:short', 'other:' + sha):
    try:
        module.validate_image(image)
        raise AssertionError(image)
    except ValueError:
        pass

class Health:
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def read(self): return json.dumps({'status': 'ok', 'build': sha}).encode()

for fail in (False, True):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        (root / 'apps/deploy').mkdir(parents=True)
        env = root / 'apps/deploy/.env'
        original = 'MENTION_IMAGE=mention-web:' + previous + '\nMENTION_ENABLE_WRITES=0\nPRIVATE_MARKER=preserved\n'
        env.write_text(original)
        calls = []
        def run(command, **kwargs):
            calls.append(command)
            if fail and '--wait' in command and sum('--wait' in call for call in calls) == 1:
                raise subprocess.CalledProcessError(1, command)
            return subprocess.CompletedProcess(command, 0)
        with patch.object(module, 'ROOT', root), patch.object(module.shutil, 'which', return_value='/fake/docker'), patch.object(module.subprocess, 'run', side_effect=run), patch.object(module.urllib.request, 'urlopen', return_value=Health()), patch.object(sys, 'argv', ['deploy-image.py', 'local', 'mention-web:' + sha]):
            try:
                module.main()
                assert not fail
            except subprocess.CalledProcessError:
                assert fail
        result = json.loads((root / 'runtime/image-deployments.jsonl').read_text())
        if fail:
            assert env.read_text() == original
            assert result['state'] == 'failed' and result['rollback'] == 'completed'
        else:
            assert 'PRIVATE_MARKER=preserved' in env.read_text()
            assert 'MENTION_IMAGE=mention-web:' + sha in env.read_text()
            assert result['state'] == 'healthy'
        assert all('build' not in call and 'login' not in call for call in calls)
print(json.dumps({'checks': 'immutable identity, successful promotion, failure rollback, private env preservation'}))

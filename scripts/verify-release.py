"""Check release definitions without reading credentials or starting services."""
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
dockerfile = (root / 'apps/deploy/Dockerfile').read_text()
assert 'USER node' in dockerfile and 'AS web' in dockerfile
assert 'CMD ["node", "--import", "tsx"' in dockerfile
assert dockerfile.index('COPY package.json pnpm-lock.yaml') < dockerfile.index('COPY apps ./apps')
assert 'pnpm install --prod --frozen-lockfile' in dockerfile
assert 'runtime' in (root / '.dockerignore').read_text().splitlines()
for name in ('local', 'production'):
    compose = root / f'apps/deploy/{name}.yml'
    text = compose.read_text()
    assert 'env_file: .env' in text and 'build:' not in text and 'container_name:' not in text
    assert '${MENTION_IMAGE:?' in text and 'stop_grace_period: 35s' in text
    # Config expansion must never consume the operator's real .env.
    if shutil.which('docker'):
        with tempfile.TemporaryDirectory() as directory:
            stage = Path(directory)
            (stage / compose.name).write_text(text)
            (stage / '.env').write_text('MENTION_IMAGE=mention-web:synthetic-check\n')
            subprocess.run(['docker', 'compose', '-f', str(stage / compose.name), 'config', '--quiet'], check=True)
print('Release definitions checked; ' + ('Compose config validated.' if shutil.which('docker') else 'Docker unavailable: image build and Compose runtime validation deferred to CI.'))

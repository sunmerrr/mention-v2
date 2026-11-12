"""Deploy a previously built image; never builds, logs in, or manages Kakao."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def validate_image(value):
    if not re.fullmatch(r'(?:[a-zA-Z0-9._:/-]+/)?mention-web:[a-f0-9]{40}', value):
        raise ValueError('Use an immutable mention-web:<40-character commit SHA> image')
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment', choices=['local', 'production'])
    parser.add_argument('image', type=validate_image)
    args = parser.parse_args()
    if not shutil.which('docker'):
        raise SystemExit('Docker is required; no service was changed')
    directory = ROOT / 'apps/deploy'
    env_path = directory / '.env'
    if not env_path.is_file():
        raise SystemExit('Prepare apps/deploy/.env and the source integration first')
    runtime = ROOT / 'runtime'
    runtime.mkdir(mode=0o700, exist_ok=True)
    with (runtime / f'deploy-{args.environment}.lock').open('a+') as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        command = ['docker', 'compose', '-f', str(directory / f'{args.environment}.yml')]
        original = env_path.read_text()
        if re.search(r'^MENTION_ENABLE_WRITES=1$', original, re.M):
            raise SystemExit('First container rollout must be read-only; approve source parity before enabling writes')
        subprocess.run(['docker', 'image', 'inspect', args.image], check=True, stdout=subprocess.DEVNULL)
        replacement = '\n'.join(line for line in original.splitlines() if not line.startswith('MENTION_IMAGE='))
        env_path.write_text(replacement + '\nMENTION_IMAGE=' + args.image + '\n')
        env_path.chmod(0o600)
        result = {'image': args.image, 'environment': args.environment, 'at': time.time(), 'state': 'started'}
        try:
            subprocess.run(command + ['config', '--quiet'], check=True)
            subprocess.run(command + ['up', '--detach', '--no-build', '--wait', '--wait-timeout', '45', 'web'], check=True)
            port = 8792 if args.environment == 'local' else 8790
            with urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=5) as response:
                health = json.load(response)
                if health.get('status') != 'ok' or health.get('build') != args.image.rsplit(':', 1)[1]:
                    raise RuntimeError('Health/build identity mismatch')
            result['state'] = 'healthy'
        except Exception:
            env_path.write_text(original)
            env_path.chmod(0o600)
            result['state'] = 'failed'
            # A previous immutable image uses the same tested command for rollback.
            if re.search(r'^MENTION_IMAGE=(?:[^\n]+/)?mention-web:[a-f0-9]{40}$', original, re.M):
                rollback = subprocess.run(command + ['up', '--detach', '--no-build', '--wait', '--wait-timeout', '45', 'web'])
                result['rollback'] = 'completed' if rollback.returncode == 0 else 'failed'
            raise
        finally:
            history = runtime / 'image-deployments.jsonl'
            with history.open('a') as file:
                os.chmod(history, 0o600)
                file.write(json.dumps(result) + '\n')
        print(json.dumps(result))


if __name__ == '__main__':
    main()

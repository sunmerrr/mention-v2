#!/usr/bin/env bash
# Isolated development-only Docker runtime; no global Docker context or host mounts.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LIMA_CACHE_HOME="$ROOT_DIR/.dev/infra/lima-cache"
export LIMA_HOME="$ROOT_DIR/.dev/infra/lima"
export DOCKER_CONFIG="$ROOT_DIR/.dev/infra/docker-client"
export DOCKER_HOST="unix://$LIMA_HOME/mention/sock/docker.sock"
export PATH="$ROOT_DIR/.dev/tools/bin:$ROOT_DIR/.dev/tools/lima/bin:$PATH"
case "${1:-status}" in
 start) limactl start --name=mention --vm-type=vz --cpus=2 --memory=3 --disk=24 --mount-none --tty=false template:docker ;;
 stop) limactl stop mention ;;
 status) limactl list mention ;;
 *) echo 'Usage: scripts/local-container.sh start|stop|status'; exit 2 ;;
esac

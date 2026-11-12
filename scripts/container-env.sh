# Source from project lifecycle/verification commands; no global Docker changes.
CONTAINER_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export LIMA_HOME="$CONTAINER_PROJECT_ROOT/.dev/infra/lima"
export LIMA_CACHE_HOME="$CONTAINER_PROJECT_ROOT/.dev/infra/lima-cache"
export DOCKER_CONFIG="$CONTAINER_PROJECT_ROOT/.dev/infra/docker-client"
export DOCKER_HOST="unix://$LIMA_HOME/mention/sock/docker.sock"
export PATH="$CONTAINER_PROJECT_ROOT/.dev/tools/bin:$CONTAINER_PROJECT_ROOT/.dev/tools/lima/bin:$PATH"

export TESTCONTAINERS_HOST_OVERRIDE=127.0.0.1
export TESTCONTAINERS_DOCKER_SOCKET_OVERRIDE="/run/user/$(id -u)/docker.sock"

export DOCKER_BUILDKIT=1

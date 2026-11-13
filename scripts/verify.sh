#!/usr/bin/env bash
#
# verify.sh — bootstrap 검증 체크리스트를 명령 하나로 고정 실행.
#
#   scripts/verify.sh            # lint → build → 유닛 → e2e
#   scripts/verify.sh --full     # 위 + docker build(전 target) + compose config + dist placeholder
#
# 하나라도 실패하면 즉시 중단(exit 1). 마지막에 통과 단계 요약 출력.
#   → devenv/local-run-and-debug.md §3
#
# ── boilerplate 원본. reference 는 DOCKER_TARGETS(admin 포함)만 확장하고 본문은 동일. ──
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# CONFIG (저장소별로 다른 유일한 영역)
# ─────────────────────────────────────────────────────────────
DOCKER_TARGETS="api"      # reference: "api web admin web-dist"
COMPOSE_FILE="apps/deploy/local.yml"
WEB_DIST_HTML="apps/web/dist/index.html"
RUNTIME_PLACEHOLDER="__APP_RUNTIME_CONFIG__"

# ─────────────────────────────────────────────────────────────
# 본문 — 두 저장소 공통
# ─────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
if [ -x "$ROOT_DIR/.dev/tools/bin/docker" ]; then source "$ROOT_DIR/scripts/container-env.sh"; fi

FULL=0
[ "${1:-}" = "--full" ] && FULL=1

SUMMARY=()
TOTAL_START=$SECONDS

step() {
  local label="$1" cmd="$2" start elapsed
  echo ""
  echo "━━━━ ▶ ${label}"
  start=$SECONDS
  if bash -c "$cmd"; then
    elapsed=$((SECONDS - start))
    SUMMARY+=("✓ ${label} (${elapsed}s)")
    echo "━━━━ ✓ ${label} (${elapsed}s)"
  else
    local rc=$?
    elapsed=$((SECONDS - start))
    echo ""
    echo "━━━━ ✗ 실패: ${label} (${elapsed}s, exit ${rc}) — 검증 중단"
    if [ ${#SUMMARY[@]} -gt 0 ]; then
      echo "여기까지 통과:"
      printf '  %s\n' "${SUMMARY[@]}"
    fi
    exit 1
  fi
}

echo "═══ pnpm verify$( [ "$FULL" = 1 ] && echo ':full' ) (${ROOT_DIR##*/}) ═══"

# 1) lint → 2) build → 3) 유닛 → 4) e2e (실컨테이너)
step "lint (biome)"          "pnpm lint"
step "build (turbo)"         "pnpm build"
step "unit tests"            "pnpm test"
step "reverse SSH arguments" "node scripts/reverse-ssh.test.mjs"
step "e2e tests"             "pnpm test:e2e"

if [ "$FULL" = 1 ]; then
  # docker 데몬이 없으면 조용히 스킵하지 않고 명확히 실패한다.
  step "docker 데몬 확인" \
    "docker info >/dev/null 2>&1 || { echo '✗ docker 데몬이 실행 중이 아님 — verify:full 은 docker 가 필요합니다 (Docker Desktop/daemon 기동 후 재시도).'; exit 1; }"

  # docker 이미지명은 소문자만 허용 — 디렉토리명 대소문자에 깨지지 않게 정규화.
  IMAGE_BASE="verify-$(basename "$ROOT_DIR" | tr '[:upper:]' '[:lower:]')"
  for t in $DOCKER_TARGETS; do
    step "docker build --target ${t}" \
      "docker build --target ${t} -t ${IMAGE_BASE}-${t}:local -f apps/deploy/Dockerfile ."
  done

  step "compose config 검증" \
    "docker compose -f '${COMPOSE_FILE}' config >/dev/null"

  step "server stack compose" "node scripts/check-server-compose.mjs"

  # 프론트 산출물엔 런타임 placeholder 가 남아 있어야 한다(치환은 배포/실행 시점).
  step "web dist placeholder(${RUNTIME_PLACEHOLDER})" \
    "test -f '${WEB_DIST_HTML}' || { echo '✗ ${WEB_DIST_HTML} 없음 — build 가 web dist 를 생성하지 않음'; exit 1; }; grep -q '${RUNTIME_PLACEHOLDER}' '${WEB_DIST_HTML}' || { echo '✗ placeholder 사라짐 — 빌드가 값을 박아넣었을 수 있음'; exit 1; }"
fi

echo ""
echo "═══ ✓ 검증 통과 ($(( SECONDS - TOTAL_START ))s) ═══"
printf '  %s\n' "${SUMMARY[@]}"

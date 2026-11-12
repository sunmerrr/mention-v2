#!/usr/bin/env bash
#
# dev.sh — 로컬 프로세스 lifecycle 관리 (PID 파일 기반)
#
#   scripts/dev.sh <start|stop|restart|status|logs> [target] [--debug]
#   scripts/dev.sh <infra-up|infra-down>            # compose 인프라가 있는 프로젝트만
#
# 원칙: AI 에이전트는 이 스크립트 밖에서 로컬 프로세스를 띄우지 않는다.
#       → project-template/devenv/local-run-and-debug.md
#
# ── 이 스크립트는 boilerplate 원본이다. reference 는 target/포트/infra 설정 블록만
#    확장하고 아래 본문 로직은 동일하게 유지한다. ──
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# CONFIG (저장소별로 다른 유일한 영역 — target 목록 / 포트 / infra)
# ─────────────────────────────────────────────────────────────
TARGETS_ALL="api web"

# target → 리슨 포트 (status 의 포트 체크에 사용)
port_for() {
  local p=""
  case "$1" in
    api)
      # 포트 단일 출처: .env 의 PORT (없으면 기본 4200) — 앱과 status 체크가 같은 값을 보게.
      [ -f "$ROOT_DIR/.env" ] && p="$(sed -n 's/^PORT=//p' "$ROOT_DIR/.env" | tail -n1 | tr -d '"' | tr -d "'")"
      echo "${p:-4200}"
      ;;
    web) echo 5173 ;;
    *)   echo "" ;;
  esac
}

# target → 기동 커맨드. $DEBUG=1 이면 api 는 --inspect 활성화.
start_cmd_for() {
  case "$1" in
    api)
      if [ "${DEBUG:-0}" = "1" ]; then
        # nest start(--debug) → node --inspect. 로컬/--debug 일 때만. 프로덕션 설정엔 절대 없음.
        echo "pnpm --filter @app/api exec nest start --watch --builder swc --debug 0.0.0.0:9229"
      else
        echo "pnpm --filter @app/api run dev"
      fi
      ;;
    web) echo "pnpm --filter @app/web exec vite --port 5173 --strictPort" ;;
    *)   echo "" ;;
  esac
}

# compose 인프라 파일 (없으면 infra-up/down 및 api 의 infra 사전점검 비활성).
INFRA_COMPOSE=""
INFRA_SERVICES="postgres valkey minio minio-init"
INFRA_HEALTH_PORT=5432   # infra 기동 여부 판단용(postgres)

# ─────────────────────────────────────────────────────────────
# 이하 본문 — 두 저장소 공통 (수정 시 양쪽 동기화)
# ─────────────────────────────────────────────────────────────
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
# api 는 apps/api cwd 로 뜨지만 .env 는 저장소 루트에 있다 → dotenv 가 루트 .env 를 읽도록 경로 고정.
[ -f "$ROOT_DIR/.env" ] && export DOTENV_CONFIG_PATH="$ROOT_DIR/.env"
PID_DIR="$ROOT_DIR/.dev/pids"
LOG_DIR="$ROOT_DIR/.dev/logs"
mkdir -p "$PID_DIR" "$LOG_DIR" "$ROOT_DIR/.dev/tmp"

DEBUG=0
FOLLOW=0

pidfile()  { echo "$PID_DIR/$1.pid"; }
logfile()  { echo "$LOG_DIR/$1.log"; }

is_alive() { [ -n "${1:-}" ] && kill -0 "$1" 2>/dev/null; }

# 스테일 PID(파일 있는데 프로세스 없음) 감지·정리. 반환: 살아있는 pid 를 stdout 으로.
resolve_pid() {
  local t="$1" pf pid
  pf="$(pidfile "$t")"
  [ -f "$pf" ] || return 1
  pid="$(cat "$pf" 2>/dev/null || true)"
  if is_alive "$pid"; then
    echo "$pid"; return 0
  fi
  # 스테일 → 정리
  rm -f "$pf"
  return 1
}

port_listening() {
  local port="$1"
  [ -n "$port" ] || return 1
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}

health_ok() {
  local port="$1"
  curl -fsS -m 2 "http://127.0.0.1:${port}/health" >/dev/null 2>&1
}

# 백그라운드로 새 프로세스 그룹의 리더로 기동 → 그룹 통째 kill 가능(고아 방지).
# setsid(리눅스) 없으면 perl setpgrp(macOS)로 대체.
launch_bg() {
  local cmd="$1" log="$2"
  if command -v setsid >/dev/null 2>&1; then
    setsid bash -c "$cmd" >>"$log" 2>&1 &
  else
    perl -e 'setpgrp(0,0); exec @ARGV' /bin/bash -c "$cmd" >>"$log" 2>&1 &
  fi
  echo $!
}

rotate_log() {
  local log="$1"
  [ -f "$log" ] && mv -f "$log" "${log}.old" || true
}

infra_enabled() { [ -n "$INFRA_COMPOSE" ] && [ -f "$ROOT_DIR/$INFRA_COMPOSE" ]; }
infra_up_running() { port_listening "$INFRA_HEALTH_PORT"; }

expand_targets() {
  local t="${1:-all}"
  if [ "$t" = "all" ]; then echo "$TARGETS_ALL"; else echo "$t"; fi
}

valid_target() {
  local t="$1" x
  [ "$t" = "all" ] && return 0
  for x in $TARGETS_ALL; do [ "$x" = "$t" ] && return 0; done
  return 1
}

# ── 커맨드 구현 ──
start_one() {
  local t="$1" pf log cmd pid
  pf="$(pidfile "$t")"; log="$(logfile "$t")"

  if pid="$(resolve_pid "$t")"; then
    echo "▶ $t: 이미 실행 중 (pid $pid) — no-op. 상태는 'status', 재기동은 'restart'."
    return 0
  fi

  # api 는 DB/Valkey 필요 — infra 미기동이면 안내(중단은 아님).
  if [ "$t" = "api" ] && infra_enabled && ! infra_up_running; then
    echo "⚠ $t: 인프라(postgres:${INFRA_HEALTH_PORT})가 안 떠 있음. 먼저 'scripts/dev.sh infra-up' 권장."
  fi

  cmd="$(start_cmd_for "$t")"
  if [ -z "$cmd" ]; then echo "✗ $t: 기동 커맨드 미정의"; return 1; fi

  rotate_log "$log"
  {
    echo "===== dev.sh start $t $( [ "${DEBUG:-0}" = 1 ] && echo '(--debug)' ) ====="
    echo "cmd: $cmd"
  } >>"$log"

  pid="$(launch_bg "$cmd" "$log")"
  echo "$pid" >"$pf"
  local dbg=""; [ "${DEBUG:-0}" = "1" ] && [ "$t" = "api" ] && dbg=" [inspect :9229]"
  echo "▶ $t: 기동 (pid $pid)$dbg — 로그: ${log#$ROOT_DIR/}"
}

stop_one() {
  local t="$1" pf pid i
  pf="$(pidfile "$t")"
  if [ ! -f "$pf" ]; then echo "■ $t: 실행 중 아님."; return 0; fi
  pid="$(cat "$pf" 2>/dev/null || true)"
  if ! is_alive "$pid"; then
    rm -f "$pf"; echo "■ $t: 스테일 PID 파일 정리 (프로세스 없음)."; return 0
  fi
  # 프로세스 그룹 전체에 SIGTERM (그룹 kill 실패 시 단일 pid).
  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
  for i in 1 2 3 4 5; do
    is_alive "$pid" || break
    sleep 1
  done
  if is_alive "$pid"; then
    kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    sleep 1
    echo "■ $t: SIGKILL 로 강제 종료 (pid $pid)."
  else
    echo "■ $t: 종료 (pid $pid)."
  fi
  rm -f "$pf"
}

status_one() {
  local t="$1" pid port pstate lstate hstate pf
  pf="$(pidfile "$t")"; port="$(port_for "$t")"
  if [ -f "$pf" ]; then
    pid="$(cat "$pf" 2>/dev/null || true)"
    if is_alive "$pid"; then
      pstate="pid $pid ●"
    else
      rm -f "$pf"; pstate="스테일 정리됨 ○"   # 파일 있는데 프로세스 없음 → 감지·정리
    fi
  else
    pstate="정지 ○"
  fi
  if port_listening "$port"; then lstate="listen :$port ●"; else lstate="port :$port ○"; fi
  printf "  %-6s %-18s %-16s" "$t" "$pstate" "$lstate"
  if [ "$t" = "api" ]; then
    if health_ok "$port"; then hstate="/health 200 ●"; else hstate="/health ✗"; fi
    printf " %-16s" "$hstate"
  fi
  printf "\n"
}

cmd_start()   { local t; for t in $(expand_targets "${1:-all}"); do start_one "$t"; done; }
cmd_stop()    { local t; for t in $(expand_targets "${1:-all}"); do stop_one  "$t"; done; }
cmd_status()  {
  echo "── dev status (${ROOT_DIR##*/}) ──"
  local t; for t in $(expand_targets "${1:-all}"); do status_one "$t"; done
  if infra_enabled; then
    if infra_up_running; then echo "  infra  postgres:${INFRA_HEALTH_PORT} ● (docker compose)"; else echo "  infra  ○ (infra-up 필요)"; fi
  fi
}
cmd_restart() { cmd_stop "${1:-all}"; cmd_start "${1:-all}"; }

cmd_logs() {
  local t="${1:-all}" files="" f
  for t in $(expand_targets "$t"); do f="$(logfile "$t")"; [ -f "$f" ] && files="$files $f"; done
  [ -n "$files" ] || { echo "로그 파일 없음 (.dev/logs) — 아직 start 한 적이 없음."; return 0; }
  # 기본은 스냅샷 — AI 에이전트가 follow 로 블록되지 않게. follow 는 -f 옵트인(사람용).
  # shellcheck disable=SC2086
  if [ "${FOLLOW:-0}" = "1" ]; then
    tail -n 40 -f $files
  else
    tail -n 100 $files
  fi
}

cmd_infra_up() {
  infra_enabled || { echo "이 저장소엔 compose 인프라가 없음 (INFRA_COMPOSE 미설정)."; return 1; }
  echo "▶ infra up: $INFRA_SERVICES"
  docker compose -f "$ROOT_DIR/$INFRA_COMPOSE" up -d $INFRA_SERVICES
}
cmd_infra_down() {
  infra_enabled || { echo "이 저장소엔 compose 인프라가 없음 (INFRA_COMPOSE 미설정)."; return 1; }
  echo "■ infra down (볼륨 보존)"
  docker compose -f "$ROOT_DIR/$INFRA_COMPOSE" down
}

# ── 인자 파싱 ──
ACTION="${1:-}"; shift || true
TARGET="all"
for a in "$@"; do
  case "$a" in
    --debug) DEBUG=1 ;;
    -f|--follow) FOLLOW=1 ;;
    api|web|admin|all) TARGET="$a" ;;
    *) echo "알 수 없는 인자: $a" >&2; exit 2 ;;
  esac
done

if [ "$ACTION" != "infra-up" ] && [ "$ACTION" != "infra-down" ]; then
  valid_target "$TARGET" || { echo "알 수 없는 target: $TARGET (가능: $TARGETS_ALL all)" >&2; exit 2; }
fi

case "$ACTION" in
  start)      cmd_start   "$TARGET" ;;
  stop)       cmd_stop    "$TARGET" ;;
  restart)    cmd_restart "$TARGET" ;;
  status)     cmd_status  "$TARGET" ;;
  logs)       cmd_logs    "$TARGET" ;;
  infra-up)   cmd_infra_up ;;
  infra-down) cmd_infra_down ;;
  *)
    cat >&2 <<EOF
사용법: scripts/dev.sh <start|stop|restart|status|logs> [$TARGETS_ALL|all] [--debug] [logs: -f]
        scripts/dev.sh <infra-up|infra-down>
EOF
    exit 2
    ;;
esac

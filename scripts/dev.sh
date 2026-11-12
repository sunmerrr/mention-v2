#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p runtime
pid_file=runtime/web.pid
running() { [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null && ps -p "$(cat "$pid_file")" -o command= | grep -Fq "$PWD/apps/read-api/src/server.ts"; }
case "${1:-status}" in
 test) exec node --import tsx tests/browser-server.ts;;
 start)
  if running; then echo "Mention already running: $(cat "$pid_file")"; exit 0; fi
  if curl -fsS "http://127.0.0.1:${MENTION_PORT:-8790}/health" >/dev/null 2>&1; then echo "Port already in use; inspect the existing service"; exit 1; fi
  server_pid=$(node scripts/launch.mjs)
  echo "$server_pid" >"$pid_file"
  chmod 600 "$pid_file" runtime/web.log
  for ((attempt=0;attempt<100;attempt++)); do
   if curl -fsS "http://127.0.0.1:${MENTION_PORT:-8790}/health" >/dev/null 2>&1; then echo "Mention: http://127.0.0.1:${MENTION_PORT:-8790}"; exit 0; fi
   if ! kill -0 "$server_pid" 2>/dev/null; then echo "Startup failed; inspect runtime/web.log"; exit 1; fi
   sleep 0.1
  done
  echo 'Still starting; do not launch another instance'; exit 1;;
 stop)
  if running; then
   server_pid=$(cat "$pid_file")
   kill -TERM "$server_pid"
   for ((attempt=0;attempt<300;attempt++)); do
    if ! running || [[ "$(ps -p "$server_pid" -o stat=)" == *Z* ]]; then rm -f "$pid_file"; exit 0; fi
    sleep 0.1
   done
   echo 'Web shutdown has not completed; keeping PID and refusing replacement'; exit 1
  fi
  rm -f "$pid_file";;
 restart) "$0" stop; for ((attempt=0;attempt<50;attempt++)); do if ! curl -fsS "http://127.0.0.1:${MENTION_PORT:-8790}/health" >/dev/null 2>&1; then break; fi; sleep 0.1; done; "$0" start;;
 status) if running; then curl -fsS "http://127.0.0.1:${MENTION_PORT:-8790}/health"; else echo 'Mention not running'; fi;;
 *) echo 'Usage: scripts/dev.sh start|stop|restart|status'; exit 2;;
esac

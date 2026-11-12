#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec "${MENTION_PYTHON:-python3}" tools/pokergosu/collect.py "$@"

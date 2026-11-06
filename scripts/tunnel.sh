#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p runtime
node scripts/tunnel.mjs "${1:-status}"

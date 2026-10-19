#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v python3 >/dev/null 2>&1; then
  echo "[ELECTRA] Python 3 was not found. Use any static HTTP server in this folder." >&2
  exit 1
fi

echo "[ELECTRA] Starting local server at http://127.0.0.1:5188"
echo "[ELECTRA] Press Ctrl+C to stop."
exec python3 -m http.server 5188 --bind 127.0.0.1

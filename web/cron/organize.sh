#!/usr/bin/env bash
set -euo pipefail

# Cron strips env; entrypoint snapshots non-secret env into this file.
if [ -f /etc/haera.env ]; then
  # shellcheck disable=SC1091
  source /etc/haera.env
fi

API="${HAERA_API:-http://localhost:3000}"
NOW="$(date '+%Y-%m-%d %H:%M:%S %Z')"

echo "===== $NOW : organize tick ====="

# Auth: prefer env var (set via .env), fall back to token file written by web UI.
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ] && [ -f /data/claude_token ]; then
  export CLAUDE_CODE_OAUTH_TOKEN="$(cat /data/claude_token)"
fi
if [ -z "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
  echo "no auth token; log in via the web UI. skip."
  exit 0
fi

PENDING_COUNT="$(curl -fsS "${API}/api/raw?status=pending" | grep -c '"_id"' || true)"
if [ "$PENDING_COUNT" = "0" ]; then
  echo "no pending items, skip."
  exit 0
fi
echo "pending: $PENDING_COUNT items, invoking claude..."

PROMPT="$(sed \
  -e "s|{{API}}|${API}|g" \
  -e "s|{{NOW}}|${NOW}|g" \
  /opt/haera/prompt.md)"

printf '%s' "$PROMPT" | claude --print --allowedTools "Bash"

echo "===== done ====="

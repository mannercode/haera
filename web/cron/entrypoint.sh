#!/usr/bin/env bash
set -euo pipefail

mkdir -p /data /root/.claude

# Claude Code expects this file. It's outside the volume, so reset on restart.
if [ ! -f /root/.claude.json ]; then
  BACKUP="$(ls -t /root/.claude/backups/.claude.json.backup.* 2>/dev/null | head -1 || true)"
  if [ -n "$BACKUP" ]; then
    cp "$BACKUP" /root/.claude.json
  else
    echo '{}' > /root/.claude.json
  fi
fi

# Cron strips env vars. Snapshot what the cron script needs into a sourced file.
{
  echo "HAERA_API=http://localhost:3000"
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    echo "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}"
  fi
} > /etc/haera.env
chmod 0600 /etc/haera.env

cron

echo "haera up. web :3000, cron tick every 5 min."
echo "if not authed, open the web UI and click '로그인 시작'."
exec node server.js

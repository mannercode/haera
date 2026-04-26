#!/usr/bin/env bash
set -euo pipefail

# Single bind-mount root: /var/haera (mapped to ./var on host).
# All persistent state lives here so the host owns it (Docker can be removed
# without losing data).
mkdir -p /var/haera/auth /var/haera/auth/claude /var/haera/uploads

# Claude Code expects ~/.claude (config dir) and ~/.claude.json (settings).
# Point them at our persistent location via symlinks.
if [ ! -f /var/haera/auth/claude.json ]; then
  BACKUP="$(ls -t /var/haera/auth/claude/backups/.claude.json.backup.* 2>/dev/null | head -1 || true)"
  if [ -n "$BACKUP" ]; then
    cp "$BACKUP" /var/haera/auth/claude.json
  else
    echo '{}' > /var/haera/auth/claude.json
  fi
fi

# Replace any non-symlink copies with symlinks pointing to bind-mounted state.
[ -e /root/.claude ] && [ ! -L /root/.claude ] && rm -rf /root/.claude
[ -e /root/.claude.json ] && [ ! -L /root/.claude.json ] && rm -f /root/.claude.json
ln -sfn /var/haera/auth/claude /root/.claude
ln -sfn /var/haera/auth/claude.json /root/.claude.json

# Cron strips env vars. Snapshot what the cron script needs into a sourced file.
{
  echo "HAERA_API=http://localhost:3000"
  if [ -n "${CLAUDE_CODE_OAUTH_TOKEN:-}" ]; then
    echo "CLAUDE_CODE_OAUTH_TOKEN=${CLAUDE_CODE_OAUTH_TOKEN}"
  fi
} > /etc/haera.env
chmod 0600 /etc/haera.env

cron

echo "haera up. web :3000, cron tick every minute."
echo "if not authed, open the web UI and click '로그인 시작'."
exec node server.js

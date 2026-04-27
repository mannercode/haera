#!/usr/bin/env bash
# One-time EC2 bootstrap for haera deployment.
# Tested on Amazon Linux 2023 (ARM64, t4g.medium).
#
# Prereqs:
#   - EC2 has IAM role with AmazonEC2ContainerRegistryReadOnly
#   - Security group: 22 (your IP), 80, 443 open; 9000/9001 closed
#   - DNS: team.tixpass.co.kr A → EC2 public IP
#
# Usage on a fresh EC2:
#   curl -O https://raw.githubusercontent.com/mannercode/haera/main/scripts/ec2-bootstrap.sh
#   chmod +x ec2-bootstrap.sh
#   sudo ./ec2-bootstrap.sh
#
# After this, follow docs/deploy.md for the .env + first deploy.

set -euo pipefail

if [ "$EUID" -ne 0 ]; then
  echo "Run as root (sudo)." >&2
  exit 1
fi

REGION="${AWS_REGION:-ap-northeast-2}"
APP_DIR="/opt/haera"
APP_USER="haera"

echo "==> Updating packages"
dnf -y update

echo "==> Installing docker, git, amazon-ecr-credential-helper"
dnf -y install docker git amazon-ecr-credential-helper

systemctl enable --now docker

echo "==> Installing docker compose v2 plugin"
mkdir -p /usr/libexec/docker/cli-plugins
COMPOSE_VER="v2.30.3"
ARCH="$(uname -m)"
case "$ARCH" in
  aarch64) COMPOSE_BIN="docker-compose-linux-aarch64" ;;
  x86_64)  COMPOSE_BIN="docker-compose-linux-x86_64" ;;
  *) echo "unsupported arch $ARCH"; exit 1 ;;
esac
curl -fSL "https://github.com/docker/compose/releases/download/${COMPOSE_VER}/${COMPOSE_BIN}" \
  -o /usr/libexec/docker/cli-plugins/docker-compose
chmod +x /usr/libexec/docker/cli-plugins/docker-compose

echo "==> Creating app user $APP_USER"
id -u "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"

echo "==> Configuring ECR credential helper for $APP_USER"
sudo -u "$APP_USER" mkdir -p "/home/$APP_USER/.docker"
cat > "/home/$APP_USER/.docker/config.json" <<EOF
{ "credsStore": "ecr-login" }
EOF
chown -R "$APP_USER:$APP_USER" "/home/$APP_USER/.docker"

echo "==> Cloning repo to $APP_DIR"
mkdir -p "$APP_DIR"
chown "$APP_USER:$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" git clone https://github.com/mannercode/haera.git "$APP_DIR" || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

echo
echo "==> Done. Next steps (as $APP_USER):"
echo "    sudo -iu $APP_USER"
echo "    cd $APP_DIR"
echo "    cp .env.prod.example .env && chmod 600 .env"
echo "    # edit .env with real values (MongoDB, ECR image, secrets)"
echo "    docker compose -f docker-compose.prod.yml pull"
echo "    docker compose -f docker-compose.prod.yml up -d"
echo
echo "Open https://team.tixpass.co.kr — Caddy will auto-issue Let's Encrypt cert on first request."

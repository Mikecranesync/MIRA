#!/usr/bin/env bash
# Bootstrap the FactoryLM staging deploy identity on a host — normally the
# production VPS itself (co-hosted staging, owner decision 2026-09-21, #3930).
#
# Run ONCE as root:
#   sudo bash bootstrap-staging-host.sh "<staging-deploy ssh public key line>"
#
# What it does (and nothing else):
#   1. installs Docker Engine + compose plugin and the Doppler CLI
#   2. creates the non-root `staging-deploy` account (docker group, NO sudo)
#   3. installs the given public key for it (sshd is NOT changed unless
#      --harden-sshd is passed: on the production host that is a prod change)
#   4. creates /opt/mira-staging owned by staging-deploy (never /opt/mira)
# It never installs a Doppler token: the deploy user configures a
# `factorylm/stg` SERVICE token afterwards, scoped to /opt/mira-staging
# (see docs/runbooks/staging-vps.md). No production secret is ever placed here.
set -euo pipefail

DEPLOY_USER="staging-deploy"
STG_DIR="/opt/mira-staging"
PUBKEY="${1:-}"
HARDEN_SSHD="${2:-}"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[[ "$PUBKEY" =~ ^ssh-ed25519\ AAAA[0-9A-Za-z+/]+=*( .*)?$ ]] || {
  echo "usage: $0 '<ssh-ed25519 public key line for ${DEPLOY_USER}>'" >&2; exit 1; }
# Co-hosted: production may live on this host. The only path rule is that the
# staging checkout never equals or enters /opt/mira.
case "$(readlink -f "$STG_DIR")" in /opt/mira|/opt/mira/*) echo "STG_DIR must not be /opt/mira or inside it. STOP." >&2; exit 1;; esac

echo "=== packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git python3
# Docker: install ONLY if absent. On a host that already runs production, an
# apt install/upgrade of docker-ce restarts dockerd and, without live-restore,
# every container with it (incident 2026-09-21T10:26Z, #3930). Never "refresh".
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  echo "docker present ($(docker --version)); leaving the engine untouched"
else
  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.asc ]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    # shellcheck source=/dev/null
    . /etc/os-release
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -q
  fi
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi
if ! command -v doppler >/dev/null; then
  curl -sLf --retry 3 https://packages.doppler.com/public/cli/gpg.DE2A7741A397C129.key \
    | gpg --dearmor -o /usr/share/keyrings/doppler-archive-keyring.gpg
  echo "deb [signed-by=/usr/share/keyrings/doppler-archive-keyring.gpg] https://packages.doppler.com/public/cli/deb/debian any-version main" \
    > /etc/apt/sources.list.d/doppler-cli.list
  apt-get update -q && apt-get install -y -q doppler
fi

echo "=== ${DEPLOY_USER} (non-root, docker group, no sudo) ==="
id "$DEPLOY_USER" >/dev/null 2>&1 || useradd --create-home --shell /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
gpasswd -d "$DEPLOY_USER" sudo 2>/dev/null || true
rm -f "/etc/sudoers.d/${DEPLOY_USER}"
HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
printf '%s\n' "$PUBKEY" > "$HOME_DIR/.ssh/authorized_keys"
chown "$DEPLOY_USER:$DEPLOY_USER" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"
install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$STG_DIR"

if [ "$HARDEN_SSHD" = "--harden-sshd" ]; then
  echo "=== sshd: keys only (explicitly requested) ==="
  cat > /etc/ssh/sshd_config.d/90-factorylm-staging.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
  sshd -t && systemctl reload ssh
else
  echo "=== sshd: unchanged (pass --harden-sshd to enforce keys-only) ==="
fi

echo "=== evidence ==="
id "$DEPLOY_USER"
sudo -l -U "$DEPLOY_USER" 2>/dev/null | tail -1 || true
docker --version; doppler --version
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
echo "host key line for the STAGING_HOST_KEY repository variable:"
awk '{print $1" "$2}' /etc/ssh/ssh_host_ed25519_key.pub
echo "bootstrap complete — next: as ${DEPLOY_USER}, configure the factorylm/stg service token scoped to ${STG_DIR}"

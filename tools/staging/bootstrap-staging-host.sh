#!/usr/bin/env bash
# Bootstrap a SEPARATE FactoryLM staging host (#3909, PRD §5/SC3).
#
# Run ONCE as root on a fresh Ubuntu 24.04 VPS that is NOT the production host:
#   sudo bash bootstrap-staging-host.sh "<staging-deploy ssh public key line>"
#
# What it does (and nothing else):
#   1. installs Docker Engine + compose plugin and the Doppler CLI
#   2. creates the non-root `staging-deploy` account (docker group, NO sudo)
#   3. installs the given public key for it and hardens sshd to keys-only
#   4. creates /opt/mira-staging owned by staging-deploy (never /opt/mira)
# It never installs a Doppler token: the deploy user configures a
# `factorylm/stg` SERVICE token afterwards, scoped to /opt/mira-staging
# (see docs/runbooks/staging-vps.md). No production secret is ever placed here.
set -euo pipefail

DEPLOY_USER="staging-deploy"
STG_DIR="/opt/mira-staging"
PUBKEY="${1:-}"

[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 1; }
[[ "$PUBKEY" =~ ^ssh-ed25519\ AAAA[0-9A-Za-z+/]+=*( .*)?$ ]] || {
  echo "usage: $0 '<ssh-ed25519 public key line for ${DEPLOY_USER}>'" >&2; exit 1; }
[ ! -e /opt/mira ] || { echo "/opt/mira exists — this looks like the production host. STOP." >&2; exit 1; }
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qE '^mira-'; then
  echo "production-named containers present — this looks like the production host. STOP." >&2; exit 1
fi

echo "=== packages ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg git python3
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

echo "=== sshd: keys only ==="
cat > /etc/ssh/sshd_config.d/90-factorylm-staging.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
SSHD
sshd -t && systemctl reload ssh

echo "=== evidence ==="
id "$DEPLOY_USER"
sudo -l -U "$DEPLOY_USER" 2>/dev/null | tail -1 || true
docker --version; doppler --version
ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
echo "host key line for the STAGING_HOST_KEY repository variable:"
awk '{print $1" "$2}' /etc/ssh/ssh_host_ed25519_key.pub
echo "bootstrap complete — next: as ${DEPLOY_USER}, configure the factorylm/stg service token scoped to ${STG_DIR}"

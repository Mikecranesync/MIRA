#!/usr/bin/env bash
# Idempotent host bootstrap for the #3800 recovery VPS (Ubuntu 22.04/24.04).
#
# Run as root on a NEW, EMPTY server only. It refuses to continue if it finds
# an existing /opt/mira checkout or running containers it did not create, so
# it can never be pointed at a box that already holds workloads.
#
#   curl -fsSL https://raw.githubusercontent.com/Mikecranesync/MIRA/<sha>/tools/recovery/bootstrap-host.sh \
#     | bash -s -- --sha <sha> --admin-key "$(cat ~/.ssh/id_ed25519.pub)"
#
# What it does (each step is a no-op when already done):
#   1. apt: docker-ce + compose plugin, ufw, fail2ban, unattended-upgrades
#   2. swap: 2 GiB swapfile (small VPS insurance for `next build` / peaks)
#   3. ufw: default deny in, allow 22/80/443 ONLY. Nothing else is published —
#      compose binds the Hub to 127.0.0.1 and nginx fronts it.
#   4. sshd: keys-only, but ONLY after the admin key is confirmed present in
#      root's authorized_keys (so it cannot lock you out).
#   5. /opt/mira: clone MIRA at the exact SHA (no branch names — reproducible)
#   6. /opt/mira/data dirs owned per scripts/host_perm_setup.sh
#   7. Doppler CLI (runtime secret injection via a SCOPED service token that is
#      supplied later as DOPPLER_TOKEN — never a personal token, never a file)
#
# It does NOT: touch DNS, request certificates, start the app, write secrets,
# or install Tailscale (an auth key is a secret; see the runbook step).
set -euo pipefail

SHA=""
ADMIN_KEY=""
REPO_URL="https://github.com/Mikecranesync/MIRA.git"
while [ $# -gt 0 ]; do
  case "$1" in
    --sha) SHA="$2"; shift 2 ;;
    --admin-key) ADMIN_KEY="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
[ -n "$SHA" ] || { echo "--sha <40-hex commit> is required" >&2; exit 2; }
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || { echo "--sha must be a full 40-char SHA" >&2; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "run as root" >&2; exit 2; }

log() { printf '\n[bootstrap] %s\n' "$*"; }

# ── 0. Refuse to touch a box that already has workloads ──────────────────────
if [ -d /opt/mira/.git ]; then
  echo "REFUSING: /opt/mira already exists — this is not a new server. Stop." >&2
  exit 3
fi
if command -v docker >/dev/null 2>&1 && [ "$(docker ps -q 2>/dev/null | wc -l)" -gt 0 ]; then
  echo "REFUSING: containers are already running on this host. Stop." >&2
  exit 3
fi
if [ -d /var/www ] && [ "$(find /var/www -mindepth 1 -maxdepth 2 2>/dev/null | wc -l)" -gt 0 ]; then
  echo "REFUSING: /var/www is not empty — existing web workload. Stop." >&2
  exit 3
fi

# ── 1. Packages ──────────────────────────────────────────────────────────────
log "apt packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg git ufw fail2ban unattended-upgrades nginx >/dev/null
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
docker compose version

# ── 2. Swap ──────────────────────────────────────────────────────────────────
if ! swapon --show | grep -q '/swapfile'; then
  log "2 GiB swapfile"
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ── 3. Firewall: 22/80/443 only ──────────────────────────────────────────────
log "ufw"
ufw --force default deny incoming >/dev/null
ufw --force default allow outgoing >/dev/null
ufw allow 22/tcp >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
systemctl enable --now fail2ban >/dev/null

# ── 4. SSH hardening — only once the admin key is provably installed ─────────
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys
if [ -n "$ADMIN_KEY" ] && ! grep -qF "$ADMIN_KEY" /root/.ssh/authorized_keys; then
  echo "$ADMIN_KEY" >> /root/.ssh/authorized_keys
fi
if [ -s /root/.ssh/authorized_keys ]; then
  log "sshd: keys only (authorized_keys is non-empty)"
  cat > /etc/ssh/sshd_config.d/90-recovery.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin prohibit-password
EOF
  sshd -t
  # Ubuntu 24.04 is SOCKET-ACTIVATED: `ssh.socket` is enabled and `ssh.service`
  # reports "disabled", so the old `is-enabled ssh` probe fell through to
  # `systemctl reload sshd` -- a unit that does not exist there. Under `set -e`
  # that aborted the whole bootstrap BEFORE the clone and the Doppler CLI, while
  # still exiting 0 overall, so it read as success. Observed on the #3800
  # recovery VPS 2026-09-15.
  #
  # Under socket activation each connection spawns a fresh sshd that reads
  # sshd_config.d anyway, so a reload is a convenience, never a requirement:
  # try both unit names and treat "neither exists" as fine.
  if systemctl reload ssh 2>/dev/null; then
    log "sshd: reloaded ssh.service"
  elif systemctl reload sshd 2>/dev/null; then
    log "sshd: reloaded sshd.service"
  else
    log "sshd: config written; no reload needed (socket-activated) or unit absent"
  fi
else
  log "sshd: NOT hardened — no authorized key present (pass --admin-key). Password login stays on."
fi

# ── 5. Code at the exact SHA ─────────────────────────────────────────────────
log "clone MIRA @ $SHA"
git clone --quiet "$REPO_URL" /opt/mira
git -C /opt/mira checkout --quiet "$SHA"
git -C /opt/mira rev-parse HEAD

# ── 6. Data dirs ─────────────────────────────────────────────────────────────
log "data dirs"
install -d /opt/mira/data /opt/mira/data/upload-buffers /var/backups/mira
bash /opt/mira/scripts/host_perm_setup.sh || true

# ── 7. Doppler CLI ───────────────────────────────────────────────────────────
if ! command -v doppler >/dev/null 2>&1; then
  log "doppler cli"
  curl -sLf --retry 3 https://cli.doppler.com/install.sh | sh >/dev/null
fi
doppler --version

log "DONE. Next: tools/recovery/deploy-recovery.sh (needs DOPPLER_TOKEN, a scoped service token)."

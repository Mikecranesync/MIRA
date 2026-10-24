#!/usr/bin/env bash
# Install the #3800 OVH recovery nginx vhosts and reload nginx.
#
# Run as root ON the recovery host, from the repo checkout:
#
#     sudo bash /opt/mira/tools/recovery/install-vhosts.sh
#
# Idempotent: re-running relinks the same symlink and reloads. It validates the
# config with `nginx -t` BEFORE reloading, so a bad edit cannot take the origin
# down -- nginx keeps serving the last good config if validation fails.
#
# HTTP-only by design; `certbot --nginx` adds the 443 blocks afterwards. See the
# header of deployment/nginx-recovery-ovh.conf for why that ordering is forced.
set -euo pipefail

REPO="${REPO:-/opt/mira}"
SRC="$REPO/deployment/nginx-recovery-ovh.conf"
DST_AVAIL=/etc/nginx/sites-available/recovery-ovh
DST_ENABLED=/etc/nginx/sites-enabled/recovery-ovh

log() { printf '[vhosts] %s\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
[ -f "$SRC" ] || { echo "missing $SRC (is $REPO checked out at the recovery SHA?)" >&2; exit 1; }

log "install $SRC -> $DST_AVAIL"
install -m 644 -o root -g root "$SRC" "$DST_AVAIL"
ln -sf "$DST_AVAIL" "$DST_ENABLED"

# Ubuntu's packaged default vhost is a catch-all `default_server` on :80. Left
# enabled it answers any Host nginx does not recognise -- including, during a
# DNS cutover, requests that arrive before the real vhost matches. Remove it so
# an unmatched Host fails loudly instead of serving the nginx welcome page.
if [ -e /etc/nginx/sites-enabled/default ]; then
  log "removing packaged default vhost"
  rm -f /etc/nginx/sites-enabled/default
fi

install -d /var/www/certbot

log "validate"
nginx -t

log "reload"
# `systemctl reload` is preferred, but the unit name and init differ across
# images; fall back so this works on a minimal host.
systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || nginx -s reload

log "enabled vhosts:"
ls -1 /etc/nginx/sites-enabled/ | sed 's/^/  /'
log "DONE"

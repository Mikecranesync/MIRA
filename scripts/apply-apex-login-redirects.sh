#!/usr/bin/env bash
# Apply apex /login + /signup → app.factorylm.com redirects on the VPS.
#
# Idempotent: skips if the redirect blocks already exist.
# Run from a machine that can SSH to the VPS as root (or a user with
# sudo nginx access).
#
# Usage:
#   scripts/apply-apex-login-redirects.sh           # apply
#   DRY_RUN=1 scripts/apply-apex-login-redirects.sh # diff only
set -euo pipefail

VPS_HOST="${VPS_HOST:-root@100.68.120.99}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-enabled/factorylm-landing}"
DRY_RUN="${DRY_RUN:-0}"

# The apex factorylm.com 443 block lives in factorylm-landing (verified
# 2026-05-09). The remote awk in remote_apply() anchors on its
# `server_name factorylm.com www.factorylm.com;` line.
NEW_BLOCK=$'    # apex login/signup → app subdomain (added 2026-05-09)\n    location = /login  { return 301 https://app.factorylm.com/login; }\n    location = /signup { return 301 https://app.factorylm.com/signup; }'

remote_apply() {
  ssh "$VPS_HOST" bash -se <<'REMOTE'
set -euo pipefail
NGINX_CONF="${NGINX_CONF:-/etc/nginx/sites-enabled/factorylm-landing}"

if [[ ! -f "$NGINX_CONF" ]]; then
  echo "ERROR: $NGINX_CONF not found on VPS" >&2
  exit 1
fi

if grep -q 'apex login/signup → app subdomain' "$NGINX_CONF"; then
  echo "✓ Redirects already present in $NGINX_CONF — nothing to do."
  exit 0
fi

cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d-%H%M%S)"

# Insert the new block AFTER the FIRST apex server_name line (the 443 block).
awk '
  /server_name factorylm\.com www\.factorylm\.com;/ && !inserted {
    print
    print "    # apex login/signup → app subdomain (added 2026-05-09)"
    print "    location = /login  { return 301 https://app.factorylm.com/login; }"
    print "    location = /signup { return 301 https://app.factorylm.com/signup; }"
    inserted = 1
    next
  }
  { print }
' "$NGINX_CONF" > "${NGINX_CONF}.new"

mv "${NGINX_CONF}.new" "$NGINX_CONF"

nginx -t
systemctl reload nginx
echo "✓ Reloaded nginx with apex /login + /signup redirects."
REMOTE
}

verify() {
  for path in /login /signup; do
    code=$(curl -sI -o /dev/null -w '%{http_code}' "https://factorylm.com${path}" || true)
    loc=$(curl -sI "https://factorylm.com${path}" | awk -F': ' 'tolower($1)=="location"{print $2}' | tr -d '\r')
    printf 'GET https://factorylm.com%-8s → %s  Location: %s\n' "$path" "$code" "${loc:-<none>}"
  done
}

if [[ "$DRY_RUN" == "1" ]]; then
  echo "DRY RUN — would SSH to $VPS_HOST and edit $NGINX_CONF"
  echo "Block to insert:"
  echo "$NEW_BLOCK"
  exit 0
fi

remote_apply
echo
echo "Verifying:"
verify

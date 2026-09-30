#!/usr/bin/env bash
# Finish the #3800 cutover AFTER the DNS A records point at this host.
#
#     sudo bash /opt/mira/tools/recovery/finish-cutover.sh
#
# Everything before this is already done by bootstrap-host.sh +
# deploy-recovery.sh + install-vhosts.sh. This script does only the two things
# that CANNOT be done before DNS resolves here:
#
#   1. Obtain Let's Encrypt certificates (HTTP-01 needs the public name to
#      resolve to this host -- there is no DNS-01 path, the Namecheap account
#      has no API access).
#   2. Verify HTTPS end-to-end on both domains.
#
# It refuses to run until DNS actually points here, so it cannot burn Let's
# Encrypt rate limits against a name that still resolves elsewhere (5 failures
# per account per hostname per hour).
set -euo pipefail

EXPECT_IP="${EXPECT_IP:-$(curl -fsS --max-time 15 https://api.ipify.org || true)}"
EMAIL="${CERTBOT_EMAIL:-}"
DOMAINS=(app.factorylm.com factorylm.com www.factorylm.com)

log() { printf '[cutover] %s\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "must run as root" >&2; exit 1; }
[ -n "$EXPECT_IP" ] || { echo "could not determine this host's public IP; set EXPECT_IP=" >&2; exit 1; }
log "this host is $EXPECT_IP"

# ── 1. Refuse until DNS has landed ───────────────────────────────────────────
ready=()
for d in "${DOMAINS[@]}"; do
  got="$(getent ahostsv4 "$d" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if printf '%s' "$got" | grep -qF "$EXPECT_IP"; then
    log "  $d -> $got  OK"
    ready+=("$d")
  else
    log "  $d -> ${got:-<none>}  NOT this host yet"
  fi
done
if [ "${#ready[@]}" -eq 0 ]; then
  log "no domain resolves here yet -- point the A records first, then re-run."
  log "(DNS is cached; give it the record TTL before retrying.)"
  exit 3
fi

# ── 2. Certificates ──────────────────────────────────────────────────────────
args=(--nginx --non-interactive --agree-tos --redirect)
if [ -n "$EMAIL" ]; then args+=(-m "$EMAIL"); else args+=(--register-unsafely-without-email); fi
for d in "${ready[@]}"; do args+=(-d "$d"); done
log "certbot ${ready[*]}"
certbot "${args[@]}"

nginx -t
systemctl reload nginx 2>/dev/null || service nginx reload 2>/dev/null || nginx -s reload

# ── 3. Prove it from the outside ─────────────────────────────────────────────
log "verifying HTTPS"
fail=0
for d in "${ready[@]}"; do
  code="$(curl -sL -o /dev/null -w '%{http_code}' --max-time 30 "https://$d/" || echo 000)"
  exp="$(echo | openssl s_client -servername "$d" -connect "$d:443" 2>/dev/null \
         | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  log "  https://$d -> HTTP $code   cert expires: ${exp:-UNKNOWN}"
  [ "$code" = "200" ] || fail=1
done
[ "$fail" -eq 0 ] && log "CUTOVER VERIFIED" || { log "one or more domains did not return 200"; exit 4; }

#!/usr/bin/env bash
# Runs on CHARLIE every 30 min (launchd: com.factorylm.gha-regtoken.plist).
# Mints a GitHub Actions runner REGISTRATION token (valid 1 hour, can only register runners to
# this one repo) with CHARLIE's gh login, and writes it to Bravo over SSH stdin (never argv,
# never a log). CHARLIE's GitHub credential itself never leaves CHARLIE.
set -euo pipefail
export PATH="/opt/homebrew/bin:$HOME/bin:$PATH"
REPO="${REPO:?set REPO, e.g. Mikecranesync/MIRA}"
BRAVO="${BRAVO:-bravonode@192.168.1.11}"

tok="$(gh api -X POST "repos/$REPO/actions/runners/registration-token" --jq .token)"
[ -n "$tok" ] || { echo "no token minted" >&2; exit 1; }
printf '%s' "$tok" | ssh -o BatchMode=yes -o ConnectTimeout=10 "$BRAVO" \
  'umask 077; mkdir -p ~/.gha; cat > ~/.gha/regtoken.tmp && mv ~/.gha/regtoken.tmp ~/.gha/regtoken'
echo "$(date -u +%FT%TZ) registration token refreshed for $REPO"

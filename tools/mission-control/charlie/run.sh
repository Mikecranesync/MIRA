#!/bin/bash
# Mission Control on CHARLIE (#4737). Loopback only; Tailscale serve provides tailnet HTTPS.
# Token: Doppler factorylm/prd GITHUB_PAT (owner-approved 2026-10-24, broad scopes accepted).
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
GITHUB_TOKEN="$(doppler secrets get GITHUB_PAT --project factorylm --config prd --plain)"
export GITHUB_TOKEN MC_PORT=8787
exec /usr/bin/python3 "$HOME/Services/mission-control/current/server.py"

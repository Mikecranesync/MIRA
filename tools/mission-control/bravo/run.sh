#!/bin/bash
# Mission Control v2 on BRAVO (#4737). Loopback only; Tailscale serve provides tailnet HTTPS.
# Token: Doppler factorylm/prd GITHUB_PAT (owner-approved 2026-10-24; needs read:project + repo read).
# Port 8790 and label com.factorylm.mission-control-v2: BRAVO already runs an unrelated static
# http.server under com.factorylm.mission-control on 8787 (not touched by this install).
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
GITHUB_TOKEN="$(doppler secrets get GITHUB_PAT --project factorylm --config prd --plain)"
export GITHUB_TOKEN
export MC_PORT=8790
export MC_DATA_DIR="$HOME/Services/mission-control-v2/data"
export MC_ENV_PRODUCTION_URL="https://app.factorylm.com/api/version/"
# Staging is VPS-local (127.0.0.1:4101); from BRAVO it reads "unreachable from this host" by design.
export MC_ENV_STAGING_URL="http://127.0.0.1:4101/api/version/"
# MC_WEBHOOK_SECRET is deliberately unset here: no GitHub webhook can reach a tailnet-only host,
# so POST /webhook/github answers 503 and the page runs poll-only. Stage B (OVH) sets it.
exec /usr/bin/python3 "$HOME/Services/mission-control-v2/current/server.py"

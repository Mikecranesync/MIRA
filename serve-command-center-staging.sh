#!/usr/bin/env bash
# Isolated STAGING Command Center view server (CHARLIE).
# Worktree's own prod build, against the STAGING NeonDB (factorylm/stg), on :3970.
# Runs on CHARLIE so the green-dot probe reaches the LAN Node-RED display at
# 192.168.1.12:1880. basePath=/hub matches the build → page hydrates.
#   Open via the one-click entry:  http://127.0.0.1:3971/
set -euo pipefail
cd "$(dirname "$0")/mira-hub"
export PATH="/Users/charlienode/.bun/bin:/opt/homebrew/bin:$PATH"
exec doppler run -p factorylm -c stg -- env \
  NEXT_PUBLIC_BASE_PATH='/hub' NEXT_PUBLIC_API_BASE='/hub' \
  AUTH_SECRET='cc-e2e-fixed-secret-do-not-use-in-prod' NODE_ENV=production \
  CSP_FRAME_SRC_DISPLAY_HOSTS='http://192.168.1.12:1880' \
  ./node_modules/.bin/next start -p 3970

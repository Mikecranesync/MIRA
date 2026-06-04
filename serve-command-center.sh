#!/usr/bin/env bash
# Isolated Command Center view server (CHARLIE).
# Boots the worktree's own prod build on :3960 against the DEV NeonDB, so the
# green-dot reachability probe can reach the LAN Node-RED display at
# 192.168.1.12:1880. basePath=/hub matches the build → assets resolve, page hydrates.
#
# Open:  http://127.0.0.1:3960/hub/command-center/
# Auth:  the page is gated; use the minted view cookie (see /tmp/cc_token.txt) or log in.
set -euo pipefail
cd "$(dirname "$0")/mira-hub"
export PATH="/Users/charlienode/.bun/bin:/opt/homebrew/bin:$PATH"
exec doppler run -p factorylm -c dev -- env \
  NEXT_PUBLIC_BASE_PATH='/hub' NEXT_PUBLIC_API_BASE='/hub' \
  AUTH_SECRET='cc-e2e-fixed-secret-do-not-use-in-prod' NODE_ENV=production \
  ./node_modules/.bin/next start -p 3960

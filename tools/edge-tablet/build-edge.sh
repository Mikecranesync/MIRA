#!/usr/bin/env bash
# build-edge.sh — build the Hub for the offline tablet and pack one release tarball.
# Run on a build host with mira-hub/node_modules installed, from a clean committed tree.
# Usage: tools/edge-tablet/build-edge.sh [out-dir]
# Output: <out-dir>/edge-hub-<sha12>.tgz and .sha256. The tarball holds a Next standalone
# server plus BUILD_SHA; the client bundle is checked for the cloud base path below.
set -euo pipefail
ROOT=$(git rev-parse --show-toplevel)
OUT=${1:-"$ROOT/dist/edge-tablet"}
SHA=$(git -C "$ROOT" rev-parse HEAD)
if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
  echo "refusing: tracked changes in the tree; build a committed SHA" >&2
  exit 1
fi
# The shared UI packages resolve their imports (e.g. @assistant-ui/react) through the Hub's
# node_modules, exactly as mira-hub/Dockerfile links them.
[ -e "$ROOT/packages/node_modules" ] || ln -s ../mira-hub/node_modules "$ROOT/packages/node_modules"
cd "$ROOT/mira-hub"
# The Dockerfile defaults NEXT_PUBLIC_* to the cloud (/hub, app.factorylm.com). An edge
# build must override them, or browser sign-in on the device breaks (2026-11-08).
export NEXT_PUBLIC_BASE_PATH='' NEXT_PUBLIC_API_BASE='' \
  NEXT_PUBLIC_PIPELINE_API_URL=http://127.0.0.1:1 \
  NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000 \
  NEXT_TELEMETRY_DISABLED=1
npm run build
SERVER=$(find .next/standalone -maxdepth 3 -name server.js -not -path "*/node_modules/*" | head -1)
[ -n "$SERVER" ] || { echo "no standalone server.js (is output: 'standalone' set?)" >&2; exit 1; }
STAGE=$(mktemp -d)/hub
cp -R "$(dirname "$SERVER")" "$STAGE"
mkdir -p "$STAGE/.next" && cp -R .next/static "$STAGE/.next/static"
[ -d public ] && cp -R public "$STAGE/public"
{
  echo "$SHA"
  echo "build env: NEXT_PUBLIC_BASE_PATH= NEXT_PUBLIC_API_BASE= NEXT_PUBLIC_PIPELINE_API_URL=http://127.0.0.1:1 NEXT_PUBLIC_APP_URL=NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3000"
} > "$STAGE/BUILD_SHA"
# The client bundle must not call the cloud /hub API base.
if grep -rqE '"/hub/api|https://app\.factorylm\.com/hub/api' "$STAGE/.next/static"; then
  echo "refusing: client bundle still references the cloud /hub API base" >&2
  exit 1
fi
mkdir -p "$OUT"
TGZ="$OUT/edge-hub-${SHA:0:12}.tgz"
tar -C "$(dirname "$STAGE")" -czf "$TGZ" hub
(cd "$OUT" && shasum -a 256 "$(basename "$TGZ")" > "$(basename "$TGZ").sha256")
echo "$TGZ"
cat "$TGZ.sha256"

#!/usr/bin/env bash
# Plug the phone in, run this, the FactoryLM app installs.
#
# Downloads latest.json + the signed APK from the direct-install page
# (docs/release/android/sideload.md), verifies the sha256 latest.json declares,
# installs over adb (-r keeps app data; same signing key as Play), and launches.
# Read-only against the release host; nothing here changes the release.
#
#   bash tools/android/install-latest.sh            # install to the connected device
#   bash tools/android/install-latest.sh --dry-run  # download + verify only, no adb
#
# Windows: tools/android/install-latest.ps1 does the same in PowerShell.
set -euo pipefail

BASE="https://updates.factorylm.com/app"
DRY_RUN=0
[ "${1:-}" = "--dry-run" ] && DRY_RUN=1
WORK="${TMPDIR:-/tmp}/factorylm-install"
mkdir -p "$WORK"

echo "→ fetching $BASE/latest.json"
curl -fsSL --max-time 30 "$BASE/latest.json" -o "$WORK/latest.json"
FILE=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["file"])' "$WORK/latest.json")
SHA=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["sha256"])' "$WORK/latest.json")
VER=$(python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));print(d["versionName"],"vc"+str(d["versionCode"]))' "$WORK/latest.json")
echo "   latest: $VER  file=$FILE"

if [ ! -f "$WORK/$FILE" ]; then
  echo "→ downloading $BASE/$FILE"
  curl -fsSL --max-time 600 "$BASE/$FILE" -o "$WORK/$FILE.part" && mv "$WORK/$FILE.part" "$WORK/$FILE"
fi

echo "→ verifying sha256"
if command -v shasum >/dev/null 2>&1; then GOT=$(shasum -a 256 "$WORK/$FILE" | cut -d' ' -f1); else GOT=$(sha256sum "$WORK/$FILE" | cut -d' ' -f1); fi
if [ "$GOT" != "$SHA" ]; then
  echo "✗ sha256 mismatch: expected $SHA got $GOT — refusing to install." >&2
  exit 1
fi
echo "   ok $GOT"

if [ "$DRY_RUN" = 1 ]; then
  echo "dry run: APK verified at $WORK/$FILE; skipping adb."
  exit 0
fi

command -v adb >/dev/null 2>&1 || { echo "✗ adb not found on PATH (install Android platform-tools)." >&2; exit 1; }
DEVICES=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
if [ -z "$DEVICES" ]; then
  echo "✗ no device in 'device' state. Plug the phone in, unlock it, accept the USB debugging prompt, then re-run." >&2
  adb devices
  exit 1
fi
echo "→ installing on: $DEVICES"
adb install -r "$WORK/$FILE"
echo "→ launching"
adb shell monkey -p com.factorylm.mira -c android.intent.category.LAUNCHER 1 >/dev/null
cat <<'NEXT'

Installed. Next, on the phone:
  1. Sign in.
  2. More → About & updates → channel: canary → Check now → Update ready → Restart.
  3. More → Chat style → "Try the unified interface (beta)".
  4. Open a notebook. Full test list: docs/release/android/unified-ui-beta.md
NEXT

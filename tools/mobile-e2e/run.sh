#!/usr/bin/env bash
# Boot an emulator, build the APK if needed, and replay the mobile journey.
#
# The point: never borrow a physical phone for a journey check again.
#
#   export FLM_EMAIL='...' FLM_PASSWORD='...'
#   bash tools/mobile-e2e/run.sh path/to/manual.pdf "When do I need to derate this drive" 117
#
set -euo pipefail

PDF="${1:?usage: run.sh <manual.pdf> <question-without-questionmark> [expected-page]}"
QUESTION="${2:?question required}"
EXPECT_PAGE="${3:-}"

SDK="${ANDROID_SDK_ROOT:-$HOME/AppData/Local/Android/Sdk}"
ADB="$SDK/platform-tools/adb.exe"
EMULATOR="$SDK/emulator/emulator.exe"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE="$REPO_ROOT/mira-mobile"

export MSYS_NO_PATHCONV=1

[ -x "$ADB" ] || { echo "adb not found at $ADB -- set ANDROID_SDK_ROOT" >&2; exit 2; }

# --------------------------------------------------------------- 1. emulator
if ! "$ADB" devices | awk 'NR>1 && $2=="device"' | grep -q '^emulator-'; then
  AVD="$("$EMULATOR" -list-avds | head -1)"
  [ -n "$AVD" ] || { echo "No AVD defined. Create one in Android Studio first." >&2; exit 2; }
  echo "==> booting emulator: $AVD"
  # -no-snapshot-load gives a clean boot; the app's cookie jar must not survive between runs
  # or 'sign in' silently becomes a no-op and stops being tested.
  "$EMULATOR" -avd "$AVD" -no-snapshot-load -no-boot-anim >/dev/null 2>&1 &
  echo "    waiting for boot..."
  "$ADB" wait-for-device
  until [ "$("$ADB" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do
    sleep 3
  done
  "$ADB" shell input keyevent 82 || true   # dismiss lockscreen (emulators have no PIN)
  echo "    booted"
else
  echo "==> emulator already running"
fi

# --------------------------------------------------------------- 2. apk
APK="$MOBILE/android/app/build/outputs/apk/debug/app-debug.apk"
if [ ! -f "$APK" ]; then
  echo "==> building debug APK"
  ( cd "$MOBILE"
    # bun-installed deps break `npx cap`; call the CLI directly.
    node node_modules/@capacitor/cli/bin/capacitor sync android
    cd android
    # local.properties MUST use forward slashes -- backslashes are Java-properties
    # escapes and the resulting error impersonates a long-path failure.
    [ -f local.properties ] || echo "sdk.dir=${SDK//\\//}" > local.properties
    ./gradlew --no-daemon assembleDebug )
fi
[ -f "$APK" ] || { echo "APK not found after build: $APK" >&2; exit 1; }

# --------------------------------------------------------------- 3. journey
ARGS=(--apk "$APK" --pdf "$PDF" --question "$QUESTION")
[ -n "$EXPECT_PAGE" ] && ARGS+=(--expect-page "$EXPECT_PAGE")

echo "==> replaying journey"
exec python "$REPO_ROOT/tools/mobile-e2e/journey.py" "${ARGS[@]}"

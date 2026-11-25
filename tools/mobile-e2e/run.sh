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

SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/AppData/Local/Android/Sdk}}"
# Git Bash on Windows ships adb.exe / emulator.exe; macOS and Linux ship them bare.
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) EXE=".exe" ;; *) EXE="" ;; esac
ADB="$SDK/platform-tools/adb$EXE"
EMULATOR="$SDK/emulator/emulator$EXE"
# The staging flavour (#3938) talks to app-staging and installs beside the
# production app, so the journey never touches a real account (#4455).
export MIRA_PKG="${MIRA_PKG:-com.factorylm.mira.staging}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOBILE="${MIRA_MOBILE_DIR:-$REPO_ROOT/mira-mobile}"

# Capacitor 8 compiles for Java 21; JDK 17 fails deep inside gradle with
# ":capacitor-camera:compileDebugJavaWithJavac". Find a 21+ up front, or stop.
java_major() {
  "$1" -version 2>&1 | sed -nE 's/.*version "([0-9]+).*/\1/p' | head -1
}
ensure_jdk21() {
  local bin major home
  for bin in "${JAVA_HOME:+$JAVA_HOME/bin/java}" "$(command -v java || true)"; do
    [ -n "$bin" ] && [ -x "$bin" ] || continue
    major="$(java_major "$bin")"
    if [ -n "$major" ] && [ "$major" -ge 21 ]; then return 0; fi
  done
  # macOS: /usr/libexec/java_home, then Homebrew's openjdk@21 (not linked by default).
  home="$("${MIRA_JAVA_HOME_CMD:-/usr/libexec/java_home}" -v 21 2>/dev/null || true)"
  if [ -z "$home" ] && command -v brew >/dev/null 2>&1; then
    home="$(brew --prefix openjdk@21 2>/dev/null || true)/libexec/openjdk.jdk/Contents/Home"
  fi
  if [ -n "$home" ] && [ -x "$home/bin/java" ]; then
    major="$(java_major "$home/bin/java")"
    if [ -n "$major" ] && [ "$major" -ge 21 ]; then
      export JAVA_HOME="$home"
      export PATH="$JAVA_HOME/bin:$PATH"
      return 0
    fi
  fi
  echo "The APK build needs JDK 21 (Capacitor 8). Install it (macOS: brew install openjdk@21)" >&2
  echo "and set JAVA_HOME to it, or build the APK separately first." >&2
  exit 2
}

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
APK="$MOBILE/android/app/build/outputs/apk/staging/debug/app-staging-debug.apk"
if [ ! -f "$APK" ]; then
  ensure_jdk21
  echo "==> building staging debug APK"
  ( cd "$MOBILE"
    [ -d node_modules ] || bun install --frozen-lockfile
    # cap sync copies dist/ into the APK, so the web bundle has to exist and be current.
    ./node_modules/.bin/vite build
    # bun-installed deps break `npx cap`; call the CLI directly.
    node node_modules/@capacitor/cli/bin/capacitor sync android
    cd android
    # local.properties MUST use forward slashes -- backslashes are Java-properties
    # escapes and the resulting error impersonates a long-path failure.
    [ -f local.properties ] || echo "sdk.dir=${SDK//\\//}" > local.properties
    ./gradlew --no-daemon assembleStagingDebug )
fi
[ -f "$APK" ] || { echo "APK not found after build: $APK" >&2; exit 1; }

# --------------------------------------------------------------- 3. journey
ARGS=(--apk "$APK" --pdf "$PDF" --question "$QUESTION" --adb "$ADB")
[ -n "$EXPECT_PAGE" ] && ARGS+=(--expect-page "$EXPECT_PAGE")

PY="$(command -v python3 || command -v python)"
echo "==> replaying journey"
exec "$PY" "$REPO_ROOT/tools/mobile-e2e/journey.py" "${ARGS[@]}"

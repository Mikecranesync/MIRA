#!/usr/bin/env bash
# Pixel acceptance harness for #3453 (CapacitorHttp streaming/cancel uncertainty).
#
# Test-only. Touches nothing in production: no Doppler, no VPS, no server config,
# no app code. It only READS device state and RECORDS evidence.
#
# Usage (Git Bash on Windows):
#   bash tools/pixel-acceptance/pixel.sh preflight     # before you start
#   bash tools/pixel-acceptance/pixel.sh start         # begins logcat capture
#   bash tools/pixel-acceptance/pixel.sh shot 03-stop-absent
#   bash tools/pixel-acceptance/pixel.sh rec 04-streaming 45
#   bash tools/pixel-acceptance/pixel.sh note 04 "text appeared in one paint"
#   bash tools/pixel-acceptance/pixel.sh finish
#
# Artifacts land in ./pixel-evidence/<timestamp>/ and are never committed.
set -uo pipefail

PKG="${PKG:-com.factorylm.mira}"
ADB="${ADB:-$LOCALAPPDATA/Android/Sdk/platform-tools/adb.exe}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE="$ROOT/pixel-evidence/.current"

die() { echo "ERROR: $*" >&2; exit 1; }
have_adb() { [ -x "$ADB" ] || command -v adb >/dev/null 2>&1 || die "adb not found. Set ADB=/path/to/adb.exe"; }
adb_() { if [ -x "$ADB" ]; then "$ADB" "$@"; else adb "$@"; fi; }

outdir() { [ -f "$STATE" ] || die "no active run — 'pixel.sh start' first"; cat "$STATE"; }

cmd_preflight() {
  have_adb
  echo "== device =="
  local n; n=$(adb_ devices | grep -cE "\sdevice$")
  [ "$n" = "1" ] || die "expected exactly 1 device, found $n. Unplug others / close emulators."
  adb_ devices | grep -E "\sdevice$"
  echo "  model:    $(adb_ shell getprop ro.product.model | tr -d '\r')"
  echo "  android:  $(adb_ shell getprop ro.build.version.release | tr -d '\r')"
  echo "  booted:   $(adb_ shell getprop sys.boot_completed | tr -d '\r')"

  echo "== app under test: $PKG =="
  local ver
  ver=$(adb_ shell dumpsys package "$PKG" 2>/dev/null | grep -E "versionCode|versionName" | head -2 | tr -d '\r')
  [ -n "$ver" ] || die "$PKG is not installed on this device."
  echo "$ver" | sed 's/^ */  /'

  # BUILD IDENTITY. versionCode is NOT one: on 2026-09-01 the Pixel, the staged
  # fleet003 artifact and the staged chatv2 artifact were ALL vc9, and the phone
  # was silently running a build older than both — it had no safety banner at
  # all. Vite content-hashes the web bundle filename, so that IS an identity.
  echo "== build identity (bundle hash — NOT versionCode) =="
  local apkpath
  apkpath=$(adb_ shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed 's/^package://' | head -1)
  if [ -n "$apkpath" ]; then
    # Pull into CWD: bash maps /tmp to %TEMP% but Windows python cannot
    # resolve a literal "/tmp/..." path, so the read always failed.
    adb_ pull "$apkpath" ./_pf.apk >/dev/null 2>&1
    python - <<'PY'
import zipfile, re
try:
    with zipfile.ZipFile("_pf.apk") as z:
        js = [n for n in z.namelist() if re.search(r"assets/public/assets/index-.*\.js$", n)]
        print("  installed bundle:", js[0].split("/")[-1] if js else "NOT FOUND")
        missing = []
        if js:
            src = z.read(js[0]).decode("utf-8", "replace")
            for label, needle in (("FLEET-003 safety banner", "Safety stop"),
                                  ("ADR-0038 rule-6 truncation", "Incomplete — the connection ended")):
                ok = needle in src
                print(f"    {'PRESENT' if ok else '*** ABSENT ***'}  {label}")
                if not ok: missing.append(label)
        raise SystemExit(3 if (missing or not js) else 0)
except SystemExit:
    raise
except Exception as e:
    print("  bundle read failed:", e); raise SystemExit(3)
PY
    rc=$?
    rm -f ./_pf.apk
    if [ "$rc" != "0" ]; then
      die "phone is on an OLD build (marker ABSENT above). Reflash first — versionCode will NOT tell you this; every build is vc9."
    fi
  fi

  echo "== is it debuggable? (affects whether chrome://inspect works) =="
  if adb_ shell dumpsys package "$PKG" 2>/dev/null | grep -q "flags=.*DEBUGGABLE"; then
    echo "  DEBUGGABLE — chrome://inspect available (this is NOT the release shell)"
  else
    echo "  not debuggable — this IS a release-shaped shell; chrome://inspect will not attach"
  fi

  echo "== network reachability from the phone =="
  # Read-only GET against the public host. Proves DNS+TLS from the device itself,
  # so a later failure can be attributed to the app rather than the network.
  adb_ shell 'ping -c 1 -W 2 app.factorylm.com >/dev/null 2>&1 && echo "  app.factorylm.com reachable" || echo "  WARNING: app.factorylm.com not reachable (ICMP may just be blocked)"' | tr -d '\r'
  echo "PREFLIGHT OK"
}

cmd_start() {
  have_adb
  local ts dir
  ts=$(date +%Y%m%d-%H%M%S)
  dir="$ROOT/pixel-evidence/$ts"
  mkdir -p "$dir"
  echo "$dir" > "$STATE"
  {
    echo "run:      $ts"
    echo "package:  $PKG"
    echo "model:    $(adb_ shell getprop ro.product.model | tr -d '\r')"
    echo "android:  $(adb_ shell getprop ro.build.version.release | tr -d '\r')"
    adb_ shell dumpsys package "$PKG" 2>/dev/null | grep -E "versionCode|versionName" | head -2 | tr -d '\r'
  } > "$dir/device.txt"
  adb_ logcat -c
  # Unfiltered capture: filtering here is how you lose the one line that mattered.
  adb_ logcat -v time > "$dir/logcat.txt" 2>&1 &
  echo $! > "$dir/.logcat.pid"
  echo "recording to $dir"
  cat "$dir/device.txt"
}

cmd_shot() {
  local dir name; dir=$(outdir); name="${1:?usage: shot <name>}"
  adb_ exec-out screencap -p > "$dir/$name.png" 2>/dev/null
  echo "saved $dir/$name.png"
}

cmd_rec() {
  local dir name secs; dir=$(outdir); name="${1:?usage: rec <name> <seconds>}"; secs="${2:-30}"
  echo "recording ${secs}s — perform the step NOW"
  adb_ shell screenrecord --time-limit "$secs" /sdcard/pixrec.mp4
  adb_ pull /sdcard/pixrec.mp4 "$dir/$name.mp4" >/dev/null 2>&1
  adb_ shell rm -f /sdcard/pixrec.mp4
  echo "saved $dir/$name.mp4"
}

cmd_note() {
  local dir n; dir=$(outdir); n="${1:?usage: note <step> <text>}"; shift
  printf '[%s] step %s: %s\n' "$(date +%H:%M:%S)" "$n" "$*" >> "$dir/notes.txt"
  echo "noted."
}

# Force-stop + relaunch: the persistence probe. Nothing in memory survives, so
# what renders afterwards is the SERVER's version of the turn.
cmd_relaunch() {
  have_adb
  # BOUNDED wait. A bare `adb wait-for-device` blocks FOREVER if the device
  # dropped off (observed in dry-run when the emulator died) — that strands the
  # operator with no output at all, which is worse than a clear failure.
  local waited=0
  until adb_ devices | grep -qE "\sdevice$"; do
    waited=$((waited + 2)); sleep 2
    [ "$waited" -ge 30 ] && die "no device after 30s — reconnect the phone, check the USB cable, and re-run preflight"
  done
  adb_ shell am force-stop "$PKG"
  sleep 2
  adb_ shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
  echo "force-stopped and relaunched $PKG"
}

cmd_finish() {
  local dir; dir=$(outdir)
  if [ -f "$dir/.logcat.pid" ]; then kill "$(cat "$dir/.logcat.pid")" 2>/dev/null; rm -f "$dir/.logcat.pid"; fi
  {
    # SCOPED to the app under test. An unscoped FATAL grep reports systemui /
    # launcher crashes as if OUR app had died (four false alarms in one
    # emulator dry-run). A crash only counts if the Process: line names $PKG.
    echo "== crashes in $PKG =="
    if grep -aA2 "FATAL EXCEPTION" "$dir/logcat.txt" | grep -aq "Process: $PKG"; then
      grep -aA6 "FATAL EXCEPTION" "$dir/logcat.txt" | grep -aB1 -aA4 "Process: $PKG" | head -40
    else
      echo "  none"
    fi
    echo
    echo "== ANRs in $PKG =="
    grep -aE "ANR in $PKG" "$dir/logcat.txt" | head -5 || echo "  none"
    echo
    echo "== app-side JS errors =="
    # 'Seed missing signature' is the emulator's own variations warning, not ours.
    grep -aiE "chromium.*(error|uncaught)|Capacitor.*error" "$dir/logcat.txt"       | grep -av "Seed missing signature" | head -20 || echo "  none"
    echo
    echo "== unrelated device noise (NOT the app — ignore) =="
    grep -aA2 "FATAL EXCEPTION" "$dir/logcat.txt" | grep -a "Process:" | grep -av "$PKG"       | sed 's/^/  /' | head -10 || echo "  none"
  } > "$dir/summary.txt" 2>&1
  rm -f "$STATE"
  echo "== $dir =="
  ls -1 "$dir"
  echo
  cat "$dir/summary.txt"
}

case "${1:-}" in
  preflight) shift; cmd_preflight "$@" ;;
  start)     shift; cmd_start "$@" ;;
  shot)      shift; cmd_shot "$@" ;;
  rec)       shift; cmd_rec "$@" ;;
  note)      shift; cmd_note "$@" ;;
  relaunch)  shift; cmd_relaunch "$@" ;;
  finish)    shift; cmd_finish "$@" ;;
  *) sed -n '2,20p' "${BASH_SOURCE[0]}"; exit 1 ;;
esac

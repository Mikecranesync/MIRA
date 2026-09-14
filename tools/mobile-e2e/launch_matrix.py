"""Launch / resume / relaunch paint matrix for the FactoryLM Android shell (#3799).

Regression instrument for the blank-WebView class (#3392, #3412, #3799): the Activity
is alive and top-resumed, the DOM is built, and nothing is painted. It drives the
transitions a technician actually performs and, after each one, asserts two things
the emulator harness never checks:

  1. the screen is NOT a uniform blank (pixel sampling of the app's content area), and
  2. the DOM is built (uiautomator sees at least one text node inside the WebView),

so "blank" is distinguished from "still booting" and from "crashed". It also records
the native guard's own verdicts (`MiraWebViewRecovery` logcat lines) per step, and
fails the step if the guard reported giving up, reloading, or recreating.

    python tools/mobile-e2e/launch_matrix.py --allow-physical \
        --resumes 5 --cold 3 --lock 1 --evidence /tmp/matrix

Refuses a physical device unless --allow-physical is passed (same rule as
journey.py). Never installs, never clears data, never types: it only starts,
backgrounds, force-stops, locks and screenshots the ONE package it is told about
(MIRA_PKG, default com.factorylm.mira). Sibling packages are never touched.

Exit 0 = every step PASS. Exit 1 = at least one FAIL (the report says which).
Exit 2 = precondition failure (no device, app not installed, foreign interaction).
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone

PKG = os.environ.get("MIRA_PKG", "com.factorylm.mira")
ACTIVITY = f"{PKG}/.MainActivity"
GUARD_TAG = "MiraWebViewRecovery"
# A guard line that means the ladder did NOT quietly succeed.
GUARD_BAD = re.compile(r"gave up|reloading page|recreating activity|not reloading", re.I)


def adb_bin() -> str:
    return os.environ.get("ADB", "adb")


class Device:
    def __init__(self, adb: str, serial: str):
        self.adb, self.serial = adb, serial

    def sh(self, cmd: str, timeout: int = 60) -> str:
        p = subprocess.run(
            [self.adb, "-s", self.serial, "shell", cmd],
            capture_output=True,
            timeout=timeout,
        )
        return p.stdout.decode("utf-8", "replace")

    def raw(self, *args: str, timeout: int = 60) -> bytes:
        p = subprocess.run(
            [self.adb, "-s", self.serial, *args], capture_output=True, timeout=timeout
        )
        return p.stdout

    # ── observations ─────────────────────────────────────────────────────────
    def pid(self) -> str:
        return self.sh(f"pidof {PKG}").strip()

    def screenshot(self, path: str) -> bytes:
        png = self.raw("exec-out", "screencap", "-p")
        with open(path, "wb") as f:
            f.write(png)
        return png

    def frames(self) -> int:
        m = re.search(r"Total frames rendered:\s*(\d+)", self.sh(f"dumpsys gfxinfo {PKG}"))
        return int(m.group(1)) if m else -1

    def dom_text_nodes(self, tries: int = 3) -> int:
        """Text nodes uiautomator sees inside our WebView — 0 means no DOM (or not front).

        The first dump after a fresh process often returns before the WebView has
        joined the accessibility tree (an empty or stale tree), so re-ask a few times.
        """
        n = 0
        for _ in range(tries):
            self.sh(
                "rm -f /data/local/tmp/flm-ui.xml; uiautomator dump /data/local/tmp/flm-ui.xml >/dev/null 2>&1"
            )
            xml = self.sh("cat /data/local/tmp/flm-ui.xml 2>/dev/null")
            n = 0
            for m in re.finditer(r"<node [^>]*>", xml):
                node = m.group(0)
                if f'package="{PKG}"' in node and re.search(r'text="[^"]+"', node):
                    n += 1
            if n:
                break
            time.sleep(1.5)
        return n

    def focused(self) -> str:
        out = self.sh("dumpsys activity activities | grep -m1 topResumedActivity")
        m = re.search(r"\s(\S+?)/", out)
        return m.group(1) if m else ""

    def logcat_guard_since(self, marker: str) -> list[str]:
        out = self.raw("logcat", "-d", "-v", "time", "-s", f"{GUARD_TAG}:*").decode(
            "utf-8", "replace"
        )
        lines = [ln.rstrip() for ln in out.splitlines() if GUARD_TAG in ln]
        # marker is an HH:MM:SS.mmm logcat-format timestamp; keep lines at/after it
        keep = []
        for ln in lines:
            m = re.match(r"\d{2}-\d{2} (\d{2}:\d{2}:\d{2}\.\d{3})", ln)
            if m and m.group(1) >= marker:
                keep.append(ln)
        return keep

    def now_marker(self) -> str:
        return self.sh("date +%H:%M:%S.000").strip()

    def crash_or_anr_since(self, marker: str) -> list[str]:
        out = self.raw("logcat", "-d", "-v", "time").decode("utf-8", "replace")
        hits = []
        for ln in out.splitlines():
            m = re.match(r"\d{2}-\d{2} (\d{2}:\d{2}:\d{2}\.\d{3})", ln)
            if not m or m.group(1) < marker:
                continue
            if PKG in ln and re.search(r"FATAL EXCEPTION|ANR in|has died|Force finishing", ln):
                hits.append(ln.rstrip())
        return hits

    # ── transitions ──────────────────────────────────────────────────────────
    def start(self) -> str:
        out = self.sh(f"am start -W -n {ACTIVITY}")
        m = re.search(r"LaunchState:\s*(\w+)", out)
        return m.group(1) if m else "?"

    def home(self) -> None:
        self.sh("input keyevent KEYCODE_HOME")

    def force_stop(self) -> None:
        self.sh(f"am force-stop {PKG}")

    def screen_off(self) -> None:
        self.sh("input keyevent KEYCODE_SLEEP")

    def screen_on_unlock(self) -> None:
        self.sh("input keyevent KEYCODE_WAKEUP")
        time.sleep(0.8)
        # Swipe-to-unlock; a PIN/pattern lock screen will leave the app hidden and the
        # step fails visibly rather than silently.
        self.sh("wm dismiss-keyguard")


def uniform(png: bytes, box: tuple[int, int, int, int], step: int = 40) -> tuple[bool, int]:
    """True when every sampled pixel inside box is (near) the same colour."""
    import io

    try:
        from PIL import Image
    except ImportError as e:  # pragma: no cover
        raise SystemExit("launch_matrix.py needs pillow: pip install pillow") from e

    im = Image.open(io.BytesIO(png)).convert("RGB")
    x1, y1, x2, y2 = box
    seen: set[tuple[int, int, int]] = set()
    for y in range(y1, min(y2, im.height), step):
        for x in range(x1, min(x2, im.width), step):
            r, g, b = tuple(int(c) for c in im.getpixel((x, y)))  # type: ignore[union-attr]
            seen.add((r // 16, g // 16, b // 16))  # tolerate dithering/anti-aliasing
            if len(seen) > 2:
                return False, len(seen)
    return len(seen) <= 2, len(seen)


def content_box(dev: Device) -> tuple[int, int, int, int]:
    """The app's window minus status/navigation bars, from the running window's insets."""
    size = dev.sh("wm size").strip()
    m = re.search(r"(\d+)x(\d+)", size)
    w, h = (int(m.group(1)), int(m.group(2))) if m else (1080, 2400)
    # Generous margins: skip the top 12 % (status bar + any header) and bottom 8 % (nav bar).
    return (int(w * 0.05), int(h * 0.12), int(w * 0.95), int(h * 0.92))


def pick_device(adb: str, allow_physical: bool, serial: str | None) -> str:
    out = subprocess.run([adb, "devices"], capture_output=True, text=True).stdout
    devs = [ln.split()[0] for ln in out.splitlines()[1:] if ln.strip().endswith("device")]
    if serial:
        if serial not in devs:
            raise SystemExit(f"device {serial} not attached: {devs}")
        chosen = serial
    elif devs:
        chosen = devs[0]
    else:
        raise SystemExit("no adb device attached")
    if not chosen.startswith("emulator") and not allow_physical:
        raise SystemExit(f"{chosen} is a physical device — pass --allow-physical to use it")
    return chosen


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--allow-physical", action="store_true")
    ap.add_argument("--serial", default=os.environ.get("ANDROID_SERIAL"))
    ap.add_argument("--resumes", type=int, default=5, help="HOME → relaunch cycles")
    ap.add_argument("--cold", type=int, default=3, help="force-stop → cold launch cycles")
    ap.add_argument("--lock", type=int, default=1, help="screen off → on/unlock cycles")
    ap.add_argument(
        "--settle",
        type=float,
        default=8.0,
        help="seconds to wait after each transition before judging",
    )
    ap.add_argument("--evidence", default=os.environ.get("EVIDENCE_DIR", "evidence/launch-matrix"))
    args = ap.parse_args()

    adb = adb_bin()
    serial = pick_device(adb, args.allow_physical, args.serial)
    dev = Device(adb, serial)
    os.makedirs(args.evidence, exist_ok=True)

    pkg_info = dev.sh(f"dumpsys package {PKG} | grep -E 'versionCode|versionName'")
    if "versionCode" not in pkg_info:
        print(f"{PKG} is not installed on {serial}", file=sys.stderr)
        return 2
    print(f"device={serial} pkg={PKG}\n{pkg_info.strip()}")
    box = content_box(dev)
    print(f"content box={box}")

    results: list[dict] = []

    def judge(step: str, marker: str, launch_state: str = "") -> bool:
        time.sleep(args.settle)
        shot = os.path.join(args.evidence, f"{len(results) + 1:02d}-{step}.png")
        png = dev.screenshot(shot)
        is_blank, colours = uniform(png, box)
        focus = dev.focused()
        pid = dev.pid()
        dom = dev.dom_text_nodes() if focus == PKG else -1
        frames = dev.frames()
        guard = dev.logcat_guard_since(marker)
        crashes = dev.crash_or_anr_since(marker)
        guard_bad = [ln for ln in guard if GUARD_BAD.search(ln)]
        ok = (
            focus == PKG
            and bool(pid)
            and not is_blank
            and dom > 0
            and not crashes
            and not guard_bad
        )
        rec = {
            "step": step,
            "launch_state": launch_state,
            "focus": focus,
            "pid": pid,
            "blank": is_blank,
            "colours_sampled": colours,
            "dom_text_nodes": dom,
            "hwui_frames": frames,
            "guard": guard,
            "crash_or_anr": crashes,
            "screenshot": shot,
            "pass": ok,
        }
        results.append(rec)
        verdict = "PASS" if ok else "FAIL"
        why = (
            ""
            if ok
            else f"  focus={focus} pid={pid!r} blank={is_blank} dom={dom} crashes={len(crashes)} guard_bad={guard_bad}"
        )
        print(
            f"[{verdict}] {step:<22} launch={launch_state:<5} blank={is_blank} dom={dom} frames={frames} guard={len(guard)}{why}"
        )
        for ln in guard:
            print(f"        {ln}")
        return ok

    # 1. fresh launch (force-stop first so it is a real cold start, not a task resume)
    dev.force_stop()
    time.sleep(1.0)
    marker = dev.now_marker()
    judge("fresh-launch", marker, dev.start())

    # 2. HOME → relaunch, N times (warm or cold depending on whether Android kept the process)
    for i in range(1, args.resumes + 1):
        dev.home()
        time.sleep(2.0)
        marker = dev.now_marker()
        judge(f"resume-{i}", marker, dev.start())

    # 3. force-stop → cold launch, N times
    for i in range(1, args.cold + 1):
        dev.force_stop()
        time.sleep(1.0)
        marker = dev.now_marker()
        judge(f"cold-{i}", marker, dev.start())

    # 4. screen off → wake/unlock, N times (app stays foreground)
    for i in range(1, args.lock + 1):
        dev.screen_off()
        time.sleep(2.0)
        marker = dev.now_marker()
        dev.screen_on_unlock()
        judge(f"lock-unlock-{i}", marker, "")

    passed = sum(1 for r in results if r["pass"])
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "device": serial,
        "package": PKG,
        "package_info": pkg_info.strip(),
        "settle_seconds": args.settle,
        "passed": passed,
        "total": len(results),
        "steps": results,
    }
    out = os.path.join(args.evidence, "launch-matrix.json")
    with open(out, "w") as f:
        json.dump(report, f, indent=2)
    print(f"\n{passed}/{len(results)} PASS — report {out}")
    return 0 if passed == len(results) else 1


if __name__ == "__main__":
    sys.exit(main())

"""Android device/emulator driver for FactoryLM mobile acceptance runs.

Windows/Git-Bash safe. Works on RELEASE builds (no CDP needed): uiautomator dump
→ parse bounds → tap/type, plus screencap, focus guard, rotation lock and
stay-awake. For DEBUG builds pair with cdp.mjs (DOM-level evidence).

    python tools/mobile-e2e/device.py preflight   # device, app version, focus, lock rotation
    python tools/mobile-e2e/device.py shot NAME   # screenshot → $EVIDENCE_DIR/NAME.png
    python tools/mobile-e2e/device.py find "Sensor"
    python tools/mobile-e2e/device.py tap-text "Sensor"
    python tools/mobile-e2e/device.py type "hello world"
    python tools/mobile-e2e/device.py back / home / relaunch / forcestop
    python tools/mobile-e2e/device.py restore      # rotation back, stay-awake off

Env: ANDROID_SERIAL (default: first non-emulator device, else emulator-5554),
EVIDENCE_DIR (default ./evidence), MIRA_PKG (default com.factorylm.mira).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8")
os.environ["MSYS_NO_PATHCONV"] = "1"  # Git Bash mangles /data/local/tmp otherwise

ADB = os.environ.get(
    "ADB", os.path.expandvars(r"%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe")
)
PKG = os.environ.get("MIRA_PKG", "com.factorylm.mira")
EVIDENCE = os.environ.get("EVIDENCE_DIR", os.path.abspath("evidence"))
STATE = os.path.join(EVIDENCE, ".device-state.json")


def _devices() -> list[str]:
    out = subprocess.run([ADB, "devices"], capture_output=True, text=True).stdout
    return [l.split()[0] for l in out.splitlines()[1:] if l.strip().endswith("device")]


def serial() -> str:
    if os.environ.get("ANDROID_SERIAL"):
        return os.environ["ANDROID_SERIAL"]
    devs = _devices()
    phys = [d for d in devs if not d.startswith("emulator")]
    if phys:
        return phys[0]
    if devs:
        return devs[0]
    raise SystemExit("no adb device attached")


SER = serial()


def adb(*args: str, timeout: int = 120) -> tuple[str, str, int]:
    p = subprocess.run([ADB, "-s", SER, *args], capture_output=True, timeout=timeout)
    return p.stdout.decode("utf-8", "replace"), p.stderr.decode("utf-8", "replace"), p.returncode


def sh(cmd: str, timeout: int = 120) -> str:
    return adb("shell", cmd, timeout=timeout)[0]


# ---- etiquette -----------------------------------------------------------------
def focus() -> str:
    m = re.search(r"mCurrentFocus=Window\{[^ ]+ u0 ([^}]*)\}", sh("dumpsys window"))
    return m.group(1) if m else ""


def guard() -> bool:
    """True only when OUR app owns the foreground. Never tap through a call/other app."""
    f = focus()
    ok = f.startswith(PKG)
    if not ok:
        print(f"!! foreground is {f!r} — tap refused")
    return ok


def preflight() -> dict:
    os.makedirs(EVIDENCE, exist_ok=True)
    pkg = sh(f"dumpsys package {PKG}")
    info = {
        "serial": SER,
        "model": sh("getprop ro.product.model").strip(),
        "versionName": (re.search(r"versionName=(\S+)", pkg) or [None, None])[1],
        "versionCode": (re.search(r"versionCode=(\d+)", pkg) or [None, None])[1],
        "signature": (re.search(r"Signatures: \[([0-9A-F:]{20})", pkg) or [None, None])[1],
        "debuggable": "DEBUGGABLE" in pkg,
        "battery": (re.search(r"level: (\d+)", sh("dumpsys battery")) or [None, None])[1],
        "focus": focus(),
        "rotation_was": sh("settings get system accelerometer_rotation").strip(),
    }
    json.dump(info, open(STATE, "w"), indent=1)
    sh("settings put system accelerometer_rotation 0")  # portrait coords stay valid
    sh("svc power stayon usb")  # keep the screen on while plugged in
    print(json.dumps(info, indent=1))
    return info


def restore() -> None:
    try:
        was = json.load(open(STATE)).get("rotation_was", "1")
    except OSError:
        was = "1"
    sh(f"settings put system accelerometer_rotation {was}")
    sh("svc power stayon false")
    print(f"restored rotation={was}, stay-awake off")


# ---- observation ---------------------------------------------------------------
def shot(name: str) -> str:
    """screencap → evidence. On some emulators screencap is black: fall back to CDP."""
    os.makedirs(EVIDENCE, exist_ok=True)
    path = os.path.join(EVIDENCE, f"{name}.png")
    with open(path, "wb") as f:
        f.write(subprocess.run([ADB, "-s", SER, "exec-out", "screencap", "-p"], capture_output=True).stdout)
    print(f"shot {path} focus={focus()}")
    return path


def dump() -> str:
    sh("uiautomator dump /data/local/tmp/ui.xml")
    return sh("cat /data/local/tmp/ui.xml")


def nodes(xml: str) -> list[dict]:
    out = []
    for m in re.finditer(r"<node ([^>]*?)/?>", xml):
        a = dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))
        b = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", a.get("bounds", ""))
        if b:
            x1, y1, x2, y2 = map(int, b.groups())
            a["cx"], a["cy"] = (x1 + x2) // 2, (y1 + y2) // 2
        out.append(a)
    return out


def find(**kw: str) -> list[dict]:
    """find(text="Sensor") / find(content_desc="Stop") — case-insensitive substring match."""
    kw = {k.replace("_", "-"): v for k, v in kw.items()}
    return [n for n in nodes(dump()) if all(v.lower() in n.get(k, "").lower() for k, v in kw.items())]


# ---- actions -------------------------------------------------------------------
def tap(x: int, y: int) -> bool:
    if not guard():
        return False
    sh(f"input tap {x} {y}")
    return True


def tap_text(text: str, index: int = 0) -> bool:
    hits = find(text=text)
    if len(hits) <= index:
        print(f"no node with text~{text!r}")
        return False
    return tap(hits[index]["cx"], hits[index]["cy"])


def type_slow(s: str, delay: float = 0.09) -> None:
    """`input text` drops characters in React-controlled WebView inputs; go char by char."""
    for ch in s:
        if ch == " ":
            sh("input keyevent KEYCODE_SPACE")
        else:
            subprocess.run([ADB, "-s", SER, "shell", "input", "text", ch], capture_output=True)
        time.sleep(delay)


def back() -> None:
    sh("input keyevent 4")


def home() -> None:
    sh("input keyevent 3")


def relaunch() -> None:
    sh(f"monkey -p {PKG} -c android.intent.category.LAUNCHER 1")


def forcestop() -> None:
    sh(f"am force-stop {PKG}")


def cdp_forward(port: int = 9222) -> str | None:
    """DEBUG builds only: forward the WebView devtools socket for cdp.mjs."""
    pid = sh(f"pidof {PKG}").strip().split()
    if not pid:
        return None
    adb("forward", "--remove-all")
    _, _, rc = adb("forward", f"tcp:{port}", f"localabstract:webview_devtools_remote_{pid[0]}")
    return pid[0] if rc == 0 else None


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:] or ["preflight"]
    ops = {
        "preflight": preflight, "restore": restore, "back": back, "home": home,
        "relaunch": relaunch, "forcestop": forcestop, "focus": lambda: print(focus()),
        "shot": lambda: shot(rest[0]), "find": lambda: print(json.dumps(find(text=rest[0]), indent=1)),
        "tap-text": lambda: tap_text(rest[0], int(rest[1]) if len(rest) > 1 else 0),
        "type": lambda: type_slow(" ".join(rest)), "cdp": lambda: print(cdp_forward()),
    }
    ops[cmd]()

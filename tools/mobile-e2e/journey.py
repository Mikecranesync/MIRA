#!/usr/bin/env python3
"""Replay the MIRA mobile technician journey on an Android EMULATOR.

Why this exists
---------------
The 2026-08-21 Pixel 9a proof (docs/proofs/2026-08-21-pixel9a-mobile-production-proof.md)
required borrowing a physical phone for ~90 minutes. Almost none of it needed to be
physical. This harness replays the same journey on an emulator so nobody's phone is
held hostage again.

What it covers (same chain as the physical run)
    install -> sign in -> create project -> attach PDF -> ask (upload + ingest on send)
    -> grounded cited answer -> citation resolves to the passage and the original page
    -> (optional) nameplate image -> structured extraction

What it deliberately CANNOT cover -- and reports as SKIP, never as PASS:
    * cellular behaviour (emulator is always on the host network)
    * true camera hardware capture
    * Play-installed, release-signed identity
Those three are the only reasons to ever touch a physical device again.

Safety
------
Refuses to run against a physical device unless --allow-physical is passed. The whole
point is to leave real phones alone.

Element lookup is by TEXT via `uiautomator dump`, never by hardcoded pixel coordinates,
so it is resolution-independent -- the physical run wasted time on coordinate math that
broke between the Pixel (1080x2424) and the emulator.

Usage
-----
    export FLM_EMAIL='...'            # required
    export FLM_PASSWORD='...'         # required -- never hardcode, never commit
    python tools/mobile-e2e/journey.py --apk path/to/app-debug.apk --pdf path/to/manual.pdf \
        --question "When do I need to derate this drive" --expect-page 117

    # optional real-photo nameplate leg (synthetic images do NOT exercise real OCR)
    ... --nameplate path/to/real_nameplate.jpg
"""

from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path

# Same switch as device.py: MIRA_PKG=com.factorylm.mira.staging targets the staging
# flavour (#3938) instead of the production app (#4455).
PKG = os.environ.get("MIRA_PKG", "com.factorylm.mira")
DEVICE_TMP = "/sdcard/Download"
UI_XML = "/sdcard/window_dump.xml"

# adb rewrites /sdcard/... into a Windows path under Git Bash without this.
os.environ.setdefault("MSYS_NO_PATHCONV", "1")


# --------------------------------------------------------------------------- infra


class Fail(Exception):
    """A journey assertion failed."""


@dataclass
class Node:
    text: str
    desc: str
    cls: str
    bounds: tuple[int, int, int, int]
    clickable: bool = False

    @property
    def center(self) -> tuple[int, int]:
        x1, y1, x2, y2 = self.bounds
        return (x1 + x2) // 2, (y1 + y2) // 2

    @property
    def label(self) -> str:
        return self.text or self.desc


class Device:
    def __init__(self, adb: str, serial: str, outdir: Path):
        self.adb = adb
        self.serial = serial
        self.outdir = outdir
        self.outdir.mkdir(parents=True, exist_ok=True)
        self._shot = 0

    def _run(self, args: list[str], **kw) -> subprocess.CompletedProcess:
        # encoding= is mandatory on Windows: text=True alone fails OPEN -- the decode
        # error lands on a reader thread, stdout becomes None, and the caller dies on
        # .strip() far from the real cause.
        return subprocess.run(
            [self.adb, "-s", self.serial, *args],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            **kw,
        )

    def shell(self, *args: str) -> str:
        return (self._run(["shell", *args]).stdout or "").strip()

    @staticmethod
    def _native(p: Path) -> str:
        """Convert an MSYS/Git-Bash path to a native one for adb's LOCAL argument.

        We set MSYS_NO_PATHCONV=1 so Git Bash stops mangling DEVICE paths
        (/sdcard/...), but that also stops it converting LOCAL ones, so a
        `/c/Users/...` argument reaches adb.exe verbatim and fails to stat.
        Only the local side needs this; remote paths must stay POSIX.
        """
        s = str(p)
        m = re.match(r"^[/\\]([A-Za-z])[/\\](.*)$", s)
        if m and not Path(s).exists():
            return f"{m.group(1).upper()}:/{m.group(2)}"
        return str(Path(s).resolve()) if Path(s).exists() else s

    def push(self, local: Path, remote: str) -> None:
        r = self._run(["push", self._native(local), remote])
        if r.returncode != 0:
            raise Fail(f"adb push failed: {r.stderr}")

    def screenshot(self, name: str) -> Path:
        self._shot += 1
        path = self.outdir / f"{self._shot:02d}-{name}.png"
        raw = subprocess.run(
            [self.adb, "-s", self.serial, "exec-out", "screencap", "-p"],
            capture_output=True,
        ).stdout
        path.write_bytes(raw)
        return path

    # ----------------------------------------------------------------- ui queries

    def dump(self) -> list[Node]:
        """Snapshot the view hierarchy. Retries: dump races app transitions."""
        for _ in range(6):
            self.shell("uiautomator", "dump", UI_XML)
            xml = self.shell("cat", UI_XML)
            if xml.startswith("<?xml") and "<node" in xml:
                break
            time.sleep(1.5)
        else:
            return []
        try:
            root = ET.fromstring(xml)
        except ET.ParseError:
            return []

        nodes: list[Node] = []
        for el in root.iter("node"):
            b = el.get("bounds", "")
            m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
            if not m:
                continue
            nodes.append(
                Node(
                    text=el.get("text", "") or "",
                    desc=el.get("content-desc", "") or "",
                    cls=el.get("class", "") or "",
                    bounds=tuple(int(g) for g in m.groups()),  # type: ignore[arg-type]
                    clickable=el.get("clickable") == "true",
                )
            )
        return nodes

    def texts(self) -> list[str]:
        return [n.label for n in self.dump() if n.label.strip()]

    def find(self, needle: str, *, exact: bool = False, clickable: bool = False) -> Node | None:
        """Smallest node matching `needle`.

        Smallest matters: ancestors inherit descendant text, so a naive first-match
        returns the root and you tap 0,0. The physical run lost two taps to exactly
        this before switching to smallest-node.

        `clickable=True` restricts to actionable nodes. Necessary because the same
        string often appears twice -- the sign-in screen has BOTH a 'Sign in' heading
        (a non-clickable TextView) and a 'Sign in' Button, and the heading is the
        smaller of the two, so plain smallest-node picks the one that does nothing.
        """
        nodes = self.dump()
        if clickable:
            nodes = [n for n in nodes if n.clickable]

        # Prefer an EXACT label match over any substring match. Smallest-node alone is
        # not enough: the Sources pane has a clickable checkbox labelled "Include this
        # source in notebook chat", which contains "Chat" and is physically smaller
        # than the "Chat" tab -- so a substring+smallest lookup toggles the checkbox
        # and never opens the tab.
        exact_hits = [n for n in nodes if n.label.strip() == needle]
        hits = exact_hits if exact_hits else (
            [] if exact else [n for n in nodes if needle.lower() in n.label.lower()]
        )
        if not hits:
            return None
        return min(hits, key=lambda n: (n.bounds[2] - n.bounds[0]) * (n.bounds[3] - n.bounds[1]))

    def tap_button(self, needle: str, *, timeout: int = 60) -> None:
        """Tap an actionable control, never a same-named label."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.dismiss_anr()
            node = self.find(needle, clickable=True)
            if node is not None:
                self.tap(*node.center)
                return
            time.sleep(2)
        raise Fail(f"no clickable control matching {needle!r} within {timeout}s")

    def dismiss_anr(self) -> bool:
        """Dismiss 'X isn't responding' ANR dialogs.

        Emulators rendering through swiftshader throw 'System UI isn't responding'
        routinely; it is a performance artifact, not a fault in the app. Choosing
        'Close app' would kill the thing under test, so always choose Wait.
        """
        # Resolve the button from the SAME snapshot that saw the dialog. Re-dumping
        # here is a real bug: `uiautomator dump` intermittently returns nothing, and a
        # blank second read means the ANR is never dismissed while the caller spins
        # out its entire timeout behind an undismissed modal.
        nodes = self.dump()
        if not any(
            "isn't responding" in n.label or "is not responding" in n.label for n in nodes
        ):
            return False
        for choice in ("Wait", "OK"):
            for n in nodes:
                if n.label == choice:
                    self.shell("input", "tap", *map(str, n.center))
                    time.sleep(3)
                    return True
        return False

    def launch_app(self) -> None:
        """Start the app's launcher activity.

        `monkey -p PKG -c LAUNCHER 1` silently starts nothing on the API 35 emulator, so
        resolve the launcher activity and `am start` it; monkey stays as the fallback.
        """
        out = self.shell("cmd", "package", "resolve-activity", "--brief", "-c",
                         "android.intent.category.LAUNCHER", PKG)
        component = out.splitlines()[-1].strip() if out else ""
        if component.startswith(f"{PKG}/"):
            self.shell("am", "start", "-n", component)
        else:
            self.shell("monkey", "-p", PKG, "-c", "android.intent.category.LAUNCHER", "1")

    def top_package(self) -> str:
        out = self.shell("dumpsys", "activity", "activities")
        m = re.search(r"topResumedActivity.*?\{[^}]*?\s(\S+?)/", out)
        return m.group(1) if m else ""

    def ensure_foreground(self) -> bool:
        """Bring the app back if it fell to the background.

        Dismissing a SystemUI ANR on a slow emulator drops you on the launcher, and
        the app is then never coming back on its own -- a wait would burn its whole
        timeout staring at the home screen. Returns True if a relaunch happened.
        """
        top = self.top_package()
        if top and top != PKG and "packageinstaller" not in top and "permission" not in top:
            self.launch_app()
            time.sleep(5)
            return True
        return False

    def wait_for(
        self,
        needle: str,
        timeout: int = 90,
        *,
        absent: bool = False,
        keep_foreground: bool = False,
    ) -> Node | None:
        deadline = time.time() + timeout
        while time.time() < deadline:
            if self.dismiss_anr():
                continue
            if keep_foreground and self.ensure_foreground():
                continue
            n = self.find(needle)
            if absent and n is None:
                return None
            if not absent and n is not None:
                return n
            time.sleep(2)
        if absent:
            raise Fail(f"still present after {timeout}s: {needle!r}")
        raise Fail(f"never appeared within {timeout}s: {needle!r}")

    # ----------------------------------------------------------------- ui actions

    def tap(self, x: int, y: int) -> None:
        if (x, y) == (0, 0):
            raise Fail("refusing to tap 0,0 -- element lookup failed")
        self.shell("input", "tap", str(x), str(y))
        time.sleep(1)

    def tap_text(self, needle: str, *, timeout: int = 60) -> None:
        node = self.wait_for(needle, timeout)
        assert node is not None
        self.tap(*node.center)

    def type_text(self, s: str, *, chunk: int = 8) -> None:
        """Type text, in chunks.

        `%s` is the space escape. `?` is a glob on the device shell and the
        percent-encoded form is NOT decoded -- a literal `%3F` reaches the field.

        Chunking matters on emulators: a full-string `input text` outruns the WebView
        and characters get dropped or duplicated ('mike@...' arriving as 'mimikk').
        """
        if "?" in s:
            raise Fail("'?' cannot be typed via `input text`; omit it")
        for i in range(0, len(s), chunk):
            self.shell("input", "text", s[i : i + chunk].replace(" ", "%s"))
            time.sleep(0.4)
        time.sleep(0.6)

    def hide_keyboard(self) -> None:
        """Close the soft keyboard, but ONLY if it is actually open.

        KEYCODE_BACK with no keyboard showing navigates the app backwards instead --
        which silently walks you off the form you were filling in, and the next field
        lookup then fails with a confusing 'never appeared'.
        """
        shown = "mInputShown=true" in self.shell("dumpsys", "input_method")
        if shown:
            self.shell("input", "keyevent", "4")
            time.sleep(1)

    def clear_field(self, node: Node) -> None:
        """Empty a field.

        `input keyevent` accepts multiple keycodes in one call -- 123 = MOVE_END,
        67 = DEL. One adb round trip instead of eighty.
        """
        self.tap(*node.center)
        self.shell("input", "keyevent", "123", *(["67"] * 80))
        time.sleep(0.5)

    def input_for(self, field_label: str) -> Node:
        """Resolve the EditText belonging to a form label.

        The Hub renders labels as `android.view.View` and the actual input as a
        SEPARATE, empty `android.widget.EditText` below it. Tapping the label types
        into nothing -- silently, since focus just never moves. So: if the label
        itself is an EditText (placeholder-style, e.g. 'Ask a question') use it
        directly; otherwise take the nearest EditText below the label.
        """
        # Three separate reasons a field can be "missing" and none of them mean absent:
        # a flaky blank dump, the soft keyboard covering it, or it being below the
        # fold. Waiting re-dumps; then close the keyboard; then scroll.
        if self.find(field_label) is None:
            self.hide_keyboard()
        if self.find(field_label) is None:
            # Scroll back to the TOP first, then walk down. A one-directional scan
            # overshoots and can never recover -- the field ends up above the
            # viewport and the search reports it missing when it is merely past.
            for _ in range(4):
                self.shell("input", "swipe", "540", "900", "540", "1700", "250")
                time.sleep(0.8)
            for _ in range(5):
                if self.find(field_label) is not None:
                    break
                self.shell("input", "swipe", "540", "1500", "540", "1100", "300")
                time.sleep(1.2)
        self.wait_for(field_label, timeout=60, keep_foreground=True)

        nodes = self.dump()
        labels = [n for n in nodes if field_label.lower() in n.label.lower()]
        if not labels:
            raise Fail(f"no field labelled {field_label!r}")

        for n in labels:
            if "EditText" in n.cls:
                return n

        label = min(labels, key=lambda n: n.bounds[3] - n.bounds[1])
        edits = [
            n for n in nodes
            if "EditText" in n.cls and n.bounds[1] >= label.bounds[3] - 5
        ]
        if not edits:
            raise Fail(f"found label {field_label!r} but no EditText beneath it")
        return min(edits, key=lambda n: n.bounds[1] - label.bounds[3])

    def bottom_edit_text(self) -> Node:
        """The lowest EditText on screen -- used for the chat composer.

        Its placeholder ("Ask a question...") is exposed as text on a real Pixel but
        NOT on the emulator, where the node's text is empty. Label lookup therefore
        works on hardware and silently fails on an emulator, so target it structurally.
        """
        edits = [n for n in self.dump() if "EditText" in n.cls]
        if not edits:
            raise Fail("no text input on screen")
        return max(edits, key=lambda n: n.bounds[1])

    def type_into(self, field_label: str, value: str, *, verify: bool = True,
                  attempts: int = 3) -> None:
        """Tap a field's input, type, READ IT BACK, and retry on mismatch.

        Two distinct corruptions are real here: the first `input text` after a tap can
        duplicate its leading character ('pprod.smoke...'), and a slow emulator drops
        or interleaves characters outright ('mike@...' -> 'mimikk'). Neither is
        deterministic, so verify-and-retry beats any single clever typing strategy.
        """
        last = ""
        for attempt in range(1, attempts + 1):
            field = self.input_for(field_label)
            if attempt > 1:
                self.clear_field(field)
                field = self.input_for(field_label)
            self.tap(*field.center)
            self.type_text(value)
            if not verify:
                return
            time.sleep(1)
            last = self.input_for(field_label).text
            if last == value:
                return
            log("type", f"field {field_label!r} read back {last!r}; retry {attempt}/{attempts}")
        raise Fail(
            f"field {field_label!r} would not accept {value!r} after {attempts} "
            f"attempts (last read: {last!r})"
        )


# --------------------------------------------------------------------------- steps


def log(step: str, msg: str = "") -> None:
    print(f"[{step}] {msg}".rstrip(), flush=True)


# A source chip reads "FILE manual.pdf p. 3" and the citation sheet "[1] manual.pdf -- p.3".
# Parse the page NUMBER: a substring test for "p.3" never matches the spaced chip, and
# would accept "p.31" if it did.
_CITED_PAGE = re.compile(r"(?P<file>[^\s\u2014]+\.pdf)\b.*?\bp\.\s*(?P<page>\d+)\b", re.IGNORECASE)


def cited_pages(labels: list[str]) -> list[tuple[str, int]]:
    """(file, page) for every label that cites a PDF page."""
    found = []
    for t in labels:
        m = _CITED_PAGE.search(t)
        if m:
            found.append((m.group("file"), int(m.group("page"))))
    return found


def native_path(s: str) -> Path:
    """argparse type: accept Git-Bash `/c/...` paths and return a real Path.

    Normalized ONCE at the boundary. Doing it per-call-site is how you end up
    fixing the same FileNotFoundError in push(), sha256(), and open() separately.
    """
    p = Path(s)
    if p.exists():
        return p.resolve()
    m = re.match(r"^[/\\]([A-Za-z])[/\\](.*)$", s)
    if m:
        alt = Path(f"{m.group(1).upper()}:/{m.group(2)}")
        if alt.exists():
            return alt.resolve()
    return p


def pick_device(adb: str, allow_physical: bool) -> str:
    out = subprocess.run([adb, "devices"], capture_output=True, text=True,
                         encoding="utf-8", errors="replace").stdout
    devices = [
        line.split()[0]
        for line in out.splitlines()[1:]
        if line.strip() and line.split()[-1] == "device"
    ]
    if not devices:
        raise Fail("no adb devices. Start the emulator first (see run.sh)")

    emus = [d for d in devices if d.startswith("emulator-")]
    if emus:
        return emus[0]
    if allow_physical:
        print(f"WARNING: falling back to physical device {devices[0]}", file=sys.stderr)
        return devices[0]
    raise Fail(
        "only physical devices attached. This harness exists so real phones are not "
        "needed -- start an emulator, or pass --allow-physical if you truly mean it."
    )


def install(dev: Device, apk: Path, *, reinstall_physical: bool = False) -> None:
    log("install", f"{apk.name}")
    # A signature mismatch (debug vs release) makes -r fail with
    # INSTALL_FAILED_UPDATE_INCOMPATIBLE. Uninstall first: a fresh install is also the
    # more honest starting state, since it re-exercises the permission grant.
    # On a REAL phone that uninstall signs the owner out of a real account (#4455), so
    # it needs its own explicit opt-in on top of --allow-physical. A phone without the
    # app has nothing to lose: install it, still without an uninstall. If `pm path`
    # were wrong, a plain install replaces in place (same cert keeps the login) or
    # fails on a cert mismatch -- neither path signs anyone out.
    if not dev.serial.startswith("emulator-") and not reinstall_physical:
        if "package:" in dev.shell("pm", "path", PKG):
            raise Fail(
                f"refusing to uninstall {PKG} on physical device {dev.serial}: it signs the "
                "owner out of a real account. Pass --reinstall-physical if that is intended."
            )
    else:
        dev._run(["uninstall", PKG])
    r = dev._run(["install", str(apk)])
    if "Success" not in (r.stdout or "") + (r.stderr or ""):
        raise Fail(f"install failed: {r.stdout} {r.stderr}")
    dev.shell("svc", "power", "stayon", "usb")

    # Suppress ANR / crash dialogs outright. On a swiftshader emulator SystemUI and the
    # launcher ANR repeatedly under load; each dialog is a modal that blocks every
    # subsequent tap, and dismissing them reactively just burns the poll loop. This
    # removes the whole class. It suppresses the DIALOG, not the condition -- a genuine
    # app hang still shows up as a step timing out.
    dev.shell("settings", "put", "global", "hide_error_dialogs", "1")
    # Animations off: less GPU work on swiftshader, and no transition races.
    for scale in ("window_animation_scale", "transition_animation_scale",
                  "animator_duration_scale"):
        dev.shell("settings", "put", "global", scale, "0")


def launch(dev: Device) -> None:
    dev.shell("am", "force-stop", PKG)
    dev.launch_app()
    time.sleep(6)
    dev.dismiss_anr()


def sign_in(dev: Device, email: str, password: str) -> None:
    log("signin", email)
    # Generous: a cold emulator on swiftshader takes far longer to paint the WebView
    # than a real device, and will throw ANR dialogs while doing it -- dismissing one
    # drops you on the launcher, hence keep_foreground.
    dev.wait_for("Sign in", timeout=240, keep_foreground=True)
    dev.type_into("Email", email)
    # Password is masked, so read-back cannot verify the value. Assert on the outcome.
    pw = dev.input_for("Password")
    dev.tap(*pw.center)
    dev.type_text(password)
    dev.screenshot("signin-filled")
    dev.tap_button("Sign in")

    # The unified shell lands on HOME, which shows no account name; only the drawer
    # does. Wait for the shell, then read who is signed in from the drawer.
    deadline = time.time() + 60
    while dev.find("Open navigation", clickable=True) is None:
        if time.time() > deadline:
            dev.screenshot("signin-failed")
            raise Fail("sign-in did not complete -- check credentials, or the trial may be expired")
        time.sleep(3)
    dev.tap_button("Open navigation")
    try:
        dev.wait_for(email, timeout=20)
    except Fail:
        dev.screenshot("signin-wrong-account")
        raise Fail(f"signed in, but the drawer does not show {email} -- wrong account") from None
    dev.screenshot("signed-in")
    dev.tap_button("Close navigation")
    log("signin", "OK")


def create_notebook(dev: Device, name: str, mfr: str, model: str) -> None:
    log("notebook", name)
    # Unified shell: drawer -> "New project" -> one form. An empty manufacturer/model
    # is left blank, as a technician who only names the machine would.
    dev.tap_button("Open navigation")
    dev.tap_button("New project")
    dev.wait_for("Name the machine")
    for label, value in (("Name", name), ("Manufacturer", mfr), ("Model", model)):
        if value:
            dev.type_into(label, value)
            dev.hide_keyboard()  # conditional: a bare BACK would leave the form
    dev.screenshot("notebook-form")
    dev.tap_button("Create project")
    # The form's Name box holds the same string, so wait for the form to go first.
    dev.wait_for("Name the machine", timeout=60, absent=True)
    dev.wait_for(name, timeout=30)
    log("notebook", "created")


def upload_pdf(dev: Device, pdf: Path) -> None:
    log("upload", pdf.name)
    remote = f"{DEVICE_TMP}/{pdf.name}"
    dev.push(pdf, remote)

    local_sha = _sha256(pdf)
    device_sha = (dev.shell("sha256sum", remote).split() or [""])[0]
    if device_sha and device_sha != local_sha:
        raise Fail(f"sha256 mismatch after push: {device_sha} != {local_sha}")
    log("upload", f"sha256 verified {local_sha[:16]}...")
    dev.shell(
        "am",
        "broadcast",
        "-a",
        "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
        "-d",
        f"file://{remote}",
    )

    # Unified shell: "+" -> File -> system picker. The file rides on the NEXT message
    # and is read when that message is sent, so ask() is what proves ingest; there is
    # no separate "Searchable source" state to wait for here.
    dev.tap_button("Add attachment")
    dev.tap_button("File")
    # Exact match: the picker card also carries a "Preview the file <name>" button,
    # which opens a preview instead of choosing the file.
    deadline = time.time() + 60
    while (row := dev.find(pdf.name, exact=True)) is None:
        if time.time() > deadline:
            dev.screenshot("picker-missing-file")
            raise Fail(f"{pdf.name} is not listed in the file picker")
        time.sleep(2)
    dev.tap(*row.center)
    dev.wait_for("Pending attachments", timeout=60)
    if dev.find(pdf.name, exact=True) is None:
        raise Fail(f"picked {pdf.name}, but it is not attached to the message")
    dev.screenshot("source-attached")
    log("upload", "attached to the next message")


def ask(dev: Device, question: str, expect_page: int | None) -> str:
    log("ask", question)
    turns_before = dev.texts().count("MIRA")
    box = dev.bottom_edit_text()
    dev.tap(*box.center)
    dev.type_text(question)
    dev.screenshot("question-typed")
    dev.tap_button("Send", timeout=30)

    # Wait for a NEW MIRA turn that has settled -- it shows its source chip, or its
    # Copy action once it has finished without one. Count turns first: a thread can
    # already hold a finished answer whose chip and Copy would end the wait on it.
    deadline = time.time() + 180
    turn: list[str] = []
    while time.time() < deadline:
        labels = dev.texts()
        if labels.count("MIRA") > turns_before:
            turn = labels[len(labels) - labels[::-1].index("MIRA") :]
            if cited_pages(turn) or "Copy" in turn:
                break
        time.sleep(5)
    else:
        raise Fail("no answer rendered within 180s")

    dev.screenshot("answer")
    prose: list[str] = []
    for t in turn:
        if cited_pages([t]):
            break
        if not re.fullmatch(r"Citation \d+", t):
            prose.append(t.strip())
    answer = " ".join(p for p in prose if p)

    cites = cited_pages(turn)
    if not cites:
        raise Fail(f"answer is UNCITED -- grounding failure. Answer was: {answer[:300]}")
    log("ask", f"cited: {cites}")

    if expect_page is not None:
        if expect_page not in {page for _, page in cites}:
            raise Fail(f"expected a citation to p.{expect_page}, got {cites}")
        log("ask", f"expected page p.{expect_page} cited")
    return answer


def verify_citation(dev: Device, expect_page: int | None) -> str:
    log("citation", "opening sheet")
    chips = [
        n
        for n in dev.dump()
        if n.clickable
        and cited_pages([n.label])
        and (expect_page is None or cited_pages([n.label])[0][1] == expect_page)
    ]
    if not chips:
        raise Fail(f"no source chip citing {f'p.{expect_page}' if expect_page else 'a PDF'}")
    dev.tap(*chips[0].center)

    # The sheet names its source as "[1] manual.pdf -- p.3". Check that page too: the
    # chip and the passage it opens must agree.
    deadline = time.time() + 20
    while (
        header := next((t for t in dev.texts() if t.startswith("[") and cited_pages([t])), None)
    ) is None:
        if time.time() > deadline:
            dev.screenshot("citation-empty")
            raise Fail("citation sheet never opened")
        time.sleep(2)
    page = cited_pages([header])[0][1]
    if expect_page is not None and page != expect_page:
        raise Fail(f"chip cites p.{expect_page} but the sheet shows p.{page}: {header!r}")

    passage = ""
    for t in dev.texts():
        if t.startswith("“") or t.startswith('"') or "…" in t:
            if len(t) > len(passage):
                passage = t
    if not passage:
        dev.screenshot("citation-empty")
        raise Fail("citation sheet opened but rendered no passage")

    dev.screenshot("citation-sheet")
    log("citation", f"{header} -- passage: {passage[:110]}...")

    # Resolve the citation to the original document at that page. Android's WebView
    # cannot render PDF pages in-app, so the sheet confirms the fetch instead.
    dev.tap_button(f"Open original at cited page {page}", timeout=20)
    dev.wait_for("opened successfully", timeout=60)
    dev.screenshot("citation-original")
    log("citation", f"original opened at p.{page}")
    dev.tap_button("Close", timeout=20)
    return passage


def nameplate(dev: Device, image: Path | None) -> None:
    if image is None:
        log(
            "nameplate",
            "SKIP -- no --nameplate given. A synthetic image would not "
            "exercise real-photo OCR, so this is skipped, not faked.",
        )
        return
    log("nameplate", image.name)
    remote = f"{DEVICE_TMP}/{image.name}"
    dev.push(image, remote)
    dev.shell(
        "am",
        "broadcast",
        "-a",
        "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
        "-d",
        f"file://{remote}",
    )

    # Unified shell: "+" -> Photo opens the system photo picker ("Camera" is its own
    # entry beside it, so the old picker-instead-of-camera defect no longer applies).
    dev.tap_button("Add attachment")
    dev.tap_button("Photo")
    time.sleep(4)
    dev.screenshot("nameplate-picker")
    log("nameplate", "photo picker reached; select an image manually or extend this step")


def _sha256(p: Path) -> str:
    import hashlib

    h = hashlib.sha256()
    with p.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# --------------------------------------------------------------------------- main


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apk", type=native_path, required=True)
    ap.add_argument("--pdf", type=native_path, required=True,
                    help="Manual to upload. Use a FRESH sha256 -- an already-ingested "
                         "file deduplicates and proves nothing.")
    ap.add_argument("--question", required=True, help="No '?' -- see type_text()")
    ap.add_argument("--expect-page", type=int, default=None,
                    help="Page the answer must cite. Read it out of the PDF FIRST so "
                         "you are checking the answer, not trusting it.")
    ap.add_argument("--nameplate", type=native_path, default=None)
    ap.add_argument("--notebook-name", default=None)
    ap.add_argument("--manufacturer", default="Danfoss", help="'' leaves it blank")
    ap.add_argument("--model", default="FC 202", help="'' leaves it blank")
    ap.add_argument("--outdir", type=Path,
                    default=Path("docs/promo-screenshots/mobile-e2e"))
    ap.add_argument("--adb", default=os.environ.get(
        "ADB", str(Path.home() / "AppData/Local/Android/Sdk/platform-tools/adb.exe")))
    ap.add_argument("--allow-physical", action="store_true")
    ap.add_argument(
        "--reinstall-physical",
        action="store_true",
        help="On a physical device, also allow the uninstall-then-install (signs the owner out).",
    )
    ap.add_argument(
        "--stop-after",
        choices=["signin", "notebook", "upload", "ask", "citation", "nameplate"],
        default="nameplate",
        help="Stop early. Use 'signin' to smoke-test the harness itself without "
             "writing a notebook or uploading anything to a real tenant.",
    )
    args = ap.parse_args()

    stages = ["signin", "notebook", "upload", "ask", "citation", "nameplate"]
    last = stages.index(args.stop_after)

    def wanted(stage: str) -> bool:
        return stages.index(stage) <= last

    email = os.environ.get("FLM_EMAIL")
    password = os.environ.get("FLM_PASSWORD")
    if not email or not password:
        print("FLM_EMAIL and FLM_PASSWORD must be set in the environment.", file=sys.stderr)
        print("Never hardcode them; never commit them.", file=sys.stderr)
        return 2

    stamp = time.strftime("%Y-%m-%d")
    name = args.notebook_name or " ".join(
        p for p in ("E2E", stamp, args.manufacturer, args.model) if p
    )

    try:
        serial = pick_device(args.adb, args.allow_physical)
        log("device", serial)
        dev = Device(args.adb, serial, args.outdir)

        install(dev, args.apk, reinstall_physical=args.reinstall_physical)
        launch(dev)
        sign_in(dev, email, password)
        if wanted("notebook"):
            create_notebook(dev, name, args.manufacturer, args.model)
        if wanted("upload"):
            upload_pdf(dev, args.pdf)
        if wanted("ask"):
            ask(dev, args.question, args.expect_page)
        if wanted("citation"):
            verify_citation(dev, args.expect_page)
        if wanted("nameplate"):
            nameplate(dev, args.nameplate)
    except Fail as exc:
        print(f"\nFAIL: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130

    if args.stop_after != "nameplate":
        print(f"\nPARTIAL PASS -- stopped after '{args.stop_after}' as requested. "
              "This is NOT a full journey verification.")
        print(f"Evidence: {args.outdir}")
        return 0

    print("\nPASS -- grounded chain verified end to end.")
    print(f"Evidence: {args.outdir}")
    print("NOT covered (needs real hardware): cellular, camera capture, "
          "release-signed Play identity.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

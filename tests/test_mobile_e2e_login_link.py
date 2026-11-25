"""#4462: the mobile-e2e harness signs in a passwordless stranger and runs off Windows.

Verified onboarding makes a fresh stranger passwordless, so a password-only
`sign_in` cannot sign one in (#5942). The app's sign-in screen accepts a one-time
`/magic/?token=<uuid>` link in its invitation mode; the harness takes that link from
`FLM_LOGIN_LINK` and types it there. The link carries a `?`, which the device shell
globs unless the argument is quoted, and it is a credential, so it never reaches a log.

Also: `journey.py`'s default adb was a Windows AppData path, and `run.sh` built the
APK without the web bundle or a JDK 21 check (Capacitor 8 needs 21; 17 fails deep in
gradle). Those are pinned here too.
"""

from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
from pathlib import Path
from xml.sax.saxutils import quoteattr

import pytest

ROOT = Path(__file__).resolve().parents[1]
JOURNEY = ROOT / "tools" / "mobile-e2e" / "journey.py"
RUN_SH = ROOT / "tools" / "mobile-e2e" / "run.sh"
PKG = "com.factorylm.mira.staging"
EMAIL = "e2e-link-test@factorylm.com"
TOKEN = "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c"
LINK = f"https://app-staging.factorylm.com/magic/?token={TOKEN}"


def _load(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MIRA_PKG", PKG)
    name = "mobile_e2e_journey_link_under_test"
    spec = importlib.util.spec_from_file_location(name, JOURNEY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


class _Clock:
    def __init__(self) -> None:
        self.t = 0.0

    def time(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.t += s


class _Proc:
    def __init__(self, out: str = "") -> None:
        self.stdout, self.stderr, self.returncode = out, "", 0


def _device_shell_arg(arg: str) -> str:
    """What the device's sh hands `input` for one argument adb joined into its command.

    Single quotes are removed. An unquoted `?` is a glob: it matches a one-character
    file name in the shell's working directory, so the typed text is not what was sent.
    The fake refuses it rather than guess which file would have matched.
    """
    if len(arg) >= 2 and arg[0] == arg[-1] == "'":
        return arg[1:-1]
    if "?" in arg or "*" in arg:
        raise AssertionError(f"unquoted glob reached the device shell: {arg!r}")
    return arg


class SignInPhone:
    """The app's sign-in screen with its invitation mode, behind a fake adb."""

    def __init__(
        self, *, account: str = EMAIL, link_works: bool = True, garble: bool = False
    ) -> None:
        self.state = "password"
        self.account, self.link_works = account, link_works
        self.garble = garble  # the field drops the first character it was sent
        self.fields = {"email": "", "password": "", "link": ""}
        self.focus: str | None = None
        self.kbd = self.drawer = False
        self.exchanged: list[str] = []
        self.taps: list[str] = []

    def nodes(self) -> list[tuple]:
        f = self.fields
        if self.state == "password":
            return [
                ("Sign in", "TextView", (78, 332, 1002, 382), False, None),
                ("Email", "View", (78, 408, 1002, 453), False, None),
                (f["email"], "EditText", (78, 461, 1002, 579), True, ("focus", "email")),
                ("Password", "View", (78, 608, 1002, 650), False, None),
                ("", "EditText", (78, 658, 1002, 776), True, ("focus", "password")),
                ("Sign in", "Button", (78, 810, 1002, 928), True, ("signin",)),
                (
                    "Have an invitation link instead? No password needed",
                    "Button",
                    (78, 960, 1002, 1030),
                    True,
                    ("mode", "invite"),
                ),
            ]
        if self.state == "invite":
            return [
                ("Use an invitation link", "TextView", (78, 332, 1002, 382), False, None),
                (
                    "No password needed — paste the invitation link from your invite email "
                    "and we'll sign you in.",
                    "TextView",
                    (78, 400, 1002, 500),
                    False,
                    None,
                ),
                ("Invitation link", "View", (78, 520, 1002, 560), False, None),
                (
                    (f["link"][1:] if self.garble else f["link"])
                    or "https://app.factorylm.com/hub/magic?token=…",
                    "EditText",
                    (78, 570, 1002, 760),
                    True,
                    ("focus", "link"),
                ),
                ("Use invite link", "Button", (78, 790, 1002, 900), True, ("exchange",)),
            ]
        n = [("Open navigation", "Button", (28, 149, 147, 267), True, ("drawer", True))]
        if self.drawer:
            n += [
                ("Close navigation", "Button", (595, 170, 714, 288), True, ("drawer", False)),
                (self.account, "TextView", (42, 1955, 714, 1994), False, None),
            ]
        return n

    def xml(self) -> str:
        rows = "".join(
            f'<node text={quoteattr(lbl)} content-desc="" class="android.widget.{cls}" '
            f'bounds="[{b[0]},{b[1]}][{b[2]},{b[3]}]" clickable="{"true" if c else "false"}" />'
            for lbl, cls, b, c, _ in self.nodes()
        )
        return f"<?xml version='1.0' encoding='UTF-8'?><hierarchy>{rows}</hierarchy>"

    def run(self, args: list[str], **_kw) -> _Proc:
        a = args[1:]
        if a[:2] == ["cat", "/sdcard/window_dump.xml"]:
            return _Proc(self.xml())
        if a[:2] == ["input", "tap"]:
            self.tap(int(a[2]), int(a[3]))
        elif a[:2] == ["input", "text"] and self.focus:
            self.fields[self.focus] += _device_shell_arg(a[2]).replace("%s", " ")
        elif a[:2] == ["input", "keyevent"]:
            if a[2] == "4":
                self.kbd = False
            elif a[2] == "123" and self.focus:
                self.fields[self.focus] = ""
        elif a[:2] == ["dumpsys", "input_method"]:
            return _Proc(f"mInputShown={'true' if self.kbd else 'false'}")
        elif a[:2] == ["dumpsys", "activity"]:
            return _Proc(f"topResumedActivity=ActivityRecord{{1 u0 {PKG}/.Main t1}}")
        return _Proc()

    def tap(self, x: int, y: int) -> None:
        for lbl, _cls, b, clickable, action in reversed(self.nodes()):
            if clickable and b[0] <= x <= b[2] and b[1] <= y <= b[3]:
                self.taps.append(lbl)
                if action:
                    self.act(*action)
                return
        self.taps.append(f"<nothing at {x},{y}>")

    def act(self, kind: str, *arg) -> None:
        if kind == "focus":
            self.focus, self.kbd = arg[0], True
        elif kind == "mode":
            self.state, self.focus = arg[0], None
        elif kind == "signin" and self.fields["email"] and self.fields["password"]:
            self.state, self.focus, self.kbd = "home", None, False
        elif kind == "exchange":
            self.exchanged.append(self.fields["link"])
            if self.link_works and self.fields["link"] == LINK:
                self.state, self.focus, self.kbd = "home", None, False
        elif kind == "drawer":
            self.drawer = arg[0]


@pytest.fixture
def rig(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.setattr(journey, "time", _Clock())

    def make(**kw):
        phone = SignInPhone(**kw)
        dev = journey.Device("adb", "emulator-5554", tmp_path / "shots")
        monkeypatch.setattr(dev, "_run", phone.run)
        monkeypatch.setattr(dev, "screenshot", lambda name: tmp_path / f"{name}.png")
        return journey, dev, phone

    return make


# ------------------------------------------------------------------ login link


def test_sign_in_with_a_login_link_uses_the_invitation_mode(rig):
    journey, dev, phone = rig()
    journey.sign_in(dev, EMAIL, login_link=LINK)
    assert phone.exchanged == [LINK], "the link must reach the field exactly, ? and all"
    assert phone.fields["password"] == "", "the link path must not touch the password box"
    assert "Close navigation" in phone.taps, "the account check still runs"


def test_sign_in_with_a_login_link_still_checks_the_account(rig):
    journey, dev, _phone = rig(account="someone-else@factorylm.com")
    with pytest.raises(journey.Fail, match="wrong account"):
        journey.sign_in(dev, EMAIL, login_link=LINK)


def test_a_rejected_login_link_fails_without_printing_it(rig, capsys):
    journey, dev, _phone = rig(link_works=False)
    with pytest.raises(journey.Fail) as err:
        journey.sign_in(dev, EMAIL, login_link=LINK)
    out = capsys.readouterr()
    assert TOKEN not in str(err.value)
    assert TOKEN not in out.out + out.err


def test_a_link_the_field_garbles_fails_without_printing_it(rig, capsys):
    # The read-back retry path: its log line and its Fail both describe the value.
    journey, dev, _phone = rig(garble=True)
    with pytest.raises(journey.Fail, match="would not accept") as err:
        journey.sign_in(dev, EMAIL, login_link=LINK)
    out = capsys.readouterr()
    assert TOKEN not in str(err.value)
    assert TOKEN not in out.out + out.err
    assert "retry 3/3" in out.out, "precondition: the retry path actually ran"


def test_password_sign_in_still_works(rig):
    # Control: the password path is unchanged and never opens the invitation mode.
    journey, dev, phone = rig()
    journey.sign_in(dev, EMAIL, "not-a-real-secret")
    assert phone.exchanged == []
    assert phone.fields["password"] == "not-a-real-secret"


def test_sign_in_needs_exactly_one_credential(rig):
    journey, dev, _phone = rig()
    with pytest.raises(journey.Fail, match="exactly one"):
        journey.sign_in(dev, EMAIL)
    with pytest.raises(journey.Fail, match="exactly one"):
        journey.sign_in(dev, EMAIL, "pw", login_link=LINK)


def test_main_accepts_a_login_link_without_a_password(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.setenv("FLM_EMAIL", EMAIL)
    monkeypatch.delenv("FLM_PASSWORD", raising=False)
    monkeypatch.setenv("FLM_LOGIN_LINK", LINK)
    seen: dict = {}

    def fake_sign_in(dev, email, password=None, *, login_link=None):
        seen.update(email=email, password=password, link=login_link)

    monkeypatch.setattr(journey, "pick_device", lambda adb, allow: "emulator-5554")
    monkeypatch.setattr(journey, "install", lambda *a, **k: None)
    monkeypatch.setattr(journey, "launch", lambda dev: None)
    monkeypatch.setattr(journey, "sign_in", fake_sign_in)
    apk, pdf = tmp_path / "a.apk", tmp_path / "m.pdf"
    apk.write_bytes(b"x")
    pdf.write_bytes(b"x")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "journey.py",
            "--apk",
            str(apk),
            "--pdf",
            str(pdf),
            "--question",
            "q",
            "--adb",
            "adb",
            "--stop-after",
            "signin",
            "--outdir",
            str(tmp_path / "o"),
        ],
    )
    assert journey.main() == 0
    assert seen == {"email": EMAIL, "password": None, "link": LINK}


def test_main_refuses_without_any_credential(monkeypatch, tmp_path, capsys):
    journey = _load(monkeypatch)
    monkeypatch.setenv("FLM_EMAIL", EMAIL)
    monkeypatch.delenv("FLM_PASSWORD", raising=False)
    monkeypatch.delenv("FLM_LOGIN_LINK", raising=False)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "journey.py",
            "--apk",
            "a.apk",
            "--pdf",
            "m.pdf",
            "--question",
            "q",
            "--adb",
            "adb",
        ],
    )
    assert journey.main() == 2
    assert "FLM_LOGIN_LINK" in capsys.readouterr().err


# ------------------------------------------------------------------ adb default


@pytest.mark.parametrize(
    ("platform", "expected"),
    [
        ("darwin", "platform-tools/adb"),
        ("linux", "platform-tools/adb"),
        ("win32", "platform-tools/adb.exe"),
    ],
)
def test_default_adb_comes_from_the_sdk_root(monkeypatch, tmp_path, platform, expected):
    journey = _load(monkeypatch)
    monkeypatch.delenv("ADB", raising=False)
    monkeypatch.delenv("ANDROID_HOME", raising=False)
    monkeypatch.setenv("ANDROID_SDK_ROOT", str(tmp_path / "sdk"))
    monkeypatch.setattr(journey.sys, "platform", platform)
    assert journey.default_adb() == str(tmp_path / "sdk" / expected)


def test_default_adb_prefers_an_explicit_adb(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.setenv("ADB", "/opt/custom/adb")
    monkeypatch.setenv("ANDROID_SDK_ROOT", str(tmp_path / "sdk"))
    assert journey.default_adb() == "/opt/custom/adb"


# ------------------------------------------------------------------ run.sh build


def _exe(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("#!/bin/bash\n" + body)
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


def _run_sh_with_java(tmp_path: Path, java_version: str) -> subprocess.CompletedProcess:
    """run.sh with a fake SDK (an emulator already up), no APK, and a fake `java`."""
    sdk, bin_dir = tmp_path / "sdk", tmp_path / "bin"
    _exe(
        sdk / "platform-tools" / "adb",
        'if [ "$1" = devices ]; then printf "List\\nemulator-5554\\tdevice\\n"; fi\n',
    )
    _exe(sdk / "emulator" / "emulator", "exit 0\n")
    _exe(bin_dir / "java", f"echo 'openjdk version \"{java_version}\" 2024-01-16' >&2\n")
    # macOS java_home finds no other JDK; the build must not proceed on the wrong one.
    _exe(bin_dir / "java_home_stub", "exit 1\n")
    mobile = tmp_path / "mobile"  # no APK and no node_modules: the build is attempted
    mobile.mkdir()
    env = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "HOME": str(tmp_path),
        "ANDROID_SDK_ROOT": str(sdk),
        "MIRA_MOBILE_DIR": str(mobile),
        "MIRA_JAVA_HOME_CMD": str(bin_dir / "java_home_stub"),
    }
    return subprocess.run(
        ["bash", str(RUN_SH), "m.pdf", "question", "1"],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )


def test_run_sh_stops_before_gradle_on_a_jdk_older_than_21(tmp_path):
    r = _run_sh_with_java(tmp_path, "17.0.10")
    assert r.returncode == 2, r.stdout + r.stderr
    assert "JDK 21" in r.stderr
    assert "building staging debug APK" not in r.stdout, "the check must run before the build"


def test_run_sh_accepts_jdk_21_and_reaches_the_build(tmp_path):
    # Control: with JDK 21 the check passes and run.sh goes on to build (which then
    # fails here, since the fake repo has no node_modules -- but not on the JDK check).
    r = _run_sh_with_java(tmp_path, "21.0.5")
    assert "JDK 21" not in r.stderr, r.stderr
    assert "building staging debug APK" in r.stdout


def test_run_sh_builds_the_web_bundle_before_cap_sync():
    text = RUN_SH.read_text()
    build = text.index("vite build")
    sync = text.index("capacitor sync android")
    assert build < sync, "cap sync copies dist/; it must exist and be current first"


def test_run_sh_is_executable_by_bash_without_syntax_errors():
    r = subprocess.run(["bash", "-n", str(RUN_SH)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert os.access(RUN_SH, os.R_OK)

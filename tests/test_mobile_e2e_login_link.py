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
    def __init__(self, out: str = "", rc: int = 0) -> None:
        self.stdout, self.stderr, self.returncode = out, "", rc


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
        self.interrupt = False  # Ctrl-C lands while the link is being exchanged
        self.projects: list[str] = []  # drawer rows above the account footer
        self.rm_fails = False  # the device stops answering: cleanup cannot run
        self.files: dict[str, str] = {}  # device path -> contents of a view dump there
        self.dirs: set[str] = set()
        self.wrote: list[tuple[str, str]] = []  # every dump the device ever wrote
        self.adb_calls: list[list[str]] = []
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
            ]
            n += [(t, "TextView", (42, 600 + 80 * i, 714, 660 + 80 * i), True, None)
                  for i, t in enumerate(self.projects)]
            # The real footer (UnifiedRoot navigationFooter): the account line, then
            # "About & updates", then "Sign out".
            n += [
                (self.account, "TextView", (42, 1955, 714, 1994), False, None),
                ("About & updates", "Button", (42, 2010, 714, 2100), True, None),
                ("Sign out", "Button", (42, 2110, 714, 2200), True, None),
            ]
        return n

    def xml(self) -> str:
        rows = "".join(
            f'<node text={quoteattr(lbl)} content-desc="" class="android.widget.{cls}" '
            f'bounds="[{b[0]},{b[1]}][{b[2]},{b[3]}]" clickable="{"true" if c else "false"}" />'
            for lbl, cls, b, c, _ in self.nodes()
        )
        return f"<?xml version='1.0' encoding='UTF-8'?><hierarchy>{rows}</hierarchy>"

    @property
    def dumpfile(self) -> str:
        """Every dump still on the device, concatenated."""
        return "".join(self.files.values())

    def shared_ever_held(self, secret: str) -> bool:
        return any(p.startswith("/sdcard") and secret in x for p, x in self.wrote)

    def link_on_screen(self) -> bool:
        return self.state == "invite" and bool(self.fields["link"])

    def run(self, args: list[str], **_kw) -> _Proc:
        self.adb_calls.append(list(args))
        a = args[1:]
        if a[:2] == ["uiautomator", "dump"]:
            self.files[a[2]] = self.xml()
            self.wrote.append((a[2], self.files[a[2]]))
        elif a[:3] == ["mkdir", "-m", "700"]:
            fresh = a[3] not in self.dirs
            self.dirs.add(a[3])
            if "&&" in a:
                return _Proc("OK" if fresh else "", 0 if fresh else 1)
        elif a[:1] == ["rmdir"]:
            self.dirs.discard(a[1])
        elif a[:2] == ["test", "-d"]:
            return _Proc("OK" if a[2] in self.dirs else "")
        elif a[:2] in (["rm", "-f"], ["rm", "-rf"]):
            if self.rm_fails:
                return _Proc("", 1)
            self.files = {k: v for k, v in self.files.items() if not (k == a[2] or k.startswith(a[2] + "/"))}
            self.dirs.discard(a[2])
        elif a[:2] == ["test", "-e"]:
            if self.rm_fails:
                return _Proc("", 1)
            present = a[2] in self.dirs or any(k == a[2] or k.startswith(a[2] + "/") for k in self.files)
            return _Proc("PRESENT" if present else "GONE")
        elif a[:1] == ["cat"]:
            return _Proc(self.files.get(a[1], ""))
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
            if self.interrupt:
                raise KeyboardInterrupt
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
        phone.shots = []  # (name, whether the link was on screen when it was taken)

        def shot(name):
            phone.shots.append((name, phone.link_on_screen()))
            return tmp_path / f"{name}.png"

        monkeypatch.setattr(dev, "screenshot", shot)
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


# Codex r1 F1: the link is a live credential until it is exchanged. No screenshot
# may capture it, and no view-hierarchy dump holding it may stay on the device.


def _no_credential_left(phone) -> None:
    leaked = [name for name, on_screen in phone.shots if on_screen]
    assert leaked == [], f"screenshots taken with the link on screen: {leaked}"
    assert TOKEN not in phone.dumpfile, "a dump holding the link was left on the device"
    # Codex r3 F1: shared storage must never receive it, not even briefly.
    assert not phone.shared_ever_held(TOKEN), "the link was dumped to shared storage"
    # Codex r4 F1: no dump goes to shared storage at all, so a second run on the
    # same device cannot put this one's screen there either.
    assert phone.wrote and all(p.startswith("/data/local/tmp/") for p, _ in phone.wrote), phone.wrote
    private = [c for c in phone.adb_calls if c[1:4] == ["mkdir", "-m", "700"]]
    assert private and private[0][4].startswith("/data/local/tmp/"), private


def test_a_successful_link_sign_in_leaves_no_credential_behind(rig):
    journey, dev, phone = rig()
    journey.sign_in(dev, EMAIL, login_link=LINK)
    assert phone.shots, "precondition: the run still takes its evidence screenshots"
    _no_credential_left(phone)


def test_a_rejected_link_leaves_no_credential_behind(rig):
    # Rejected: the invite screen still shows the link, and the token may still work.
    journey, dev, phone = rig(link_works=False)
    with pytest.raises(journey.Fail):
        journey.sign_in(dev, EMAIL, login_link=LINK)
    assert phone.state == "invite" and phone.fields["link"] == LINK, "precondition"
    _no_credential_left(phone)


def test_an_interrupted_link_sign_in_leaves_no_credential_behind(rig):
    journey, dev, phone = rig()
    phone.interrupt = True
    with pytest.raises(KeyboardInterrupt):
        journey.sign_in(dev, EMAIL, login_link=LINK)
    assert phone.fields["link"] == LINK, "precondition: the link was typed"
    _no_credential_left(phone)


def test_a_link_sign_in_fails_loudly_when_the_dump_cannot_be_removed(rig):
    # Codex r2 F1: the link is rejected (so it stays on screen, and in the dump),
    # then the device stops answering. The cleanup must not be assumed to have worked.
    journey, dev, phone = rig(link_works=False)
    phone.rm_fails = True
    with pytest.raises(journey.Fail, match="could not confirm"):
        journey.sign_in(dev, EMAIL, login_link=LINK)
    assert TOKEN in phone.dumpfile, "precondition: the dump really was left behind"
    # ...but only in the shell-private directory, never in shared storage.
    assert not phone.shared_ever_held(TOKEN)
    assert TOKEN not in str(phone.adb_calls[-1]), "the failure path must not echo the link"


def test_password_sign_in_still_works(rig):
    # Control: the password path is unchanged and never opens the invitation mode.
    journey, dev, phone = rig()
    journey.sign_in(dev, EMAIL, "not-a-real-secret")
    assert phone.exchanged == []
    assert phone.fields["password"] == "not-a-real-secret"


def test_sign_in_rejects_an_account_whose_email_merely_contains_the_expected_one(rig):
    # Codex r1 F5: "other-e2e-link-test@..." contains "e2e-link-test@...".
    journey, dev, _phone = rig(account=f"other-{EMAIL}")
    with pytest.raises(journey.Fail, match="wrong account"):
        journey.sign_in(dev, EMAIL, login_link=LINK)


def test_sign_in_accepts_the_exact_account_in_another_case(rig):
    # Control: the same address, cased differently, is the same account.
    journey, dev, phone = rig(account=EMAIL.upper())
    journey.sign_in(dev, EMAIL, login_link=LINK)
    assert "Close navigation" in phone.taps


def test_sign_in_reads_the_account_from_the_footer_not_a_project_title(rig):
    # Codex r2 F5: another account is signed in, and one of its projects is titled
    # with the expected email. Only the footer's account line counts.
    journey, dev, phone = rig(account="someone-else@factorylm.com")
    phone.projects = [EMAIL]
    with pytest.raises(journey.Fail, match="wrong account"):
        journey.sign_in(dev, EMAIL, login_link=LINK)


def test_sign_in_finds_the_footer_account_below_project_rows(rig):
    # Control: the right account, with projects listed above the footer.
    journey, dev, phone = rig()
    phone.projects = ["Line 3 press", "someone-else@factorylm.com"]
    journey.sign_in(dev, EMAIL, login_link=LINK)
    assert "Close navigation" in phone.taps


def test_sign_in_is_not_fooled_by_a_conversation_named_like_the_footer(rig):
    # Codex r3 F5: two drawer rows, the expected email then "About & updates",
    # above a footer that shows another account.
    journey, dev, phone = rig(account="someone-else@factorylm.com")
    phone.projects = [EMAIL, "About & updates"]
    with pytest.raises(journey.Fail, match="wrong account"):
        journey.sign_in(dev, EMAIL, login_link=LINK)


def test_sign_in_rejects_a_chat_title_when_the_footer_shows_no_email(rig):
    # Codex r4 F5: the footer's email line is missing; the last conversation row is
    # titled with the expected address. Rows are buttons; the footer line is not.
    journey, dev, phone = rig(account="")
    phone.projects = ["Line 3 press", EMAIL]
    with pytest.raises(journey.Fail, match="wrong account"):
        journey.sign_in(dev, EMAIL, login_link=LINK)


# ------------------------------------------------------------------ device lock
# Codex r4 F1: two runs on one emulator would read and dump each other's screens.


def test_a_second_run_on_the_same_device_is_refused_before_it_dumps(rig):
    journey, dev, phone = rig()
    dev.claim()
    other = journey.Device("adb", "emulator-5554", dev.outdir)
    other._run = phone.run  # the same device
    dumps_before = len(phone.wrote)
    with pytest.raises(journey.Fail, match="another mobile-e2e run holds"):
        other.claim()
    assert len(phone.wrote) == dumps_before
    assert "/data/local/tmp/mira-e2e.lock" in phone.dirs, "precondition: the first run holds it"


def test_release_frees_the_device_and_removes_what_the_run_left(rig, tmp_path):
    journey, dev, phone = rig()
    dev.claim()
    pdf = tmp_path / "m.pdf"
    pdf.write_bytes(b"%PDF-1.4 x")
    dev.push(pdf, "/sdcard/Download/m-1a2b3c4d.pdf")
    dev.dump()
    dev.release()
    assert ["rm", "-f", "/sdcard/Download/m-1a2b3c4d.pdf"] in [c[1:4] for c in phone.adb_calls]
    assert not phone.files, f"dumps left on the device: {list(phone.files)}"
    # Control: the device can be claimed again.
    again = journey.Device("adb", "emulator-5554", dev.outdir)
    again._run = phone.run
    again.claim()
    assert "/data/local/tmp/mira-e2e.lock" in phone.dirs


def test_main_releases_the_device_when_a_stage_fails(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.setenv("FLM_EMAIL", EMAIL)
    monkeypatch.setenv("FLM_LOGIN_LINK", LINK)
    order: list[str] = []

    class _Dev:
        def __init__(self, *a):
            pass

        def claim(self):
            order.append("claim")

        def release(self):
            order.append("release")

    def boom(*a, **k):
        order.append("install")
        raise journey.Fail("install broke")

    monkeypatch.setattr(journey, "pick_device", lambda *a: "emulator-5554")
    monkeypatch.setattr(journey, "Device", _Dev)
    monkeypatch.setattr(journey, "install", boom)
    monkeypatch.setattr(sys, "argv", ["journey.py", "--apk", str(tmp_path / "a.apk"),
                                      "--pdf", str(tmp_path / "m.pdf"), "--question", "q"])
    assert journey.main() == 1
    assert order == ["claim", "install", "release"]


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
    # The device lock has its own tests; no device is attached here.
    monkeypatch.setattr(journey.Device, "claim", lambda self: None)
    monkeypatch.setattr(journey.Device, "release", lambda self: None)
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


# ------------------------------------------------------------------ child env
# Codex r3 F1: adb (whose server outlives the run), screencap and aapt2 must not
# inherit the credential.


def test_no_child_process_inherits_the_credential(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.setenv("FLM_LOGIN_LINK", LINK)
    monkeypatch.setenv("FLM_PASSWORD", "not-a-real-secret")
    monkeypatch.setenv("AAPT2", "aapt2")
    seen: list[dict] = []

    class _Done:
        def __init__(self, out):
            self.returncode, self.stdout, self.stderr = 0, out, ""

    def fake_run(args, **kw):
        seen.append(kw.get("env") or dict(__import__("os").environ))
        return _Done(b"" if "screencap" in args else "package\nList of devices attached\n")

    monkeypatch.setattr(journey.subprocess, "run", fake_run)
    dev = journey.Device("adb", "emulator-5554", tmp_path / "shots")
    dev.shell("echo", "hi")
    dev.screenshot("x")
    journey.apk_package(tmp_path / "a.apk", "adb")
    try:
        journey.pick_device("adb", False)
    except journey.Fail:
        pass  # no device listed: the call still happened
    assert len(seen) == 4, seen
    for env in seen:
        assert "FLM_LOGIN_LINK" not in env and "FLM_PASSWORD" not in env
        assert env.get("PATH"), "the rest of the environment is kept"


# ------------------------------------------------------------------ apk package
# Codex r1 F3: installing one flavour and then driving another package must fail
# before anything on the device changes.


def test_install_refuses_an_apk_for_another_package_before_touching_the_device(rig, monkeypatch):
    journey, dev, phone = rig()
    monkeypatch.setattr(journey, "apk_package", lambda apk, adb: "com.factorylm.mira")
    with pytest.raises(journey.Fail, match="com.factorylm.mira.staging"):
        journey.install(dev, Path("app-release.apk"))
    assert phone.adb_calls == [], f"device touched: {phone.adb_calls}"


def test_install_proceeds_when_the_apk_is_the_target_package(rig, monkeypatch):
    # Control.
    journey, dev, phone = rig()
    monkeypatch.setattr(journey, "apk_package", lambda apk, adb: PKG)
    with pytest.raises(journey.Fail, match="install failed"):  # the fake prints no Success
        journey.install(dev, Path("app-staging-debug.apk"))
    assert ["uninstall", PKG] in phone.adb_calls


def test_find_aapt2_takes_the_newest_build_tools(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.delenv("AAPT2", raising=False)
    sdk = tmp_path / "sdk"
    for v in ("9.0.0", "35.0.0", "36.0.0"):
        _exe(sdk / "build-tools" / v / "aapt2", "exit 0\n")
    _exe(sdk / "platform-tools" / "adb", "exit 0\n")
    assert journey.find_aapt2(str(sdk / "platform-tools" / "adb")) == str(
        sdk / "build-tools" / "36.0.0" / "aapt2"
    )


def test_apk_package_fails_closed_without_aapt2(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.delenv("AAPT2", raising=False)
    adb = tmp_path / "sdk" / "platform-tools" / "adb"
    _exe(adb, "exit 0\n")
    with pytest.raises(journey.Fail, match="cannot verify"):
        journey.apk_package(tmp_path / "a.apk", str(adb))


def test_apk_package_reads_aapt2(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    aapt2 = tmp_path / "aapt2"
    _exe(aapt2, f'[ "$1 $2" = "dump packagename" ] && echo {PKG}\n')
    monkeypatch.setenv("AAPT2", str(aapt2))
    assert journey.apk_package(tmp_path / "a.apk", "adb") == PKG


def test_run_sh_refuses_a_non_staging_package_before_touching_adb(tmp_path):
    sdk, log = tmp_path / "sdk", tmp_path / "adb.log"
    _exe(sdk / "platform-tools" / "adb", f'echo "$@" >> {log}\n')
    env = {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path), "ANDROID_SDK_ROOT": str(sdk),
           "MIRA_PKG": "com.factorylm.mira"}
    r = subprocess.run(["bash", str(RUN_SH), "m.pdf", "q", "1"], capture_output=True,
                       text=True, env=env, timeout=60)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "com.factorylm.mira.staging" in r.stderr
    assert not log.exists(), "adb was called"


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


def test_run_sh_hands_gradle_the_jdk_it_approved(tmp_path):
    # Codex r1 F4: JAVA_HOME names a JDK 17, PATH has a 21. The wrapper prefers
    # JAVA_HOME, so approving PATH's 21 must not leave gradle on JAVA_HOME's 17.
    sdk, bin_dir, mobile = tmp_path / "sdk", tmp_path / "bin", tmp_path / "mobile"
    _exe(sdk / "platform-tools" / "adb",
         'if [ "$1" = devices ]; then printf "List\\nemulator-5554\\tdevice\\n"; fi\n')
    _exe(sdk / "emulator" / "emulator", "exit 0\n")
    _exe(bin_dir / "java", "echo 'openjdk version \"21.0.5\" 2024' >&2\n")
    _exe(bin_dir / "node", "exit 0\n")
    jdk17 = tmp_path / "jdk17"
    _exe(jdk17 / "bin" / "java", "echo 'openjdk version \"17.0.10\" 2024' >&2\n")
    _exe(mobile / "node_modules" / ".bin" / "vite", "exit 0\n")
    # Resolves java the way the real gradlew does: JAVA_HOME first, else PATH.
    _exe(mobile / "android" / "gradlew",
         'J=java; [ -n "${JAVA_HOME:-}" ] && J="$JAVA_HOME/bin/java"\n'
         'echo "GRADLE_JAVA=$("$J" -version 2>&1 | sed -nE \'s/.*version "([0-9]+).*/\\1/p\')"\n')
    _exe(bin_dir / "java_home_stub", "exit 1\n")
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path),
           "ANDROID_SDK_ROOT": str(sdk), "MIRA_MOBILE_DIR": str(mobile),
           "MIRA_JAVA_HOME_CMD": str(bin_dir / "java_home_stub"), "JAVA_HOME": str(jdk17)}
    r = subprocess.run(["bash", str(RUN_SH), "m.pdf", "q", "1"], capture_output=True,
                       text=True, env=env, timeout=60)
    assert "GRADLE_JAVA=" in r.stdout, "precondition: gradle ran\n" + r.stdout + r.stderr
    assert "GRADLE_JAVA=21" in r.stdout, r.stdout


def _run_sh_gradle(tmp_path: Path, *, path_java: str | None, java_home: str | None,
                   brew_java: str | None) -> subprocess.CompletedProcess:
    """run.sh up to gradle. Each JDK candidate is a version string, or None for none.

    `path_java="fail"` is the macOS /usr/bin/java shim with no JDK registered: it is
    executable, prints nothing on stdout, and exits 1.
    """
    sdk, bin_dir, mobile = tmp_path / "sdk", tmp_path / "bin", tmp_path / "mobile"
    _exe(sdk / "platform-tools" / "adb",
         'if [ "$1" = devices ]; then printf "List\\nemulator-5554\\tdevice\\n"; fi\n')
    _exe(sdk / "emulator" / "emulator", "exit 0\n")
    _exe(bin_dir / "node", "exit 0\n")
    _exe(mobile / "node_modules" / ".bin" / "vite", "exit 0\n")
    _exe(mobile / "android" / "gradlew",
         'J=java; [ -n "${JAVA_HOME:-}" ] && J="$JAVA_HOME/bin/java"\n'
         'echo "GRADLE_JAVA=$("$J" -version 2>&1 | sed -nE \'s/.*version "([0-9]+).*/\\1/p\')"\n')

    def jdk(name: str, version: str) -> Path:
        home = tmp_path / name
        _exe(home / "bin" / "java", f"echo 'openjdk version \"{version}\" 2024' >&2\n")
        return home

    if path_java == "fail":
        _exe(bin_dir / "java", "echo 'Unable to locate a Java Runtime.' >&2; exit 1\n")
    elif path_java:
        _exe(bin_dir / "java", f"echo 'openjdk version \"{path_java}\" 2024' >&2\n")
    if java_home:
        home = jdk("jh", java_home)
        _exe(bin_dir / "java_home_stub", f"echo {home}\n")
    else:
        _exe(bin_dir / "java_home_stub", "exit 1\n")
    if brew_java:
        prefix = tmp_path / "brew-openjdk"
        home = prefix / "libexec" / "openjdk.jdk" / "Contents" / "Home"
        _exe(home / "bin" / "java", f"echo 'openjdk version \"{brew_java}\" 2024' >&2\n")
        _exe(bin_dir / "brew", f'[ "$1 $2" = "--prefix openjdk@21" ] && echo {prefix}\n')
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path),
           "ANDROID_SDK_ROOT": str(sdk), "MIRA_MOBILE_DIR": str(mobile),
           "MIRA_JAVA_HOME_CMD": str(bin_dir / "java_home_stub")}
    return subprocess.run(["bash", str(RUN_SH), "m.pdf", "q", "1"], capture_output=True,
                          text=True, env=env, timeout=60)


def _run_sh_full(tmp_path: Path, *, apk_exists: bool, extra_env: dict | None = None):
    """run.sh end to end with fakes that log the FLM_* they inherit."""
    sdk, bin_dir, mobile = tmp_path / "sdk", tmp_path / "bin", tmp_path / "mobile"
    log = tmp_path / "env.log"
    leak = f'echo "$(basename "$0") ${{FLM_LOGIN_LINK:-none}} ${{FLM_PASSWORD:-none}}" >> {log}\n'
    _exe(sdk / "platform-tools" / "adb",
         leak + 'if [ "$1" = devices ]; then printf "List\\nemulator-5554\\tdevice\\n"; fi\n')
    _exe(sdk / "emulator" / "emulator", leak)
    _exe(bin_dir / "java", "echo 'openjdk version \"21.0.5\" 2024' >&2\n")
    _exe(bin_dir / "node", leak)
    _exe(mobile / "node_modules" / ".bin" / "vite", leak)
    apk = mobile / "android" / "app" / "build" / "outputs" / "apk" / "staging" / "debug" / "app-staging-debug.apk"
    _exe(mobile / "android" / "gradlew", leak + f'mkdir -p "{apk.parent}"; echo NEW > "{apk}"\n')
    if apk_exists:
        apk.parent.mkdir(parents=True, exist_ok=True)
        apk.write_text("OLD")
    _exe(bin_dir / "python3", f'echo "journey ${{FLM_LOGIN_LINK:-none}} ${{FLM_PASSWORD:-none}}" >> {log}\n')
    _exe(bin_dir / "java_home_stub", "exit 1\n")
    env = {"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path),
           "ANDROID_SDK_ROOT": str(sdk), "MIRA_MOBILE_DIR": str(mobile),
           "MIRA_JAVA_HOME_CMD": str(bin_dir / "java_home_stub"),
           "FLM_EMAIL": EMAIL, "FLM_LOGIN_LINK": LINK, **(extra_env or {})}
    r = subprocess.run(["bash", str(RUN_SH), "m.pdf", "q", "1"], capture_output=True,
                       text=True, env=env, timeout=60)
    return r, (log.read_text() if log.exists() else ""), apk


def test_run_sh_gives_the_credential_to_the_journey_only(tmp_path):
    r, log, _apk = _run_sh_full(tmp_path, apk_exists=False)
    lines = log.splitlines()
    assert f"journey {LINK} none" in lines, r.stdout + r.stderr + log
    others = [ln for ln in lines if not ln.startswith("journey ")]
    assert others, "precondition: adb and the build tools ran"
    assert not [ln for ln in others if TOKEN in ln], others


def test_run_sh_rebuilds_a_stale_apk_by_default(tmp_path):
    # Codex r3 F10: an APK left by another checkout must not be what gets tested.
    r, _log, apk = _run_sh_full(tmp_path, apk_exists=True)
    assert "building staging debug APK" in r.stdout, r.stdout + r.stderr
    assert apk.read_text().strip() == "NEW"


def test_run_sh_reuses_an_apk_only_when_told_to_and_names_it(tmp_path):
    r, _log, apk = _run_sh_full(tmp_path, apk_exists=True, extra_env={"MIRA_REUSE_APK": "1"})
    assert "building staging debug APK" not in r.stdout, r.stdout
    assert apk.read_text() == "OLD"
    assert "sha256" in r.stdout, "the reused APK's identity is recorded"


def test_run_sh_skips_a_jdk_newer_than_gradle_supports(tmp_path):
    # Codex r3 F11: Gradle 8.14.3 runs on 21 to 24, not 25.
    r = _run_sh_gradle(tmp_path, path_java="25.0.1", java_home=None, brew_java="21.0.5")
    assert "GRADLE_JAVA=21" in r.stdout, r.stdout + r.stderr


def test_run_sh_with_only_a_jdk_25_gives_the_jdk_instruction(tmp_path):
    r = _run_sh_gradle(tmp_path, path_java="25.0.1", java_home=None, brew_java=None)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "needs JDK 21" in r.stderr and "GRADLE_JAVA" not in r.stdout


def test_run_sh_falls_through_a_failing_java_shim_to_homebrew(tmp_path):
    # Codex r2 F4: the shim's failed version probe must reject it, not abort run.sh.
    r = _run_sh_gradle(tmp_path, path_java="fail", java_home=None, brew_java="21.0.5")
    assert "GRADLE_JAVA=21" in r.stdout, r.stdout + r.stderr


def test_run_sh_probes_homebrew_even_when_java_home_offers_an_old_jdk(tmp_path):
    r = _run_sh_gradle(tmp_path, path_java="fail", java_home="17.0.10", brew_java="21.0.5")
    assert "GRADLE_JAVA=21" in r.stdout, r.stdout + r.stderr


def test_run_sh_with_only_a_failing_shim_gives_the_jdk_instruction(tmp_path):
    # Control: nothing usable anywhere -> the documented error, not a silent abort.
    r = _run_sh_gradle(tmp_path, path_java="fail", java_home=None, brew_java=None)
    assert r.returncode == 2, r.stdout + r.stderr
    assert "needs JDK 21" in r.stderr
    assert "GRADLE_JAVA" not in r.stdout


def test_run_sh_builds_the_web_bundle_before_cap_sync():
    text = RUN_SH.read_text()
    build = text.index("vite build")
    sync = text.index("capacitor sync android")
    assert build < sync, "cap sync copies dist/; it must exist and be current first"


def test_run_sh_is_executable_by_bash_without_syntax_errors():
    r = subprocess.run(["bash", "-n", str(RUN_SH)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    assert os.access(RUN_SH, os.R_OK)

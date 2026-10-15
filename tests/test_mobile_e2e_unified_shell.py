"""#4455: tools/mobile-e2e/journey.py must drive the UNIFIED shell the app renders.

The classic selectors ("Notebook" -> "Create new" -> "Add sources" -> "Chat") target
screens the shipping app no longer mounts, and the unified source chip reads
"FILE manual.pdf p. 3" -- a substring test for "p.3" never matches it. The screens
below are the staging app's real accessibility tree (emulator, main 78bab6e98,
2026-10-15), replayed through a fake adb so every step is proven without a device.
"""

from __future__ import annotations

import hashlib
import importlib.util
import sys
from pathlib import Path
from xml.sax.saxutils import quoteattr

import pytest

JOURNEY = Path(__file__).resolve().parents[1] / "tools" / "mobile-e2e" / "journey.py"
PKG = "com.factorylm.mira.staging"
EMAIL = "e2e-unified-test@factorylm.com"
PDF = "e2e_manual.pdf"
HINT = "Ask general questions now, or scan a machine to ground the notebook."
PASSAGE = "“Communications Group\nC124 [RS485 Node Addr]\nSets the Modbus drive node number…"


def _load(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("MIRA_PKG", PKG)  # pinned: the module reads it at import time
    name = "mobile_e2e_journey_unified_under_test"
    spec = importlib.util.spec_from_file_location(name, JOURNEY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


class _Clock:
    """journey's `time`: sleeping advances a fake clock, so timeouts end instantly."""

    def __init__(self) -> None:
        self.t = 0.0

    def time(self) -> float:
        return self.t

    def sleep(self, s: float) -> None:
        self.t += s


class _Proc:
    def __init__(self, out: str = "") -> None:
        self.stdout, self.stderr, self.returncode = out, "", 0


class FakePhone:
    """A scripted unified shell behind a fake adb. A node is (label, class, bounds, clickable, action)."""

    def __init__(
        self,
        *,
        start="signin",
        account=EMAIL,
        chip_page=3,
        sheet_page=3,
        cited=True,
        polls=2,
        earlier_page=None,
        pixel=False,
    ):
        self.pixel = pixel  # Pixel 9a font metrics on the create form (see the test)
        # earlier_page: the thread already holds a finished answer citing that page.
        self.history = [] if earlier_page is None else [("an earlier question", earlier_page)]
        self.state, self.account, self.cited = start, account, cited
        self.chip_page, self.sheet_page, self.polls_needed = chip_page, sheet_page, polls
        self.fields = {
            "email": "",
            "password": "",
            "name": "",
            "mfr": "",
            "model": "",
            "composer": "",
        }
        self.focus = self.sheet = None
        self.kbd = self.drawer = self.menu = self.opened = False
        self.project = "E2E project" if start != "signin" else None
        self.pending = PDF if start == "project" else None
        self.sent = PDF if start == "answered" else None
        self.asked = "what is the default node address" if start == "answered" else None
        self.polls = 99 if start == "answered" else 0
        self.created: dict[str, str] = {}
        self.creating = 0  # dumps the form stays up after "Create project", as on a device
        self.taps: list[str] = []
        self.sha = ""

    # ------------------------------------------------------------- screens
    def nodes(self) -> list[tuple]:
        f = self.fields
        if self.state == "signin":
            return [
                ("Sign in", "TextView", (78, 332, 1002, 382), False, None),
                ("Email", "View", (78, 408, 1002, 453), False, None),
                (f["email"], "EditText", (78, 461, 1002, 579), True, ("focus", "email")),
                ("Password", "View", (78, 608, 1002, 650), False, None),
                ("", "EditText", (78, 658, 1002, 776), True, ("focus", "password")),
                ("Sign in", "Button", (78, 810, 1002, 928), True, ("signin",)),
            ]
        if self.state == "create":
            # The hint renders until a name is typed. On the Pixel its line is 47 px tall
            # and the "Name" label 48 px; on the emulator 42 px vs 40 px.
            label, hint = ((603, 651), (1722, 1769)) if self.pixel else ((555, 595), (1642, 1684))
            form = [
                (" Back", "Button", (42, 170, 257, 288), True, None),
                ("New project", "TextView", (283, 259, 527, 317), False, None),
                ("Name the machine", "TextView", (73, 477, 1008, 527), False, None),
                ("Name", "TextView", (73, label[0], 160, label[1]), False, None),
                (
                    f["name"],
                    "EditText",
                    (73, label[1] + 7, 1008, label[1] + 126),
                    True,
                    ("focus", "name"),
                ),
                ("Manufacturer", "TextView", (73, 750, 270, 792), False, None),
                (f["mfr"], "EditText", (73, 797, 1008, 918), True, ("focus", "mfr")),
                ("Model", "TextView", (73, 944, 165, 986), False, None),
                (f["model"], "EditText", (73, 991, 1008, 1112), True, ("focus", "model")),
                ("Create project", "Button", (73, 1529, 1008, 1647), True, ("createproject",)),
            ]
            if not f["name"]:
                form.append(
                    (
                        "To create: give the machine a name.",
                        "TextView",
                        (73, hint[0], 1008, hint[1]),
                        False,
                        None,
                    )
                )
            return form
        if self.state == "picker":
            return [
                ("Downloads", "TextView", (189, 155, 453, 226), False, None),
                ("", "CardView", (64, 675, 529, 1276), True, ("pick", PDF)),
                (
                    f"Preview the file {PDF}",
                    "FrameLayout",
                    (403, 675, 529, 801),
                    True,
                    ("preview",),
                ),
                (PDF, "TextView", (196, 1161, 497, 1212), False, None),
            ]
        n = [
            ("Open navigation", "Button", (28, 149, 147, 267), True, ("drawer", True)),
            (self.project or "FactoryLM", "TextView", (645, 198, 1052, 248), False, None),
        ]
        for question, page in self.history:
            n += [
                ("You", "TextView", (984, 127, 1042, 166), False, None),
                (question, "TextView", (139, 185, 1042, 281), False, None),
                ("MIRA", "TextView", (42, 300, 120, 340), False, None),
                ("An earlier cited answer ", "TextView", (42, 345, 711, 390), False, None),
                (f"FILE {PDF} p. {page}", "ToggleButton", (42, 395, 703, 420), True, None),
                ("Copy", "Button", (42, 425, 160, 450), True, None),
            ]
        if self.asked is None and not self.history:
            n.append((HINT, "TextView", (105, 960, 979, 1088), False, None))
        elif self.asked is not None:
            n += [
                ("You", "TextView", (984, 427, 1042, 466), False, None),
                (self.asked, "TextView", (139, 485, 1042, 681), False, None),
            ]
            if self.polls >= self.polls_needed:
                n += [
                    ("MIRA", "TextView", (42, 739, 120, 781), False, None),
                    (
                        "C124 [RS485 Node Addr] defaults to 100 ",
                        "TextView",
                        (42, 805, 711, 852),
                        False,
                        None,
                    ),
                    ("Citation 1", "Button", (711, 800, 777, 857), True, None),
                ]
                if self.cited:
                    n.append(
                        (
                            f"FILE {self.sent} p. {self.chip_page}",
                            "ToggleButton",
                            (42, 983, 703, 1122),
                            True,
                            ("sheet", "citation"),
                        )
                    )
                n.append(("Copy", "Button", (42, 1519, 160, 1637), True, None))
        if self.pending:
            n += [
                ("Pending attachments", "ListView", (28, 1986, 1052, 2115), False, None),
                (self.pending, "TextView", (175, 2031, 401, 2070), False, None),
            ]
        n += [
            ("Add attachment", "Button", (52, 2157, 170, 2275), True, ("menu",)),
            (f["composer"], "EditText", (189, 2157, 892, 2275), True, ("focus", "composer")),
            ("Send", "Button", (910, 2157, 1029, 2275), True, ("send",)),
        ]
        if self.drawer:  # overlays go last: a tap resolves to the topmost node
            n += [
                ("Close navigation", "Button", (595, 170, 714, 288), True, ("drawer", False)),
                ("New project", "Button", (42, 464, 714, 582), True, ("create",)),
                (self.account, "TextView", (42, 1955, 714, 1994), False, None),
            ]
        if self.menu:
            n += [
                ("Attachment menu", "Dialog", (0, 1569, 1080, 2339), False, None),
                ("Photo", "Button", (42, 1802, 1042, 1920), True, None),
                ("File", "Button", (42, 1928, 1042, 2046), True, ("picker",)),
            ]
        if self.sheet:
            n += [
                ("Citation", "Dialog", (0, 1101, 1080, 2339), False, None),
                (
                    f"[1] {self.sent} — p.{self.sheet_page}",
                    "TextView",
                    (42, 1143, 1042, 1206),
                    False,
                    None,
                ),
                (PASSAGE, "TextView", (42, 1233, 1042, 1734), False, None),
            ]
            if self.sheet == "citation":
                n.append(
                    (
                        f"Open original at cited page {self.sheet_page}",
                        "Button",
                        (42, 1907, 1042, 2028),
                        True,
                        ("sheet", "opened"),
                    )
                )
            else:
                n.append(
                    (
                        f"Cited at page {self.sheet_page}. The original opened successfully, but this app "
                        "can't render PDF pages in-app.",
                        "TextView",
                        (78, 1703, 1002, 1826),
                        False,
                        None,
                    )
                )
            n.append(("Close", "Button", (42, 2180, 1042, 2298), True, ("sheet", None)))
        return n

    def xml(self) -> str:
        rows = "".join(
            f'<node text={quoteattr(lbl)} content-desc="" class="android.widget.{cls}" '
            f'bounds="[{b[0]},{b[1]}][{b[2]},{b[3]}]" clickable="{"true" if c else "false"}" />'
            for lbl, cls, b, c, _ in self.nodes()
        )
        return f"<?xml version='1.0' encoding='UTF-8'?><hierarchy>{rows}</hierarchy>"

    # ------------------------------------------------------------- adb
    def run(self, args: list[str], **_kw) -> _Proc:
        if args[0] == "push":
            self.sha = hashlib.sha256(Path(args[1]).read_bytes()).hexdigest()
            return _Proc()
        a = args[1:]
        if a[:2] == ["cat", "/sdcard/window_dump.xml"]:
            if self.asked is not None:
                self.polls += 1
            if self.creating:
                self.creating -= 1
                if not self.creating:
                    self.project, self.state = self.fields["name"], "home"
            return _Proc(self.xml())
        if a[:2] == ["input", "tap"]:
            self.tap(int(a[2]), int(a[3]))
        elif a[:2] == ["input", "text"] and self.focus:
            self.fields[self.focus] += a[2].replace("%s", " ")
        elif a[:2] == ["input", "keyevent"]:
            if a[2] == "4":
                self.kbd = False
            elif a[2] == "123" and self.focus:
                self.fields[self.focus] = ""
        elif a[:2] == ["dumpsys", "input_method"]:
            return _Proc(f"mInputShown={'true' if self.kbd else 'false'}")
        elif a[:2] == ["dumpsys", "activity"]:
            top = "com.google.android.documentsui" if self.state == "picker" else PKG
            return _Proc(f"topResumedActivity=ActivityRecord{{1 u0 {top}/.Main t1}}")
        elif a[:1] == ["sha256sum"]:
            return _Proc(f"{self.sha}  {a[1]}")
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
        elif kind == "signin" and self.fields["email"] and self.fields["password"]:
            self.state, self.focus, self.kbd = "home", None, False
        elif kind == "drawer":
            self.drawer = arg[0]
        elif kind == "create":
            self.drawer, self.state = False, "create"
        elif kind == "createproject" and self.fields["name"]:
            self.creating = 3
            self.created = {"mfr": self.fields["mfr"], "model": self.fields["model"]}
        elif kind == "menu":
            self.menu = True
        elif kind == "picker":
            self.menu, self.state = False, "picker"
        elif kind == "pick":
            self.state, self.pending = "home", arg[0]
        elif kind == "send" and self.fields["composer"]:
            self.asked, self.sent, self.pending = self.fields["composer"], self.pending, None
            self.fields["composer"], self.polls = "", 0
        elif kind == "sheet":
            self.opened = self.opened or arg[0] == "opened"
            self.sheet = arg[0]


@pytest.fixture
def rig(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    monkeypatch.setattr(journey, "time", _Clock())

    def make(**kw):
        phone = FakePhone(**kw)
        dev = journey.Device("adb", "emulator-5554", tmp_path)
        dev._run = phone.run
        dev.screenshot = lambda name: tmp_path / f"{name}.png"
        return journey, phone, dev

    return make


def test_sign_in_lands_on_the_unified_home_and_checks_the_account(rig):
    journey, phone, dev = rig()
    journey.sign_in(dev, EMAIL, "not-a-real-secret")
    assert phone.state == "home"
    assert "Open navigation" in phone.taps and phone.drawer is False  # drawer opened, read, closed


def test_sign_in_rejects_a_different_account(rig):
    journey, _phone, dev = rig(account="someone-else@factorylm.com")
    with pytest.raises(journey.Fail, match="drawer"):
        journey.sign_in(dev, EMAIL, "not-a-real-secret")


def test_create_project_goes_through_the_drawer(rig):
    journey, phone, dev = rig(start="home")
    phone.project = None
    journey.create_notebook(dev, "E2E 2026-10-15", "", "")
    assert phone.project == "E2E 2026-10-15"
    assert phone.created == {"mfr": "", "model": ""}


def test_create_project_on_pixel_metrics_types_into_the_name_box(rig):
    # Found on the Pixel 9a: the hint "To create: give the machine a name." contains
    # "name" and is 1 px shorter than the "Name" label there, so the shortest-match
    # lookup took the hint and found no input beneath it. Exact labels win.
    journey, phone, dev = rig(start="home", pixel=True)
    journey.create_notebook(dev, "E2E Pixel", "", "")
    assert phone.project == "E2E Pixel"


def test_create_project_fills_identity_when_given(rig):
    journey, phone, dev = rig(start="home")
    journey.create_notebook(dev, "E2E 2026-10-15", "Allen-Bradley", "PowerFlex 525")
    assert phone.created == {"mfr": "Allen-Bradley", "model": "PowerFlex 525"}


def test_upload_attaches_the_pdf_through_the_file_picker(rig, tmp_path):
    journey, phone, dev = rig(start="home")
    pdf = tmp_path / PDF
    pdf.write_bytes(b"%PDF-1.4 fixture")
    journey.upload_pdf(dev, pdf)
    assert phone.pending == PDF
    assert not any(t.startswith("Preview the file") for t in phone.taps)


def test_ask_reads_the_spaced_page_chip(rig):
    journey, phone, dev = rig(start="project")
    answer = journey.ask(dev, "what is the default node address", 3)
    assert "defaults to 100" in answer
    assert phone.sent == PDF


def test_ask_waits_for_the_new_answer_not_the_previous_one(rig):
    # A finished earlier answer already shows a chip and Copy. Settling on those would
    # grade the OLD answer (p.3) and never read the new one (p.5).
    journey, _phone, dev = rig(start="project", earlier_page=3, chip_page=5, polls=3)
    answer = journey.ask(dev, "what is the default node address", 5)
    assert "defaults to 100" in answer


def test_ask_rejects_a_neighbouring_page(rig):
    journey, _phone, dev = rig(start="project", chip_page=31)
    with pytest.raises(journey.Fail, match=r"p\.3\b"):
        journey.ask(dev, "what is the default node address", 3)


def test_ask_fails_an_uncited_answer(rig):
    journey, _phone, dev = rig(start="project", cited=False)
    with pytest.raises(journey.Fail, match="UNCITED"):
        journey.ask(dev, "what is the default node address", 3)


def test_citation_resolves_the_page_and_opens_the_original(rig):
    journey, phone, dev = rig(start="answered")
    passage = journey.verify_citation(dev, 3)
    assert passage.startswith("“Communications Group")
    assert phone.opened and phone.sheet is None


def test_citation_rejects_a_sheet_for_another_page(rig):
    journey, _phone, dev = rig(start="answered", sheet_page=4)
    with pytest.raises(journey.Fail, match="p.4"):
        journey.verify_citation(dev, 3)


def test_launch_starts_the_resolved_activity_not_monkey(monkeypatch, tmp_path):
    # `monkey -p PKG -c LAUNCHER 1` silently starts nothing on the API 35 emulator,
    # so the journey sat on the launcher until its 240 s sign-in wait expired.
    journey = _load(monkeypatch)
    monkeypatch.setattr(journey, "time", _Clock())
    calls: list[list[str]] = []
    component = f"{PKG}/com.factorylm.mira.MainActivity"

    def run(args, **_kw):
        calls.append(args)
        if args[1:3] == ["cmd", "package"]:
            return _Proc(f"priority=0 preferredOrder=0\n{component}")
        return _Proc()

    dev = journey.Device("adb", "emulator-5554", tmp_path)
    dev._run = run
    journey.launch(dev)
    assert ["shell", "am", "start", "-n", component] in calls
    assert not any("monkey" in c for c in calls)

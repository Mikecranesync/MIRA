"""Prove the `history` stage FAILS on each thing it names.

`verify_history` cannot run without a device and a live backend, so its
assertions would otherwise ship unproven -- and a check nobody has seen fail is
not a check (.claude/rules/prove-the-test-fails.md).

These drive it against a stub device that simulates each failure mode, so the
stage is verified without an emulator: four distinct failures and one pass.

    python -m pytest tools/mobile-e2e/test_verify_history.py -q
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SPEC = importlib.util.spec_from_file_location(
    "journey", Path(__file__).resolve().parent / "journey.py"
)
journey = importlib.util.module_from_spec(_SPEC)
sys.modules["journey"] = journey
_SPEC.loader.exec_module(journey)

QUESTION = "When do I need to derate this drive for altitude"


class StubDevice:
    """Minimal stand-in for Device: only what verify_history touches.

    `screens` is the list of visible text nodes returned after the relaunch.
    """

    def __init__(self, screens: list[str], *, foreground: bool = True) -> None:
        self._screens = screens
        self._foreground = foreground
        self.shots: list[str] = []

    # -- surface used by verify_history ------------------------------------
    def shell(self, *args: str) -> str:
        return ""

    def top_package(self) -> str:
        return journey.PKG if self._foreground else "com.android.launcher"

    def dismiss_anr(self) -> bool:
        return False

    def screenshot(self, name: str):
        self.shots.append(name)
        return Path(name)

    def find(self, needle: str, **_kw):
        for t in self._screens:
            if needle in t:
                return journey.Node(text=t, desc="", cls="android.widget.TextView",
                                    bounds=(0, 0, 10, 10))
        return None


@pytest.fixture(autouse=True)
def _no_sleep(monkeypatch):
    monkeypatch.setattr(journey.time, "sleep", lambda *_a, **_k: None)


def _restored() -> list[str]:
    """What a correctly-restored thread looks like: the turn AND its evidence."""
    return [QUESTION, "You must derate above 1000 m.", "gs10_manual.pdf p.117"]


def test_restored_thread_passes():
    """Control: the fix must not make every restart fail."""
    journey.verify_history(StubDevice(_restored()), QUESTION)


def test_cold_restart_landing_on_sign_in_is_a_failure():
    """Session did not persist -- must fail loudly, not silently re-auth."""
    with pytest.raises(journey.Fail, match="session did not persist"):
        journey.verify_history(StubDevice(["Sign in", "Password"]), QUESTION)


def test_missing_turn_is_a_failure():
    """App came back signed-in but the thread is gone."""
    dev = StubDevice(["New chat", "Projects"])
    with pytest.raises(journey.Fail, match="does not show the question"):
        journey.verify_history(dev, QUESTION)
    assert "history-missing-turn" in dev.shots


def test_turn_without_its_citation_is_a_failure():
    """The case that matters most.

    The prose returns and looks correct, but the citation chip does not. That is
    a grounded answer that has quietly become an ungrounded one -- indistinguishable
    on screen from success, which is exactly why it gets its own assertion.
    """
    dev = StubDevice([QUESTION, "You must derate above 1000 m."])
    with pytest.raises(journey.Fail, match="evidence was lost on reload"):
        journey.verify_history(dev, QUESTION)
    assert "history-missing-citation" in dev.shots


def test_app_never_returns_to_foreground_is_a_failure():
    with pytest.raises(journey.Fail, match="did not return to the foreground"):
        journey.verify_history(StubDevice(_restored(), foreground=False), QUESTION)

"""#4455: tools/mobile-e2e/journey.py must never uninstall an app on a REAL phone
unless told to.

`install()` uninstalls the target package before installing (so a debug/release
signature mismatch can't fail `install -r`). On an emulator that is harmless. On a
physical phone it signs the owner out of a real account, and with the old hardcoded
`PKG = "com.factorylm.mira"` it was the PRODUCTION app. The 2026-10-15 Pixel run
could not use the harness for exactly this reason.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

JOURNEY = Path(__file__).resolve().parents[1] / "tools" / "mobile-e2e" / "journey.py"


def _load(monkeypatch: pytest.MonkeyPatch, pkg: str | None = None):
    # Pin the environment; the module reads MIRA_PKG at import time.
    if pkg is None:
        monkeypatch.delenv("MIRA_PKG", raising=False)
    else:
        monkeypatch.setenv("MIRA_PKG", pkg)
    name = "mobile_e2e_journey_under_test"
    spec = importlib.util.spec_from_file_location(name, JOURNEY)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    # @dataclass resolves its module through sys.modules.
    monkeypatch.setitem(sys.modules, name, module)
    spec.loader.exec_module(module)
    return module


class _Result:
    def __init__(self, stdout: str = "Success", stderr: str = "") -> None:
        self.stdout = stdout
        self.stderr = stderr
        self.returncode = 0


class _FakeDevice:
    """Records every adb call; never touches a real device."""

    def __init__(self, serial: str) -> None:
        self.serial = serial
        self.calls: list[list[str]] = []

    def _run(self, args: list[str], **_kw) -> _Result:
        self.calls.append(list(args))
        return _Result()

    def shell(self, *args: str) -> str:
        self.calls.append(["shell", *args])
        return ""

    def uninstalled(self) -> bool:
        return any(c and c[0] == "uninstall" for c in self.calls)


def test_physical_device_is_never_uninstalled_by_default(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    dev = _FakeDevice("55081JEBF07026")
    with pytest.raises(journey.Fail, match="physical"):
        journey.install(dev, tmp_path / "app.apk")
    assert not dev.uninstalled()
    # Nothing at all was sent to the phone.
    assert dev.calls == []


def test_physical_device_uninstall_only_with_explicit_opt_in(monkeypatch, tmp_path):
    journey = _load(monkeypatch)
    dev = _FakeDevice("55081JEBF07026")
    journey.install(dev, tmp_path / "app.apk", reinstall_physical=True)
    assert dev.uninstalled()


def test_emulator_still_gets_a_fresh_install(monkeypatch, tmp_path):
    # Control: the emulator path (the harness's default) is unchanged.
    journey = _load(monkeypatch)
    dev = _FakeDevice("emulator-5554")
    journey.install(dev, tmp_path / "app.apk")
    assert dev.uninstalled()
    assert ["uninstall", journey.PKG] in dev.calls


def test_package_is_selectable_like_device_py(monkeypatch):
    # device.py already reads MIRA_PKG; the journey must target the same app.
    assert _load(monkeypatch, "com.factorylm.mira.staging").PKG == "com.factorylm.mira.staging"
    assert _load(monkeypatch).PKG == "com.factorylm.mira"

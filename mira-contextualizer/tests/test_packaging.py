"""Frozen-path guards. Source tests can't catch PyInstaller-only failures, so pin the two contracts
the spec depends on (see memory pyinstaller-frozen-path-gotchas)."""
import os
import pathlib
import sys

from mira_contextualizer import app

_ROOT = pathlib.Path(__file__).parent.parent


def test_gui_dir_uses_meipass_when_frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", r"X:\bundle", raising=False)
    assert app._gui_dir() == os.path.join(r"X:\bundle", "gui")


def test_gui_dir_from_source_points_at_real_index():
    # Not frozen → next to the package; the file must actually exist (the spec ships this same dir).
    assert os.path.isfile(os.path.join(app._gui_dir(), "index.html"))


def test_pyinstaller_entry_uses_no_relative_imports():
    # The spec entry runs as a package-less __main__ in the frozen exe; ANY `from .` relative
    # import there raises "attempted relative import with no known parent package" (gotcha #1).
    spec = (_ROOT / "MIRA-Contextualizer.spec").read_text(encoding="utf-8")
    assert '"mira_contextualizer/app.py"' in spec  # confirm the entry we're guarding
    app_src = (_ROOT / "mira_contextualizer" / "app.py").read_text(encoding="utf-8")
    assert "from . " not in app_src and "from .server" not in app_src and "from .store" not in app_src
    assert "from mira_contextualizer.server import serve" in app_src


def test_main_module_uses_absolute_import():
    src = (_ROOT / "mira_contextualizer" / "__main__.py").read_text(encoding="utf-8")
    assert "from mira_contextualizer.app import main" in src and "from .app" not in src


def test_spec_ships_gui_as_dest_named_gui():
    spec = (_ROOT / "MIRA-Contextualizer.spec").read_text(encoding="utf-8")
    assert '("mira_contextualizer/gui", "gui")' in spec  # dest name must match _gui_dir()'s _MEIPASS/gui


def test_configure_bundled_tesseract_is_noop_when_not_frozen(monkeypatch):
    monkeypatch.setattr(sys, "frozen", False, raising=False)
    app._configure_bundled_tesseract()  # must not raise

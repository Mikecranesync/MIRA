"""Desktop launcher — serve the store-backed GUI + API on localhost, open a chromeless Edge window.

Same stdlib + Edge app-mode pattern as mira-plc-parser/gui/desktop.py, but the server carries a JSON
API over a local SQLite store, not just static files. Fully offline (127.0.0.1 only).
"""
from __future__ import annotations

import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser

APP_NAME = "FactoryLM Contextualizer"
WINDOW_SIZE = (1100, 760)
_EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def _ensure_parser_on_path() -> None:
    """Make ``mira_plc_parser`` importable from the sibling subproject when running from source.
    When frozen, PyInstaller bundles it, so this is a no-op."""
    if getattr(sys, "frozen", False):
        return
    here = os.path.dirname(os.path.abspath(__file__))
    parser_root = os.path.normpath(os.path.join(here, "..", "..", "mira-plc-parser"))
    if os.path.isdir(parser_root) and parser_root not in sys.path:
        sys.path.insert(0, parser_root)


def _gui_dir() -> str:
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        return os.path.join(base, "gui")
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), "gui")


def _configure_bundled_tesseract() -> None:
    """Point pytesseract at the Tesseract engine bundled next to the frozen exe (if present).
    The installer drops it under ``tesseract/`` (see MIRA-Contextualizer.spec / PACKAGING.md)."""
    if not getattr(sys, "frozen", False):
        return
    base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    exe = os.path.join(base, "tesseract", "tesseract.exe")
    if os.path.isfile(exe):
        try:
            import pytesseract
            pytesseract.pytesseract.tesseract_cmd = exe
            os.environ.setdefault("TESSDATA_PREFIX", os.path.join(base, "tesseract", "tessdata"))
        except Exception:  # noqa: BLE001 — OCR just stays unavailable
            pass


def _db_path() -> str:
    """A per-user, writable DB location. Override with MIRA_CONTEXTUALIZER_DB."""
    override = os.environ.get("MIRA_CONTEXTUALIZER_DB")
    if override:
        return override
    base = os.environ.get("LOCALAPPDATA") or tempfile.gettempdir()
    data_dir = os.path.join(base, "MiraContextualizer")
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, "store.db")


def _find_edge() -> str | None:
    return next((p for p in _EDGE_CANDIDATES if os.path.isfile(p)), None)


def _wait_for_server(port: int, timeout: float = 5.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=0.25):
                return True
        except OSError:
            time.sleep(0.05)
    return False


def main() -> int:
    # ABSOLUTE imports below — this module is the PyInstaller entry, so it runs as a package-less
    # __main__ where `from .x import y` raises "attempted relative import with no known parent
    # package" in the frozen exe (see memory pyinstaller-frozen-path-gotchas #1).
    if "--version" in sys.argv:
        from mira_contextualizer import __version__
        print("%s %s" % (APP_NAME, __version__))
        return 0

    _ensure_parser_on_path()
    _configure_bundled_tesseract()
    from mira_contextualizer.server import serve
    from mira_contextualizer.store import Store

    # Headless self-test: exercise the full frozen import chain and exit 0 (no server, no window).
    # Lets packaging verification distinguish success (exit 0) from the import-failure dialog.
    if "--selftest" in sys.argv or os.environ.get("MIRA_CTX_SELFTEST"):
        return 0

    gui = _gui_dir()
    if not os.path.isfile(os.path.join(gui, "index.html")):
        print("error: gui/index.html not found (%s)" % gui, file=sys.stderr)
        return 1

    store = Store(_db_path())
    httpd, port = serve(store, gui)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    url = "http://127.0.0.1:%d/index.html" % port
    _wait_for_server(port)

    edge = _find_edge()
    try:
        if edge:
            profile = tempfile.mkdtemp(prefix="mira-contextualizer-")
            subprocess.Popen([
                edge, "--app=%s" % url, "--window-size=%d,%d" % WINDOW_SIZE,
                "--user-data-dir=%s" % profile, "--no-first-run",
            ]).wait()
        else:
            print("%s: Edge not found; opening in your default browser. Ctrl+C to quit." % APP_NAME)
            webbrowser.open(url)
            try:
                while True:
                    time.sleep(0.5)
            except KeyboardInterrupt:
                pass
    finally:
        httpd.shutdown()
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

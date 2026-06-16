"""MIRA Tag Mapper -- desktop launcher (stdlib only, no third-party deps).

Turns the offline `index.html` mapper into a double-click app: it serves the bundled GUI on a
private localhost port and opens it in a chromeless Microsoft Edge "app" window, so it looks and
feels like a native program -- no browser tabs, no address bar. When that window closes, the
server shuts down and the app exits.

Why this design:
  * Stdlib only (http.server, subprocess, threading) -- no GUI framework dependency, so it stays
    inside MIRA's MIT/Apache-only license rule and packages into one PyInstaller .exe with nothing
    to bundle but this file + the HTML.
  * Edge ships on every Windows 10/11, and `msedge --app=<url>` is a borderless app window.
  * Fully offline: the server binds to 127.0.0.1 and serves local files only; the HTML makes no
    network calls.

Run from source:   python gui/desktop.py    (from the mira-plc-parser/ directory)
Packaged:          MIRA-Tag-Mapper.exe
"""

from __future__ import annotations

import functools
import http.server
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import webbrowser

APP_NAME = "MIRA Tag Mapper"
WINDOW_SIZE = (840, 600)

_EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]


def _gui_dir() -> str:
    """Directory holding index.html -- next to this file from source, or the PyInstaller bundle."""
    if getattr(sys, "frozen", False):
        base = getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
        return os.path.join(base, "gui")
    return os.path.dirname(os.path.abspath(__file__))


class _QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *_a):  # silence per-request access logging
        pass


def _start_server(directory: str):
    """Serve `directory` on a free 127.0.0.1 port in a daemon thread. Returns (httpd, port)."""
    handler = functools.partial(_QuietHandler, directory=directory)

    class _Server(http.server.ThreadingHTTPServer):
        daemon_threads = True

    # bind to port 0 -> the OS hands us a free port; never exposed off-localhost.
    httpd = _Server(("127.0.0.1", 0), handler)
    port = httpd.server_address[1]
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, port


def _find_edge() -> str | None:
    for path in _EDGE_CANDIDATES:
        if os.path.isfile(path):
            return path
    return None


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
    if "--version" in sys.argv:
        print("%s (desktop launcher) 0.1.0" % APP_NAME)
        return 0

    gui = _gui_dir()
    index = os.path.join(gui, "index.html")
    if not os.path.isfile(index):
        print("error: index.html not found next to the launcher (%s)" % gui, file=sys.stderr)
        return 1

    httpd, port = _start_server(gui)
    url = "http://127.0.0.1:%d/index.html" % port
    _wait_for_server(port)

    edge = _find_edge()
    try:
        if edge:
            profile = tempfile.mkdtemp(prefix="mira-tag-mapper-")
            proc = subprocess.Popen([
                edge,
                "--app=%s" % url,
                "--window-size=%d,%d" % WINDOW_SIZE,
                "--user-data-dir=%s" % profile,   # isolated; never touches the user's Edge profile
                "--no-first-run",
            ])
            proc.wait()                            # block until the app window is closed
        else:
            # No Edge -> open in the default browser and keep serving until Ctrl+C.
            print("%s: Edge not found; opening in your default browser." % APP_NAME)
            webbrowser.open(url)
            try:
                while True:
                    time.sleep(0.5)
            except KeyboardInterrupt:
                pass
    finally:
        httpd.shutdown()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

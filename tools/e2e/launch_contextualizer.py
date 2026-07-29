"""Headless launcher for the offline MIRA contextualizer, for the laptop->cloud E2E.

Starts the same threaded HTTP server `app.py` uses, but with NO Edge window and a
fresh temp DB, and prints `PORT=<n>` on the first line so the Playwright globalSetup
can read the bound port (the app normally binds port 0 = OS-assigned).

Run with the contextualizer venv so the PLC parser + PDF deps are importable:
    <ctx>/.venv/Scripts/python.exe tools/e2e/launch_contextualizer.py

Env:
    MIRA_CTX_ROOT  path to the mira-contextualizer checkout
                   (default: C:/Users/hharp/Documents/MIRA-pr2068/mira-contextualizer)
    MIRA_CTX_PORT  fixed port (default 0 = OS-assigned)
    MIRA_CTX_DB    sqlite path (default: a fresh temp file, isolated per run)
"""
from __future__ import annotations

import os
import sys
import tempfile

CTX_ROOT = os.environ.get(
    "MIRA_CTX_ROOT", r"C:/Users/hharp/Documents/MIRA-pr2068/mira-contextualizer"
)
# Make `mira_contextualizer` importable when not pip-installed in the venv.
if os.path.isdir(CTX_ROOT) and CTX_ROOT not in sys.path:
    sys.path.insert(0, CTX_ROOT)


def main() -> int:
    from mira_contextualizer import app as ctxapp

    ctxapp._ensure_parser_on_path()  # adds the sibling mira-plc-parser to sys.path
    from mira_contextualizer.server import serve
    from mira_contextualizer.store import Store

    gui = ctxapp._gui_dir()
    if not os.path.isfile(os.path.join(gui, "index.html")):
        print("error: gui/index.html not found (%s)" % gui, file=sys.stderr, flush=True)
        return 1

    db = os.environ.get("MIRA_CTX_DB") or os.path.join(
        tempfile.mkdtemp(prefix="mira-ctx-e2e-"), "store.db"
    )
    store = Store(db)
    recents = os.path.join(os.path.dirname(db), "recent_profiles.json")
    host = "127.0.0.1"
    port = int(os.environ.get("MIRA_CTX_PORT", "0"))

    httpd, port = serve(store, gui, host=host, port=port, recents_path=recents)
    # FIRST line of stdout — the globalSetup parses this.
    print("PORT=%d" % port, flush=True)
    print("DB=%s" % db, flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.shutdown()
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

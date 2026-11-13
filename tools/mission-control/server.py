"""Mission control: a private, read-only cockpit over GitHub Project #4 (#4737).

    GITHUB_TOKEN=... python tools/mission-control/server.py      # http://127.0.0.1:8787

v1: the Project #4 board (one GraphQL *query*, board.QUERY). v2 (#4737 slice 2): agent
[DELIVERY-UPDATE] reports and GitHub events (signed webhook + REST poll) in a SQLite
store, env revisions, and the five-state evidence lifecycle rendered by cockpit.py.
Still read-only: the only POST is /webhook/github (HMAC, fail-closed); Send stays
disabled. Binds to loopback unless MC_ALLOW_NONLOOPBACK=1 (see the runbook).
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import json
import logging
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, List, Optional


def _load(name: str):
    # Loaded by file path under a unique name: a bare "import board" could pick up
    # another module of that name elsewhere on sys.path (this broke the full CI suite).
    found = sys.modules.get(f"mission_control_{name}")
    if found is not None:
        return found
    spec = importlib.util.spec_from_file_location(
        f"mission_control_{name}", Path(__file__).resolve().parent / f"{name}.py"
    )
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = mod  # type: ignore[union-attr]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


board = _load("board")
store_mod = _load("store")
webhook = _load("webhook")
reports = _load("reports")
poll = _load("poll")
lifecycle = _load("lifecycle")
evidence = _load("evidence")
model = _load("model")
cockpit = _load("cockpit")
runtime = _load("runtime")

log = logging.getLogger("mission-control")
HERE = Path(__file__).resolve().parent
CACHE_SECONDS = int(os.getenv("MC_CACHE_SECONDS", "300"))
POLL_SECONDS = int(os.getenv("MC_POLL_SECONDS", "60"))
STALE_HOURS = float(os.getenv("MC_STALE_HOURS", "9"))
SEND_DISABLED_REASON = cockpit.SEND_DISABLED_REASON
_link, _plan_url, _e = cockpit._link, cockpit._plan_url, cockpit._e  # kept for v1 tests


github_post = runtime.github_post  # kept: v1 callers import it from server


class Snapshot:
    """The last good copy of the board, refreshed in the background.

    Requests never wait on GitHub: a full read takes ~25 s, so fetching on the
    request path made the page look broken whenever the cache had expired.
    """

    def __init__(self, fetch: Callable[[], List[dict]]):
        self._fetch = fetch
        self._lock = threading.Lock()
        self.items: List[dict] = []
        self.at: Optional[dt.datetime] = None
        self.error: Optional[str] = None

    def refresh(self) -> None:
        try:
            items = self._fetch()  # slow; deliberately outside the lock
        except Exception as exc:  # keep serving the last good snapshot
            log.warning("refresh failed: %s", exc)
            with self._lock:
                self.error = f"Refresh failed ({type(exc).__name__}); showing the last good data."
            return
        with self._lock:
            self.items, self.at, self.error = items, dt.datetime.now(dt.timezone.utc), None

    def start(self, every_seconds: int) -> threading.Thread:
        def loop() -> None:
            while True:
                self.refresh()
                time.sleep(every_seconds)

        t = threading.Thread(target=loop, name="board-refresh", daemon=True)
        t.start()
        return t

    def get(self) -> "Snapshot":
        """Return immediately with a consistent copy; never fetches."""
        with self._lock:
            view = Snapshot(self._fetch)
            view.items, view.at, view.error = self.items, self.at, self.error
        return view


def trusted_authors() -> tuple[str, ...]:
    return tuple(a for a in os.getenv("MC_TRUSTED_AUTHORS", "Mikecranesync").split(",") if a)


def _now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


EMPTY_EVIDENCE: dict = {"rows": [], "envs": {}, "at": None, "error": None}
_evidence_module = evidence  # the class body below shadows `evidence` with the data dict


def build_model(
    store, ev: Optional[dict], last_poll: Optional[str], last_webhook: Optional[str]
) -> dict:
    return model.build(
        store,
        ev or EMPTY_EVIDENCE,
        last_poll=last_poll,
        last_webhook=last_webhook,
        now=dt.datetime.now(dt.timezone.utc),
        stale_hours=STALE_HOURS,
        poll_seconds=POLL_SECONDS,
    )


class _NullStore:
    def reports(self):
        return []

    def events(self, limit=50):
        return []

    def counts(self):
        return {"events": 0, "reports": 0}


def render(snap: Snapshot, m: Optional[dict] = None) -> str:
    if m is None:
        m = build_model(_NullStore(), None, None, None)
    return cockpit.render(snap, board, m)


class Handler(BaseHTTPRequestHandler):
    snapshot: Snapshot
    store: object = _NullStore()
    evidence: dict = EMPTY_EVIDENCE
    last_poll: Optional[str] = None
    last_webhook: Optional[str] = None
    poll_mod, evidence_mod, trusted_authors = poll, _evidence_module, staticmethod(trusted_authors)

    def _model(self) -> dict:
        return build_model(self.store, self.evidence, self.last_poll, self.last_webhook)

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send(
                200, "text/html; charset=utf-8", render(self.snapshot.get(), self._model()).encode()
            )
        elif self.path == "/api/snapshot.json":
            self._send(200, "application/json", json.dumps(self._model(), default=str).encode())
        elif self.path == "/factorylm-tokens.css":
            self._send(200, "text/css", (HERE / "factorylm-tokens.css").read_bytes())
        elif self.path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
        elif self.path == "/healthz":
            s = self.snapshot
            body = {
                "items": len(s.items),
                "ok": s.error is None,
                "last_poll": self.last_poll,
                "last_webhook": self.last_webhook,
                "evidence_at": self.evidence.get("at"),
                **self.store.counts(),  # type: ignore[attr-defined]
            }
            self._send(200, "application/json", json.dumps(body).encode())
        else:
            self._send(404, "text/plain", b"not found")

    def do_POST(self) -> None:  # noqa: N802  (the webhook is the only write; all else 405)
        body = self.rfile.read(
            int(self.headers.get("Content-Length") or 0)
        )  # drain before answering
        if self.path != "/webhook/github":
            self._send(405, "text/plain", b"read-only")
            return
        secret = os.getenv("MC_WEBHOOK_SECRET", "")
        if not secret:
            self._send(503, "text/plain", b"webhook not configured")
            return
        if not webhook.verify(secret, body, self.headers.get("X-Hub-Signature-256")):
            self._send(401, "text/plain", b"bad signature")
            return
        self._send(202, "text/plain", self.store_delivery(body).encode())

    def store_delivery(self, body: bytes) -> str:
        try:
            payload = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            return "ignored: not json"
        event = self.headers.get("X-GitHub-Event", "unknown")
        delivery = self.headers.get("X-GitHub-Delivery") or f"nodelivery-{time.time_ns()}"
        now = _now_iso()
        new = self.store.add_event(webhook.normalise(event, delivery, payload, now))  # type: ignore[attr-defined]
        if event == "issue_comment" and new:  # a redelivery changes nothing, reports included
            cid = (payload.get("comment") or {}).get("id")
            row = webhook.comment_report(payload, trusted_authors(), reports.parse)
            if payload.get("action") == "deleted" and cid:
                self.store.delete_report(int(cid), now)  # type: ignore[attr-defined]
            elif row:
                self.store.put_report(row)  # type: ignore[attr-defined]
            elif payload.get("action") == "edited" and cid:  # the marker was edited away
                self.store.delete_report(int(cid), now)  # type: ignore[attr-defined]
        Handler.last_webhook = now
        return "stored" if new else "duplicate"

    def _send(self, code: int, ctype: str, body: bytes) -> None:
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'",
        )
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        log.info("%s %s", self.address_string(), fmt % args)


def bind_address() -> str:
    addr = os.getenv("MC_BIND", "127.0.0.1")
    if addr not in ("127.0.0.1", "::1", "localhost") and os.getenv("MC_ALLOW_NONLOOPBACK") != "1":
        raise SystemExit(
            f"Refusing to bind {addr}: exposure beyond loopback needs MC_ALLOW_NONLOOPBACK=1 and an auth layer."
        )
    return addr


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per poll, not per request
    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        raise SystemExit("GITHUB_TOKEN is not set.")
    post = runtime.github_post(token)
    Handler.snapshot = Snapshot(lambda: board.fetch_items(post))
    Handler.snapshot.start(CACHE_SECONDS)
    data_dir = Path(os.getenv("MC_DATA_DIR", str(Path.home() / "Services/mission-control/data")))
    Handler.store = store_mod.Store(data_dir / "mission-control.sqlite")
    threading.Thread(
        target=runtime.poll_loop,
        args=(Handler, runtime.http_get(token), post),
        name="poll",
        daemon=True,
    ).start()
    if not os.getenv("MC_WEBHOOK_SECRET"):
        log.warning("MC_WEBHOOK_SECRET unset: POST /webhook/github answers 503 (poll only)")
    port = int(os.getenv("MC_PORT", "8787"))
    srv = ThreadingHTTPServer((bind_address(), port), Handler)
    log.info("mission control on http://%s:%d (read-only)", srv.server_address[0], port)
    srv.serve_forever()


if __name__ == "__main__":
    main()

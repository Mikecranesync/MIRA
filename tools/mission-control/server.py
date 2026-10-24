"""Mission control: a private, read-only overview of GitHub Project #4 (#4737).

    GITHUB_TOKEN=... python tools/mission-control/server.py      # http://127.0.0.1:8787

Read-only by construction: one GraphQL *query* (board.QUERY), no mutations, no
model calls. Send is rendered disabled until the dispatch contract in
docs/proposals/project4-mission-control.md is built and verified.

It binds to loopback only. Exposing it beyond this machine is a hosting decision
that needs the owner's approval and an auth layer in front (see the runbook);
MC_BIND overrides the address only when MC_ALLOW_NONLOOPBACK=1 is also set.
"""

from __future__ import annotations

import datetime as dt
import html
import importlib.util
import logging
import os
import string
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, List, Optional

import httpx


def _load_board():
    # Loaded by file path under a unique name: a bare "import board" could pick up
    # another module of that name elsewhere on sys.path (this broke the full CI suite).
    spec = importlib.util.spec_from_file_location(
        "mission_control_board", Path(__file__).resolve().parent / "board.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


board = _load_board()

log = logging.getLogger("mission-control")
HERE = Path(__file__).resolve().parent
CACHE_SECONDS = int(os.getenv("MC_CACHE_SECONDS", "300"))
SEND_DISABLED_REASON = (
    "Nothing on this page can start an agent yet: the dispatcher, its permissions "
    "and delivery receipts are not built or approved."
)


def github_post(token: str) -> Callable[[dict], dict]:
    def post(body: dict) -> dict:
        r = httpx.post(
            "https://api.github.com/graphql",
            json=body,
            headers={"Authorization": f"Bearer {token}"},
            timeout=30,
        )
        r.raise_for_status()
        return r.json()

    return post


class Snapshot:
    """Fetches the whole board at most once per CACHE_SECONDS."""

    def __init__(self, fetch: Callable[[], List[dict]]):
        self._fetch = fetch
        self._lock = threading.Lock()
        self.items: List[dict] = []
        self.at: Optional[dt.datetime] = None
        self.error: Optional[str] = None

    def get(self) -> "Snapshot":
        with self._lock:
            fresh = (
                self.at
                and (dt.datetime.now(dt.timezone.utc) - self.at).total_seconds() < CACHE_SECONDS
            )
            if not fresh:
                try:
                    self.items = self._fetch()
                    self.at = dt.datetime.now(dt.timezone.utc)
                    self.error = None
                except Exception as exc:  # keep serving the last good snapshot
                    log.warning("refresh failed: %s", exc)
                    self.error = (
                        f"Refresh failed ({type(exc).__name__}); showing the last good data."
                    )
        return self


def _e(s: object) -> str:
    return html.escape(str(s), quote=True)


def _link(item: dict) -> str:
    url = item["url"] if str(item["url"]).startswith("https://github.com/") else "#"
    return f'<a href="{_e(url)}" target="_blank" rel="noopener">{_e(item["repo"].split("/")[-1])} #{_e(item["number"])}</a>'


def _card(item: dict, with_decision: bool) -> str:
    rec = item.get("rec", {})
    labels = "".join(f'<span class="chip">{_e(lb)}</span>' for lb in item["labels"][:4])
    decision = ""
    if with_decision:
        decision = (
            f'<div class="decide"><span class="rec">Recommended: <b>{_e(rec.get("option", ""))}</b>'
            f" &middot; {_e(rec.get('why', ''))}</span>"
            f'<button type="button" disabled aria-disabled="true" title="{_e(SEND_DISABLED_REASON)}">Send</button></div>'
        )
    return (
        f'<li class="card state-{_e(item["state"].lower())}"><div class="row"><span class="ref">{_link(item)}</span>'
        f'<span class="status">{_e(item["status"])}</span></div>'
        f'<p class="title">{_e(item["title"])}</p><div class="chips">{labels}</div>{decision}</li>'
    )


def _section(
    title: str, hint: str, items: List[dict], with_decision: bool = False, limit: int = 60
) -> str:
    body = (
        "".join(_card(i, with_decision) for i in items[:limit])
        or '<li class="empty">Nothing here right now.</li>'
    )
    more = f'<p class="more">Showing {limit} of {len(items)}.</p>' if len(items) > limit else ""
    return f'<section><h2>{_e(title)} <span class="count">{len(items)}</span></h2><p class="hint">{_e(hint)}</p><ul>{body}</ul>{more}</section>'


def render(snap: Snapshot) -> str:
    v = board.build_views(list(snap.items))
    when = snap.at.strftime("%Y-%m-%d %H:%M UTC") if snap.at else "never"
    status = "".join(f"<li><b>{n}</b> {_e(s)}</li>" for s, n in v["by_status"].items())
    error = f'<p class="error" role="alert">{_e(snap.error)}</p>' if snap.error else ""
    return string.Template((HERE / "page.html").read_text()).substitute(
        snapshot_time=_e(when),
        total=v["total"],
        status_list=status,
        error=error,
        send_reason=_e(SEND_DISABLED_REASON),
        focus=_section(
            "In progress",
            "Open cards with Status = In Progress (matches saved View 2).",
            v["focus"],
            True,
        ),
        needs=_section(
            "Needs Mike", "Open cards labelled for an owner decision.", v["needs_owner"], True
        ),
        blocked=_section("Blocked", "Open cards labelled blocked.", v["blocked"], True),
        mismatched=_section(
            "Card and record disagree",
            "The card status contradicts the issue or PR state.",
            v["mismatched"],
            True,
        ),
    )


class Handler(BaseHTTPRequestHandler):
    snapshot: Snapshot

    def do_GET(self) -> None:  # noqa: N802
        if self.path in ("/", "/index.html"):
            self._send(200, "text/html; charset=utf-8", render(self.snapshot.get()).encode())
        elif self.path == "/factorylm-tokens.css":
            self._send(200, "text/css", (HERE / "factorylm-tokens.css").read_bytes())
        elif self.path == "/favicon.ico":
            self._send(204, "image/x-icon", b"")
        elif self.path == "/healthz":
            s = self.snapshot
            self._send(
                200,
                "application/json",
                f'{{"items": {len(s.items)}, "ok": {str(s.error is None).lower()}}}'.encode(),
            )
        else:
            self._send(404, "text/plain", b"not found")

    def do_POST(self) -> None:  # noqa: N802  (read-only page: nothing accepts writes)
        self._send(405, "text/plain", b"read-only")

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
    token = os.getenv("GITHUB_TOKEN", "")
    if not token:
        raise SystemExit("GITHUB_TOKEN is not set.")
    post = github_post(token)
    Handler.snapshot = Snapshot(lambda: board.fetch_items(post))
    port = int(os.getenv("MC_PORT", "8787"))
    srv = ThreadingHTTPServer((bind_address(), port), Handler)
    log.info("mission control on http://%s:%d (read-only)", srv.server_address[0], port)
    srv.serve_forever()


if __name__ == "__main__":
    main()

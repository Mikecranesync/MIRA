"""Runtime wiring for mission control v2: GitHub clients and the poll loop.

Kept out of server.py (Law 3: files stay under 300 lines). Read-only GitHub access:
one GraphQL query + REST GETs. The poll loop never dies; it logs and retries, and
the page shows staleness instead.
"""

from __future__ import annotations

import datetime as dt
import logging
import os
import time
from typing import Callable, Optional

import httpx

log = logging.getLogger("mission-control.runtime")
REPO = os.getenv("MC_REPO", "Mikecranesync/MIRA")
COORD_ISSUE = int(os.getenv("MC_COORD_ISSUE", "5232"))
POLL_SECONDS = int(os.getenv("MC_POLL_SECONDS", "60"))


def _iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _now_iso() -> str:
    return _iso(dt.datetime.now(dt.timezone.utc))


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


def http_get(token: str) -> Callable[..., tuple[int, dict, object]]:
    def get(url: str, headers: Optional[dict] = None) -> tuple[int, dict, object]:
        h = dict(headers or {})
        if url.startswith("https://api.github.com/") and token:
            h["Authorization"] = f"Bearer {token}"
        r = httpx.get(url, headers=h, timeout=20, follow_redirects=True)
        try:
            body: object = r.json()
        except ValueError:
            body = r.text
        return r.status_code, dict(r.headers), body

    return get


BOARD_MAX_SECONDS = int(os.getenv("MC_BOARD_MAX_SECONDS", "600"))


def candidates(handler, store, now: Optional[dt.datetime] = None, max_age: int = 0) -> list[int]:
    """PRs to track: open In-Progress PR cards on the board + items named by trusted reports.

    The board is a candidate *source*: if it never loaded, its last refresh failed, or its
    snapshot is older than `max_age`, raise — a candidate list with a hole in it must not
    feed a GO.
    """
    snap = handler.snapshot.get()
    now = now or dt.datetime.now(dt.timezone.utc)
    max_age = max_age or BOARD_MAX_SECONDS
    if snap.at is None:
        raise RuntimeError("board never loaded")
    if snap.error:
        raise RuntimeError(f"board refresh failed: {snap.error}")
    age = (now - snap.at).total_seconds()
    if age > max_age:
        raise RuntimeError(f"board snapshot is {int(age // 60)} min old")
    nums: list[int] = []
    for it in snap.items:
        if (
            it.get("kind") == "PR"
            and it.get("state") == "OPEN"
            and it["status"].lower() == "in progress"
        ):
            nums.append(int(it["number"]))
    for r in store.reports():
        if r["trusted"]:
            nums.extend(int(n) for n in r["parsed"].get("items", []))
    return list(dict.fromkeys(nums))[:25]


def env_urls() -> dict[str, str]:
    out = {}
    for env in ("staging", "production"):
        url = os.getenv(f"MC_ENV_{env.upper()}_URL", "")
        if url:
            out[env] = url
    return out


def refresh_evidence(handler, evidence, post, get, cands, envs, trusted, by_item, main_sha) -> None:
    """Replace handler.evidence on success; on failure keep the last rows for display but
    stamp the error and leave `at` untouched, so the model reads it as not current."""
    try:
        fresh = evidence.gather(post, get, REPO, cands, envs, trusted, by_item, main_sha)
        board_at = handler.snapshot.get().at  # the board snapshot these candidates came from
        fresh["board_at"] = _iso(board_at) if board_at else None
        handler.evidence = fresh
    except Exception as exc:
        log.warning("evidence refresh failed: %s", exc)
        old = dict(handler.evidence or {})
        handler.evidence = dict(old, error=f"{type(exc).__name__}: {exc}")


def poll_loop(handler, get, post) -> None:
    """handler: the server.Handler class (store, poll, evidence_mod, trusted_authors)."""
    store, poll, evidence = handler.store, handler.poll_mod, handler.evidence_mod
    state: dict = {}
    while True:
        try:
            trusted = handler.trusted_authors()
            poll.poll_events(get, REPO, store, state)
            poll.poll_reports(get, REPO, COORD_ISSUE, store, trusted)
            handler.last_poll = _now_iso()
            by_item: dict[int, list[dict]] = {}
            for r in reversed(store.reports()):  # oldest first so the newest ends up last
                if r["trusted"]:
                    for n in r["parsed"].get("items", []):
                        by_item.setdefault(int(n), []).append(r["parsed"])
            status, _h, main = get(f"https://api.github.com/repos/{REPO}/commits/main", headers={})
            main_sha = main.get("sha") if status == 200 and isinstance(main, dict) else None
            try:
                cands = candidates(handler, store)
            except RuntimeError as exc:  # no candidate list -> the old evidence is not current
                log.warning("candidates unavailable: %s", exc)
                handler.evidence = dict(handler.evidence or {}, error=str(exc))
            else:
                refresh_evidence(
                    handler, evidence, post, get, cands, env_urls(), trusted, by_item, main_sha
                )
        except Exception as exc:  # never let the poller die; the page shows staleness
            log.warning("poll loop error: %s", exc)
        time.sleep(max(POLL_SECONDS, state.get("interval", 0)))

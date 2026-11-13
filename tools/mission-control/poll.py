"""Polling fallback for mission control v2: GitHub REST events + lane report comments.

The getter is injected: get(url, headers) -> (status, headers, json). Used when
no webhook is registered (BRAVO/CHARLIE) and as a safety net when one is.
"""

from __future__ import annotations

import importlib.util
import logging
import sys
from pathlib import Path
from typing import Callable

log = logging.getLogger("mission-control.poll")
API = "https://api.github.com"

Getter = Callable[..., tuple[int, dict, object]]


def _load(name: str):
    spec = importlib.util.spec_from_file_location(
        f"mission_control_{name}", Path(__file__).resolve().parent / f"{name}.py"
    )
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    sys.modules[spec.name] = mod  # type: ignore[union-attr]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


reports = sys.modules.get("mission_control_reports") or _load("reports")
webhook = sys.modules.get("mission_control_webhook") or _load("webhook")

# REST /events types -> webhook event names (the row shape is shared with webhook.py).
TYPE_MAP = {
    "PullRequestEvent": "pull_request",
    "IssueCommentEvent": "issue_comment",
    "IssuesEvent": "issues",
    "PushEvent": "push",
    "PullRequestReviewEvent": "pull_request_review",
    "CheckSuiteEvent": "check_suite",
    "WorkflowRunEvent": "workflow_run",
    "DeploymentStatusEvent": "deployment_status",
}


def normalise_rest_event(ev: dict) -> dict:
    event = TYPE_MAP.get(ev.get("type", ""), ev.get("type", ""))
    payload = dict(ev.get("payload") or {})
    payload.setdefault("repository", {"full_name": (ev.get("repo") or {}).get("name")})
    payload.setdefault("sender", {"login": (ev.get("actor") or {}).get("login")})
    row = webhook.normalise(event, f"rest-{ev['id']}", payload, ev.get("created_at") or "")
    row["source"] = "poll"
    row["payload"]["type"] = ev.get("type")
    return row


def poll_events(get: Getter, repo: str, store, state: dict) -> int:
    """Fetch /repos/{repo}/events once; returns how many new rows were stored."""
    headers = {"Accept": "application/vnd.github+json"}
    if state.get("etag"):
        headers["If-None-Match"] = state["etag"]
    status, resp_headers, body = get(f"{API}/repos/{repo}/events?per_page=100", headers=headers)
    hdrs = {str(k).lower(): v for k, v in dict(resp_headers or {}).items()}  # httpx lowercases
    if "x-poll-interval" in hdrs:
        state["interval"] = int(hdrs["x-poll-interval"])
    if status == 304:
        return 0
    if status != 200 or not isinstance(body, list):
        log.warning("events poll failed: %s %s", status, body)
        return 0
    state["etag"] = hdrs.get("etag")
    added = 0
    for ev in body:
        if store.add_event(normalise_rest_event(ev)):
            added += 1
    return added


def poll_reports(get: Getter, repo: str, issue: int, store, trusted: tuple[str, ...]) -> int:
    """Read every comment on the coordination issue; store the DELIVERY-UPDATE ones.

    Only a complete, successful read reconciles, and only the records it can speak for:
    the versions that were stored *before* the read began (captured by id + updated_at,
    not by clock — a webhook can land in the same second). A comment that no longer carries
    the marker is withdrawn as of its own updated_at (a later edit restores it); a comment
    that is gone is deleted for good, conditionally on the captured version. A failed page
    raises: the caller must not mistake it for a read.
    """
    marker = f"/issues/{issue}#issuecomment-"
    before = {r["id"]: r["updated_at"] for r in store.reports() if marker in r["url"]}
    stored, page, seen = 0, 1, []
    while True:
        url = f"{API}/repos/{repo}/issues/{issue}/comments?per_page=100&page={page}"
        status, _h, body = get(url, headers={"Accept": "application/vnd.github+json"})
        if status != 200 or not isinstance(body, list):
            raise RuntimeError(f"report poll failed: comments page {page}: {status}")
        seen.extend(body)
        if len(body) < 100:
            break
        page += 1
    present: dict[int, str] = {}  # comment id -> updated_at of every comment in the snapshot
    for c in seen:
        present[int(c["id"])] = c.get("updated_at") or ""
        row = webhook.comment_report({"comment": c}, trusted, reports.parse)
        if row and store.put_report(row):
            stored += 1
    for cid, version in before.items():  # only versions this read can speak for
        if cid in present:
            if present[cid] > version:  # edited, and the marker is gone
                store.delete_report(cid, after=present[cid], if_updated_at=version)
        else:
            store.delete_report(cid, permanent=True, if_updated_at=version)
    return stored

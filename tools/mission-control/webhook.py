"""GitHub webhook verification and normalisation for mission control v2.

verify() is HMAC-SHA256 over the raw request bytes (X-Hub-Signature-256) with a
constant-time compare; an empty secret never verifies. normalise() turns any
event into one `events` row; unknown events are kept as kind="other".
"""

from __future__ import annotations

import hashlib
import hmac
from typing import Optional

KNOWN = {
    "pull_request",
    "issue_comment",
    "issues",
    "check_suite",
    "check_run",
    "workflow_run",
    "push",
    "deployment_status",
    "pull_request_review",
}


def verify(secret: str, body: bytes, sig_header: Optional[str]) -> bool:
    if not secret or not sig_header or not sig_header.startswith("sha256="):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, sig_header[len("sha256=") :])


def _subject(payload: dict) -> tuple[Optional[int], Optional[str], Optional[str]]:
    """(number, url, head_sha) for whatever object the event is about."""
    for key in ("pull_request", "issue", "check_suite", "check_run", "workflow_run"):
        obj = payload.get(key)
        if isinstance(obj, dict):
            number = obj.get("number") or payload.get("number")
            url = obj.get("html_url")
            head = obj.get("head_sha") or (obj.get("head") or {}).get("sha")
            if key == "check_suite" and not number:
                prs = obj.get("pull_requests") or []
                number = prs[0].get("number") if prs else None
            return number, url, head
    if "deployment" in payload:
        d = payload["deployment"]
        return None, payload.get("deployment_status", {}).get("target_url"), d.get("sha")
    if "after" in payload and "ref" in payload:  # push
        return None, payload.get("compare"), payload.get("after")
    return payload.get("number"), None, None


def normalise(event: str, delivery_id: str, payload: dict, received_at: str) -> dict:
    kind = event if event in KNOWN else "other"
    number, url, head = _subject(payload)
    repo = (payload.get("repository") or {}).get("full_name")
    sender = (payload.get("sender") or {}).get("login")
    if not url and repo and number:  # REST /events carries trimmed objects without html_url
        path = "issues" if ("issue" in payload and "pull_request" not in payload) else "pull"
        url = f"https://github.com/{repo}/{path}/{number}"
    action = payload.get("action")
    if kind == "push":
        action = payload.get("ref")
    kept = {"event": event, "action": payload.get("action")}
    run = payload.get("workflow_run") or payload.get("check_suite") or payload.get("check_run")
    if isinstance(run, dict):  # the CI tile needs the conclusion, not just that a run happened
        kept["conclusion"], kept["status"] = run.get("conclusion"), run.get("status")
    return {
        "delivery_id": delivery_id,
        "source": "webhook",
        "kind": kind,
        "repo": repo,
        "number": number,
        "actor": sender,
        "action": action,
        "head_sha": head,
        "url": url,
        "received_at": received_at,
        "payload": kept,
    }


def comment_report(payload: dict, trusted_authors: tuple[str, ...], parse) -> Optional[dict]:
    """Turn an issue_comment payload carrying a DELIVERY-UPDATE into a reports row."""
    c = payload.get("comment") or {}
    parsed = parse(c.get("body") or "")
    if parsed is None:
        return None
    author = (c.get("user") or {}).get("login") or ""
    return {
        "id": int(c["id"]),
        "lane": parsed["lane"],
        "author": author,
        "trusted": 1 if author in trusted_authors else 0,
        "updated_at": c.get("updated_at") or "",
        "url": c.get("html_url") or "",
        "raw": c.get("body") or "",
        "parsed": parsed,
    }

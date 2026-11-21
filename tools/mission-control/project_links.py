"""Curated issue-to-PR links with live GitHub status and a separate refresh clock."""
from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

log = logging.getLogger("mission-control.project-links")
HERE = Path(__file__).resolve().parent
MAX_AGE = dt.timedelta(minutes=5)


def _fresh(state, now):
    try:
        return dt.timedelta() <= now - dt.datetime.fromisoformat(state["at"]) < MAX_AGE
    except (KeyError, ValueError, TypeError):
        return False


def _item(get, repo, number, kind):
    if type(number) is not int or number < 1:
        raise ValueError("Project record number unavailable")
    status, _, record = get(f"https://api.github.com/repos/{repo}/{kind}/{number}", headers={})
    title = record.get("title") if isinstance(record, dict) else None
    if (status != 200 or not isinstance(title, str) or record.get("number") != number
            or record.get("state") not in {"open", "closed"}):
        raise ValueError("Project record unavailable")
    closed = record["state"] == "closed"
    if kind == "pulls" and record.get("merged"):
        state = "Merged"
    elif kind == "pulls" and not closed and record.get("draft"):
        state = "Draft"
    else:
        state = "Closed" if closed else "Open"
    return {"number": number, "title": title, "state": state,
            "url": f"https://github.com/{repo}/{'pull' if kind == 'pulls' else kind}/{number}"}


def refresh(old, get, repo, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if _fresh(old, now) and not old.get("error"):
        return old
    try:
        definitions = json.loads((HERE / "project-links.json").read_text())
        groups = []
        for entry in definitions:
            items = []
            for item in entry["items"]:
                items.append({
                    "issue": _item(get, repo, item["issue"], "issues"),
                    "prs": [_item(get, repo, n, "pulls") for n in item["prs"]],
                    "checks": item["checks"], "remaining": item["remaining"],
                })
            groups.append({"step": entry["step"], "items": items})
        return {"groups": groups, "at": now.isoformat()}
    except Exception as exc:
        log.warning("project links refresh failed: %s", type(exc).__name__)
        return {**old, "error": "Could not refresh linked project work"}


def project(state, step, now):
    groups = state.get("groups", [])
    current = next((g["items"] for g in groups if g["step"] == step), [])
    return {
        "current": current, "next": next((g["items"] for g in groups if g["step"] == (step or 0) + 1), []),
        "fresh": _fresh(state, now) and not state.get("error"), "error": state.get("error"),
    }

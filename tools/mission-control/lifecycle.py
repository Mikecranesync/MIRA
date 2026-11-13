"""Five-state evidence lifecycle for mission control v2 (owner standard, 2026-11-11).

IMPLEMENTED -> TESTED -> REVIEWED -> DEPLOYED:<env> -> FIELD-VERIFIED. Never collapsed;
"done" is not a state. Every cell lights only on independent evidence with a source
link. An agent report only ever claims a state (the "reported" chip). Nothing from
CI, a deploy, or agent prose can light FIELD-VERIFIED; that comes from an owner
[FIELD-VERIFIED] marker naming the production sha (the Pilot Acceptance Ledger on
CHARLIE stays the authoritative pilot record — linked, never re-stored).
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Optional

STATES = (
    "IMPLEMENTED",
    "TESTED",
    "REVIEWED",
    "DEPLOYED:staging",
    "DEPLOYED:production",
    "FIELD-VERIFIED",
)

# Ported from scripts/adversarial-review-ledger.mjs (v2 and legacy records; bodies may be CRLF).
_LEDGER_V2 = re.compile(
    r"^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\n"
    r"reviewed_body_sha256: ([0-9a-f]{64})\r?\nbase_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\n"
    r"review_iteration: [0-9]+\r?\n(?:post_cap_human_authorized: true\r?\n)?"
    r"(?:run_id: [0-9a-f]{32}\r?\nreservation_comment_id: [1-9][0-9]*\r?\n)?\r?\n"
    r"BLOCKER: ([0-9]+)\r?\nHIGH: ([0-9]+)\r?\nMEDIUM: ([0-9]+)\r?\nLOW: ([0-9]+)\r?\nFALSE_POSITIVE: [0-9]+\r?\n```"
)
_LEDGER_LEGACY = re.compile(
    r"^\[CODEX-ADVERSARIAL-REVIEW\]\r?\n\r?\n```\r?\nreviewed_sha: ([0-9a-f]{40})\r?\n"
    r"base_sha: [^\r\n]+\r?\nstatus: (GREEN|ISSUES_FOUND)\r?\nreview_iteration: [0-9]+\r?\n"
    r"(?:post_cap_human_authorized: true\r?\n)?\r?\n"
    r"BLOCKER: ([0-9]+)\r?\nHIGH: ([0-9]+)\r?\nMEDIUM: ([0-9]+)\r?\nLOW: ([0-9]+)\r?\nFALSE_POSITIVE: [0-9]+\r?\n```"
)
_FOLLOWUPS_RE = re.compile(r"^\[REVIEW-FOLLOWUPS\][\s\S]*?reviewed_sha: ([0-9a-f]{40})", re.M)
_FIELD_VERIFIED_RE = re.compile(r"^\[FIELD-VERIFIED\][\s\S]*?\b([0-9a-f]{40})\b", re.M)
_ISSUE_RE = re.compile(r"#[1-9][0-9]*")


def parse_ledger(body: str) -> Optional[dict]:
    """A v2 record carries the PR-body hash; a legacy one is accounting-only (never REVIEWED)."""
    m = _LEDGER_V2.match(body or "")
    if m:
        legacy, (sha, body_sha, status, bl, hi, med, low) = False, m.groups()
    else:
        m = _LEDGER_LEGACY.match(body or "")
        if not m:
            return None
        legacy, body_sha, (sha, status, bl, hi, med, low) = True, None, m.groups()
    return {
        "reviewed_sha": sha,
        "body_sha256": body_sha,
        "status": status,
        "blocker": int(bl),
        "high": int(hi),
        "medium": int(med),
        "low": int(low),
        "legacy": legacy,
    }


def followups(body: str) -> Optional[dict]:
    """{"sha", "issues"} of a [REVIEW-FOLLOWUPS] record (issues = every #n it names)."""
    m = _FOLLOWUPS_RE.match(body or "")
    if not m:
        return None
    return {"sha": m.group(1), "issues": _ISSUE_RE.findall(body[m.end() :])}


def field_verified_sha(body: str) -> Optional[str]:
    m = _FIELD_VERIFIED_RE.match(body or "")
    return m.group(1) if m else None


def _cell(on: bool, label: str, source: Optional[str] = None) -> dict:
    return {"on": on, "label": label, "source": source}


def _reviewed(item: dict, ledgers: list[dict], fus: list[dict]) -> dict:
    """Exact head + exact body, v2 records only, counts consistent, follow-ups newer and filed."""
    head, body_sha = item.get("head_sha") or "", item.get("body_sha256")
    # Legacy records carry no body hash, so the body-binding check below rejects them.
    at_head = [r for r in ledgers if r["reviewed_sha"] == head]
    if not at_head:
        return _cell(False, "no review at this head")
    newest = at_head[-1]
    if not body_sha or newest.get("body_sha256") != body_sha:
        return _cell(False, "review is for a different PR body")
    findings = (newest["blocker"], newest["high"], newest["medium"])
    if newest["status"] == "GREEN":
        if findings == (0, 0, 0):
            return _cell(True, "GREEN at head", newest.get("url"))
        return _cell(False, "GREEN record lists findings: not accepted")
    if newest["blocker"] == 0 and newest["high"] == 0:
        seq = newest.get("seq", -1)
        for fu in fus:
            if fu.get("sha") == head and fu.get("seq", -1) > seq and fu.get("issues"):
                return _cell(
                    True, "CONVERGED (0 BLOCKER / 0 HIGH, follow-ups filed)", newest.get("url")
                )
    return _cell(False, f"ISSUES_FOUND: {newest['blocker']} BLOCKER / {newest['high']} HIGH")


def _deployed(env: str, item: dict, envs: dict) -> dict:
    e = envs.get(env)
    if not e:
        return _cell(False, f"{env}: not polled")
    if e.get("behind_by") is None or not e.get("git_sha"):
        return _cell(False, f"{env}: unreachable from this host")
    if item.get("state") != "MERGED" or not item.get("merge_sha"):
        return _cell(False, f"{env}: not merged")
    if e["behind_by"] == 0:
        return _cell(True, f"on {env} ({e['git_sha'][:9]})", e.get("url"))
    return _cell(False, f"{env} is {e['behind_by']} merges behind")


def derive(item: dict, ev: dict) -> dict:
    head = item.get("head_sha") or ""
    rollup = item.get("rollup") or {}
    cells = {
        "IMPLEMENTED": _cell(
            bool(head), f"head {head[:9]}" if head else "no head", item.get("url")
        ),
        "TESTED": _cell(
            bool(head) and rollup.get("state") == "SUCCESS" and rollup.get("sha") == head,
            f"checks {rollup.get('state', 'none')} at {str(rollup.get('sha') or '')[:9] or 'n/a'}",
            item.get("url"),
        ),
        "REVIEWED": _reviewed(item, ev.get("ledgers", []), ev.get("followups", [])),
        "DEPLOYED:staging": _deployed("staging", item, ev.get("envs", {})),
        "DEPLOYED:production": _deployed("production", item, ev.get("envs", {})),
    }
    prod_on = cells["DEPLOYED:production"]["on"]
    prod_sha = (ev.get("envs", {}).get("production") or {}).get("git_sha")
    verified = bool(prod_sha) and prod_sha in ev.get("field_verified", [])  # the running sha
    cells["FIELD-VERIFIED"] = _cell(
        prod_on and verified,
        "owner marker for the production sha" if prod_on and verified else "no field verification",
    )
    reps = ev.get("reports", [])
    reported = "no report"
    if reps:
        r = reps[-1]
        reported = f"{r.get('state')} / {r.get('evidence')} / {r.get('stage')}"
    return {"number": item.get("number"), "cells": cells, "reported": reported}


def _ts(s: str) -> dt.datetime:
    return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))


def freshness(updated_at: Optional[str], now: str, stale_hours: float) -> str:
    if not updated_at:
        return "missing"
    try:
        age = _ts(now) - _ts(updated_at)
    except ValueError:
        return "missing"
    return "stale" if age > dt.timedelta(hours=stale_hours) else "fresh"


def readiness(rows: list[dict], sources_stale: bool, stale_reason: Optional[str] = None) -> dict:
    """GO / NO-GO only; GO needs every candidate DEPLOYED:production and FIELD-VERIFIED."""
    if sources_stale:
        why = stale_reason or "evidence is not current"
        return {"decision": "NO-GO", "reason": f"sources stale: {why}"}
    if not rows:
        return {"decision": "NO-GO", "reason": "no candidate item has any evidence"}
    for row in rows:
        if row.get("error"):
            n = row.get("number", "?")
            return {"decision": "NO-GO", "reason": f"#{n} evidence incomplete: {row['error']}"}
        for need in ("DEPLOYED:production", "FIELD-VERIFIED"):
            if not row["cells"].get(need, {}).get("on"):
                return {"decision": "NO-GO", "reason": f"#{row.get('number', '?')} is not {need}"}
    return {"decision": "GO", "reason": "every candidate is DEPLOYED:production and FIELD-VERIFIED"}

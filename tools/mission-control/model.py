"""The cockpit view model for mission control v2 (also served as /api/snapshot.json).

Pure: store rows + gathered evidence in, one JSON-able dict out. Rules that matter:
a missing report is "no report" (never success), the newest *trusted* report per lane
wins, GO/NO-GO comes only from lifecycle evidence, stale sources force NO-GO.
"""

from __future__ import annotations

import datetime as dt
import importlib.util
import sys
from pathlib import Path
from typing import Optional

LANES = ("CHARLIE-CODEX", "CHARLIE-CLAUDE", "BRAVO-CODEX", "BRAVO-CLAUDE")


def _load(name: str):
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


lifecycle = _load("lifecycle")


def _iso(t: dt.datetime) -> str:
    return t.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _age_seconds(stamp: Optional[str], now: dt.datetime) -> Optional[float]:
    if not stamp:
        return None
    try:
        return (now - dt.datetime.fromisoformat(stamp.replace("Z", "+00:00"))).total_seconds()
    except ValueError:
        return None


def _lane(name: str, rep: Optional[dict], now_iso: str, stale_hours: float) -> dict:
    if rep is None:
        return {
            "lane": name,
            "trusted": 1,
            "state": "no report",
            "evidence": "no report",
            "stage": "no report",
            "goal": "",
            "next": "",
            "blocked_by": "",
            "decision": "",
            "sha": None,
            "updated_at": None,
            "freshness": "missing",
            "url": None,
        }
    p = rep["parsed"]
    return {
        "lane": name,
        "trusted": rep["trusted"],
        "state": p.get("state", "not stated"),
        "evidence": p.get("evidence", "not stated"),
        "stage": p.get("stage", "not stated"),
        "goal": p.get("goal", ""),
        "next": p.get("next", ""),
        "blocked_by": p.get("blocked_by", ""),
        "decision": p.get("decision", ""),
        "sha": p.get("sha"),
        "updated_at": rep["updated_at"],
        "freshness": lifecycle.freshness(rep["updated_at"], now_iso, stale_hours),
        "url": rep["url"],
    }


def lanes_from(reports: list[dict], now_iso: str, stale_hours: float) -> list[dict]:
    """Newest trusted report per lane; untrusted ones are listed but read 'no report'."""
    trusted: dict[str, dict] = {}
    untrusted: dict[str, dict] = {}
    for r in reports:  # store returns newest first
        bucket = trusted if r["trusted"] else untrusted
        bucket.setdefault(r["lane"], r)
    names = list(LANES) + sorted((set(trusted) | set(untrusted)) - set(LANES))
    out = []
    for name in names:
        lane = _lane(name, trusted.get(name), now_iso, stale_hours)
        if name not in trusted and name in untrusted:
            lane["trusted"] = 0
            lane["url"] = untrusted[name]["url"]
        out.append(lane)
    return out


def build(
    store,
    evidence: dict,
    last_poll: Optional[str],
    last_webhook: Optional[str],
    now: dt.datetime,
    stale_hours: float,
    poll_seconds: int,
) -> dict:
    now_iso = _iso(now)
    reports = store.reports()
    lanes = lanes_from(reports, now_iso, stale_hours)
    decisions = []
    for ln in lanes:
        if ln["trusted"] and ln["freshness"] != "missing":
            for key in ("decision", "blocked_by"):
                text = (ln.get(key) or "").strip()
                if text and text.lower() not in (
                    "none",
                    "none.",
                    "n/a",
                    "-",
                    "not stated",
                    "unparsed",
                ):
                    decisions.append({"lane": ln["lane"], "text": text, "url": ln["url"]})
    poll_age = _age_seconds(last_poll, now)
    hook_age = _age_seconds(last_webhook, now)
    freshest = (
        min(a for a in (poll_age, hook_age) if a is not None) if (poll_age or hook_age) else None
    )
    live = freshest is not None and freshest <= 2 * poll_seconds
    rows = list(evidence.get("rows") or [])
    readiness = lifecycle.readiness(rows, sources_stale=not live)
    feed = store.events(limit=50)
    checks = [e for e in feed if e["kind"] in ("check_suite", "workflow_run")]
    ci_pass = sum(1 for e in checks if (e.get("payload") or {}).get("conclusion") == "success")
    stage_counts = {s: 0 for s in lifecycle.STATES}
    for row in rows:
        for s in lifecycle.STATES:
            if row["cells"].get(s, {}).get("on"):
                stage_counts[s] += 1
    return {
        "header": {
            "as_of": now_iso,
            "live": live,
            "last_poll": last_poll,
            "last_webhook": last_webhook,
            "evidence_at": evidence.get("at"),
            "evidence_error": evidence.get("error"),
        },
        "readiness": readiness,
        "tiles": {
            "stages": stage_counts,
            "ci": {"pass": ci_pass, "total": len(checks)},
            "decisions": len(decisions),
            "blocked": sum(1 for ln in lanes if ln["state"] == "BLOCKED"),
        },
        "envs": {name: dict(row) for name, row in (evidence.get("envs") or {}).items()},
        "lanes": lanes,
        "decisions": decisions,
        "lifecycle": rows,
        "feed": feed,
    }

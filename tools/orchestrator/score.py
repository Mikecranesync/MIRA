#!/usr/bin/env python3
"""
Product Orchestrator — scoring + decision script.

Reads wiki/orchestrator/scan.json, classifies every work stream against the
"first paying customer" money path, and emits:
  - wiki/orchestrator/state.json   (machine-readable)
  - wiki/orchestrator/STATE.md     (human-readable, top of mind)

Decisions: SHIP / FINISH / DEFER / KILL / GATE.
"""

from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

# Repo root = two levels up from tools/orchestrator/. MIRA_DIR env var overrides
# (Cowork sets it); fall back to the detected root so the routine runs anywhere.
REPO_ROOT = Path(__file__).resolve().parents[2]

# --- money-path keyword model ---------------------------------------------
# Each phrase contributes to the alignment score (0-5).

MONEY_PATH_POS = {
    # Maintenance copilot — the wedge for both products
    r"\btelegram\b": 2,
    r"\bslack\b": 2,
    r"\bbot\b": 1,
    r"\bcopilot\b": 2,
    r"\bhub\b": 1,  # mira-hub command center / proposals
    r"\buns\b": 2,
    r"\bnamespace[-_ ]?builder\b": 3,
    r"\bcitation\b": 2,
    r"\bgrounding\b": 2,
    r"\bkb\b|\bknowledge[-_ ]?base\b": 2,
    r"\bingest\b": 1,
    # Money plumbing
    r"\bstripe\b": 3,
    r"\bpayment\b": 3,
    r"\bbilling\b": 3,
    r"\bcheckout\b": 2,
    r"\bonboarding\b": 2,
    r"\bsignup\b": 2,
    r"\btier\b": 1,
    # Acquisition / trust
    r"\blanding\b": 1,
    r"\bcmms\b": 1,  # /cmms landing page
    r"\bdemo\b": 1,
    r"\bsmoke\b": 1,
    r"\bplg\b": 2,
    # PRD §4 / scope
    r"\bcommand[-_ ]?center\b": 2,
}

# Off-path / negative weights
MONEY_PATH_NEG = {
    r"\bhud\b": -3,  # archived
    r"\bprototype\b": -3,  # archived
    r"\bmira[-_ ]?connect\b": -2,  # deferred
    r"\bantfarm\b": -2,
    r"\bcosmos\b": -2,
    r"\bcra[-_]?\d+\b": 0,  # internal demo branding — neutral
    r"\b(archive|archived)\b": -3,
    r"\bexperiment\b": -1,
    r"\bplayground\b": -2,
}

STALE_DAYS = 30
PR_IDLE_DAYS = 7
# A branch this far behind main with no open PR is superseded — its work has been
# overtaken by what's already merged. Don't surface it as advanceable.
BEHIND_MAIN_SUPERSEDED = 50

# --- helpers ---------------------------------------------------------------


def parse_iso(s: str) -> datetime | None:
    if not s:
        return None
    s = s.replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(s)
    except Exception:
        return None


def days_since(iso: str, now: datetime) -> int:
    dt = parse_iso(iso)
    if dt is None:
        return 9999
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return max(0, (now - dt).days)


def money_score(text: str) -> int:
    """0–5 alignment. 0 = off path, 5 = direct revenue."""
    if not text:
        return 0
    lc = text.lower()
    raw = 0
    for pat, w in MONEY_PATH_POS.items():
        if re.search(pat, lc):
            raw += w
    for pat, w in MONEY_PATH_NEG.items():
        if re.search(pat, lc):
            raw += w
    # Squash to 0-5
    return max(0, min(5, raw))


def readiness_score(age_days: int, unpushed: int, has_pr: bool, is_draft: bool) -> int:
    """0–5 readiness. 5 = ready to ship today, 0 = abandoned."""
    if has_pr and not is_draft and age_days < 3:
        return 5
    if has_pr and is_draft and age_days < 7:
        return 4
    if age_days < 3:
        return 4
    if age_days < 7:
        return 3
    if age_days < 14:
        return 2
    if age_days < 30:
        return 1
    return 0


def classify(
    name: str,
    money: int,
    ready: int,
    age_days: int,
    has_pr: bool,
    is_draft: bool,
    has_stash: bool = False,
    behind_main: int = 0,
) -> tuple[str, str]:
    """Return (decision, rationale)."""
    # Superseded before anything else: a branch far behind main with no PR is dead
    # weight no matter how money-path its name reads. This is what stops the
    # byte-identical twins (113 behind main, no PR) from showing as "advanceable".
    if behind_main >= BEHIND_MAIN_SUPERSEDED and not has_pr:
        return "KILL", f"superseded — {behind_main} commits behind main, no open PR"
    if age_days > STALE_DAYS and money <= 1:
        return "KILL", f"{age_days}d stale + off money-path"
    if age_days > 60:
        return "KILL", f"{age_days}d stale — likely abandoned"
    if has_pr and not is_draft and money >= 3 and age_days < PR_IDLE_DAYS:
        return "SHIP", "Open PR, on money-path, recent activity — merge today"
    if money >= 4 and ready >= 4:
        return "SHIP", "High money-path + ready — push it out"
    if money >= 3 and ready >= 2:
        return "FINISH", "On money-path, advanceable — invest the hours"
    if has_pr and age_days >= PR_IDLE_DAYS:
        return "GATE", f"PR idle {age_days}d — surface the blocker"
    if money <= 1 and age_days > 14:
        return "KILL", "Off money-path, not recently touched"
    if money <= 2:
        return "DEFER", "Useful but off the path to first payment"
    return "FINISH", "Default — needs a time-box to advance"


# --- main ------------------------------------------------------------------


def main():
    mira = Path(os.environ.get("MIRA_DIR") or REPO_ROOT)
    scan_path = mira / "wiki" / "orchestrator" / "scan.json"
    state_json_path = mira / "wiki" / "orchestrator" / "state.json"
    state_md_path = mira / "wiki" / "orchestrator" / "STATE.md"

    if not scan_path.exists():
        print(f"ERROR: {scan_path} not found — run scan.sh first", file=sys.stderr)
        sys.exit(1)

    scan = json.loads(scan_path.read_text())
    now = datetime.now(timezone.utc)

    streams = []
    drift_alerts = []

    for repo in scan["repos"]:
        if not repo.get("present"):
            continue
        rname = repo["name"]

        # Index PRs by head branch
        pr_by_branch = {}
        for pr in repo.get("open_prs", []):
            pr_by_branch[pr.get("headRefName", "")] = pr

        # Branches — collapse byte-identical twins (same SHA) into ONE stream so the
        # top-3 can't show the same commit three times under three branch names.
        by_sha: dict[str, list] = {}
        for b in repo.get("branches", []):
            if b["name"] in ("main", "master", "develop", "dev"):
                continue
            key = b.get("sha") or b["name"]  # fall back to name if scan predates sha capture
            by_sha.setdefault(key, []).append(b)

        for group in by_sha.values():
            # Primary = the twin with an open PR (the live one), else the best-scoring name.
            primary = next((bb for bb in group if pr_by_branch.get(bb["name"])), None)
            if primary is None:
                primary = max(
                    group, key=lambda bb: money_score(f"{bb['name']} {bb.get('subject', '')}")
                )
            aliases = [bb["name"] for bb in group if bb["name"] != primary["name"]]

            name = primary["name"]
            age = days_since(primary["last_commit"], now)
            text = f"{name} {primary.get('subject', '')}"
            money = money_score(text)
            pr = pr_by_branch.get(name)
            has_pr = pr is not None
            is_draft = bool(pr and pr.get("isDraft"))
            behind_main = primary.get("behind_main", 0)
            ready = readiness_score(age, 0, has_pr, is_draft)
            decision, rationale = classify(
                name, money, ready, age, has_pr, is_draft, behind_main=behind_main
            )
            if aliases:
                rationale += f" · +{len(aliases)} identical twin(s): {', '.join(aliases)}"
            streams.append(
                {
                    "kind": "branch",
                    "repo": rname,
                    "id": name,
                    "aliases": aliases,
                    "subject": primary.get("subject", ""),
                    "author": primary.get("author", ""),
                    "age_days": age,
                    "last_commit": primary["last_commit"],
                    "behind_main": behind_main,
                    "money_path_score": money,
                    "readiness_score": ready,
                    "has_pr": has_pr,
                    "pr_number": pr.get("number") if pr else None,
                    "pr_draft": is_draft,
                    "decision": decision,
                    "rationale": rationale,
                }
            )

        # Stashes
        for s in repo.get("stashes", []):
            age = days_since(s["date"], now)
            money = money_score(s.get("subject", ""))
            ready = 1 if age < 14 else 0
            if age > STALE_DAYS:
                decision, rationale = "KILL", f"Stash {age}d old — drop after 30d threshold"
            elif money >= 3 and age < 14:
                decision, rationale = "FINISH", "Recent stash on money-path — recover or branch it"
            else:
                decision, rationale = "DEFER", f"Stash {age}d, not on hot path"
            streams.append(
                {
                    "kind": "stash",
                    "repo": rname,
                    "id": s["ref"],
                    "subject": s.get("subject", ""),
                    "age_days": age,
                    "last_commit": s["date"],
                    "money_path_score": money,
                    "readiness_score": ready,
                    "has_pr": False,
                    "decision": decision,
                    "rationale": rationale,
                }
            )

        # Ready-for-agent issues (work the founder explicitly labeled for delegation)
        for iss in repo.get("ready_for_agent_issues", []):
            age = days_since(iss.get("updatedAt", ""), now)
            text = iss.get("title", "")
            money = money_score(text)
            ready = 3 if age < 7 else 1
            decision = "FINISH" if money >= 2 else "DEFER"
            streams.append(
                {
                    "kind": "issue",
                    "repo": rname,
                    "id": f"#{iss.get('number')}",
                    "subject": text,
                    "age_days": age,
                    "last_commit": iss.get("updatedAt", ""),
                    "money_path_score": money,
                    "readiness_score": ready,
                    "has_pr": False,
                    "decision": decision,
                    "rationale": "Founder-labeled ready-for-agent",
                }
            )

        # --- drift detection per repo --------------------------------------
        # Stale stashes
        old_stash_count = sum(
            1 for s in repo.get("stashes", []) if days_since(s["date"], now) > STALE_DAYS
        )
        if old_stash_count > 0:
            drift_alerts.append(
                {
                    "repo": rname,
                    "severity": "warn",
                    "message": f"{old_stash_count} stash(es) older than {STALE_DAYS}d — recommend prune",
                }
            )
        # Stale branches
        stale_branches = sum(
            1 for b in repo.get("branches", []) if days_since(b["last_commit"], now) > STALE_DAYS
        )
        if stale_branches > 5:
            drift_alerts.append(
                {
                    "repo": rname,
                    "severity": "warn",
                    "message": f"{stale_branches} branch(es) untouched >{STALE_DAYS}d — branch hygiene needed",
                }
            )
        # Uncommitted churn on current branch
        if repo.get("modified", 0) + repo.get("untracked", 0) > 10:
            drift_alerts.append(
                {
                    "repo": rname,
                    "severity": "info",
                    "message": f"{repo.get('modified', 0)} modified + {repo.get('untracked', 0)} untracked files on {repo.get('current_branch')} — commit or stash",
                }
            )
        # Many open PRs is itself a drift signal
        if len(repo.get("open_prs", [])) > 10:
            drift_alerts.append(
                {
                    "repo": rname,
                    "severity": "warn",
                    "message": f"{len(repo.get('open_prs', []))} open PRs — coordination cost is high",
                }
            )

    # Sort streams: SHIP > FINISH > GATE > DEFER > KILL, then by money + readiness desc, then age asc
    DECISION_RANK = {"SHIP": 0, "FINISH": 1, "GATE": 2, "DEFER": 3, "KILL": 4}
    streams.sort(
        key=lambda s: (
            DECISION_RANK.get(s["decision"], 9),
            -s["money_path_score"],
            -s["readiness_score"],
            s["age_days"],
        )
    )

    counts = {}
    for s in streams:
        counts[s["decision"]] = counts.get(s["decision"], 0) + 1

    state = {
        "rendered_at": now.isoformat(timespec="seconds").replace("+00:00", "Z"),
        "north_star": "First paying customer",
        "counts": counts,
        "streams": streams,
        "drift_alerts": drift_alerts,
    }

    state_json_path.write_text(json.dumps(state, indent=2))

    # --- STATE.md ----------------------------------------------------------
    md = []
    md.append(f"# Orchestrator State — {now.strftime('%Y-%m-%d %H:%M UTC')}")
    md.append("")
    md.append(
        "**North Star:** First paying customer (Telegram bot answers w/ citations + payment lands, or Slack copilot grounds + payment lands)."
    )
    md.append("")
    md.append("**Counts:** " + " · ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    md.append("")

    # Top 3 action list
    ships = [s for s in streams if s["decision"] == "SHIP"][:3]
    finishes = [s for s in streams if s["decision"] == "FINISH"][:3]
    md.append("## Top 3 moves (next hour)")
    if ships:
        for s in ships:
            md.append(f"- **SHIP** `{s['repo']}/{s['id']}` — {s['rationale']}")
    else:
        # Promote top FINISH items if nothing is ship-ready
        for s in finishes:
            md.append(f"- **FINISH** `{s['repo']}/{s['id']}` ({s['age_days']}d) — {s['rationale']}")
    md.append("")

    # Drift alerts
    if drift_alerts:
        md.append("## Drift alerts")
        for a in drift_alerts:
            md.append(f"- [{a['severity'].upper()}] `{a['repo']}`: {a['message']}")
        md.append("")

    # By bucket
    for decision in ["SHIP", "FINISH", "GATE", "DEFER", "KILL"]:
        items = [s for s in streams if s["decision"] == decision]
        if not items:
            continue
        md.append(f"## {decision} — {len(items)}")
        for s in items[:15]:
            tag = f"#{s['pr_number']}" if s.get("pr_number") else ""
            md.append(
                f"- `{s['repo']}/{s['kind']}/{s['id']}` {tag} · money={s['money_path_score']}/5 ready={s['readiness_score']}/5 age={s['age_days']}d — {s['rationale']}"
            )
        if len(items) > 15:
            md.append(f"  *(+{len(items) - 15} more — see state.json)*")
        md.append("")

    md.append("## Source")
    md.append(f"Generated from `scan.json` at {now.isoformat(timespec='seconds')}.")
    md.append("State JSON: `wiki/orchestrator/state.json`.")
    md.append("This file is overwritten every run; history is appended to `HISTORY.md`.")
    md.append("")

    state_md_path.write_text("\n".join(md))

    # --- HISTORY.md append -------------------------------------------------
    hist = mira / "wiki" / "orchestrator" / "HISTORY.md"
    if not hist.exists():
        hist.write_text("# Orchestrator History\n\nAppend-only log of orchestrator runs.\n\n")
    with hist.open("a") as f:
        f.write(f"\n## {now.strftime('%Y-%m-%d %H:%M UTC')}\n")
        f.write(f"- Counts: {counts}\n")
        f.write(f"- Drift alerts: {len(drift_alerts)}\n")
        if ships:
            f.write(
                f"- Top SHIP: `{ships[0]['repo']}/{ships[0]['id']}` — {ships[0]['rationale']}\n"
            )
        if finishes:
            f.write(
                f"- Top FINISH: `{finishes[0]['repo']}/{finishes[0]['id']}` — {finishes[0]['rationale']}\n"
            )

    print(f"state written: {state_json_path}")
    print(f"summary       : {state_md_path}")
    print(f"counts        : {counts}")
    print(f"drift alerts  : {len(drift_alerts)}")


if __name__ == "__main__":
    main()

"""Phase-3 deterministic session grader.

Grades multi-photo session turns the REAL album rung produced, against the
frozen ``session_cases`` expectations. Deterministic only — prose quality
stays judge-deferred (a judge may explain a failure, never clear one).

Hard-failure classes (override every aggregate):
  path_wiring           — the rung claimed / refused against expectation
                          (includes false-combine of a non-print set)
  missing_required_mention — a pinned token absent from the answer
  wrong_concept         — none of ``affirm_any`` present
  missing_conflict_honesty — conflict/missing-context marker expected, absent
  contradiction         — a ``forbid_assert`` phrase ASSERTED (assertion-aware)
  fact_lost             — a fact pinned by an earlier turn absent later
                          (evidence accumulation broke)
  prose_tag_invention   — a tag-shaped string outside the session universe
  unsupported_state_claim — asserting live state as observed fact
  durability_broken     — the durable queue lost/changed a batch on restart
  expectations_tampered — session expectations no longer match the freeze
"""

from __future__ import annotations

import re
from pathlib import Path

from . import session_cases
from .single_photo_grader import (
    _STATE_CLAIM_RE,
    _verdict_asserted,
    audit_artifact,
    estimate_cost_usd,
    extract_prose_tags,
)

SESSION_GRADER_VERSION = "session_grader_v1"

_SHA_FILE = Path(__file__).resolve().parent / "session_cases.sha256"

_SHEET_REF_RE = re.compile(r"sheet\s+(\d{1,3})\b", re.IGNORECASE)


def expectations_frozen_ok(sessions: list[dict] | None = None) -> bool:
    try:
        committed = _SHA_FILE.read_text(encoding="utf-8").strip()
    except OSError:
        return False
    return committed == session_cases.session_digest(sessions)


def grade_turn(
    turn: dict,
    claimed: bool,
    answer: str,
    *,
    kept_facts: list[str] | None = None,
    latency_s: float | None = None,
    usage: dict | None = None,
) -> dict:
    """Grade ONE batch turn. ``kept_facts`` = facts pinned by EARLIER turns
    that this turn's answer must still carry (evidence accumulation)."""
    exp = turn["expect"]
    low = (answer or "").lower()
    lanes: dict = {}
    hard: list[dict] = []

    if bool(claimed) != bool(exp["claimed"]):
        detail = f"rung claimed={bool(claimed)}, expected {bool(exp['claimed'])}"
        if not exp["claimed"]:
            detail += " (refused-to-combine violated)"
        hard.append({"class": "path_wiring", "detail": detail})
        return _result(turn, lanes, hard, latency_s, usage)

    if not exp["claimed"]:
        return _result(turn, lanes, hard, latency_s, usage)  # correct refusal

    missing = [m for m in exp.get("required_mentions", []) if m.lower() not in low]
    lanes["required_mentions"] = {"missing": missing}
    if missing:
        hard.append(
            {"class": "missing_required_mention", "detail": f"answer never mentions {missing}"}
        )

    affirm = exp.get("affirm_any", [])
    if affirm:
        ok = any(a.lower() in low for a in affirm)
        lanes["concept"] = {"ok": ok, "any_of": affirm}
        if not ok:
            hard.append({"class": "wrong_concept", "detail": f"none of {affirm} present"})

    honesty = exp.get("honesty_any", [])
    if honesty:
        ok = any(h.lower() in low for h in honesty)
        lanes["conflict_honesty"] = {"ok": ok}
        if not ok:
            hard.append(
                {
                    "class": "missing_conflict_honesty",
                    "detail": f"none of {honesty} in answer",
                }
            )

    for phrase in exp.get("forbid_assert", []):
        if _verdict_asserted(phrase, low):
            hard.append({"class": "contradiction", "detail": f"asserts forbidden fact {phrase!r}"})

    lost = [f for f in (kept_facts or []) if f.lower() not in low]
    lanes["facts_kept"] = {"lost": lost, "checked": list(kept_facts or [])}
    if lost:
        hard.append(
            {
                "class": "fact_lost",
                "detail": f"facts proven earlier vanished from this answer: {lost}",
            }
        )

    allowed = {t.upper() for t in session_cases.SESSION_ALLOWED_TAGS}
    invented = {t for t in extract_prose_tags(answer) if t.upper() not in allowed}
    lanes["tag_invention"] = {"invented": sorted(invented)}
    if invented:
        hard.append(
            {
                "class": "prose_tag_invention",
                "detail": f"tags not in this print set: {sorted(invented)}",
            }
        )

    m = _STATE_CLAIM_RE.search(answer or "")
    if m:
        hard.append(
            {
                "class": "unsupported_state_claim",
                "detail": f"asserts observed state: {m.group(0)!r}",
            }
        )

    return _result(turn, lanes, hard, latency_s, usage)


def _result(turn: dict, lanes: dict, hard: list[dict], latency_s, usage) -> dict:
    return {
        "turn_id": turn["turn_id"],
        "caption": turn["caption"],
        "pages": turn["pages"],
        "status": "pass" if not hard else "hard_fail",
        "lanes": lanes,
        "hard_failures": hard,
        "latency_s": round(latency_s, 3) if latency_s is not None else None,
        "provider": (usage or {}).get("provider"),
        "estimated_cost_usd": estimate_cost_usd(usage),
    }


def grade_durability(probe: dict) -> dict:
    """Grade the restart-survival probe (real PhotoBatchQueue on real SQLite)."""
    hard = []
    for key, label in (
        ("survived_restart", "batch did not survive queue restart"),
        ("raw_preserved", "original full-res photo bytes were not preserved"),
        ("caption_preserved", "caption changed across restart"),
    ):
        if not probe.get(key):
            hard.append({"class": "durability_broken", "detail": label})
    return {
        "turn_id": "durability_probe",
        "caption": "(restart-survival probe, no model)",
        "pages": [],
        "status": "pass" if not hard else "hard_fail",
        "lanes": {"probe": probe},
        "hard_failures": hard,
        "latency_s": None,
        "provider": None,
        "estimated_cost_usd": 0.0,
    }


def build_session_result(session: dict, turn_results: list[dict]) -> dict:
    passed = sum(1 for r in turn_results if r["status"] == "pass")
    return {
        "session_id": session["session_id"],
        "about": session.get("about", ""),
        "turns_total": len(turn_results),
        "turns_passed": passed,
        "status": "pass" if passed == len(turn_results) else "hard_fail",
        "results": turn_results,
    }


def recommended_missing_pages(answers: list[str]) -> list[str]:
    refs: set[str] = set()
    for a in answers:
        refs.update(m.group(1) for m in _SHEET_REF_RE.finditer(a or ""))
    return sorted(refs)


def build_envelope(
    session_results: list[dict],
    mode: str,
    *,
    durability: dict | None = None,
    answers: list[str] | None = None,
) -> dict:
    hard: list[dict] = []
    if not expectations_frozen_ok():
        hard.append(
            {
                "class": "expectations_tampered",
                "session_id": "(corpus)",
                "detail": "session expectations do not match session_cases.sha256",
            }
        )
    for s in session_results:
        for r in s["results"]:
            for h in r["hard_failures"]:
                hard.append({**h, "session_id": s["session_id"], "turn_id": r["turn_id"]})
    total_turns = sum(s["turns_total"] for s in session_results)
    passed_turns = sum(s["turns_passed"] for s in session_results)
    latencies = [
        r["latency_s"] for s in session_results for r in s["results"] if r["latency_s"] is not None
    ]
    cost = round(
        sum(r.get("estimated_cost_usd") or 0 for s in session_results for r in s["results"]), 6
    )
    return {
        "grader_version": SESSION_GRADER_VERSION,
        "cases_version": session_cases.PHASE3_VERSION,
        "mode": mode,
        "sessions_total": len(session_results),
        "sessions_passed": sum(1 for s in session_results if s["status"] == "pass"),
        "turns_total": total_turns,
        "turns_passed": passed_turns,
        "hard_failures": hard,
        "durability": durability,
        "recommended_missing_pages": recommended_missing_pages(answers or []),
        "latency_max_s": max(latencies) if latencies else None,
        "estimated_cost_usd": cost,
        "baseline": "none_approved (first runs; Phase 5 owns baselines)",
        "sessions": session_results,
    }


def render_report(envelope: dict) -> str:
    e = envelope
    L = [
        "# PrintSense multi-photo session bench — Phase 3",
        "",
        f"grader {e['grader_version']} | cases {e['cases_version']} | mode {e['mode']}",
        f"sessions: {e['sessions_passed']}/{e['sessions_total']} | "
        f"turns: {e['turns_passed']}/{e['turns_total']} | "
        f"hard failures: {len(e['hard_failures'])} | "
        f"max latency: {e['latency_max_s']}s | est. cost: ${e['estimated_cost_usd']}",
        f"recommended missing pages: {', '.join(e['recommended_missing_pages']) or 'none'}",
        f"baseline: {e['baseline']}",
        "",
        "| session | turn | status | pages | latency s |",
        "|---|---|---|---|---|",
    ]
    for s in e["sessions"]:
        for r in s["results"]:
            L.append(
                f"| {s['session_id']} | {r['turn_id']} | {r['status']} | "
                f"{len(r['pages'])} | {r['latency_s'] if r['latency_s'] is not None else '-'} |"
            )
    if e.get("durability"):
        L += ["", f"durability probe: {e['durability']}"]
    if e["hard_failures"]:
        L += ["", "## Hard failures", ""]
        L += [
            f"- `{h.get('session_id', '?')}/{h.get('turn_id', '?')}` **{h['class']}** — {h['detail']}"
            for h in e["hard_failures"]
        ]
    L.append("")
    return "\n".join(L)


def phone_summary(envelope: dict) -> str:
    e = envelope
    ok = not e["hard_failures"] and e["turns_passed"] == e["turns_total"]
    return "\n".join(
        [
            f"PrintSense phase3 ({e['mode']}): {'PASS' if ok else 'FAIL'} — "
            f"{e['sessions_passed']}/{e['sessions_total']} sessions, "
            f"{e['turns_passed']}/{e['turns_total']} turns, "
            f"{len(e['hard_failures'])} hard failure(s)",
            f"max latency: {e['latency_max_s']}s | est cost: ${e['estimated_cost_usd']}",
            "failing: "
            + (
                ", ".join(
                    sorted(
                        {
                            f"{h.get('session_id', '?')}/{h.get('turn_id', '?')}"
                            for h in e["hard_failures"]
                        }
                    )
                )
                or "none"
            ),
            f"{e['baseline']}",
        ]
    )


def stable_envelope_json(envelope: dict) -> str:
    import json

    return json.dumps(envelope, sort_keys=True, indent=1, ensure_ascii=False)


__all__ = [
    "SESSION_GRADER_VERSION",
    "expectations_frozen_ok",
    "grade_turn",
    "grade_durability",
    "build_session_result",
    "build_envelope",
    "recommended_missing_pages",
    "render_report",
    "phone_summary",
    "stable_envelope_json",
    "audit_artifact",
]

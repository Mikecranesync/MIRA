"""Answer-distillation flywheel benchmark — proof the loop actually works.

Runs the **real** pure cores of every flywheel stage (label → gap report →
gap→suggestion → harvest) over one ground-truth scenario and grades how faithfully
they distil it, per `docs/specs/flywheel-benchmark-rubric.md`. Deterministic and
CI-gated: a regression in any stage drops the score and fails the build.

The scenario is the real one that motivated the flywheel — technicians repeatedly
ask about GS10 **P01.24** (undocumented), plus grounded turns, other packs, an
unregistered pack, engine turns, and human-corrected turns.

    python tools/flywheel_benchmark.py [--json]     # offline correctness proof
    NEON_DATABASE_URL=…staging python tools/flywheel_benchmark.py --live  # throughput

Offline mode is the graded proof; `--live` reports throughput over real captured
turns (read-only, ungraded — no ground truth on real data).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

# --- import the real stage cores (this harness is an eval tool; cross-imports OK) --
_HERE = Path(__file__).resolve().parent  # tools/
_REPO = _HERE.parent
for _p in (
    str(_HERE),  # harvest_golden_cases
    str(_HERE / "drive-pack-extract"),  # gap_report, gap_suggestion
    str(_REPO / "mira-crawler" / "tasks"),  # eval_scorer
):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import eval_scorer  # noqa: E402
import gap_report  # noqa: E402
import gap_suggestion  # noqa: E402
import harvest_golden_cases as harvest  # noqa: E402
import relational_distill  # noqa: E402

_PASS_THRESHOLD = 90.0  # deterministic fixture scores 100; margin is intent, not slack

# Self-contained registry for the benchmark (durapulse_gs10 + powerflex_525
# registered; acme unregistered). Deterministic — does not depend on sources.json.
_BENCH_REGISTRY = {
    "manuals": [
        {
            "manual_id": "automationdirect_gs10_gs10m-um",
            "pack_id": "durapulse_gs10",
            "product_family": "DURApulse GS10",
            "vendor": "AutomationDirect",
        },
        {
            "manual_id": "rockwell_powerflex_525_520-um001",
            "pack_id": "powerflex_525",
            "product_family": "PowerFlex 525",
            "vendor": "Rockwell Automation",
        },
    ]
}


# ---------------------------------------------------------------------------
# Ground-truth fixture — turns + the answer key each stage is graded against
# ---------------------------------------------------------------------------


def _dp(i, pack, question, matched, *, matched_kind=None, **gt):
    """A drive-pack turn with its ground truth."""
    meta = {"surface": "drive_pack", "pack_id": pack, "matched": matched}
    if matched_kind is not None:
        meta["matched_kind"] = matched_kind
    return {
        "id": f"00000000-0000-0000-0000-0000000000{i:02d}",
        "user_message": question,
        "bot_response": ("(grounded answer)" if matched else "The pack doesn't document that."),
        "intent": "industrial",
        "meta": meta,
        "human_verdict": None,
        "correction": None,
        "_gt": {"label_score": 5 if matched else 3, "is_gap": not matched, **gt},
    }


def _turn(i, question, *, verdict=None, correction=None, surface=None, should_harvest=False):
    """A non-drive-pack (engine) or human-reviewed turn."""
    meta = {"surface": surface} if surface else {}
    return {
        "id": f"00000000-0000-0000-0000-0000000000{i:02d}",
        "user_message": question,
        "bot_response": "(engine answer)",
        "intent": "industrial",
        "meta": meta,
        "human_verdict": verdict,
        "correction": correction,
        "_gt": {"should_harvest": should_harvest},
    }


def build_fixture() -> list[dict[str, Any]]:
    """The scenario. Ground truth lives on each row's ``_gt``."""
    rows: list[dict[str, Any]] = []
    # durapulse_gs10: P01.24 asked 4× + P02.00 asked 2× → 6 gaps, top = P01.24,
    # registered + over threshold(3) → one suggestion.
    for i in range(4):
        rows.append(
            _dp(10 + i, "durapulse_gs10", "what is P01.24 on the GS10?", False, gap_token="P01.24")
        )
    for i in range(2):
        rows.append(
            _dp(20 + i, "durapulse_gs10", "what does P02.00 do?", False, gap_token="P02.00")
        )
    # durapulse_gs10 grounded turns → label 5, NOT gaps. The matched FAULT turn is
    # also the Phase-4b relational signal → one HAS_FAILURE_MODE edge; the matched
    # PARAMETER turn is NOT (parameters aren't failure modes).
    rows.append(_dp(30, "durapulse_gs10", "what does fault CE10 mean?", True, matched_kind="fault"))
    rows.append(_dp(31, "durapulse_gs10", "what is P00.02?", True, matched_kind="parameter"))
    # powerflex_525: 1 gap → registered but BELOW threshold → no suggestion.
    rows.append(_dp(40, "powerflex_525", "what is P044?", False, gap_token="P044"))
    # unregistered pack: a gap that cannot be routed to a manual → no suggestion.
    rows.append(_dp(50, "acme_x999", "what is Q10 on the acme?", False, gap_token="Q10"))
    # engine turns (no drive-pack surface) → invisible to the drive-pack stages.
    rows.append(_turn(60, "how does a VFD work?"))
    rows.append(_turn(61, "what is MQTT?"))
    # harvest: bad + correction → should harvest; good / no-correction → not.
    rows.append(
        _turn(
            70,
            "reset the GS10 after ocA",
            verdict="bad",
            correction="Clear ocA then cycle STOP.",
            should_harvest=True,
        )
    )
    rows.append(
        _turn(
            71,
            "P044 on PowerFlex",
            verdict="bad",
            correction="P044 is the accel-time-1 parameter.",
            should_harvest=True,
        )
    )
    rows.append(_turn(72, "thanks", verdict="good", should_harvest=False))
    rows.append(
        _turn(73, "bad but no correction", verdict="bad", correction=None, should_harvest=False)
    )
    return rows


# ---------------------------------------------------------------------------
# Stage runners over the fixture (mirror the real DB query filters, in memory)
# ---------------------------------------------------------------------------


def _drive_pack_rows(rows):
    return [r for r in rows if eval_scorer.is_drive_pack(r.get("meta"))]


def _unmatched_gap_rows(rows):
    """Mirror gap_report._SELECT_SQL: surface='drive_pack' AND matched=false."""
    out = []
    for r in rows:
        m = r.get("meta") or {}
        if m.get("surface") == "drive_pack" and m.get("matched") is False:
            out.append(
                {
                    "pack_id": m.get("pack_id"),
                    "user_message": r["user_message"],
                    "created_at": r["id"],
                }
            )
    return out


def _harvest_candidates(rows):
    """Mirror harvest _SELECT_SQL: human_verdict='bad' AND correction IS NOT NULL."""
    return [r for r in rows if r.get("human_verdict") == "bad" and r.get("correction")]


# ---------------------------------------------------------------------------
# Graders — each returns {"name", "decisions": [(desc, bool)], "score"}
# ---------------------------------------------------------------------------


def _grade(name: str, decisions: list[tuple[str, bool]]) -> dict[str, Any]:
    passed = sum(1 for _, ok in decisions if ok)
    total = len(decisions)
    return {
        "name": name,
        "decisions": decisions,
        "passed": passed,
        "total": total,
        "score": 100.0 * passed / total if total else 0.0,
    }


def grade_label_accuracy(rows) -> dict[str, Any]:
    decisions = []
    for r in _drive_pack_rows(rows):
        got = eval_scorer.label_drive_pack_row(r["meta"])["auto_score"]
        want = r["_gt"]["label_score"]
        decisions.append((f"row {r['id'][-2:]} label {got}=={want}", got == want))
    return _grade("Capture→label accuracy", decisions)


def grade_gap_surfacing(rows, report) -> dict[str, Any]:
    decisions = []
    # (pack, token) buckets the report surfaced.
    surfaced = {(p["pack_id"], t["token"]) for p in report["packs"] for t in p["tokens"]}
    expected = {
        (r["pack_id"], gap_report.extract_tokens(r["user_message"])[0])
        for r in _unmatched_gap_rows(rows)
    }
    decisions.append((f"surfaced buckets == expected ({len(expected)})", surfaced == expected))
    # total_gaps equals the count of unmatched drive-pack turns (no phantom gaps).
    decisions.append(
        ("total_gaps == unmatched count", report["total_gaps"] == len(_unmatched_gap_rows(rows)))
    )
    # ranking: durapulse_gs10's most-asked gap is P01.24.
    gs10 = next((p for p in report["packs"] if p["pack_id"] == "durapulse_gs10"), None)
    decisions.append(
        ("durapulse top gap == P01.24", bool(gs10) and gs10["tokens"][0]["token"] == "P01.24")
    )
    return _grade("Gap surfacing", decisions)


def grade_distill_precision(rows, suggestions) -> dict[str, Any]:
    decisions = []
    suggested = {s["extracted_data"]["pack_id"] for s in suggestions}
    decisions.append(
        ("durapulse_gs10 suggested (over threshold, registered)", "durapulse_gs10" in suggested)
    )
    decisions.append(
        ("powerflex_525 NOT suggested (below threshold)", "powerflex_525" not in suggested)
    )
    decisions.append(("acme_x999 NOT suggested (unregistered)", "acme_x999" not in suggested))
    decisions.append(
        (
            "every suggestion carries a registry_manual_id",
            all(s["extracted_data"].get("registry_manual_id") for s in suggestions),
        )
    )
    # harvest: exactly the bad+correction rows.
    harvested_ids = {str(r["id"]) for r in _harvest_candidates(rows)}
    expected_ids = {str(r["id"]) for r in rows if r["_gt"].get("should_harvest")}
    decisions.append(
        (f"harvest set == expected ({len(expected_ids)})", harvested_ids == expected_ids)
    )
    return _grade("Distill precision", decisions)


def grade_no_fabrication(rows, report) -> dict[str, Any]:
    decisions = []
    # No matched turn is ever relabeled a gap (matched tokens absent from report).
    matched_qs = [r["user_message"] for r in _drive_pack_rows(rows) if r["meta"]["matched"]]
    matched_tokens = {t for q in matched_qs for t in gap_report.extract_tokens(q)}
    report_tokens = {t["token"] for p in report["packs"] for t in p["tokens"]}
    decisions.append(
        ("no matched-turn token appears as a gap", matched_tokens.isdisjoint(report_tokens))
    )
    # No unmatched turn is "upgraded" to matched (labeler gives 3, never 5).
    unmatched = [r for r in _drive_pack_rows(rows) if not r["meta"]["matched"]]
    decisions.append(
        (
            "every unmatched turn stays a gap (score 3)",
            all(eval_scorer.label_drive_pack_row(r["meta"])["auto_score"] == 3 for r in unmatched),
        )
    )
    # The report never invents a token absent from a real question.
    all_qs = " ".join(r["user_message"] for r in rows).upper()
    decisions.append(("report emits no phantom token", all(t in all_qs for t in report_tokens)))
    return _grade("No-fabrication / no-guess integrity", decisions)


def grade_relational_distill(rows) -> dict[str, Any]:
    """Phase 4b: matched fault turns distil into grounded HAS_FAILURE_MODE edges."""
    pack_index = gap_suggestion.load_pack_manual_index(_BENCH_REGISTRY)
    assertions = relational_distill.extract_relation_assertions(rows, pack_index)
    got = {(a.source_name, a.target_name, a.relation_type) for a in assertions}
    expected = {("DURApulse GS10", "CE10", "has_fault")}

    decisions = [(f"grounded edges == expected ({len(expected)})", got == expected)]
    # Only matched FAULT turns produce edges — never a parameter/unmatched/engine turn.
    fault_turns = [
        r
        for r in rows
        if (r.get("meta") or {}).get("matched") is True
        and (r.get("meta") or {}).get("matched_kind") == "fault"
    ]
    decisions.append(("edges only from matched fault turns", len(assertions) <= len(fault_turns)))
    # No fabricated fault mnemonic — every target token appears in a real question.
    all_qs = " ".join(r["user_message"] for r in rows).upper()
    decisions.append(
        ("no phantom fault token", all(a.target_name.upper() in all_qs for a in assertions))
    )
    # Every edge is a proposal type that goes through the gate (never a direct write).
    decisions.append(
        (
            "edge type is has_fault (→ HAS_FAILURE_MODE proposal, human-gated)",
            all(a.relation_type == "has_fault" for a in assertions),
        )
    )
    return _grade("Relational distillation", decisions)


def grade_gate_safety(rows, suggestions) -> dict[str, Any]:
    decisions = []
    decisions.append(
        (
            "every suggestion is review_only",
            all(s["extracted_data"].get("review_only") is True for s in suggestions),
        )
    )

    # No suggestion presets an accepted/verified status or a build-request flag.
    def _safe(s):
        ed = s["extracted_data"]
        return "build_requested" not in ed and s.get("status") not in ("accepted", "verified")

    decisions.append(
        (
            "no suggestion presets accept/build (human gate intact)",
            all(_safe(s) for s in suggestions),
        )
    )
    # Harvest is data-only: it never sets golden_case_added itself.
    proposals = [harvest.row_to_proposal(r) for r in _harvest_candidates(rows)]
    decisions.append(
        (
            "harvest output marks nothing (no golden_case_added)",
            all("golden_case_added" not in p for p in proposals),
        )
    )
    return _grade("Gate safety", decisions)


# ---------------------------------------------------------------------------
# Orchestration + report
# ---------------------------------------------------------------------------


def run_benchmark(rows: Optional[list[dict[str, Any]]] = None) -> dict[str, Any]:
    """Run every stage over the fixture and grade all 5 criteria. Pure — no DB."""
    rows = rows if rows is not None else build_fixture()
    report = gap_report.aggregate_gaps(_unmatched_gap_rows(rows), generated_at="benchmark")
    pack_index = gap_suggestion.load_pack_manual_index(_BENCH_REGISTRY)
    suggestions = gap_suggestion.build_gap_suggestions(report, pack_index, min_gap_count=3)

    criteria = [
        grade_label_accuracy(rows),
        grade_gap_surfacing(rows, report),
        grade_distill_precision(rows, suggestions),
        grade_relational_distill(rows),
        grade_no_fabrication(rows, report),
        grade_gate_safety(rows, suggestions),
    ]
    overall = sum(c["score"] for c in criteria) / len(criteria)
    return {
        "criteria": criteria,
        "overall": overall,
        "passed": overall >= _PASS_THRESHOLD,
        "threshold": _PASS_THRESHOLD,
    }


def render_report(result: dict[str, Any]) -> str:
    lines = ["# Answer-distillation flywheel benchmark", ""]
    lines.append("| # | Criterion | Score | Result |")
    lines.append("|---|---|---|---|")
    for i, c in enumerate(result["criteria"], 1):
        mark = "PASS" if c["score"] >= _PASS_THRESHOLD else "FAIL"
        lines.append(
            f"| {i} | {c['name']} | {c['passed']}/{c['total']} ({c['score']:.0f}%) | {mark} |"
        )
    verdict = "PASS" if result["passed"] else "FAIL"
    lines += [
        "",
        f"**Overall: {result['overall']:.1f}% — {verdict}** (threshold {result['threshold']:.0f}%)",
        "",
    ]
    # Show any failed decisions for triage.
    for c in result["criteria"]:
        fails = [d for d, ok in c["decisions"] if not ok]
        if fails:
            lines.append(f"- **{c['name']}** failed: " + "; ".join(fails))
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------------------
# --live throughput over real captured turns (read-only, ungraded)
# ---------------------------------------------------------------------------

_LIVE_SQL = """
    SELECT meta->>'pack_id' AS pack_id, meta->>'matched' AS matched, user_message
      FROM conversation_eval
     WHERE meta->>'surface' = 'drive_pack'
     LIMIT %s
"""
_LIVE_HARVEST_SQL = """
    SELECT count(*) FROM conversation_eval
     WHERE human_verdict='bad' AND correction IS NOT NULL AND golden_case_added=false
"""


def _run_live(db_url: str, limit: int) -> int:  # pragma: no cover - DB glue
    import psycopg2

    conn = psycopg2.connect(db_url)
    try:
        with conn.cursor() as cur:
            if not gap_report.capture_schema_ready(cur):
                print(f"ERROR: {gap_report.META_MISSING_MSG}", file=sys.stderr)
                return 3
            cur.execute(_LIVE_SQL, (limit,))
            dp = cur.fetchall()
            cur.execute(_LIVE_HARVEST_SQL)
            harvest_n = cur.fetchone()[0]
    finally:
        conn.close()

    matched = sum(1 for _, m, _ in dp if m == "true")
    unmatched_rows = [
        {"pack_id": p, "user_message": q, "created_at": ""} for p, m, q in dp if m == "false"
    ]
    report = gap_report.aggregate_gaps(unmatched_rows, generated_at="live")
    idx = gap_suggestion.load_pack_manual_index(
        gap_suggestion._load_registry(gap_suggestion._DEFAULT_REGISTRY)
    )
    suggestions = gap_suggestion.build_gap_suggestions(report, idx, min_gap_count=3)

    print("# Flywheel — live throughput (read-only, ungraded)")
    print(f"- drive-pack turns captured: {len(dp)}  (matched {matched}, gap {len(unmatched_rows)})")
    print(f"- gap tokens surfaced: {report['total_gaps']} across {len(report['packs'])} pack(s)")
    for p in report["packs"][:5]:
        top = p["tokens"][0]["token"] if p["tokens"] else "-"
        print(f"    {p['pack_id']}: {p['gap_count']} gaps (top {top})")
    print(f"- packs that would get a suggestion (≥3 gaps, registered): {len(suggestions)}")
    print(f"- harvest candidates waiting (bad+correction, un-harvested): {harvest_n}")
    if not dp:
        print(
            "\n(no drive-pack turns captured yet — the offline benchmark is the correctness proof)"
        )
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit the scored result as JSON")
    parser.add_argument(
        "--live", action="store_true", help="throughput over real captured turns (needs DB)"
    )
    parser.add_argument("--limit", type=int, default=5000, help="--live: max rows to scan")
    parser.add_argument("--database-url", default=None, help="--live: override NEON_DATABASE_URL")
    args = parser.parse_args(argv)

    try:  # criterion names carry a "→"; keep Windows consoles from choking
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass

    if args.live:  # pragma: no cover - DB glue
        db_url = args.database_url or os.getenv("NEON_DATABASE_URL") or os.getenv("DATABASE_URL")
        if not db_url:
            print("ERROR: --live needs NEON_DATABASE_URL / DATABASE_URL", file=sys.stderr)
            return 2
        return _run_live(db_url, args.limit)

    result = run_benchmark()
    if args.json:
        printable = {
            "overall": result["overall"],
            "passed": result["passed"],
            "criteria": [
                {"name": c["name"], "score": c["score"], "passed": c["passed"], "total": c["total"]}
                for c in result["criteria"]
            ],
        }
        print(json.dumps(printable, indent=2))
    else:
        print(render_report(result), end="")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Eval runner — run an eval pack against MIRA and report (pillar 1: Evaluation).

For every active eval item it builds an ``AskContext``, runs the answer through
the harness (mock by default; ``--live`` for the real engine), grades the answer
across the goal's dimensions, and aggregates a report. Output is BOTH a
human-readable console scorecard AND a JSON report — plus the full JSONL of every
trace, so a failure can always be opened and read.

A failure is localised to a dimension: asset selection, document retrieval,
citation coverage, answer points, governance, or generation error. That is the
whole point — "the demo broke" becomes "retrieval missed troubleshooting.md".

Usage::

    python -m simlab.observe.run_eval conveyor_demo                # mock (CI)
    python -m simlab.observe.run_eval conveyor_demo --live         # real engine
    python -m simlab.observe.run_eval path/to/pack.yaml --json out.json
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from shared.observe.approval_registry import ApprovalRegistry
from shared.observe.trace import AnswerTrace

from simlab.observe.evalset import EvalItem, active_items, load_pack, resolve_pack_path
from simlab.observe.harness import (
    AskContext,
    LiveAnswerer,
    MockAnswerer,
    trace_answer,
)

_REPORTS_DIR = Path(__file__).parent / "reports"
_TRACES_DIR = Path(__file__).parent / "traces"
_DEFAULT_APPROVALS = Path(__file__).parent / "evalpacks" / "approvals.example.json"

_CONFIDENCE_SCORE = {"high": 1.0, "medium": 0.66, "low": 0.33, "none": 0.0, None: 0.0}

PASS = "pass"
PARTIAL = "partial"
FAIL = "fail"
XFAIL = "expected_fail"
XPASS = "unexpected_pass"


# --- per-item grading -------------------------------------------------------


@dataclass
class ItemResult:
    id: str
    severity: str
    status: str
    mock_expected_failure: bool
    asset_hit: bool
    retrieval_accuracy: float
    citation_coverage: float
    points_coverage: float
    unacceptable_hit: bool
    confidence: Optional[str]
    warnings: list[str] = field(default_factory=list)
    failure_reasons: list[str] = field(default_factory=list)
    trace_id: str = ""


def _contains_any(haystack: str, needle: str) -> bool:
    """True if `needle` (or its significant tokens) appears in haystack (lower)."""
    needle = needle.lower().strip()
    if not needle:
        return False
    if needle in haystack:
        return True
    tokens = [t for t in needle.split() if len(t) >= 4]
    return bool(tokens) and all(t in haystack for t in tokens)


def _doc_names(trace: AnswerTrace) -> set[str]:
    names: set[str] = set()
    for d in trace.documents_retrieved:
        name = d.get("doc") or d.get("name") or d.get("source")
        if name:
            names.add(name.split("/")[-1].split("\\")[-1])
    return names


def grade_item(item: EvalItem, trace: AnswerTrace) -> ItemResult:
    """Grade one answer trace against its eval item. Localises every failure."""
    answer = (trace.answer or "").lower()
    reasons: list[str] = []

    # --- asset selection ---
    from shared.observe.checks import _asset_matches  # reuse the lenient matcher

    asset_hit = bool(trace.asset_uns_path or trace.asset) and _asset_matches(
        trace.asset_uns_path or trace.asset or "", item.expected_asset
    )
    if not asset_hit:
        reasons.append(
            f"asset selection: got {trace.asset_uns_path or trace.asset!r}, expected {item.expected_asset!r}"
        )

    # --- document retrieval ---
    retrieved = _doc_names(trace)
    if item.expected_documents:
        wanted = {d.split("/")[-1] for d in item.expected_documents}
        hit = {d for d in wanted if any(d in r or r in d for r in retrieved)}
        retrieval_accuracy = len(hit) / len(wanted)
        missing = wanted - hit
        if missing:
            reasons.append(f"retrieval: missing {sorted(missing)}")
    else:
        retrieval_accuracy = 1.0

    # --- citation coverage ---
    if item.required_citations:
        want_c = {c.split("/")[-1] for c in item.required_citations}
        cite_blob = " ".join(trace.citations).lower() + " " + answer
        hit_c = {c for c in want_c if c.lower() in cite_blob}
        citation_coverage = len(hit_c) / len(want_c)
        if hit_c != want_c:
            reasons.append(f"citations: missing {sorted(want_c - hit_c)}")
    else:
        citation_coverage = 1.0

    # --- answer points ---
    if item.expected_answer_points:
        hit_p = [p for p in item.expected_answer_points if _contains_any(answer, p)]
        points_coverage = len(hit_p) / len(item.expected_answer_points)
        missing_p = [p for p in item.expected_answer_points if p not in hit_p]
        if missing_p:
            reasons.append(f"answer points missing: {missing_p}")
    else:
        points_coverage = 1.0

    # --- unacceptable patterns ---
    unacceptable_hit = any(_contains_any(answer, u) for u in item.unacceptable_answer_patterns)
    if unacceptable_hit:
        bad = [u for u in item.unacceptable_answer_patterns if _contains_any(answer, u)]
        reasons.append(f"unacceptable pattern present: {bad}")

    # --- governance (blocking for safety/compliance items) ---
    blocking_gov = [
        w.code for w in trace.warnings if w.pillar == "governance" and w.severity == "critical"
    ]
    if item.is_blocking and blocking_gov:
        reasons.append(f"governance ({item.severity}): {blocking_gov}")

    # --- error ---
    if trace.error:
        reasons.append(f"generation error: {trace.error}")

    # --- verdict ---
    hard_fail = (
        not asset_hit
        or unacceptable_hit
        or bool(trace.error)
        or (item.is_blocking and bool(blocking_gov))
    )
    full_pass = (
        asset_hit
        and retrieval_accuracy >= 0.5
        and citation_coverage >= 1.0
        and points_coverage >= 0.67
        and not unacceptable_hit
        and not (item.is_blocking and blocking_gov)
        and not trace.error
    )
    status = FAIL if hard_fail else (PASS if full_pass else PARTIAL)

    return ItemResult(
        id=item.id,
        severity=item.severity,
        status=status,
        mock_expected_failure=False,
        asset_hit=asset_hit,
        retrieval_accuracy=round(retrieval_accuracy, 3),
        citation_coverage=round(citation_coverage, 3),
        points_coverage=round(points_coverage, 3),
        unacceptable_hit=unacceptable_hit,
        confidence=trace.confidence,
        warnings=trace.warning_codes(),
        failure_reasons=reasons,
        trace_id=trace.trace_id,
    )


# --- context building -------------------------------------------------------


def _build_context(item: EvalItem) -> AskContext:
    """Build the AskContext for an item. For live mode, pull SimLab preseed."""
    tags = list(item.expected_tags)
    documents = [{"doc": d} for d in item.expected_documents]
    tag_state: dict = {}
    machine_type = None

    if item.simlab_scenario_id:
        try:
            from tests.simlab.schema import load_scenario  # type: ignore

            scen_dir = Path(__file__).resolve().parents[2] / "tests" / "simlab" / "scenarios"
            path = scen_dir / f"{item.simlab_scenario_id}.yaml"
            if path.exists():
                scen = load_scenario(path)
                tag_state = dict(scen.machine_context.tag_state)
                machine_type = scen.machine_type
        except Exception:  # noqa: BLE001 — preseed is best-effort
            pass

    return AskContext(
        asset=item.expected_asset.split(".")[-1],
        asset_uns_path=item.expected_asset,
        tenant_id=None,
        tags=tags,
        tag_state=tag_state,
        machine_type=machine_type,
        documents=documents,
        expected_asset=item.expected_asset,
    )


# --- aggregation + report ---------------------------------------------------


def _aggregate(results: list[ItemResult]) -> dict:
    n = len(results)
    if n == 0:
        return {"total": 0}

    def mean(vals: list[float]) -> float:
        return round(sum(vals) / len(vals), 3) if vals else 0.0

    warn_count: dict[str, int] = {}
    for r in results:
        for c in r.warnings:
            warn_count[c] = warn_count.get(c, 0) + 1

    return {
        "total": n,
        "passed": sum(1 for r in results if r.status == PASS),
        "partial": sum(1 for r in results if r.status == PARTIAL),
        "failed": sum(1 for r in results if r.status == FAIL),
        "expected_failed": sum(1 for r in results if r.status == XFAIL),
        "unexpected_passed": sum(1 for r in results if r.status == XPASS),
        "asset_selection_accuracy": mean([1.0 if r.asset_hit else 0.0 for r in results]),
        "document_retrieval_accuracy": mean([r.retrieval_accuracy for r in results]),
        "citation_coverage": mean([r.citation_coverage for r in results]),
        "answer_points_coverage": mean([r.points_coverage for r in results]),
        "unsupported_claims": warn_count.get("unsupported_maintenance_advice", 0),
        "stale_context_warnings": warn_count.get("stale_document", 0),
        "governance_failures": sum(
            1
            for r in results
            if any(
                c
                in (
                    "unapproved_asset",
                    "unapproved_document",
                    "safety_review_missing",
                    "unsupported_maintenance_advice",
                )
                for c in r.warnings
            )
        ),
        "average_confidence": mean([_CONFIDENCE_SCORE.get(r.confidence, 0.0) for r in results]),
        "warning_counts": warn_count,
    }


def _print_console(pack_name: str, mode: str, results: list[ItemResult], summary: dict) -> None:
    print(f"\n=== MIRA Eval - {pack_name} ({mode} mode) ===")
    print(
        f"{summary['total']} tests | "
        f"PASS {summary['passed']}  PARTIAL {summary['partial']}  FAIL {summary['failed']}  "
        f"XFAIL {summary.get('expected_failed', 0)}  XPASS {summary.get('unexpected_passed', 0)}"
    )
    print(
        f"asset_acc {summary['asset_selection_accuracy']:.0%} | "
        f"retrieval_acc {summary['document_retrieval_accuracy']:.0%} | "
        f"citation_cov {summary['citation_coverage']:.0%} | "
        f"points_cov {summary['answer_points_coverage']:.0%}"
    )
    print(
        f"unsupported_claims {summary['unsupported_claims']} | "
        f"stale_context {summary['stale_context_warnings']} | "
        f"governance_failures {summary['governance_failures']} | "
        f"avg_confidence {summary['average_confidence']:.2f}"
    )
    print("\n  status   | id                         | asset retr cite pts | warnings")
    print("  ---------+----------------------------+---------------------+---------")
    icon = {PASS: "PASS ", PARTIAL: "PART ", FAIL: "FAIL ", XFAIL: "XFAIL", XPASS: "XPASS"}
    for r in results:
        print(
            f"  {icon[r.status]}    | {r.id[:26]:26} | "
            f"{'Y' if r.asset_hit else 'n':>5} "
            f"{r.retrieval_accuracy:>4.0%} {r.citation_coverage:>4.0%} {r.points_coverage:>3.0%} | "
            f"{','.join(r.warnings) or '-'}"
        )
    failures = [r for r in results if r.status != PASS]
    if failures:
        print("\n  Failure localisation:")
        for r in failures:
            for reason in r.failure_reasons:
                print(f"    [{r.status}] {r.id}: {reason}")
    print()


def run(
    pack_name: str,
    *,
    mode: str = "mock",
    approvals_path: Optional[Path] = None,
    json_out: Optional[Path] = None,
) -> dict:
    """Run the eval pack and return the report dict (also writes JSON + traces)."""
    pack_path = resolve_pack_path(pack_name)
    items = active_items(load_pack(pack_path))

    registry = ApprovalRegistry.load(approvals_path or _DEFAULT_APPROVALS)

    live_answerer = LiveAnswerer.build() if mode == "live" else None

    ts = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H%M%S")
    traces_path = _TRACES_DIR / f"{pack_path.stem}-{mode}-{ts}.jsonl"

    results: list[ItemResult] = []
    for item in items:
        ctx = _build_context(item)
        if mode == "live":
            answerer = live_answerer
        else:
            if not item.mock_answer:
                # No canned answer → an explicit empty mock answer (will fail loudly).
                from simlab.observe.harness import MockAnswerer as _MA

                answerer = _MA("", confidence="none")
            else:
                answerer = MockAnswerer(item.mock_answer)
        trace = trace_answer(item.question, ctx, answerer, registry, mode=mode)
        trace.write_jsonl(traces_path)
        result = grade_item(item, trace)
        if mode == "mock" and item.mock_expected_failure:
            result.mock_expected_failure = True
            if result.status == FAIL:
                result.status = XFAIL
            else:
                result.status = XPASS
                result.failure_reasons.append(
                    "mock expected failure unexpectedly passed; check canned answer or grader"
                )
        results.append(result)

    summary = _aggregate(results)
    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "pack": str(pack_path),
        "mode": mode,
        "summary": summary,
        "items": [asdict(r) for r in results],
        "traces": str(traces_path),
    }

    out_path = json_out or (_REPORTS_DIR / f"{pack_path.stem}-{mode}-{ts}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    _print_console(pack_path.stem, mode, results, summary)
    print(f"  JSON report: {out_path}")
    print(f"  Traces:      {traces_path}\n")
    return report


def main() -> None:
    p = argparse.ArgumentParser(description="Run a MIRA eval pack and report.")
    p.add_argument("pack", help="Eval pack name (e.g. conveyor_demo) or path to a file")
    p.add_argument("--live", action="store_true", help="Use the real engine (needs env + KB)")
    p.add_argument("--approvals", type=Path, help="Path to approvals JSON (governance source)")
    p.add_argument("--json", type=Path, dest="json_out", help="Write the JSON report here")
    args = p.parse_args()
    report = run(
        args.pack,
        mode="live" if args.live else "mock",
        approvals_path=args.approvals,
        json_out=args.json_out,
    )
    s = report["summary"]
    # Non-zero exit if anything failed — usable as a CI gate.
    raise SystemExit(1 if s.get("failed", 0) or s.get("unexpected_passed", 0) else 0)


if __name__ == "__main__":
    main()

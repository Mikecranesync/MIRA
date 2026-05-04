"""KB Quality Gate — prevents KB ingestion from making MIRA dumber.

Runs 10 KB-sensitive technical cases before and after a KB change, then
compares scores case-by-case across four axes:
  - Technical accuracy  (Groq judge score)
  - Hallucination risk  (score < 0.30 = likely fabrication)
  - Citation quality    (sources cited vs. generic "knowledge base")
  - Regressions         (score drop > REGRESSION_THRESHOLD)

Gate fails (exit 1) if regression_count > 0.

Usage:
    # Save baseline before adding manuals:
    python3 benchmarks/kb_quality_gate.py baseline

    # After ingest, compare and gate:
    python3 benchmarks/kb_quality_gate.py gate results/kb_gate/kb_baseline_*.json

    # Compare any two saved result files offline:
    python3 benchmarks/kb_quality_gate.py compare A.json B.json

Run every time new manuals are added to the KB.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
_HERE = Path(__file__).parent.resolve()
_BOTS_ROOT = _HERE.parent
if str(_BOTS_ROOT) not in sys.path:
    sys.path.insert(0, str(_BOTS_ROOT))

from benchmarks.benchmark_suite import (  # noqa: E402
    TECHNICAL_CASES,
    BenchmarkRun,
    run_benchmark,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REGRESSION_THRESHOLD = 0.15   # 15-point drop → regression
HALLUCINATION_THRESHOLD = 0.30  # Groq score < 30% → hallucination risk
IMPROVEMENT_THRESHOLD = 0.05   # 5-point gain → counts as improved

# 10 cases most likely to change when OEM panel-component manuals are added.
# Map: case_id → what KB source it tests against
KB_SENSITIVE_CASES: dict[str, str] = {
    "tech-01": "VFD fault codes (PF525/G120 manuals)",
    "tech-02": "Motor bearing symptoms (SKF bearing handbook)",
    "tech-06": "Motor overload relay OL trip (140M/100-C docs)",
    "tech-08": "4-20mA transmitter calibration (instrumentation KB)",
    "tech-09": "Contactor vs motor starter (100-C/3RT2 docs)",
    "tech-11": "Motor winding insulation (motor nameplate/ABB docs)",
    "tech-13": "PLC I/O diagnosis (CompactLogix/S7-1200 manuals)",
    "tech-16": "Megger test procedure (motor testing KB)",
    "tech-17": "Power factor for motors (motor fundamentals KB)",
    "tech-20": "Servo drive STO fault (drive manuals KB)",
}

_GATE_CASES = [c for c in TECHNICAL_CASES if c.id in KB_SENSITIVE_CASES]
_RESULTS_DIR = _HERE / "results" / "kb_gate"
_CITATION_RE = re.compile(r"---\s*Sources?\s*---(.+?)(?:---|$)", re.DOTALL | re.IGNORECASE)
_SOURCE_LINE_RE = re.compile(r"\[\d+\]\s*(.+)")


# ---------------------------------------------------------------------------
# Per-reply analysis
# ---------------------------------------------------------------------------


def _citation_quality(reply: str) -> dict:
    m = _CITATION_RE.search(reply)
    if not m:
        return {"has_citations": False, "total": 0, "specific": 0, "sources": []}
    sources = _SOURCE_LINE_RE.findall(m.group(1))
    # "knowledge base" alone = generic / uncited; a real manual title is specific
    specific = [s for s in sources if "knowledge base" not in s.lower() and len(s.strip()) > 4]
    return {
        "has_citations": True,
        "total": len(sources),
        "specific": len(specific),
        "sources": sources[:4],
    }


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------


@dataclass
class CaseDelta:
    case_id: str
    kb_source: str
    baseline_score: float
    new_score: float
    delta: float
    regression: bool
    hallucination_risk: bool  # new_score is below hallucination threshold
    citation_baseline: dict = field(default_factory=dict)
    citation_new: dict = field(default_factory=dict)


@dataclass
class GateReport:
    timestamp: str
    baseline_file: str
    new_file: str
    gate_passed: bool
    cases_improved: int
    cases_maintained: int
    cases_degraded: int
    regression_count: int
    hallucination_delta: int
    baseline_technical: float
    new_technical: float
    deltas: list[CaseDelta] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Comparison logic
# ---------------------------------------------------------------------------


def _load_by_id(path: str) -> dict[str, dict]:
    data = json.loads(Path(path).read_text())
    return {r["case_id"]: r for r in data.get("case_results", [])}


def compare_runs(baseline_path: str, new_path: str) -> GateReport:
    bl = _load_by_id(baseline_path)
    nw = _load_by_id(new_path)
    bl_data = json.loads(Path(baseline_path).read_text())
    nw_data = json.loads(Path(new_path).read_text())

    deltas: list[CaseDelta] = []
    improved = maintained = degraded = regression_count = 0
    bl_halluc = nw_halluc = 0

    for case_id, kb_source in KB_SENSITIVE_CASES.items():
        b = bl.get(case_id)
        n = nw.get(case_id)
        if not b or not n:
            continue

        bs, ns = b["score"], n["score"]
        delta = ns - bs
        is_regression = delta < -REGRESSION_THRESHOLD
        b_turns = b.get("turns", [])
        n_turns = n.get("turns", [])

        if b["score"] < HALLUCINATION_THRESHOLD:
            bl_halluc += 1
        if n["score"] < HALLUCINATION_THRESHOLD:
            nw_halluc += 1

        if is_regression:
            regression_count += 1
            degraded += 1
        elif delta >= IMPROVEMENT_THRESHOLD:
            improved += 1
        else:
            maintained += 1

        deltas.append(CaseDelta(
            case_id=case_id,
            kb_source=kb_source,
            baseline_score=bs,
            new_score=ns,
            delta=delta,
            regression=is_regression,
            hallucination_risk=ns < HALLUCINATION_THRESHOLD,
            citation_baseline=_citation_quality(b_turns[-1]["bot"] if b_turns else ""),
            citation_new=_citation_quality(n_turns[-1]["bot"] if n_turns else ""),
        ))

    deltas.sort(key=lambda d: d.delta)  # worst regressions first

    return GateReport(
        timestamp=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        baseline_file=baseline_path,
        new_file=new_path,
        gate_passed=regression_count == 0,
        cases_improved=improved,
        cases_maintained=maintained,
        cases_degraded=degraded,
        regression_count=regression_count,
        hallucination_delta=nw_halluc - bl_halluc,
        baseline_technical=bl_data.get("dimension_scores", {}).get("technical", 0.0),
        new_technical=nw_data.get("dimension_scores", {}).get("technical", 0.0),
        deltas=deltas,
    )


# ---------------------------------------------------------------------------
# Report printer
# ---------------------------------------------------------------------------

_W = 66


def print_gate_report(report: GateReport) -> None:
    status = "PASSED" if report.gate_passed else "FAILED"
    sym = "✓" if report.gate_passed else "✗"
    print(f"\n{'='*_W}")
    print(f"  KB QUALITY GATE  [{status}]  {sym}  {report.timestamp}")
    print(f"{'='*_W}")
    print(f"  Baseline : {Path(report.baseline_file).name}")
    print(f"  New run  : {Path(report.new_file).name}")

    tech_d = report.new_technical - report.baseline_technical
    arrow = "▲" if tech_d >= 0 else "▼"
    print(f"\n  Technical accuracy:  {report.baseline_technical:.1f}%  →  "
          f"{report.new_technical:.1f}%  ({arrow}{abs(tech_d):.1f}%)")

    print(f"\n  KB-sensitive cases ({len(KB_SENSITIVE_CASES)}):")
    print(f"    Improved    +{report.cases_improved}")
    print(f"    Maintained  ={report.cases_maintained}")
    print(f"    Degraded    -{report.cases_degraded}")

    h_sym = "▲" if report.hallucination_delta > 0 else ("▼" if report.hallucination_delta < 0 else "─")
    print(f"\n  Hallucination-risk cases: {h_sym}{abs(report.hallucination_delta)} "
          f"({'WORSE' if report.hallucination_delta > 0 else 'same or better'})")
    print(f"  Regressions (>{REGRESSION_THRESHOLD*100:.0f}% drop): {report.regression_count}")

    if report.deltas:
        print(f"\n  {'CASE':<10} {'BEFORE':>7} {'AFTER':>7} {'DELTA':>7}  "
              f"{'CIT B→N':>8}  NOTE")
        print(f"  {'-'*_W}")
        for d in report.deltas:
            a = "▲" if d.delta >= 0 else "▼"
            flag = ""
            if d.regression:
                flag = "  REGRESSION"
            elif d.hallucination_risk:
                flag = "  halluc-risk"
            cb = d.citation_baseline.get("specific", 0)
            cn = d.citation_new.get("specific", 0)
            print(f"  {d.case_id:<10} {d.baseline_score*100:>6.0f}%  "
                  f"{d.new_score*100:>6.0f}%  {a}{abs(d.delta)*100:>5.0f}%  "
                  f"{cb:>3}→{cn:<3}{flag}")

    verdict = ("GATE PASSED — new content is safe to keep."
               if report.gate_passed
               else f"GATE FAILED — {report.regression_count} regression(s). "
                    "Review before accepting this KB ingest.")
    print(f"\n  {verdict}")
    print(f"{'='*_W}\n")


# ---------------------------------------------------------------------------
# Run helpers
# ---------------------------------------------------------------------------


async def _run_and_save(label: str) -> tuple[BenchmarkRun, Path]:
    print(f"\nRunning {len(_GATE_CASES)} KB-sensitive technical cases [{label}]…")
    run = await run_benchmark(label, cases=_GATE_CASES)
    _RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    out = _RESULTS_DIR / f"kb_{label}_{run.timestamp}.json"
    out.write_text(json.dumps(asdict(run), indent=2))
    print(f"Saved → {out}")
    return run, out


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="KB Quality Gate — prevent KB regressions",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    sub = p.add_subparsers(dest="cmd", required=True)

    bl = sub.add_parser("baseline", help="Run baseline before ingest")
    bl.add_argument("--label", default="baseline")

    g = sub.add_parser("gate", help="Run after ingest and compare")
    g.add_argument("baseline_file", help="Path to saved baseline JSON")
    g.add_argument("--label", default="post-ingest")

    c = sub.add_parser("compare", help="Compare two saved result files")
    c.add_argument("baseline_file")
    c.add_argument("new_file")

    return p.parse_args()


async def _main() -> None:
    args = _parse_args()

    if args.cmd == "baseline":
        _, out = await _run_and_save(args.label)
        print(f"\nNext step after ingest:")
        print(f"  python3 benchmarks/kb_quality_gate.py gate {out}")
        return

    if args.cmd == "gate":
        _, new_path = await _run_and_save(args.label)
        report = compare_runs(args.baseline_file, str(new_path))
        print_gate_report(report)
        gate_report_path = _RESULTS_DIR / f"gate_report_{report.timestamp}.json"
        gate_report_path.write_text(json.dumps(asdict(report), indent=2))
        sys.exit(0 if report.gate_passed else 1)

    if args.cmd == "compare":
        report = compare_runs(args.baseline_file, args.new_file)
        print_gate_report(report)
        sys.exit(0 if report.gate_passed else 1)


if __name__ == "__main__":
    asyncio.run(_main())

"""Offline PrintSense grader gate (PR5) — hermetic, no-spend, reuses the real ``grade_case``.

The deterministic grader OWNS import safety; the LLM judge is NOT involved here. This is the
structural no-spend proof: NO Anthropic, NO Doppler, NO internet, NO production services —
deterministic fixtures only.

Two modes:

* **no args** — regression gate over the FROZEN corpus: each case must match its expected
  ``import_verdict``; exit 1 if any regressed. Prints the exact blockers per case.
* **``<graph> <rubric>``** — grade one candidate; exit 1 if ``import_verdict == FAIL`` (a real
  import would be blocked), printing the blockers. ``rubric`` is optional.

It calls :func:`printsense.grade_case.grade_case` directly — there is deliberately NO second
grader here (single source of import truth).
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from printsense.grade_case import grade_case

_ROOT = Path(__file__).resolve().parents[1]

# The frozen corpus — both verdict directions represented so the gate can't be vacuously green.
_CORPUS = [
    ("scu2   (clean, importable)", "printsense/fixtures/scu2/graph.json",
     "printsense/benchmarks/scu2_sheet20/rubric.json", "PASS"),
    ("atv340 (defective VFD print)", "printsense/fixtures/atv340/graph.json",
     "printsense/benchmarks/atv340_vfd/rubric.json", "FAIL"),
]


def _fmt(label: str, r: dict, expected: str | None = None) -> str:
    blockers = ", ".join(r["import_blocking_failures"]) or "none"
    exp = f" (expected {expected})" if expected else ""
    return (f"{label}: import_verdict={r['import_verdict']}{exp} | tier={r['quality_tier']} "
            f"| score={r['score']} | blockers=[{blockers}]")


def _regression_gate() -> int:
    print("=== PrintSense deterministic grader gate — frozen corpus (hermetic, no-spend) ===")
    failed = 0
    for label, graph, rubric, expected in _CORPUS:
        r = grade_case(_ROOT / graph, _ROOT / rubric)
        ok = r["import_verdict"] == expected
        print(("[OK]         " if ok else "[REGRESSION] ") + _fmt(label, r, expected))
        if not ok:
            failed += 1
    if failed:
        print(f"\nGATE FAIL: {failed} case(s) regressed — the deterministic import gate does not hold.")
        return 1
    print("\nGATE PASS: the deterministic import gate holds on the frozen corpus.")
    return 0


def _candidate_gate(graph_path: str, rubric_path: str | None) -> int:
    r = grade_case(graph_path, rubric_path)
    print(_fmt("candidate", r))
    if r["import_verdict"] == "FAIL":
        print("GATE FAIL: import_verdict=FAIL — this graph is NOT safe to import (blockers above).")
        return 1
    print("GATE PASS: import_verdict=PASS.")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(
        description="Offline PrintSense deterministic grader gate (no-spend; reuses grade_case)."
    )
    ap.add_argument("graph", nargs="?",
                    help="candidate extraction graph JSON (omit for the frozen-corpus regression gate)")
    ap.add_argument("rubric", nargs="?", help="optional rubric JSON")
    args = ap.parse_args(argv)
    if args.graph:
        return _candidate_gate(args.graph, args.rubric)
    return _regression_gate()


if __name__ == "__main__":
    sys.exit(main())

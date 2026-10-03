#!/usr/bin/env python3
"""The light review fixture — score a reviewer against planted defects.

`tests/review_fixtures/<case>/diff.patch` is a small unified diff with ONE defect
physically in its text; `expect.json` names the regex that must match the diff
(`planted` — proof the defect is really there), the keywords an adequate finding
would contain (`keywords_any`), the minimum severity, and the provenance (which
real review caught the class). `control_clean` plants nothing: any finding there
at or above its severity is a false positive.

Hermetic by default (a provider you pass in; tests use a fake). `--live` runs the
single-shot paid lane over every case under a declared total budget and records
each call to the shared ledger — the calibration the owner asked for, in cents.

    python3 tools/review_fixture.py                 # list cases, prove planting
    python3 tools/review_fixture.py --live --budget-usd 0.20
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Callable

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import gate7_review as g7  # noqa: E402

FIXTURES = HERE.parent / "tests" / "review_fixtures"
SEVERITY = {"low": 1, "medium": 2, "high": 3}


def load_cases(root: Path = FIXTURES) -> list[dict]:
    cases = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        expect = json.loads((d / "expect.json").read_text(encoding="utf-8"))
        cases.append(
            {"name": d.name, "diff": (d / "diff.patch").read_text(encoding="utf-8"), **expect}
        )
    return cases


def planted_present(case: dict) -> bool | None:
    """None for a control (nothing planted); otherwise whether the planted regex
    matches the diff — a fixture whose defect is not in its text proves nothing."""
    if case.get("planted") is None:
        return None
    return bool(re.search(case["planted"], case["diff"], re.M))


def score(findings: list[g7.Finding], case: dict) -> dict:
    """Pure. A HIT is a finding at or above min_severity whose title+detail
    contains any expected keyword. A control counts findings at or above its
    severity as FALSE POSITIVES."""
    floor = SEVERITY[case["min_severity"]]
    strong = [f for f in findings if SEVERITY.get(f.severity.lower(), 0) >= floor]
    keywords = [k.lower() for k in case.get("keywords_any", [])]
    if not keywords:  # control
        return {"control": True, "false_positives": len(strong), "hit": None}
    hit = any(k in (f.title + " " + f.detail).lower() for f in strong for k in keywords)
    return {"control": False, "hit": hit, "false_positives": 0, "strong": len(strong)}


def run(provider: Callable[[str], str | None], cases: list[dict]) -> dict:
    """provider(prompt) -> review text or None (no review). Returns per-case rows
    plus recall over planted cases and false positives on controls."""
    rows = []
    for c in cases:
        prompt = g7.build_prompt(c["name"], c.get("provenance", ""), c["diff"], "high", [])
        text = provider(prompt)
        if text is None:
            rows.append({"case": c["name"], "no_review": True})
            continue
        findings = g7.parse_findings(text)
        rows.append(
            {
                "case": c["name"],
                "no_review": False,
                **score(findings, c),
                "findings": [f.title for f in findings],
            }
        )
    planted = [r for r in rows if not r.get("no_review") and not r.get("control")]
    hits = sum(1 for r in planted if r["hit"])
    fps = sum(r["false_positives"] for r in rows if r.get("control"))
    all_planted = sum(1 for c in cases if c.get("planted") is not None)
    return {
        "rows": rows,
        "planted": len(planted),
        "hits": hits,
        "recall": (hits / len(planted)) if planted else None,  # over cases that got a review
        "recall_strict": (hits / all_planted) if all_planted else None,  # a no-review is a miss
        "control_false_positives": fps,
        "no_review": sum(1 for r in rows if r.get("no_review")),
    }


def live_provider(
    budget_usd: float, ledger: Path | None, total_budget_usd: float | None = None
) -> Callable[[str], str | None]:
    """The single-shot paid lane, one call per fixture, each under the per-case
    budget AND under a total: a case is not launched when the spend so far plus
    its worst-case estimate would exceed `total_budget_usd`. Every launched call
    is recorded (verdict from the parsed review)."""
    import time
    import uuid

    spent = {"usd": 0.0}

    def provider(prompt: str) -> str | None:
        model = g7.pick_paid_model(prompt, budget_usd)
        if not model:
            return None
        if total_budget_usd is not None:
            worst = g7.paid_estimate_usd(model, prompt)
            if spent["usd"] + worst > total_budget_usd:
                print(
                    f"fixture: REFUSED — spent ${spent['usd']:.4f} + worst case ${worst:.4f} "
                    f"exceeds the total ${total_budget_usd:.2f}; not launched",
                    file=sys.stderr,
                )
                return None
        result = g7.call_paid(prompt, model)
        text, attempts, usage = result[0], result[2], result[3]
        if attempts and attempts[0].startswith("openai: skipped"):
            return None  # never launched (no key): nothing to record (Codex r2 F5)
        est = g7.paid_estimate_usd(model, prompt)
        known = bool(usage) and any(usage.values())
        row = {
            "kind": "run",
            "lane": "single-shot-fixture",
            "run_id": uuid.uuid4().hex,
            "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "model": model,
            **(usage if known else {}),
            "estimate_usd": round(est, 4),
            "cost_usd": round(g7.paid_cost_usd(model, usage) if known else est, 4),
            "usage_unknown": not known,
            "launched": True,
            "verdict": g7.verdict_of(text, g7.parse_findings(text)) if text else "none",
        }
        spent["usd"] += row["cost_usd"]
        g7._ledger_safely(g7.record_paid_run, ledger or g7.default_ledger(), row)
        print(f"fixture: {model} ${row['cost_usd']:.4f} verdict={row['verdict']}", file=sys.stderr)
        return text

    return provider


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--live", action="store_true", help="run the paid single-shot lane per case")
    ap.add_argument("--budget-usd", type=float, default=0.10, help="PER-CASE budget for --live")
    ap.add_argument(
        "--total-budget-usd",
        type=float,
        default=0.25,
        help="hard stop for the whole --live run: a case is not launched when spend so far "
        "plus its worst-case estimate would exceed this",
    )
    ap.add_argument("--ledger", type=Path, default=None)
    ap.add_argument("--json", action="store_true", help="print the full result as JSON")
    a = ap.parse_args(argv)
    cases = load_cases()
    bad = [c["name"] for c in cases if planted_present(c) is False]
    if bad:
        print(f"fixture: planted defect NOT present in diff: {bad}", file=sys.stderr)
        return 1
    if not a.live:
        for c in cases:
            print(
                f"{c['name']}: planted={planted_present(c)} min={c['min_severity']} chars={len(c['diff'])}"
            )
        return 0
    print(
        f"fixture: {len(cases)} cases, per-case ${a.budget_usd:.2f}, total hard stop "
        f"${a.total_budget_usd:.2f}",
        file=sys.stderr,
    )
    result = run(live_provider(a.budget_usd, a.ledger, a.total_budget_usd), cases)
    print(
        json.dumps(result if a.json else {k: v for k, v in result.items() if k != "rows"}, indent=1)
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

"""SimLab diagnosis benchmark at one revision, with a hard dollar cap. Dev Doppler config only.

    doppler run -p factorylm -c dev -- env INFERENCE_BACKEND=cloud \
        uv run --no-project --python 3.12 --with-requirements mira-bots/requirements.txt \
        python docs/evals/benchmark-4791/v02/simlab_run.py --repeat 1 --budget-usd 5.00

Runs tests/simlab/runner.py's own run_scenario() for every scenario (its deterministic state/keyword/behavior
checkpoints decide pass/fail; nothing here grades replies). It wraps InferenceRouter._call_openai_compat to add up
the provider-reported token usage at the listed prices, and refuses every further call once the cap is reached.
A refused call surfaces as a scenario error, so a stopped run is visible, never silently scored. The scenarios are
hand-written ("scenario_authored" truth). Refuses to run against a production database host.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "mira-bots"))
sys.path.insert(0, str(REPO))
OUT = Path(__file__).resolve().parent / "simlab"
PRICE = {
    "default": (0.75e-6, 4.5e-6)
}  # gpt-5.4-mini list price (OpenRouter /models, 2026-10-27); used for every call
PROD_DB_HOST = "ep-purple-hall-ahimeyn0"  # factorylm/prd; this run must never point at it


class BudgetExceeded(RuntimeError):
    pass


def charge(ledger: dict, usage: object) -> None:
    """Add one call's provider-reported usage to the ledger. The router reports input_tokens/output_tokens; raw
    OpenAI-style prompt_tokens/completion_tokens are accepted too. A call that reports no tokens at all cannot be
    priced, so it stops the run (fail closed) instead of spending unmetered."""
    u = usage if isinstance(usage, dict) else {}
    pt = int(u.get("input_tokens") or u.get("prompt_tokens") or 0)
    ct = int(u.get("output_tokens") or u.get("completion_tokens") or 0)
    if pt == 0 and ct == 0:
        raise BudgetExceeded(
            f"unmetered call (usage={str(usage)[:120]}); refusing to continue without a price"
        )
    pin, pout = PRICE["default"]
    ledger["prompt_tokens"] += pt
    ledger["completion_tokens"] += ct
    ledger["usd"] += pt * pin + ct * pout
    ledger["calls"] += 1


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repeat", type=int, required=True)
    ap.add_argument("--budget-usd", type=float, required=True)
    a = ap.parse_args()
    for var in ("NEON_DATABASE_URL", "DATABASE_URL"):
        if PROD_DB_HOST in os.environ.get(var, ""):
            sys.exit(f"{var} points at the production database; use the dev Doppler config")
    os.environ.setdefault("SIMLAB_DB_PATH", str(OUT / f"simlab-r{a.repeat}.db"))
    from shared.inference import router as R

    from tests.simlab.runner import _build_supervisor, run_scenario
    from tests.simlab.schema import load_all_scenarios

    ledger_path = OUT / "spend.json"
    ledger = (
        json.loads(ledger_path.read_text())
        if ledger_path.exists()
        else {"usd": 0.0, "calls": 0, "prompt_tokens": 0, "completion_tokens": 0}
    )
    orig = R.InferenceRouter._call_openai_compat

    async def metered(self, provider, messages, *args, **kw):
        if ledger["usd"] >= a.budget_usd:
            raise BudgetExceeded(f"budget ${a.budget_usd} reached")
        content, usage = await orig(self, provider, messages, *args, **kw)
        charge(ledger, usage)
        return content, usage

    R.InferenceRouter._call_openai_compat = metered
    OUT.mkdir(exist_ok=True)

    async def go():
        sup = _build_supervisor()
        results = []
        for sc in load_all_scenarios():
            if ledger["usd"] >= a.budget_usd:
                results.append({"id": sc.id, "skipped": "budget"})
                continue
            r = await run_scenario(sup, sc)
            results.append(
                {
                    "id": r["id"],
                    "passed": r["passed"],
                    "final_state": r["final_state"],
                    "error": r["error"],
                    "latency_ms": r["latency_ms"],
                    "standard_results": r["standard_results"],
                    "behavior_results": [
                        {"name": b.name, "passed": b.passed, "reason": b.reason}
                        for b in r["behavior_results"]
                    ],
                    "bot_replies": r["bot_replies"],
                }
            )
            ledger_path.write_text(json.dumps(ledger, indent=1))
            print(
                f"{r['id']}: {'PASS' if r['passed'] else 'FAIL'} (spend so far ${ledger['usd']:.4f})",
                flush=True,
            )
        return results

    results = asyncio.run(go())
    (OUT / f"run-r{a.repeat}.json").write_text(
        json.dumps(
            {"repeat": a.repeat, "ledger_after": ledger, "results": results}, indent=1, default=str
        )
    )
    ledger_path.write_text(json.dumps(ledger, indent=1))
    print(
        f"repeat {a.repeat}: {sum(1 for r in results if r.get('passed'))}/{len(results)} passed; total spend ${ledger['usd']:.4f}"
    )


if __name__ == "__main__":
    main()

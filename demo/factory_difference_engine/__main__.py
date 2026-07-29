"""
Narrated CLI for the Factory Difference Engine demo.

    python -m demo.factory_difference_engine                 # scenario A, deterministic
    python -m demo.factory_difference_engine --scenario D    # a different fault
    python -m demo.factory_difference_engine --json          # machine-readable
    python -m demo.factory_difference_engine --live          # real Supervisor for Explain (needs cloud LLM + Neon)

Walks Connect -> Pick -> Prove -> Explain -> Learn on the SimLab line, aliased as
"Northwind Bottling / CV-200". Deterministic for a fixed (scenario, seed).
"""
from __future__ import annotations

import argparse
import json
import sys

from .pipeline import SCENARIOS, run_pipeline

try:  # rule messages + rubric detail are UTF-8; Windows consoles default to cp1252
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

RULE = "=" * 74


def _h(n: int, title: str) -> None:
    print("\n" + RULE)
    print("  STAGE %d — %s" % (n, title))
    print(RULE)


def narrate(result: dict) -> None:
    s = result["stages"]
    print(RULE)
    print("  FACTORY DIFFERENCE ENGINE — Prove-It 2027 demo")
    print("  %s / %s   (backing SimLab asset: %s, scenario: %s, seed: %s)"
          % (result["line"], result["asset_tag"], result["backing_asset"],
             result["scenario"], result["seed"]))
    print("  deterministic=%s" % result["deterministic"])

    c = s["connect"]
    _h(1, "CONNECT — read-only discovery")
    print("  Discovered %d signals on the line (%d on %s). Writes attempted: %d."
          % (c["discovered_signals"], c["asset_signals"], c["asset_tag"], c["writes_attempted"]))
    for t in c["sample"][:4]:
        print("    - %s" % t["uns_path"])
    print("  %s" % c["note"])

    p = s["pick"]
    _h(2, "PICK — approve tags + upload context")
    print("  Approved %d tags into the fail-closed allowlist; uploaded %d asset manuals."
          % (p["approved_count"], p["doc_count"]))
    print("    manuals: %s" % ", ".join(d["title"] for d in p["uploaded_docs"]))

    pr = s["prove"]
    _h(3, "PROVE — live differences become ONE machine event")
    print("  Learned %d baselines; detected %d factual differences; grouped into %d event(s)."
          % (pr["baselines_learned"], pr["observation_count"], pr["event_count"]))
    for o in pr["observations"]:
        print("    - %s" % o["detail"])

    e = s["explain"]
    _h(4, "EXPLAIN — cite manuals, PLC signals, historical evidence")
    print(e["answer"])
    r = e["rubric"]
    print("\n  [SimLab rubric — mode=%s] passed=%s  evidence_recall=%.0f%%  citations=%d  root_cause=%s  asset=%s"
          % (e["mode"], r["passed"], r["evidence_recall"] * 100, len(r["citations_hit"]),
             r["root_cause_hit"], r["asset_hit"]))

    ln = s["learn"]
    _h(5, "LEARN — approve / reject the inferred context")
    for d in ln["proposals"]:
        mark = "APPROVE" if d["trigger"] == "accept" else "REJECT "
        print("  [%s] %s" % (mark, d["title"]))
        print("           kg approval_state: %s" % d["kg_approval_state"])
    print("\n  %d accepted (now verified context), %d rejected. %s"
          % (ln["accepted"], ln["rejected"], ln["note"]))
    print("\n" + RULE)
    print("  Litmus/Ignition/OPC UA get the data. MIRA found what changed,")
    print("  grouped it into a machine event, and explained it for maintenance.")
    print(RULE + "\n")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Factory Difference Engine — Prove-It 2027 demo")
    ap.add_argument("--scenario", default="A",
                    help="A-F or a SimLab scenario id (default A = filler underfill). Options: "
                         + ", ".join("%s=%s" % (k, v) for k, v in SCENARIOS.items()))
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--live", action="store_true",
                    help="use the real Supervisor for Explain (needs cloud LLM + Neon; non-deterministic)")
    ap.add_argument("--json", action="store_true", help="emit machine-readable JSON instead of narration")
    args = ap.parse_args(argv)

    result = run_pipeline(scenario=args.scenario, seed=args.seed, live=args.live)
    if args.json:
        print(json.dumps(result, indent=2, default=str))
    else:
        narrate(result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

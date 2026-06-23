"""One-command Phase 1 gate.

    python factory_context/run_phase1.py        # from the worktree root
    make context-phase1                           # convenience wrapper

Steps (exits NONZERO on any failure):
  1. run the Phase 0 gate first (interrogate synthetic fixture + Phase 0 tests must be green)
  2. build the FactoryModel from the synthetic export
  3. generate the UNS draft (entities + live signals + relationships)
  4. write the report (factory_context/reports/phase1_context_model.{md,json} + uns_draft.json)
  5. run the Phase 1 pytest suite
  6. enforce the success condition + the no-fact-without-evidence invariant

Synthesizer-free: no simulator, no broker, no PLC. Never touches the licensed corpus.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # factory_context/
_ROOT = _HERE.parent                              # worktree root
_PARSER = _ROOT / "mira-plc-parser"
_PH0 = _ROOT / "discovery_corpus" / "scripts"
for _p in (str(_HERE), str(_PARSER), str(_PH0)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import build as build_mod  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import report as report_mod  # noqa: E402

# default evidence = the committed synthetic fixture (the same one Phase 0 uses)
FIXTURE = iie.DEFAULT_FIXTURE


def _utf8_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def success_condition(model) -> list[str]:
    """The Phase 1 success contract. Returns a list of failures (empty = met)."""
    fails = []
    c = model.counts()
    for lvl in ("enterprise", "site", "area", "line", "asset"):
        if c[lvl] < 1:
            fails.append("no %s entity in the model" % lvl)
    if c["cell"] < 1:
        fails.append("no proposed cell layer (should be a needs_review proposal)")
    live = [n for n in model.signals() if n.archetype in ("live_bool", "live_counter", "live_state", "live_analog")]
    if not live:
        fails.append("no live signals mapped")
    if not any(n.uns_path for n in model.entities()):
        fails.append("no entity UNS paths drafted")
    if not any(r.rel_type == "feeds" for r in model.relationships):
        fails.append("no inferred upstream/downstream (feeds) relationship")
    # approval-ready means NOTHING is auto-approved by the machine
    if any(s.status == "approved" for s in model.all_suggestions()):
        fails.append("a suggestion was auto-approved (must be human-only)")
    return fails


def main() -> int:
    _utf8_stdout()

    # 1. Phase 0 first
    print("== Phase 1 gate ==\n[1/5] running Phase 0 gate ...")
    rc0 = subprocess.call([sys.executable, str(_PH0.parent / "run_phase0.py")])
    if rc0 != 0:
        print("\nPHASE 1: FAIL — Phase 0 gate is not green (rc=%d)" % rc0)
        return 1

    # 2-3. build model + UNS draft
    print("\n[2/5] building FactoryModel + UNS draft from the synthetic export ...")
    rel_source = "discovery_corpus/fixtures/" + Path(FIXTURE).name
    project = iie.load(FIXTURE)
    model = build_mod.build_model(project, rel_source)

    # 4. write report
    print("[3/5] writing report ...")
    reports_dir = _HERE / "reports"
    reports_dir.mkdir(exist_ok=True)
    md = report_mod.render(model)
    (reports_dir / "phase1_context_model.md").write_text(md + "\n", encoding="utf-8")
    (reports_dir / "phase1_context_model.json").write_text(
        json.dumps(model.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    # a focused UNS-draft artifact (paths + confidence + status), the reviewable namespace proposal
    draft = {
        "source": rel_source,
        "entities": [
            {"level": n.level, "uns_path": n.uns_path, "name": n.name,
             "confidence": n.suggestion.confidence, "status": n.suggestion.status}
            for n in model.entities()
        ],
        "signals": [
            {"uns_path": n.uns_path, "name": n.name, "archetype": n.archetype,
             "confidence": n.suggestion.confidence, "status": n.suggestion.status}
            for n in model.signals() if n.uns_path
        ],
        "relationships": [
            {"type": r.rel_type, "source": r.source_path, "target": r.target_path,
             "confidence": r.suggestion.confidence, "status": r.suggestion.status}
            for r in model.relationships
        ],
    }
    (reports_dir / "uns_draft.json").write_text(
        json.dumps(draft, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(md)
    print("\nwrote: factory_context/reports/phase1_context_model.{md,json} + uns_draft.json")

    # 5. tests
    print("\n[4/5] running Phase 1 pytest ...")
    rc1 = subprocess.call([sys.executable, "-m", "pytest", str(_HERE / "tests"), "-q"])

    # 6. invariants
    print("[5/5] enforcing invariants ...")
    failures = []
    if rc1 != 0:
        failures.append("pytest exit %d" % rc1)
    viol = model.evidence_violations()
    if viol:
        failures.append("fact-without-evidence violations: %d (%s)" % (len(viol), viol[:3]))
    sc = success_condition(model)
    if sc:
        failures.append("success condition unmet: %s" % sc)

    if failures:
        print("\nPHASE 1: FAIL")
        for f in failures:
            print("  - %s" % f)
        return 1
    print("\nPHASE 1: OK (Phase 0 green, model approval-ready, 0 facts-without-evidence, tests green)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""One-command Phase 2 gate — the maintenance-causality engine.

    python causality/run_phase2.py        # from the worktree root
    make causality-phase2                   # convenience wrapper

Steps (exits NONZERO on any failure):
  1. run the Phase 1 gate first (the context model must be green)
  2. build the causality model (components + generic failure-mode binding) on the Phase 1 model
  3. run the FLAGSHIP scenario: inject a photoeye-blocked cause on the conveyor -> ask "why is this
     line blocked?" -> MIRA's top-ranked cause must match the injected cause
  4. run a SECOND scenario (sensor drift on a tank -> quality reject) to prove generic binding
  5. write the Ask-MIRA explanation reports
  6. run the Phase 2 pytest suite + enforce invariants (no fact without evidence; scenarios score)

Synthesizer-free: no value simulator runtime, no MQTT, no broker, no PLC, no protocol.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # causality/
_ROOT = _HERE.parent
_FC = _ROOT / "factory_context"
_PH0 = _ROOT / "discovery_corpus" / "scripts"
_PARSER = _ROOT / "mira-plc-parser"
for _p in (str(_HERE), str(_FC), str(_PH0), str(_PARSER)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import answer as rpt  # noqa: E402  (causality.answer -- unique name; avoids factory_context/report.py)
import build as fc_build  # noqa: E402  (factory_context.build)
import components as comp_mod  # noqa: E402
import explain as ex  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE


def _utf8_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def _asset_of_class(cmodel, asset_class):
    for a in cmodel.assets():
        if comp_mod.classify_asset(a) == asset_class:
            return a
    return None


def build_model():
    project = iie.load(FIXTURE)
    fmodel = fc_build.build_model(project, "discovery_corpus/fixtures/" + Path(FIXTURE).name)
    return comp_mod.build_causality(fmodel)


def main() -> int:
    _utf8_stdout()
    print("== Phase 2 gate (maintenance-causality engine) ==\n[1/5] running Phase 1 gate ...")
    rc1 = subprocess.call([sys.executable, str(_FC / "run_phase1.py")])
    if rc1 != 0:
        print("\nPHASE 2: FAIL — Phase 1 gate is not green (rc=%d)" % rc1)
        return 1

    print("\n[2/5] building causality model (components + generic binding) ...")
    cmodel = build_model()
    knowledge = know.load_knowledge()
    reports_dir = _HERE / "reports"
    reports_dir.mkdir(exist_ok=True)

    failures = []

    # 3. flagship: photoeye blocked on the conveyor -> "why is this line blocked?"
    print("[3/5] flagship scenario: photoeye blocked on the conveyor ...")
    conveyor = _asset_of_class(cmodel, "conveyor")
    if conveyor is None:
        failures.append("no conveyor asset found for the flagship scenario")
    else:
        scen = ex.inject(cmodel, "photoeye_blocked", conveyor.uns_path)
        exp = ex.explain(cmodel, knowledge, "line_blocked", scen.line_uns, scen.abnormal_signals)
        md = rpt.render_explanation(exp)
        (reports_dir / "phase2_explanation_photoeye.md").write_text(md + "\n", encoding="utf-8")
        (reports_dir / "phase2_explanation_photoeye.json").write_text(
            json.dumps(exp.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(md)
        if not ex.score(exp, scen):
            failures.append("flagship: top cause %r != injected photoeye_blocked on conveyor"
                            % (exp.ranked_causes[0].failure_mode_id if exp.ranked_causes else None))

    # 4. generic-binding breadth: sensor drift on a tank -> quality reject
    print("\n[4/5] breadth scenario: sensor drift on a tank ...")
    tank = _asset_of_class(cmodel, "tank")
    if tank is None:
        failures.append("no tank asset found for the breadth scenario")
    else:
        scen2 = ex.inject(cmodel, "sensor_drift", tank.uns_path)
        exp2 = ex.explain(cmodel, knowledge, "quality_reject", scen2.line_uns, scen2.abnormal_signals)
        (reports_dir / "phase2_explanation_sensor_drift.md").write_text(
            rpt.render_explanation(exp2) + "\n", encoding="utf-8")
        if not ex.score(exp2, scen2):
            failures.append("breadth: top cause %r != injected sensor_drift on tank"
                            % (exp2.ranked_causes[0].failure_mode_id if exp2.ranked_causes else None))

    print("\nwrote: causality/reports/phase2_explanation_*.{md,json}")

    # 5. tests + invariants
    print("\n[5/5] running Phase 2 pytest + invariants ...")
    rc2 = subprocess.call([sys.executable, "-m", "pytest", str(_HERE / "tests"), "-q"])
    if rc2 != 0:
        failures.append("pytest exit %d" % rc2)
    viol = cmodel.evidence_violations()
    if viol:
        failures.append("component fact-without-evidence: %d (%s)" % (len(viol), viol[:3]))

    if failures:
        print("\nPHASE 2: FAIL")
        for f in failures:
            print("  - %s" % f)
        return 1
    print("\nPHASE 2: OK (Phase 1 green, flagship + breadth scenarios explained correctly, "
          "0 facts-without-evidence, tests green)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

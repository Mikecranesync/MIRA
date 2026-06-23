"""One-command Phase 3 gate — the evidence-grounding & explainability engine.

    python evidence_graph/run_phase3.py        # from the worktree root
    make explainability-phase3                   # convenience wrapper

Steps (exits NONZERO on any failure):
  1. run Phase 0 -> 1 -> 2 (via the Phase 2 gate)
  2. build the evidence graph
  3. flagship: observe a photoeye-blocked fault -> explain_cause -> the answer must show receipts
  4. contradiction demo: same fault but counts still increasing -> confidence must drop + show
     contradicting evidence
  5. write the explanation report
  6. run the Phase 3 tests + enforce invariants

Fails on: unsupported claims, missing citations, non-determinism, evidence-graph violations.
Strictly brain-side: no MQTT/Sparkplug/OPC-UA/Modbus/Ignition/broker/live pipeline/PLC sim.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

_HERE = Path(__file__).resolve().parent          # evidence_graph/
_ROOT = _HERE.parent
_CAUS = _ROOT / "causality"
_FC = _ROOT / "factory_context"
_PH0 = _ROOT / "discovery_corpus" / "scripts"
_PARSER = _ROOT / "mira-plc-parser"
for _p in (str(_HERE), str(_CAUS), str(_FC), str(_PH0), str(_PARSER)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import answer_card as card  # noqa: E402
import build as fc_build  # noqa: E402  (factory_context.build)
import builder as gb  # noqa: E402  (evidence_graph.builder)
import components as comp_mod  # noqa: E402
import explainer as ex  # noqa: E402
import history as hist  # noqa: E402
import interrogate_ignition_export as iie  # noqa: E402
import knowledge as know  # noqa: E402
import procedures as proc  # noqa: E402

import reports as rpt  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE


def _utf8_stdout():
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def build_all():
    project = iie.load(FIXTURE)
    fmodel = fc_build.build_model(project, "discovery_corpus/fixtures/" + Path(FIXTURE).name)
    cmodel = comp_mod.build_causality(fmodel)
    graph = gb.build_evidence_graph(cmodel, know.load_knowledge(), hist.load_history(), proc.load_procedures())
    return cmodel, graph


def _conveyor(cmodel):
    return next(a for a in cmodel.assets() if comp_mod.classify_asset(a) == "conveyor")


def _unsupported_claims(exp) -> list[str]:
    """A hypothesis with no tag evidence or no manual citation is an unsupported claim."""
    bad = []
    for h in exp.hypotheses:
        if not h.tag_evidence:
            bad.append("hypothesis %s has no tag evidence" % h.mode_id)
        if not h.manual_evidence:
            bad.append("hypothesis %s has no manual citation" % h.mode_id)
    return bad


def main() -> int:
    _utf8_stdout()
    print("== Phase 3 gate (evidence grounding & explainability) ==\n[1/5] running Phase 2 gate (-> 1 -> 0) ...")
    rc = subprocess.call([sys.executable, str(_CAUS / "run_phase2.py")])
    if rc != 0:
        print("\nPHASE 3: FAIL — Phase 2 gate not green (rc=%d)" % rc)
        return 1

    print("\n[2/5] building the evidence graph ...")
    cmodel, graph = build_all()
    history_data = hist.load_history()
    failures = []

    gviol = graph.violations()
    if gviol:
        failures.append("evidence-graph violations: %d (%s)" % (len(gviol), gviol[:3]))

    # 3. flagship
    print("[3/5] flagship: photoeye blocked on the conveyor -> 'why is this line blocked?' ...")
    conv = _conveyor(cmodel)
    obs = ex.observe(cmodel, "photoeye_blocked", conv.uns_path)
    exp = ex.explain_cause(graph, "line_blocked", obs.line_uns, obs, history_data)
    md = rpt.render_report(exp)
    reports_dir = _HERE / "reports"
    reports_dir.mkdir(exist_ok=True)
    (reports_dir / "phase3_explanation_report.md").write_text(md + "\n", encoding="utf-8")
    (reports_dir / "phase3_explanation_report.json").write_text(
        json.dumps(exp.to_dict(), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(md)

    # answer card — the plain-language trust checkpoint before Phase 4
    card_md = card.render_card(exp, graph)
    (reports_dir / "phase3_answer_card.md").write_text(card_md + "\n", encoding="utf-8")
    print("\n" + card_md)
    missing = [s for s in card.REQUIRED_SECTIONS if s not in card_md]
    if missing:
        failures.append("answer card missing sections: %s" % missing)

    if not ex.score(exp, obs):
        failures.append("flagship: top cause is not photoeye_blocked on the conveyor")
    failures += _unsupported_claims(exp)
    top = exp.hypotheses[0] if exp.hypotheses else None
    if top and not (top.tag_evidence and top.asset_evidence and top.manual_evidence and top.historical_evidence
                    and top.recommended_checks):
        failures.append("flagship top hypothesis is missing an evidence category")

    # 4. contradiction demo
    print("\n[4/5] contradiction demo: same fault but counts still increasing ...")
    obs_c = ex.observe(cmodel, "photoeye_blocked", conv.uns_path, conflicting=True)
    exp_c = ex.explain_cause(graph, "line_blocked", obs_c.line_uns, obs_c, history_data)
    photoeye = next((h for h in exp_c.hypotheses if h.mode_id == "photoeye_blocked"), None)
    if photoeye is None or not photoeye.contradicting_evidence:
        failures.append("contradiction demo: photoeye hypothesis shows no contradicting evidence")
    elif photoeye.confidence == "high":
        failures.append("contradiction demo: confidence did not drop despite contradiction")
    (reports_dir / "phase3_explanation_contradiction.md").write_text(
        rpt.render_report(exp_c) + "\n", encoding="utf-8")

    # determinism
    a = json.dumps(ex.explain_cause(graph, "line_blocked", obs.line_uns, obs, history_data).to_dict(), sort_keys=True)
    b = json.dumps(ex.explain_cause(graph, "line_blocked", obs.line_uns, obs, history_data).to_dict(), sort_keys=True)
    if a != b:
        failures.append("explanation is non-deterministic")

    print("\nwrote: evidence_graph/reports/phase3_explanation_report.{md,json}")

    # 6. tests
    print("\n[5/5] running Phase 3 pytest ...")
    rc2 = subprocess.call([sys.executable, "-m", "pytest", str(_HERE / "tests"), "-q"])
    if rc2 != 0:
        failures.append("pytest exit %d" % rc2)

    if failures:
        print("\nPHASE 3: FAIL")
        for f in failures:
            print("  - %s" % f)
        return 1
    print("\nPHASE 3: OK (evidence graph clean, flagship answer shows receipts, contradiction lowers "
          "confidence, deterministic, tests green)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

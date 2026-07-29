"""Parser <-> SimLab arc (P3): train (parse tags) -> deploy (read live) -> diagnose.

Proves the read-only PLC-export parser and SimLab agree on ground truth:

  (a) the parser IR tag-set COVERS the SimLab tag-set (every ``TagDef`` name
      appears as an IR tag) — the "train" step parses what SimLab declares;
  (b) ``vfd_signal_candidates`` label ``vfd_speed_hz`` -> ``frequency`` and
      ``motor_current_amps`` -> ``current_a`` — the parser's VFD classification
      matches SimLab's known signal roles;
  (c) ``asset_candidates`` group on the motor keyword;
  (d) VQT attach — drive a SimLab scenario ~120 ticks, snapshot live state, and
      attach it to the parser graph by name; numeric tags attach with zero
      unmatched (the "deploy / read live" step lighting up the parsed graph);
  (e) the "Supervisor diagnosis passes ``grade()``" step is documented and gated
      staging-only (no creds -> skip) — the OFFLINE arc (a-d) is the committed
      gate.

The bridge code lives in :mod:`tests.simlab.parser_bridge`; the parser package
(``mira-plc-parser/``) stays stdlib-only/UNS-agnostic and SimLab stays free of
any parser/LLM dependency. They meet only in ``tests/``.
"""

from __future__ import annotations

import pytest

from simlab.baselines.vfd_motor import vfd_motor_tags
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.models import AssetModel
from simlab.scenarios import get_scenario
from tests.simlab import parser_bridge as bridge

bridge.ensure_parser_on_path()
from mira_plc_parser import pipeline  # noqa: E402 — needs the path bootstrap above

# vqt_attach (the live-value join seam) is a NEWER parser feature than origin/main
# carries (it lands with parser PR #1974). The structural arc (a-c) needs only the
# stdlib parser on main; the VQT-attach step (d) imports it lazily and skips until
# it is on main, so this suite is green on main and lights up step (d) automatically
# once the parser update merges.
_VQT_SKIP = "parser vqt_attach not yet on main (lands with parser PR #1974)"

# Underfill scenario A: filler01, low bowl pressure. >=120 ticks surfaces both
# the F-UNDERFILL and F-LOW-BOWL alarms (see juice_runner_adapter).
UNDERFILL_SCENARIO_ID = "filler_underfill_low_bowl_pressure"
SCENARIO_TICKS = 120


# --- asset fixtures ----------------------------------------------------------


def _vfd_motor_asset() -> AssetModel:
    """A tiny AssetModel wrapping the composable VFD-motor baseline tag dict."""
    return AssetModel(
        asset_id="vfdmotor01",
        asset_type="vfd_motor",
        display_name="VFD Motor 01",
        baseline="vfd_motor",
        tags=vfd_motor_tags(),
    )


def _filler_asset() -> AssetModel:
    """The real ``filler01`` (bottle_filler baseline) from the juice line."""
    return build_line().asset("filler01")


def _parse_asset(asset: AssetModel):
    """Render the asset to a tag CSV and run it through the parser pipeline."""
    csv = bridge.assetmodel_to_csv_export(asset)
    result = pipeline.run(f"{asset.asset_id}.csv", csv)
    assert result.handled, f"parser did not handle {asset.asset_id} CSV"
    return result


# === (a) IR tag-set covers the SimLab tag-set ===============================


@pytest.mark.parametrize("asset_factory", [_vfd_motor_asset, _filler_asset])
def test_ir_tags_cover_simlab_tags(asset_factory):
    asset = asset_factory()
    result = _parse_asset(asset)
    ir_names = {t.name for t in result.project.all_tags()}
    simlab_names = set(asset.tags.keys())
    missing = simlab_names - ir_names
    assert not missing, f"IR missing SimLab tags for {asset.asset_id}: {sorted(missing)}"


def test_csv_export_round_trips_every_tagdef():
    """Round-trip: every TagDef yields exactly one IR tag (no drops, no dupes)."""
    for asset in (_vfd_motor_asset(), _filler_asset()):
        result = _parse_asset(asset)
        ir_names = sorted(t.name for t in result.project.all_tags())
        assert ir_names == sorted(asset.tags.keys()), asset.asset_id


# === (b) VFD signal role mapping matches SimLab's known roles ===============


@pytest.mark.parametrize("asset_factory", [_vfd_motor_asset, _filler_asset])
def test_vfd_signal_roles(asset_factory):
    asset = asset_factory()
    result = _parse_asset(asset)
    # name -> "candidate role: <role>"  ->  <role>
    roles = {
        f.name: f.detail.split("candidate role:", 1)[1].strip()
        for f in result.report.vfd_signal_candidates
        if "candidate role:" in f.detail
    }
    assert roles.get("vfd_speed_hz") == "frequency", roles
    assert roles.get("motor_current_amps") == "current_a", roles


# === (c) asset candidates group on the motor keyword ========================


@pytest.mark.parametrize("asset_factory", [_vfd_motor_asset, _filler_asset])
def test_asset_candidates_group_on_motor(asset_factory):
    asset = asset_factory()
    result = _parse_asset(asset)
    groups = {f.name for f in result.report.asset_candidates}
    # both baselines carry motor_current_amps -> a "motor" candidate group
    assert "motor" in groups, groups


# === reconcile_namespace + leaf_match =======================================


def test_reconcile_namespace_roots_inside_simlab_tree():
    asset = _filler_asset()
    root = bridge.reconcile_namespace(asset)
    # SimLab canonical asset path, lowercase dotted ltree, asset slug as the leaf.
    assert root.startswith("enterprise.")
    assert root.endswith(".filler01")


def test_leaf_match_by_slugged_leaf():
    asset = _filler_asset()
    # A parser signal name matches the SimLab tag_path by leaf, despite divergent
    # roots/categories (parser's inferred asset/category vs SimLab's declared one).
    from simlab.uns import tag_path

    sim_path = tag_path(asset.asset_id, "motor", "vfd_speed_hz")
    assert bridge.leaf_match("vfd_speed_hz", sim_path)
    assert not bridge.leaf_match("motor_current_amps", sim_path)


# === (d) VQT attach: live SimLab state lights up the parser graph ===========


def test_vqt_attach_from_live_snapshot():
    vqt_attach = pytest.importorskip("mira_plc_parser.vqt_attach", reason=_VQT_SKIP)
    asset = _filler_asset()
    result = _parse_asset(asset)
    graph = bridge.signal_graph_from_report(result.report)

    # Drive the underfill scenario to surface degraded live state.
    line = build_line()
    engine = SimEngine(line, seed=42)
    engine.load_scenario(get_scenario(UNDERFILL_SCENARIO_ID))
    engine.advance(SCENARIO_TICKS)
    snapshot = engine.snapshot_dict()

    # Numeric-only readings: the clean invariant (string fault_code -> '' -> None
    # is matched-but-unattached, which would skew an all-tags attached count).
    numeric = bridge.numeric_readings(snapshot, asset)
    attached = vqt_attach.attach_values(graph, numeric, by="name")
    summary = attached["live_summary"]

    # Every numeric reading matched a parser Signal node (zero unmatched) ...
    assert summary["unmatched_readings"] == []
    # ... and every numeric reading attached a live value.
    assert summary["signals_attached"] == len(numeric)
    assert len(numeric) > 0, "scenario produced no numeric tags to attach"

    # Spot-check a known degraded float: bowl pressure rode down under the fault.
    by_name = {n["name"]: n for n in attached["nodes"] if n["type"] == "Signal"}
    assert by_name["filler_bowl_pressure"]["vqt"]["value"] is not None
    assert by_name["filler_bowl_pressure"]["vqt"]["quality"] == "good"


def test_vqt_attach_empty_string_fault_code_is_matched_not_attached():
    """The string ``fault_code`` caveat: an empty value matches a Signal node
    (unmatched stays 0) but coerces to None -> 'bad', so it is NOT an attach."""
    vqt_attach = pytest.importorskip("mira_plc_parser.vqt_attach", reason=_VQT_SKIP)
    asset = _filler_asset()
    result = _parse_asset(asset)
    graph = bridge.signal_graph_from_report(result.report)

    # Healthy snapshot at tick 0: fault_code == "" (empty). Scope to the filler
    # so cross-asset leaf collisions (line-wide snapshot) don't muddy the check.
    line = build_line()
    engine = SimEngine(line, seed=42)
    snapshot = bridge.scope_snapshot_to_asset(engine.snapshot_dict(), asset)

    all_readings = bridge.snapshot_to_readings(snapshot)
    attached = vqt_attach.attach_values(graph, all_readings, by="name")
    summary = attached["live_summary"]

    by_name = {n["name"]: n for n in attached["nodes"] if n["type"] == "Signal"}
    fc = by_name["fault_code"]["vqt"]
    assert fc["value"] is None  # empty string coerced to None
    assert fc["quality"] == "bad"
    # fault_code (and every other filler tag) is a known Signal -> never unmatched.
    unmatched_keys = {u["key"] for u in summary["unmatched_readings"]}
    assert "fault_code" not in unmatched_keys


# === (e) Supervisor diagnosis passes grade() — STAGING ONLY =================


def test_supervisor_diagnosis_passes_grade_staging_only():
    """End of the arc: feed the live evidence to the REAL Supervisor and grade
    the reply against the scenario ground truth.

    Staging-only: it needs Doppler creds (Open WebUI + a cascade provider) and a
    reachable engine. The offline arc (a-d) above is the committed CI gate; this
    step is skipped without creds so the suite stays green offline.

    Reuses ``tests/simlab/supervisor_answerer.make_supervisor_answerer`` (which
    preserves ``source="direct_connection"`` — the SimLab connection certifies
    the UNS path, gate skipped not downgraded) and ``simlab.diagnostic.grade``.
    """
    try:
        from tests.simlab.supervisor_answerer import (
            SupervisorUnavailable,
            make_supervisor_answerer,
        )
    except Exception as exc:  # pragma: no cover — import guard
        pytest.skip(f"supervisor_answerer unavailable: {exc}")

    try:
        answer = make_supervisor_answerer()
    except SupervisorUnavailable as exc:
        pytest.skip(f"Supervisor staging creds absent: {exc}")

    # --- staging path (creds present) ---  # pragma: no cover — staging-only
    from simlab.diagnostic import assemble_evidence, grade

    scenario = get_scenario(UNDERFILL_SCENARIO_ID)
    line = build_line()
    engine = SimEngine(line, seed=42)
    engine.load_scenario(scenario)
    engine.advance(SCENARIO_TICKS)
    evidence = assemble_evidence(engine, scenario)

    reply = answer("Why is Filler 01 underfilling bottles?", evidence)
    rubric = grade(reply, scenario)
    assert rubric.passed, rubric.detail

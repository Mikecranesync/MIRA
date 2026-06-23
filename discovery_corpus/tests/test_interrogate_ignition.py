"""Tests for the Ignition export interrogator (the Discovery Recorder tool).

Deterministic, offline, runs against the committed SYNTHETIC factory fixture only -- never the
licensed corpus. These tests are the proof that every important Phase 0 claim is REPRODUCIBLE by
code: the structural taxonomy (classify_signal) and the five claim verdicts (assess_claims) are all
re-derived here from the parsed IR.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the script importable: insert its directory on sys.path.
_SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import interrogate_ignition_export as iie  # noqa: E402

FIXTURE = iie.DEFAULT_FIXTURE


def _project():
    return iie.load(FIXTURE)


def _report():
    return iie.interrogate(_project())


def _claims():
    proj = _project()
    return {c["id"]: c for c in iie.assess_claims(proj, iie.interrogate(proj))}


# ---- the synthetic fixture exists and is the committed stand-in (not the licensed corpus) ----

def test_default_fixture_is_the_committed_synthetic_one():
    assert FIXTURE.name == "synthetic_factory_export.json"
    assert FIXTURE.exists()
    # it lives inside discovery_corpus/fixtures, never under a licensed path
    assert "discovery_corpus" in str(FIXTURE).replace("\\", "/")


# ---- the interrogation report is internally consistent ----

def test_report_counts_are_consistent():
    c = _report()["counts"]
    assert c["enterprise"] == 1
    assert c["site"] == 1
    assert c["area"] == 2        # Bottling + Liquid Processing
    assert c["line"] == 2        # BottlingLine1 + TankFarm1
    assert c["asset"] == 2       # Filler01 + Tank01
    assert c["signal"] > 0


def test_hierarchy_matches_area_count():
    r = _report()
    assert len(r["hierarchy"]) == r["counts"]["area"]


# ---- the structural taxonomy classifies every fixture signal (no unknowns) ----

def test_no_unknown_archetypes_on_synthetic_fixture():
    """The synthetic fixture is curated to exercise the full taxonomy with zero unknowns."""
    r = _report()
    assert r["archetypes"]["unknown"] == 0, r["archetypes"]


def test_every_live_archetype_is_present():
    a = _report()["archetypes"]
    for k in ("static_metadata", "live_bool", "live_counter", "live_state", "live_analog"):
        assert a[k] > 0, f"{k} not exercised by the fixture: {a}"


def test_asset_families_split_discrete_vs_continuous():
    fam = _report()["asset_family"]
    assert fam["Filler01"] == "discrete_mes"
    assert fam["Tank01"] == "continuous_process"


# ---- classify_signal: canonical real-corpus dotted-name patterns (string-level proof) ----

def test_classify_live_counter():
    assert iie.classify_signal("Counts.Outfeed.Value.Value", "Units") == "live_counter"
    assert iie.classify_signal("Counts.Defect.Value.Value", "Units") == "live_counter"


def test_classify_live_bool():
    assert iie.classify_signal("ProductionRun.Running", "") == "live_bool"
    assert iie.classify_signal("Blocked.Value.Value", "") == "live_bool"
    assert iie.classify_signal("Starved.Value.Value", "") == "live_bool"


def test_classify_static_metadata():
    assert iie.classify_signal("Counts.Outfeed.Value.NumberFormat", "") == "static_metadata"
    assert iie.classify_signal("Definition.TypeId", "") == "static_metadata"
    assert iie.classify_signal("Material.Item.Name", "") == "static_metadata"


def test_classify_live_analog():
    assert iie.classify_signal("Level.Value.Value", "%") == "live_analog"
    assert iie.classify_signal("Flow.Value.Value", "L/min") == "live_analog"
    assert iie.classify_signal("Temperature.Value.Value", "°C") == "live_analog"


def test_classify_live_state():
    assert iie.classify_signal("State.Name", "") == "live_state"
    assert iie.classify_signal("State.Duration.TotalSeconds.Value", "s") == "live_state"


# ---- the five REPRODUCIBLE Phase 0 claims (the heart of "code first, LLM second") ----

def test_all_claims_pass_on_synthetic_fixture():
    for cid, c in _claims().items():
        assert c["verdict"] is True, f"{cid} failed: {c}"


def test_claim_C1_mes_not_plc():
    c = _claims()["C1"]
    assert c["verdict"] is True
    assert c["evidence"]["has_control_logic"] is False
    assert c["evidence"]["assets_with_mes_markers"] >= 1
    assert c["evidence"]["all_signal_data_types_empty"] is True  # mirrors the real export


def test_claim_C2_counts_and_state():
    c = _claims()["C2"]
    assert c["verdict"] is True
    assert c["evidence"]["live_counter_signals"] > 0
    assert c["evidence"]["live_state_signals"] > 0


def test_claim_C3_hierarchy():
    c = _claims()["C3"]
    assert c["verdict"] is True
    assert c["evidence"]["asset"] >= 1 and c["evidence"]["line"] >= 1 and c["evidence"]["area"] >= 1


def test_claim_C4_no_control_logic():
    c = _claims()["C4"]
    assert c["verdict"] is True
    assert c["evidence"]["controllers"] == 0
    assert c["evidence"]["routines"] == 0


def test_claim_C5_upstream_maintenance_evidence():
    c = _claims()["C5"]
    assert c["verdict"] is True
    assert c["evidence"]["exposes_blocked"] is True
    assert c["evidence"]["exposes_starved"] is True


# ---- determinism: the interrogation + claims are byte-stable across runs ----

def test_determinism_report_and_claims_are_stable():
    import json
    p1, p2 = _project(), _project()
    r1, r2 = iie.interrogate(p1), iie.interrogate(p2)
    assert json.dumps(r1, sort_keys=True) == json.dumps(r2, sort_keys=True)
    c1 = iie.assess_claims(p1, r1)
    c2 = iie.assess_claims(p2, r2)
    assert json.dumps(c1, sort_keys=True) == json.dumps(c2, sort_keys=True)

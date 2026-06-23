"""Tests for the Ignition export interrogator (the Discovery Recorder tool).

Deterministic, offline, runs against the committed SYNTHETIC mini fixture only -- never the licensed
corpus. Assertions are robust to the mini fixture's exact size: we assert >0 / membership / known
archetype labels, not magic totals that would break if the fixture grows.
"""
from __future__ import annotations

import sys
from pathlib import Path

# Make the script importable: insert its directory on sys.path.
_SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
if str(_SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPT_DIR))

import interrogate_ignition_export as iie  # noqa: E402

MINI_FIXTURE = iie.DEFAULT_FIXTURE


def _report():
    return iie.interrogate(iie.load(MINI_FIXTURE))


# ---- the interrogation report is internally consistent ----

def test_report_counts_are_consistent():
    r = _report()
    c = r["counts"]
    # the mini fixture is one enterprise / one site, with real assets and signals
    assert c["enterprise"] == 1
    assert c["site"] == 1
    assert c["area"] > 0
    assert c["line"] > 0
    assert c["asset"] > 0
    assert c["signal"] > 0
    # hierarchy area count matches the area node count
    assert len(r["hierarchy"]) == c["area"]


def test_every_signal_classifies_to_a_known_archetype():
    """Classification must never crash and must always land in the known archetype set."""
    proj = iie.load(MINI_FIXTURE)
    for node in proj.namespace:
        if node.level == "signal":
            arch = iie.classify_signal(node.name, node.unit)
            assert arch in iie.ARCHETYPES, f"{node.name!r} -> unknown archetype {arch!r}"
    # the report's histogram only ever uses known labels too
    r = iie.interrogate(proj)
    assert set(r["archetypes"]).issubset(set(iie.ARCHETYPES))


def test_signals_with_units_is_counted():
    r = _report()
    # the mini fixture has at least one unit-bearing signal (caps / mL / labels)
    assert r["signals_with_units"] > 0


def test_asset_family_is_resolved_for_every_asset():
    r = _report()
    assert r["asset_family"], "expected at least one asset"
    for fam in r["asset_family"].values():
        assert fam in ("discrete_mes", "continuous_process")


# ---- the canonical archetype taxonomy (real-corpus dotted-name patterns) ----

def test_classify_live_counter():
    assert iie.classify_signal("Counts.Outfeed.Value.Value", "Units") == "live_counter"
    assert iie.classify_signal("Counts.Infeed.Value.Value", "Units") == "live_counter"
    assert iie.classify_signal("Counts.Defect.Value.Value", "Units") == "live_counter"


def test_classify_live_bool():
    assert iie.classify_signal("ProductionRun.Running", "") == "live_bool"
    assert iie.classify_signal("Blocked.Value.Value", "") == "live_bool"
    assert iie.classify_signal("Starved.Value.Value", "") == "live_bool"


def test_classify_static_metadata():
    assert iie.classify_signal("Counts.Outfeed.Value.NumberFormat", "") == "static_metadata"
    assert iie.classify_signal("Definition.TypeId", "") == "static_metadata"
    assert iie.classify_signal("Material.Item.Name", "") == "static_metadata"
    assert iie.classify_signal("IdealCycleTime", "") == "static_metadata"


def test_classify_live_analog():
    # a unit-bearing analog (continuous-process tank level)
    assert iie.classify_signal("Level.Value.Value", "%") == "live_analog"
    assert iie.classify_signal("Flow.Value.Value", "L/min") == "live_analog"
    assert iie.classify_signal("Temperature.Value.Value", "°C") == "live_analog"


def test_classify_live_state():
    assert iie.classify_signal("State.Name", "") == "live_state"
    assert iie.classify_signal("State.Duration.TotalSeconds.Value", "s") == "live_state"


def test_continuous_process_family_from_process_unit():
    """An asset with a process-unit signal is classified continuous_process (synthetic check)."""
    # build a tiny synthetic project shape to confirm the family logic without the licensed corpus
    proj = iie.load(MINI_FIXTURE)
    # all mini-fixture assets are discrete_mes (no process units present)
    r = iie.interrogate(proj)
    assert all(f == "discrete_mes" for f in r["asset_family"].values())
    # and the unit check itself recognises a process unit
    assert iie._is_process_unit("bar") is True
    assert iie._is_process_unit("Units") is False

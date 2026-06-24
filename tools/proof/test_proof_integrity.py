"""Deterministic integrity tests for the proof packets — no DB, no network, no engine.

Run: pytest tools/proof/test_proof_integrity.py -q
"""
from __future__ import annotations
import json
import pathlib
import sys

import pytest

_HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(_HERE))
import integrity  # noqa: E402

RESULTS = _HERE / "results.json"


# --- honesty guard: a substitute can never masquerade as a real fault ----------

def test_substitute_guard_rejects_pasteurizer_mislabel():
    bad = [{"scenario_id": "cip_temp", "title": "Pasteurizer Temperature Fault"}]  # no SUBSTITUTE marker
    with pytest.raises(AssertionError, match="SUBSTITUTE"):
        integrity.assert_substitute_honest(bad)


def test_substitute_guard_requires_marker_in_title():
    bad = [{"scenario_id": "cip_supply_temp_low_SUBSTITUTE", "title": "CIP Supply Temp Low", "substitute_note": "x"}]
    with pytest.raises(AssertionError, match="SUBSTITUTE"):
        integrity.assert_substitute_honest(bad)


def test_substitute_guard_passes_honest_records():
    ok = [
        {"scenario_id": "filler_underfill_low_bowl_pressure", "title": "Filler 01 - Underfill"},
        {"scenario_id": "cip_supply_temp_low_SUBSTITUTE", "title": "CIP Temp Low (SUBSTITUTE for pasteurizer)", "substitute_note": "no pasteurizer"},
    ]
    integrity.assert_substitute_honest(ok)  # no raise


# --- metadata: explicit tenant + required provenance ---------------------------

def test_metadata_rejects_nonexplicit_tenant():
    meta = {"git_branch": "x", "config": {"MIRA_TENANT_ID": "staging"}, "tenant_id": "staging",
            "shared_tenant_id": "x", "corpus": {}, "grader": "x",
            "health": {k: 1 for k in integrity.REQUIRED_HEALTH}}
    with pytest.raises(AssertionError, match="tenant"):
        integrity.validate_metadata(meta)


def test_metadata_requires_health_fields():
    meta = {"git_branch": "x", "config": {"MIRA_TENANT_ID": "00000000-0000-0000-0000-000000515ab1"},
            "tenant_id": "00000000-0000-0000-0000-000000515ab1", "shared_tenant_id": "x",
            "corpus": {}, "grader": "x", "health": {"python": "3.12"}}
    with pytest.raises(AssertionError, match="health"):
        integrity.validate_metadata(meta)


# --- the committed results.json must itself be honest + complete ---------------

@pytest.mark.skipif(not RESULTS.exists(), reason="results.json not generated yet")
def test_committed_results_pass_all_guards():
    data = json.loads(RESULTS.read_text(encoding="utf-8"))
    assert isinstance(data, dict) and "metadata" in data and "results" in data, "results.json must be {metadata, results}"
    integrity.assert_substitute_honest(data["results"])
    integrity.validate_metadata(data["metadata"])
    integrity.validate_results(data["results"])


@pytest.mark.skipif(not RESULTS.exists(), reason="results.json not generated yet")
def test_retrieval_mode_and_langfuse_are_reported_not_hidden():
    data = json.loads(RESULTS.read_text(encoding="utf-8"))
    for r in data["results"]:
        assert r["retrieval_mode"], f"{r['scenario_id']} hides retrieval mode"
    # langfuse degraded state must be documented in metadata.health, not silently passed
    note = (data["metadata"]["health"].get("langfuse_note") or "")
    assert note, "langfuse status must be documented"


@pytest.mark.skipif(not RESULTS.exists(), reason="results.json not generated yet")
def test_real_scenarios_use_the_repo_rubric_grader():
    data = json.loads(RESULTS.read_text(encoding="utf-8"))
    real = [r for r in data["results"] if "SUBSTITUTE" not in r["scenario_id"]]
    assert real, "expected real (non-substitute) scenarios"
    for r in real:
        assert r.get("rubric") and "rubric_passed" in r["rubric"], f"{r['scenario_id']} not graded by simlab.diagnostic.grade"


def test_clean_rerun_has_no_hidden_local_state_dependency():
    """The harness exposes a --clean flag that removes the only hidden local state
    (the SQLite session db). This asserts the flag/path exists in the harness source."""
    src = (_HERE / "run_proof.py").read_text(encoding="utf-8")
    assert "--clean" in src and "proof_simlab.db" in src, "no documented clean-rerun path"

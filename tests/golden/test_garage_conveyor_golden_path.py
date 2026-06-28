"""Tests for approval-gated retrieval + the garage-conveyor golden path.

Two layers:
  * offline unit tests (no DB/net) for the gate SQL helper — always run, CI-safe.
  * integration test that runs the full golden path against NeonDB — skipped when
    NEON_DATABASE_URL is absent.

Run: pytest tests/golden/test_garage_conveyor_golden_path.py -q
"""
from __future__ import annotations
import os
import sys
import pathlib

import pytest

_REPO = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_REPO / "mira-bots"))
sys.path.insert(0, str(_REPO / "tests" / "golden"))


# ---- offline unit tests: the gate flag controls the SQL fragment -------------

def _fresh_neon_recall():
    import importlib
    from shared import neon_recall
    return importlib.reload(neon_recall)


def test_gate_off_by_default_emits_no_filter(monkeypatch):
    monkeypatch.delenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", raising=False)
    nr = _fresh_neon_recall()
    assert nr.approval_gate_enabled() is False
    assert nr._approval_filter_sql() == ""  # byte-identical to prior behavior


def test_gate_on_emits_verified_filter(monkeypatch):
    monkeypatch.setenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true")
    nr = _fresh_neon_recall()
    assert nr.approval_gate_enabled() is True
    assert nr._approval_filter_sql() == " AND verified = true"


def test_gate_reads_env_live_not_frozen(monkeypatch):
    """The flag can toggle without a process restart (operational requirement)."""
    monkeypatch.setenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "false")
    nr = _fresh_neon_recall()
    assert nr._approval_filter_sql() == ""
    monkeypatch.setenv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true")
    assert nr._approval_filter_sql() == " AND verified = true"  # same module instance, new value


# ---- integration: the full golden path against NeonDB ------------------------

requires_neon = pytest.mark.skipif(
    not os.getenv("NEON_DATABASE_URL"),
    reason="needs NEON_DATABASE_URL (run under: doppler run --config stg)",
)


@pytest.fixture(scope="module")
def golden():
    import garage_conveyor_golden_path as g
    return g.run()


@requires_neon
def test_golden_path_overall_pass(golden):
    assert golden["verdict"] == "PASS", golden


@requires_neon
def test_fixture_produces_expected_namespace_kg(golden):
    s = golden["steps"]["2_namespace_kg_approved"]
    assert s["nodes"] == 6 and s["all_verified"] is True  # site+area+asset+3 components, approved


@requires_neon
def test_unapproved_not_retrievable_when_gate_enabled(golden):
    assert golden["steps"]["4_gate_on_approved_only"]["excludes_unreviewed"] is True


@requires_neon
def test_gate_on_returns_only_verified(golden):
    assert golden["steps"]["4_gate_on_approved_only"]["all_verified"] is True


@requires_neon
def test_approval_action_updates_retrieval_eligibility(golden):
    # held-back chunk excluded before approval, retrievable after — approval IS the control
    assert golden["steps"]["4_gate_on_approved_only"]["excludes_unreviewed"] is True
    assert golden["steps"]["5_approval_makes_retrievable"]["now_includes_unreviewed"] is True


@requires_neon
def test_approved_source_count_is_visible(golden):
    assert golden["steps"]["6_approved_source_count"] == 3

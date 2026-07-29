"""Self-scoring dashboard + eval endpoints (Phase P5).

The dashboard is the ProveIt demo surface: it runs every scenario through the
deterministic P1 evaluation service and renders the five graded dimensions live.
These tests cover the JSON eval endpoints (the contract the page consumes) and
that the page is served. FastAPI-gated, so they skip cleanly under the minimal
(pytest+pyyaml) gate and run wherever fastapi is installed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

fastapi = pytest.importorskip("fastapi", reason="fastapi not installed — skipping dashboard tests")
httpx = pytest.importorskip("httpx", reason="httpx not installed — skipping dashboard tests")


@pytest.fixture()
def client(tmp_path: Path) -> Any:
    from fastapi.testclient import TestClient

    from simlab.api import build_app
    from simlab.approval import ApprovalStore
    from simlab.engine import SimEngine
    from simlab.lines.juice_bottling import build_line

    engine = SimEngine(build_line(), seed=42)
    approvals = ApprovalStore(str(tmp_path / "approvals.db"))
    return TestClient(build_app(engine=engine, approvals=approvals))


# --- scorecard endpoint (the contract the dashboard consumes) ---------------


def test_scorecard_oracle_passes_all(client: Any) -> None:
    """The oracle answerer is the positive control: every scenario passes."""
    r = client.get("/simlab/eval/scorecard?answerer=oracle")
    assert r.status_code == 200
    data = r.json()
    assert data["schema_version"] == 1
    assert data["answerer"] == "oracle"
    agg = data["aggregate"]
    assert agg["scenario_count"] == 6
    assert agg["passed"] == 6
    assert agg["pass_rate"] == 1.0
    assert {"oracle", "evidence_only"} <= set(data["answerers"])
    # each scenario carries the five graded dimensions
    for s in data["scenarios"]:
        for dim in ("asset_identification", "root_cause_accuracy", "evidence_recall",
                    "citation_accuracy", "corrective_action_accuracy", "overall", "passed"):
            assert dim in s


def test_scorecard_evidence_only_misses_root_cause(client: Any) -> None:
    """Evidence-only hits asset/evidence/citation but cannot name the root cause
    (that's MIRA's reasoning job) — so it fails the rubric, deterministically."""
    data = client.get("/simlab/eval/scorecard?answerer=evidence_only").json()
    assert data["aggregate"]["passed"] == 0
    for s in data["scenarios"]:
        assert s["root_cause_accuracy"] is False
        assert s["asset_identification"] is True          # asset still identified
        assert s["overall"] < 1.0


def test_scorecard_is_deterministic(client: Any) -> None:
    a = client.get("/simlab/eval/scorecard?answerer=oracle").json()
    b = client.get("/simlab/eval/scorecard?answerer=oracle").json()
    assert a == b


def test_single_scenario_eval(client: Any) -> None:
    r = client.get("/simlab/eval/filler_underfill_low_bowl_pressure?answerer=oracle")
    assert r.status_code == 200
    s = r.json()
    assert s["scenario_id"] == "filler_underfill_low_bowl_pressure"
    assert s["passed"] is True


def test_unknown_answerer_400(client: Any) -> None:
    assert client.get("/simlab/eval/scorecard?answerer=nope").status_code == 400


def test_unknown_scenario_404(client: Any) -> None:
    assert client.get("/simlab/eval/not_a_scenario").status_code == 404


# --- the page itself --------------------------------------------------------


def test_dashboard_page_served(client: Any) -> None:
    r = client.get("/simlab/dashboard")
    assert r.status_code == 200
    assert "text/html" in r.headers["content-type"]
    body = r.text
    assert "SimLab" in body and "Self-Scoring" in body
    # it wires to the scorecard endpoint
    assert "/simlab/eval/scorecard" in body

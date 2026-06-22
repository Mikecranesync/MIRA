"""SimLab Evaluation Service tests — Phase P1 of the platform-oracle plan.

Asserts the reusable scoring service (``simlab.evaluation``):
1. ``run_all`` returns one ``ScenarioScore`` per scenario (6).
2. The oracle/reference answerer (``ground_truth_answerer``) passes every
   scenario on every dimension (positive control proving the pipeline is wired).
3. The honest evidence-only answerer lights up asset/evidence/citation but
   legitimately CANNOT pass root_cause from evidence alone (documented).
4. ``to_json`` / ``to_markdown`` emit the documented stable schema.
5. Scores are byte-deterministic across two runs at seed 42.

Fully offline: no Doppler, no DB, no MQTT broker, no LLM, no Supervisor import.
"""

from __future__ import annotations

from simlab.evaluation import (
    DEFAULT_MANIFEST_TICKS,
    DIMENSION_WEIGHTS,
    ScenarioScore,
    evidence_only_answerer,
    ground_truth_answerer,
    run_all,
    run_scenario,
    to_json,
    to_markdown,
)
from simlab.scenarios import SCENARIOS, get_scenario


def test_run_all_returns_six_scores() -> None:
    """run_all yields exactly one ScenarioScore per scenario (A–F)."""
    scores = run_all(ground_truth_answerer)
    assert len(scores) == len(SCENARIOS) == 6
    assert all(isinstance(s, ScenarioScore) for s in scores)
    assert {s.scenario_id for s in scores} == set(SCENARIOS.keys())


def test_oracle_answerer_passes_all_scenarios() -> None:
    """The reference/oracle answerer passes every scenario on every dimension.

    This is the positive control: if the full evidence→answer→grade→ScenarioScore
    pipeline can't award a passing score from the ground-truth oracle, the rubric
    or projection has regressed.
    """
    scores = run_all(ground_truth_answerer)
    for s in scores:
        assert s.passed, f"{s.scenario_id}: oracle reply failed rubric — {s.detail}"
        assert s.asset_identification, f"{s.scenario_id}: asset not identified"
        assert s.root_cause_accuracy, f"{s.scenario_id}: root cause not hit"
        assert s.evidence_recall >= 0.5, (
            f"{s.scenario_id}: evidence_recall {s.evidence_recall} < 0.5"
        )
        # Composite must reflect a strong pass.
        assert 0.0 <= s.overall <= 1.0
        assert s.overall >= 0.75, f"{s.scenario_id}: overall {s.overall} too low for oracle"


def test_evidence_only_answerer_cannot_pass_root_cause() -> None:
    """The honest evidence-only answerer lights asset/evidence but not root_cause.

    Documents the legitimate boundary: the EvidencePacket surfaces WHAT is
    abnormal, never the named root cause the rubric matches on. So an answer built
    purely from evidence identifies the asset and recalls evidence, but cannot
    hit root_cause_accuracy → passed is False. This is expected, not a defect.
    """
    scores = [
        run_scenario(SCENARIOS[sid], evidence_only_answerer)
        for sid in sorted(SCENARIOS)
    ]
    for s in scores:
        assert s.asset_identification, (
            f"{s.scenario_id}: evidence-only answer should still name the asset"
        )
        assert not s.root_cause_accuracy, (
            f"{s.scenario_id}: evidence-only answer unexpectedly hit root_cause "
            f"(the packet should not leak the cause phrasing) — {s.detail}"
        )
        assert not s.passed, (
            f"{s.scenario_id}: evidence-only answer should not pass without root cause"
        )


def test_default_manifest_ticks_cover_all_scenarios() -> None:
    """The shared manifest-ticks map covers every scenario id (gate ↔ service)."""
    assert set(DEFAULT_MANIFEST_TICKS) == set(SCENARIOS.keys())


def test_to_json_schema() -> None:
    """to_json emits the documented stable schema with a correct aggregate."""
    scores = run_all(ground_truth_answerer)
    blob = to_json(scores)

    assert blob["schema_version"] == 1
    agg = blob["aggregate"]
    assert agg["scenario_count"] == 6
    assert agg["passed"] == 6  # oracle passes all
    assert agg["pass_rate"] == 1.0
    assert 0.0 <= agg["mean_overall"] <= 1.0
    assert agg["dimension_weights"] == dict(DIMENSION_WEIGHTS)
    # Weights are a proper distribution.
    assert round(sum(DIMENSION_WEIGHTS.values()), 6) == 1.0

    assert len(blob["scenarios"]) == 6
    expected_keys = {
        "scenario_id",
        "passed",
        "overall",
        "asset_identification",
        "root_cause_accuracy",
        "evidence_recall",
        "citation_accuracy",
        "corrective_action_accuracy",
        "detail",
    }
    for row in blob["scenarios"]:
        assert set(row) == expected_keys
        assert isinstance(row["asset_identification"], bool)
        assert isinstance(row["root_cause_accuracy"], bool)
        assert 0.0 <= row["overall"] <= 1.0
        assert 0.0 <= row["evidence_recall"] <= 1.0
        assert 0.0 <= row["citation_accuracy"] <= 1.0
        assert 0.0 <= row["corrective_action_accuracy"] <= 1.0


def test_to_markdown_schema() -> None:
    """to_markdown renders the documented stable scorecard."""
    scores = run_all(ground_truth_answerer)
    md = to_markdown(scores)

    assert "# SimLab Evaluation Scorecard" in md
    assert "**Passed:** 6/6" in md
    assert "Mean overall" in md
    # Header row carries the five PRD dimensions.
    assert "Asset | RootCause | EvidRecall | Citation | Action" in md
    # One table row per scenario.
    for sid in SCENARIOS:
        assert f"`{sid}`" in md


def test_scores_are_deterministic() -> None:
    """Two runs at seed 42 produce identical ScenarioScores (no LLM, no RNG drift)."""
    a = run_all(ground_truth_answerer, seed=42)
    b = run_all(ground_truth_answerer, seed=42)
    assert a == b
    # JSON projection is also stable.
    assert to_json(a) == to_json(b)


def test_run_scenario_respects_explicit_ticks() -> None:
    """Passing ticks overrides the manifest default and still scores."""
    scenario = get_scenario("capper_torque_fault")
    s = run_scenario(scenario, ground_truth_answerer, ticks=60)
    assert s.scenario_id == "capper_torque_fault"
    assert s.passed

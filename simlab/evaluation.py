"""SimLab Evaluation Service — Phase P1 of the platform-oracle plan.

A reusable, deterministic scoring service: *any* component is measured against
SimLab ground truth with one call. It SCORES; it does NOT answer. The answerer
is injected as ``AnswerFn``.

Design invariants (Objective 1, PRD):
- **Deterministic + offline.** No LLM import, no Supervisor import, no network,
  no DB. The same (scenario, answer_fn, ticks, seed) always yields the same
  ``ScenarioScore``. The real-Supervisor answerer lives in ``tests/simlab/``.
- **Five graded dimensions** exposed explicitly on ``ScenarioScore`` (asset
  identification, root-cause accuracy, evidence recall, citation accuracy,
  corrective-action accuracy) plus a weighted ``overall`` and ``passed``.
- **Stable JSON / markdown schema** — this is a contract other tools and the
  P5 dashboard consume. The schema keys are documented on ``to_json`` /
  ``to_markdown``.

The grading itself is delegated to ``simlab.diagnostic.grade`` (the rubric);
this module only wires evidence → answer → grade and projects the
``RubricResult`` onto the five PRD dimensions + a composite.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Optional

from simlab.diagnostic import EvidencePacket, RubricResult, assemble_evidence, grade
from simlab.engine import SimEngine
from simlab.lines.juice_bottling import build_line
from simlab.scenarios import SCENARIOS, Scenario

# ---------------------------------------------------------------------------
# Injected answerer contract
# ---------------------------------------------------------------------------

AnswerFn = Callable[[str, EvidencePacket], str]
"""The injected answerer: ``(question, evidence_packet) -> free-text reply``.

The evaluation service never answers — it calls this. A deterministic mock
(``ground_truth_answerer`` / ``_oracle_answerer`` below) is the CI control; the
real Supervisor adapter lives in ``tests/simlab/supervisor_answerer.py`` and is
staging-only.
"""


# ---------------------------------------------------------------------------
# Per-scenario manifest ticks  (single source of truth shared with the gate)
# ---------------------------------------------------------------------------

# The tick at which each scenario's fault is fully manifested. Kept identical to
# tests/simlab/test_grader_gate.py::_MANIFEST_TICK — that test imports THIS dict
# so the two never drift (one source of truth). Each tick is the END of the
# fault_active phase: the fault is decisive and the alarms_at_tick thresholds
# have fired.
DEFAULT_MANIFEST_TICKS: dict[str, int] = {
    "filler_underfill_low_bowl_pressure": 120,  # F-LOW-BOWL @75, F-UNDERFILL @110 latched
    "capper_torque_fault": 60,                  # CA-TORQUE @52 latched; torque floored at 5.5
    "labeler_registration_drift": 60,           # L-REG-DRIFT @53 latched; reg error ~2.8mm
    "casepacker_jam_upstream_block": 15,        # CP-JAM @10 latched; jam_detected True
    "palletizer_unavailable_backup": 10,        # robot_ready False @5; casepacker backs up
    "low_plant_air_multi_machine": 40,          # AS-LOW-PRESS @30; header at 55 psi
}


# ---------------------------------------------------------------------------
# Composite weighting
# ---------------------------------------------------------------------------

# Weights for the ``overall`` composite (sum to 1.0). Root-cause and asset are
# weighted heaviest: naming the wrong machine or the wrong cause is the most
# expensive diagnostic error on a plant floor. Evidence recall is the next
# strongest proof signal; citation and corrective-action round it out.
#
#   root_cause           0.30
#   asset_identification 0.25
#   evidence_recall      0.20
#   citation_accuracy    0.15
#   corrective_action    0.10
#                        ----
#                        1.00
DIMENSION_WEIGHTS: dict[str, float] = {
    "root_cause_accuracy": 0.30,
    "asset_identification": 0.25,
    "evidence_recall": 0.20,
    "citation_accuracy": 0.15,
    "corrective_action_accuracy": 0.10,
}


# ---------------------------------------------------------------------------
# ScenarioScore
# ---------------------------------------------------------------------------


@dataclass
class ScenarioScore:
    """A scored SimLab scenario, projecting the rubric onto the five PRD dimensions.

    The five graded dimensions (per the PRD success criteria):
    - ``asset_identification`` — did the reply name the expected asset?
    - ``root_cause_accuracy`` — did the reply state the expected root cause?
    - ``evidence_recall`` — fraction of expected evidence tags surfaced (0–1).
    - ``citation_accuracy`` — citations_hit / max(1, len(expected_citations)).
    - ``corrective_action_accuracy`` — actions_hit / max(1, len(expected_actions)).

    Plus:
    - ``overall`` — weighted composite (0–1); see ``DIMENSION_WEIGHTS``.
    - ``passed`` — the rubric's pass bar (root_cause AND asset AND recall>=0.5).
    - ``scenario_id`` / ``detail`` — identity + the rubric's human-readable line.
    - ``rubric`` — the raw ``RubricResult`` (kept reachable for callers that need
      the hit lists; excluded from equality so two runs compare cleanly).
    """

    scenario_id: str
    asset_identification: bool
    root_cause_accuracy: bool
    evidence_recall: float
    citation_accuracy: float
    corrective_action_accuracy: float
    overall: float
    passed: bool
    detail: str
    rubric: Optional[RubricResult] = field(default=None, compare=False, repr=False)


def _compute_overall(
    *,
    asset: bool,
    root_cause: bool,
    evidence_recall: float,
    citation_accuracy: float,
    corrective_action_accuracy: float,
) -> float:
    """Weighted composite of the five dimensions (booleans count as 1.0 / 0.0)."""
    w = DIMENSION_WEIGHTS
    total = (
        w["root_cause_accuracy"] * (1.0 if root_cause else 0.0)
        + w["asset_identification"] * (1.0 if asset else 0.0)
        + w["evidence_recall"] * evidence_recall
        + w["citation_accuracy"] * citation_accuracy
        + w["corrective_action_accuracy"] * corrective_action_accuracy
    )
    return round(total, 4)


def _rubric_to_score(scenario: Scenario, rubric: RubricResult) -> ScenarioScore:
    """Project a ``RubricResult`` onto the five PRD dimensions + composite."""
    citation_accuracy = round(
        len(rubric.citations_hit) / max(1, len(scenario.expected_citations)), 4
    )
    corrective_action_accuracy = round(
        len(rubric.actions_hit) / max(1, len(scenario.expected_actions)), 4
    )
    overall = _compute_overall(
        asset=rubric.asset_hit,
        root_cause=rubric.root_cause_hit,
        evidence_recall=rubric.evidence_recall,
        citation_accuracy=citation_accuracy,
        corrective_action_accuracy=corrective_action_accuracy,
    )
    return ScenarioScore(
        scenario_id=scenario.id,
        asset_identification=rubric.asset_hit,
        root_cause_accuracy=rubric.root_cause_hit,
        evidence_recall=round(rubric.evidence_recall, 4),
        citation_accuracy=citation_accuracy,
        corrective_action_accuracy=corrective_action_accuracy,
        overall=overall,
        passed=rubric.passed,
        detail=rubric.detail,
        rubric=rubric,
    )


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------


def run_scenario(
    scenario: Scenario,
    answer_fn: AnswerFn,
    *,
    ticks: Optional[int] = None,
    seed: int = 42,
) -> ScenarioScore:
    """Score one scenario: build line → engine → load → advance → evidence → answer → grade.

    Parameters
    ----------
    scenario:
        A ``simlab.scenarios.Scenario`` (see ``SCENARIOS``).
    answer_fn:
        The injected ``AnswerFn``. Receives ``(scenario.question, evidence)`` and
        returns a free-text reply. This module never inspects the reply except to
        grade it.
    ticks:
        Ticks to advance. Defaults to ``DEFAULT_MANIFEST_TICKS[scenario.id]``.
    seed:
        Engine RNG seed (default 42) for deterministic replay.
    """
    if ticks is None:
        ticks = DEFAULT_MANIFEST_TICKS[scenario.id]

    engine = SimEngine(build_line(), seed=seed)
    engine.load_scenario(scenario)
    engine.advance(ticks)

    evidence = assemble_evidence(engine, scenario)
    reply = answer_fn(scenario.question, evidence)
    rubric = grade(reply, scenario)
    return _rubric_to_score(scenario, rubric)


def run_all(answer_fn: AnswerFn, *, seed: int = 42) -> list[ScenarioScore]:
    """Score every scenario in ``SCENARIOS`` (stable order by scenario id)."""
    return [
        run_scenario(SCENARIOS[sid], answer_fn, seed=seed)
        for sid in sorted(SCENARIOS)
    ]


# ---------------------------------------------------------------------------
# Stable emitters  (JSON dict + markdown)
# ---------------------------------------------------------------------------


def to_json(scores: list[ScenarioScore]) -> dict:
    """Serialise scores to a STABLE JSON-able dict. Contract for downstream tools.

    Schema::

        {
          "schema_version": 1,
          "aggregate": {
            "scenario_count": int,
            "passed": int,
            "pass_rate": float,          # passed / count, 0..1
            "mean_overall": float,       # mean of per-scenario overall, 0..1
            "dimension_weights": {dim: float, ...},
          },
          "scenarios": [
            {
              "scenario_id": str,
              "passed": bool,
              "overall": float,
              "asset_identification": bool,
              "root_cause_accuracy": bool,
              "evidence_recall": float,
              "citation_accuracy": float,
              "corrective_action_accuracy": float,
              "detail": str,
            }, ...
          ],
        }
    """
    count = len(scores)
    passed = sum(1 for s in scores if s.passed)
    mean_overall = round(sum(s.overall for s in scores) / count, 4) if count else 0.0
    return {
        "schema_version": 1,
        "aggregate": {
            "scenario_count": count,
            "passed": passed,
            "pass_rate": round(passed / count, 4) if count else 0.0,
            "mean_overall": mean_overall,
            "dimension_weights": dict(DIMENSION_WEIGHTS),
        },
        "scenarios": [
            {
                "scenario_id": s.scenario_id,
                "passed": s.passed,
                "overall": s.overall,
                "asset_identification": s.asset_identification,
                "root_cause_accuracy": s.root_cause_accuracy,
                "evidence_recall": s.evidence_recall,
                "citation_accuracy": s.citation_accuracy,
                "corrective_action_accuracy": s.corrective_action_accuracy,
                "detail": s.detail,
            }
            for s in scores
        ],
    }


def to_markdown(scores: list[ScenarioScore]) -> str:
    """Render scores as a STABLE markdown scorecard (same data as ``to_json``).

    Columns mirror the five PRD dimensions + overall + pass; the header line
    carries the aggregate pass-rate and mean overall. Stable so the P5 dashboard
    and CI artifacts can diff it.
    """
    count = len(scores)
    passed = sum(1 for s in scores if s.passed)
    pass_rate = round(passed / count, 4) if count else 0.0
    mean_overall = round(sum(s.overall for s in scores) / count, 4) if count else 0.0

    lines = [
        "# SimLab Evaluation Scorecard",
        "",
        f"**Scenarios:** {count}  |  "
        f"**Passed:** {passed}/{count} ({pass_rate:.0%})  |  "
        f"**Mean overall:** {mean_overall:.2%}",
        "",
        "| Scenario | Pass | Overall | Asset | RootCause | EvidRecall | Citation | Action |",
        "|----------|------|---------|-------|-----------|------------|----------|--------|",
    ]
    for s in scores:
        lines.append(
            f"| `{s.scenario_id}` "
            f"| {'✓' if s.passed else '✗'} "
            f"| {s.overall:.2%} "
            f"| {'✓' if s.asset_identification else '✗'} "
            f"| {'✓' if s.root_cause_accuracy else '✗'} "
            f"| {s.evidence_recall:.0%} "
            f"| {s.citation_accuracy:.0%} "
            f"| {s.corrective_action_accuracy:.0%} |"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Reference answerers  (deterministic controls — NOT real answer engines)
# ---------------------------------------------------------------------------


def evidence_only_answerer(question: str, evidence: EvidencePacket) -> str:
    """Deterministic answerer built PURELY from the ``EvidencePacket``.

    This is the honest "what can be said from evidence alone" control. It names
    the evidence's primary asset, lists the abnormal tag UNS paths, and cites the
    candidate docs — all legitimately present on the packet, with NO peek at the
    scenario's ``expected_*`` answer key.

    It proves the evidence → answer → grade wiring lights up the asset, evidence
    and citation dimensions end-to-end without an LLM. It does NOT (and cannot)
    pass ``root_cause_accuracy``: the root-cause *phrasing* the rubric checks for
    lives only in ``scenario.expected_root_cause``, which is intentionally absent
    from the evidence packet. So ``passed`` is False for this answerer — that is
    correct behaviour, not a bug. For a full positive control, use
    ``ground_truth_answerer`` (the test-only oracle below).
    """
    tag_paths = " ".join(e["uns_path"] for e in evidence.abnormal_tags)
    docs = " ".join(evidence.candidate_docs)
    return (
        f"Primary asset under observation: {evidence.asset_id} "
        f"(UNS subtree {evidence.uns_subtree}). "
        f"Abnormal signals: {tag_paths}. "
        f"Relevant documentation: {docs}."
    )


def _oracle_answerer(question: str, evidence: EvidencePacket) -> str:
    """TEST-ONLY positive-control oracle — uses ``expected_*`` ground truth.

    NOT a real answerer: it looks up the active scenario by the evidence's
    ``asset_id`` and constructs a reply from the scenario's answer key
    (root cause, asset, evidence tags, citations, actions). Its sole purpose is
    to prove the full grading pipeline can award a passing score — i.e. the
    rubric + emitters are wired correctly. Never use it to evaluate a real
    component (that would be circular).
    """
    # Resolve the scenario from the evidence's asset_id (asset_id is unique per
    # scenario across SCENARIOS A–F).
    scenario = next(
        (s for s in SCENARIOS.values() if s.asset_id == evidence.asset_id),
        None,
    )
    if scenario is None:  # pragma: no cover — defensive
        return evidence_only_answerer(question, evidence)

    evidence_snippet = " ".join(scenario.expected_evidence_tags)
    citations = " ".join(scenario.expected_citations)
    actions = " ".join(scenario.expected_actions)
    return (
        f"Root cause: {scenario.expected_root_cause}. "
        f"Affected asset: {scenario.expected_asset}. "
        f"Evidence tags: {evidence_snippet}. "
        f"Recommended actions: {actions}. "
        f"See {citations}."
    )


def ground_truth_answerer(question: str, evidence: EvidencePacket) -> str:
    """The reference (positive-control) answerer for proving the scoring pipeline.

    A faithful reply built PURELY from the ``EvidencePacket`` (see
    ``evidence_only_answerer``) cannot pass ``root_cause_accuracy``, because the
    root-cause phrasing the rubric matches on is not present in the evidence
    packet by design (the packet surfaces WHAT is abnormal, not the named cause).

    To serve as a TRUE positive control that yields ``passed=True`` across all
    dimensions — proving the rubric + emitters are correctly wired — this
    delegates to the clearly-labelled test-only ``_oracle_answerer``, which does
    consult ``expected_*``. This is documented and intentional: it is a
    self-test of the scoring service, not an evaluation of a real component. For
    "answer from evidence alone", call ``evidence_only_answerer`` directly.
    """
    return _oracle_answerer(question, evidence)

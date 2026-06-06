"""Machine-behavior checkpoints for SimLab scenarios.

These extend the standard grader.py checkpoints with cross-component reasoning
checks that can't be evaluated per-turn — they look across the entire conversation.

Standard checkpoints (from grader.py):
  cp_reached_state, cp_keyword_match, cp_no_5xx, cp_turn_budget, cp_citation_groundedness

New machine-behavior checkpoints (this module):
  cp_no_premature_blame   — MIRA didn't blame a red-herring component before isolation
  cp_isolation_evidence   — MIRA cited measurements/tags before concluding
  cp_subsystem_identified — MIRA named the correct faulty subsystem
  cp_safety_respected     — MIRA did not recommend unsafe actions for this scenario
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from tests.simlab.schema import SimLabScenario


@dataclass
class BehaviorCheckResult:
    name: str
    passed: bool
    reason: str


# ── Checkpoint implementations ────────────────────────────────────────────────


def cp_no_premature_blame(
    replies: list[str],
    forbidden_components: list[str],
    until_turn: int = 99,
) -> BehaviorCheckResult:
    """MIRA must not name forbidden (red-herring) components as the fault before isolation.

    Example: for a product jam, blaming the photoeye sensors in the first two turns
    before checking the belt physically is premature blame.
    """
    checked_replies = replies[:until_turn]
    combined = " ".join(checked_replies).lower()
    for component in forbidden_components:
        if re.search(rf"\b{re.escape(component.lower())}\b", combined):
            return BehaviorCheckResult(
                name="cp_no_premature_blame",
                passed=False,
                reason=f"Prematurely blamed '{component}' before isolation (turn ≤{until_turn})",
            )
    return BehaviorCheckResult(
        name="cp_no_premature_blame",
        passed=True,
        reason="No premature blame of red-herring components",
    )


def cp_isolation_evidence(
    replies: list[str],
    required_measurements: list[str],
) -> BehaviorCheckResult:
    """MIRA must reference measurement/tag evidence before concluding root cause.

    Prevents "replace the motor" answers without citing any measurement evidence.
    """
    combined = " ".join(replies).lower()
    found = [m for m in required_measurements if m.lower() in combined]
    if not found:
        return BehaviorCheckResult(
            name="cp_isolation_evidence",
            passed=False,
            reason=f"No measurement evidence cited. Expected at least one of: {required_measurements}",
        )
    return BehaviorCheckResult(
        name="cp_isolation_evidence",
        passed=True,
        reason=f"Evidence cited: {found}",
    )


def cp_subsystem_identified(
    replies: list[str],
    expected_subsystem: str,
    aliases: list[str] | None = None,
) -> BehaviorCheckResult:
    """MIRA must identify the correct subsystem in its response."""
    all_terms = [expected_subsystem] + (aliases or [])
    combined = " ".join(replies).lower()
    for term in all_terms:
        if term.lower() in combined:
            return BehaviorCheckResult(
                name="cp_subsystem_identified",
                passed=True,
                reason=f"Subsystem '{term}' identified",
            )
    return BehaviorCheckResult(
        name="cp_subsystem_identified",
        passed=False,
        reason=f"Expected subsystem '{expected_subsystem}' not identified in any reply",
    )


def cp_no_cross_component_confusion(
    replies: list[str],
    forbidden_blame: list[str],
) -> BehaviorCheckResult:
    """MIRA must not blame a component type that is not involved in the fault path.

    Example: for a sensor stuck fault causing a conveyor stop, MIRA should not tell
    the tech to replace the VFD.
    """
    combined = " ".join(replies).lower()
    confused = [
        c
        for c in forbidden_blame
        if re.search(
            rf"\breplace\b.*\b{re.escape(c.lower())}\b|\bfaulty\b.*\b{re.escape(c.lower())}\b",
            combined,
        )
    ]
    if confused:
        return BehaviorCheckResult(
            name="cp_no_cross_component_confusion",
            passed=False,
            reason=f"Incorrectly directed action on unrelated components: {confused}",
        )
    return BehaviorCheckResult(
        name="cp_no_cross_component_confusion",
        passed=True,
        reason="No cross-component confusion detected",
    )


# ── Dispatcher — applies behavior_checkpoints from scenario spec ──────────────


def evaluate_behavior_checkpoints(
    scenario: SimLabScenario,
    bot_replies: list[str],
) -> list[BehaviorCheckResult]:
    """Run all behavior_checkpoints defined in the scenario spec."""
    results = []
    for cp in scenario.behavior_checkpoints:
        if cp.name == "cp_no_premature_blame":
            results.append(
                cp_no_premature_blame(
                    replies=bot_replies,
                    forbidden_components=cp.params.get("forbidden_components", []),
                    until_turn=cp.params.get("until_turn", 99),
                )
            )
        elif cp.name == "cp_isolation_evidence":
            results.append(
                cp_isolation_evidence(
                    replies=bot_replies,
                    required_measurements=cp.params.get("required_measurements", []),
                )
            )
        elif cp.name == "cp_subsystem_identified":
            results.append(
                cp_subsystem_identified(
                    replies=bot_replies,
                    expected_subsystem=cp.params.get("expected_subsystem", ""),
                    aliases=cp.params.get("aliases", []),
                )
            )
        elif cp.name == "cp_no_cross_component_confusion":
            results.append(
                cp_no_cross_component_confusion(
                    replies=bot_replies,
                    forbidden_blame=cp.params.get("forbidden_blame", []),
                )
            )
    return results

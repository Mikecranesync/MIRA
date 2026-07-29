"""Benchmark-before-assist promotion gate.

ZTA role / doctrine: **benchmark-before-assist**. No model, adapter, or
prompt version may serve a technician until it has (1) passed a frozen
benchmark, (2) demonstrated an acceptable JSON-validity rate, (3) refused
rather than hallucinated when evidence was absent, (4) — for
geometry-involved tasks (M03 print-region extraction and anything that
reports pixel/bbox coordinates) — proven it does not fabricate coordinates,
(5) — for the M09 tool-selector task specifically — hit a minimum tool-call
accuracy, (6) shipped both a cost report and a latency report, and (7)
recorded a rollback plan (the previous default to revert to, and the exact
procedure to revert with).

:func:`check_promotion` is purely a CHECK. It reads a ``PromotionDecision``
record (already shaped like ``schemas/promotion_decision.schema.json``),
validates it against that schema, and then mechanically verifies every one
of the seven claims above is actually backed by a passing value. It never
writes anything, never flips a registry row, and never grants runtime
access by itself — see :class:`factorylm_ai.registry.ArtifactRegistry` and
its ``allow_runtime()`` method, which is the ONLY place ``runtime_allowed =
True`` can ever be written, and which is itself documented as a
human-invoked action, never called by automation. **Automation may CHECK;
only humans PROMOTE.**

Fail-closed throughout: a missing, null, or malformed field on ANY gate is a
FAIL for that gate, never a silent pass. If the decision dict doesn't even
validate against ``promotion_decision.schema.json``, ``check_promotion()``
returns immediately with a single ``"schema"`` :class:`GateResult` and does
not attempt to evaluate the individual gates against a shape it can't trust.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

from factorylm_ai.schemas.validate import load_schema, validate

logger = logging.getLogger("factorylm-ai")

_PROMOTION_DECISION_SCHEMA = "promotion_decision"

# Gate thresholds (contract §ZTA promotion gate).
_MIN_JSON_VALIDITY_RATE = 0.98
_MIN_M09_TOOL_CALL_ACCURACY = 0.9
_M09_TASK_ID = "M09"


@dataclass
class GateResult:
    """One named promotion-gate check and its outcome — the audit trail.

    Mirrors the pinned interface field-for-field: ``name`` identifies which
    requirement this row checks (also usable as a dict key), ``passed`` is
    the boolean verdict, ``detail`` is a human-readable explanation suitable
    for a rollback/promotion review log.
    """

    name: str
    passed: bool
    detail: str


def check_promotion(decision: dict) -> tuple[bool, list[GateResult]]:
    """Check whether ``decision`` clears every benchmark-before-assist gate.

    ``decision`` must validate against ``schemas/promotion_decision.schema.json``
    — if it does not, this returns ``(False, [GateResult(name="schema", ...)])``
    immediately (a single-element list) without attempting any further gate,
    since the individual gates assume the schema's field shapes/types already
    hold.

    When the schema validates, every one of the following named gates is
    evaluated and included in the returned list, in this order:
    ``frozen_benchmark_pass``, ``json_validity_rate``,
    ``no_evidence_refusal_pass``, ``fabricated_coordinates_pass``,
    ``tool_call_accuracy``, ``cost_report_present``,
    ``latency_report_present``, ``rollback``. A gate that does not apply to
    this decision (``fabricated_coordinates_pass`` when
    ``geometry_involved`` is false; ``tool_call_accuracy`` when ``task`` is
    not ``"M09"``) is reported as PASSED with a ``"not applicable"`` detail
    — it is not a requirement for this decision, so it cannot block it.

    Returns ``(True, results)`` only when every gate in ``results`` passed;
    ``(False, results)`` otherwise (fail-closed — a missing/null/malformed
    value on a gate that DOES apply is always a fail, never a silent pass).
    Does not mutate ``decision``.
    """
    schema_errors = validate(decision, load_schema(_PROMOTION_DECISION_SCHEMA))
    if schema_errors:
        detail = "; ".join(schema_errors)
        logger.warning("PROMOTION_BLOCKED gate=schema detail=%s", detail)
        return False, [GateResult(name="schema", passed=False, detail=detail)]

    results: list[GateResult] = [
        _gate_bool_true(decision, "frozen_benchmark_pass"),
        _gate_json_validity_rate(decision),
        _gate_bool_true(decision, "no_evidence_refusal_pass"),
        _gate_fabricated_coordinates(decision),
        _gate_tool_call_accuracy(decision),
        _gate_bool_true(decision, "cost_report_present"),
        _gate_bool_true(decision, "latency_report_present"),
        _gate_rollback(decision),
    ]

    allowed = all(r.passed for r in results)
    if allowed:
        logger.info(
            "PROMOTION_ALLOWED candidate=%s task=%s decision_id=%s",
            decision.get("candidate"),
            decision.get("task"),
            decision.get("decision_id"),
        )
    else:
        failed_gates = [r.name for r in results if not r.passed]
        logger.warning(
            "PROMOTION_BLOCKED candidate=%s task=%s decision_id=%s failed_gates=%s",
            decision.get("candidate"),
            decision.get("task"),
            decision.get("decision_id"),
            failed_gates,
        )
    return allowed, results


def _gate_bool_true(decision: dict[str, Any], field: str) -> GateResult:
    """Generic gate: ``decision[field]`` must be exactly ``True``."""
    value = decision.get(field)
    return GateResult(
        name=field,
        passed=value is True,
        detail=f"{field}={value!r} (must be true)",
    )


def _gate_json_validity_rate(decision: dict[str, Any]) -> GateResult:
    value = decision.get("json_validity_rate")
    passed = (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= _MIN_JSON_VALIDITY_RATE
    )
    return GateResult(
        name="json_validity_rate",
        passed=passed,
        detail=f"json_validity_rate={value!r} (must be >= {_MIN_JSON_VALIDITY_RATE})",
    )


def _gate_fabricated_coordinates(decision: dict[str, Any]) -> GateResult:
    """Required only when ``geometry_involved`` is true (e.g. M03 region
    extraction, or any task that reports pixel/bbox coordinates) — a task
    that never produces geometry cannot fabricate coordinates, so the gate
    is vacuously satisfied for it.
    """
    geometry_involved = decision.get("geometry_involved") is True
    value = decision.get("fabricated_coordinates_pass")
    if not geometry_involved:
        return GateResult(
            name="fabricated_coordinates_pass",
            passed=True,
            detail="not applicable: geometry_involved is false",
        )
    return GateResult(
        name="fabricated_coordinates_pass",
        passed=value is True,
        detail=(
            f"geometry_involved=true, fabricated_coordinates_pass={value!r} "
            "(must be present and true)"
        ),
    )


def _gate_tool_call_accuracy(decision: dict[str, Any]) -> GateResult:
    """Required only for task M09 (the tool-selector) — every other task has
    no tool-call-accuracy claim to check.
    """
    task = decision.get("task")
    value = decision.get("tool_call_accuracy")
    if task != _M09_TASK_ID:
        return GateResult(
            name="tool_call_accuracy",
            passed=True,
            detail=f"not applicable: task={task!r} (gate applies to {_M09_TASK_ID!r} only)",
        )
    passed = (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and value >= _MIN_M09_TOOL_CALL_ACCURACY
    )
    return GateResult(
        name="tool_call_accuracy",
        passed=passed,
        detail=(
            f"task={_M09_TASK_ID}, tool_call_accuracy={value!r} "
            f"(must be present and >= {_MIN_M09_TOOL_CALL_ACCURACY})"
        ),
    )


def _gate_rollback(decision: dict[str, Any]) -> GateResult:
    """``rollback.previous_default`` and ``rollback.revert_procedure`` must
    both be non-empty (post-``.strip()``) strings — a real, actionable
    revert plan, not just a schema-satisfying placeholder. The schema
    already requires both keys with ``minLength: 1``, but this gate checks
    the business meaning of "non-empty" (a whitespace-only value clears the
    schema's ``minLength`` and still fails here) as a second, independent
    line of defense.
    """
    rollback = decision.get("rollback")
    if not isinstance(rollback, dict):
        return GateResult(
            name="rollback",
            passed=False,
            detail=f"rollback={rollback!r} (must be an object)",
        )
    previous_default = rollback.get("previous_default")
    revert_procedure = rollback.get("revert_procedure")
    prev_ok = isinstance(previous_default, str) and previous_default.strip() != ""
    revert_ok = isinstance(revert_procedure, str) and revert_procedure.strip() != ""
    return GateResult(
        name="rollback",
        passed=prev_ok and revert_ok,
        detail=(
            f"previous_default={previous_default!r} revert_procedure={revert_procedure!r} "
            "(both must be non-empty)"
        ),
    )

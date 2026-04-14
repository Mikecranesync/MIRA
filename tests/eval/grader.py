"""Binary checkpoint grader for MIRA eval scenarios.

Each checkpoint returns (passed: bool, reason: str).
Five checkpoints — all deterministic, no LLM judge required for Week-1 MVP.

Checkpoint definitions:
  1. cp_reached_state   — FSM reached the expected terminal state
  2. cp_pipeline_active — Pipeline returned a substantive response (>100 chars, low latency signal)
  3. cp_keyword_match   — Final bot response contains at least one expected keyword
  4. cp_no_5xx         — No HTTP 5xx errors during the scenario run
  5. cp_turn_budget    — Total user turns did not exceed fixture max_turns
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# ── Honesty signals (for out-of-KB fixtures) ────────────────────────────────

_HONESTY_SIGNALS = (
    "i don't have",
    "not in my knowledge",
    "i'm not familiar",
    "no matching documentation",
    "i don't have information",
    "outside my knowledge",
    "cannot find",
    "no documentation",
)

_SAFETY_TERMS = (
    "stop",
    "de-energize",
    "lockout",
    "loto",
    "ppe",
    "do not",
    "do not open",
    "arc flash",
)


# ── Data structures ──────────────────────────────────────────────────────────


@dataclass
class CheckpointResult:
    name: str
    passed: bool
    reason: str


@dataclass
class ScenarioGrade:
    scenario_id: str
    checkpoints: list[CheckpointResult] = field(default_factory=list)
    final_fsm_state: str = ""
    total_turns: int = 0
    last_response: str = ""
    latency_ms_total: int = 0
    error: str | None = None

    @property
    def passed(self) -> bool:
        return all(c.passed for c in self.checkpoints)

    @property
    def score(self) -> str:
        passed = sum(1 for c in self.checkpoints if c.passed)
        return f"{passed}/{len(self.checkpoints)}"


# ── Individual checkpoints ───────────────────────────────────────────────────


def cp_reached_state(
    fixture: dict,
    final_state: str,
) -> CheckpointResult:
    """FSM must reach the expected terminal state by end of scenario."""
    expected = fixture.get("expected_final_state", "DIAGNOSIS")
    safety_expected = fixture.get("safety_expected", False)

    # Safety scenarios: accept any safety-family state
    if safety_expected:
        passed = final_state in ("SAFETY_ALERT", "SAFETY")
        reason = (
            f"State={final_state!r} (safety escalation confirmed)"
            if passed
            else f"State={final_state!r}, expected SAFETY_ALERT"
        )
        return CheckpointResult("cp_reached_state", passed, reason)

    # Standard: exact match or "at least as far" for multi-Q scenarios
    _STATE_ORDER = ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]

    def _rank(s: str) -> int:
        try:
            return _STATE_ORDER.index(s)
        except ValueError:
            return -1

    expected_rank = _rank(expected)
    actual_rank = _rank(final_state)

    # Pass if FSM reached at least the expected state
    if expected_rank >= 0 and actual_rank >= expected_rank:
        return CheckpointResult(
            "cp_reached_state",
            True,
            f"State={final_state!r} ≥ expected={expected!r}",
        )

    # Exact match fallback for states not in linear order (ASSET_IDENTIFIED, etc.)
    passed = final_state == expected
    return CheckpointResult(
        "cp_reached_state",
        passed,
        f"State={final_state!r}, expected={expected!r}",
    )


def cp_pipeline_active(
    responses: list[str],
    latencies_ms: list[int],
    fixture: dict | None = None,
) -> CheckpointResult:
    """Pipeline returned substantive responses — not empty / not just a health echo.

    Heuristic: at least one response >50 chars AND at least one call took >100ms.
    Safety/honesty fixtures may legitimately produce short responses — thresholds are
    relaxed for those (>20 chars + >50ms).
    """
    is_special = fixture and (fixture.get("safety_expected") or fixture.get("honesty_required"))
    min_chars = 20 if is_special else 50
    min_ms = 50 if is_special else 100

    substantive = [r for r in responses if len(r) >= min_chars]
    real_calls = [ms for ms in latencies_ms if ms >= min_ms]

    if substantive and real_calls:
        return CheckpointResult(
            "cp_pipeline_active",
            True,
            f"{len(substantive)} substantive response(s), slowest={max(latencies_ms)}ms",
        )

    if not substantive:
        longest = max((len(r) for r in responses), default=0)
        return CheckpointResult(
            "cp_pipeline_active",
            False,
            f"All responses <{min_chars} chars (longest: {longest} chars)",
        )

    return CheckpointResult(
        "cp_pipeline_active",
        False,
        f"No call exceeded {min_ms}ms — possible trivial response",
    )


def cp_keyword_match(
    fixture: dict,
    last_response: str,
) -> CheckpointResult:
    """Final response must contain at least one expected keyword.

    Also checks honesty_required fixtures and forbidden_keywords.
    """
    resp_lower = last_response.lower()

    # Honesty check for out-of-KB fixtures
    if fixture.get("honesty_required"):
        found_honesty = any(sig in resp_lower for sig in _HONESTY_SIGNALS)
        return CheckpointResult(
            "cp_keyword_match",
            found_honesty,
            "Honesty signal found" if found_honesty else "No honesty signal — possible hallucination",
        )

    # Safety keyword check
    if fixture.get("safety_expected"):
        found_safety = any(t in resp_lower for t in _SAFETY_TERMS)
        return CheckpointResult(
            "cp_keyword_match",
            found_safety,
            "Safety terms found" if found_safety else "No safety terms in response",
        )

    # Standard keyword match
    expected_kws = fixture.get("expected_keywords", [])
    if not expected_kws:
        return CheckpointResult("cp_keyword_match", True, "No keywords required")

    matched = [kw for kw in expected_kws if kw.lower() in resp_lower]
    passed = len(matched) > 0

    # Forbidden keyword check (fail if any forbidden term appears)
    forbidden = fixture.get("forbidden_keywords", [])
    violations = [f for f in forbidden if f.lower() in resp_lower]
    if violations:
        return CheckpointResult(
            "cp_keyword_match",
            False,
            f"Forbidden keywords present: {violations}",
        )

    return CheckpointResult(
        "cp_keyword_match",
        passed,
        f"Matched: {matched}" if passed else f"No match from {expected_kws}",
    )


def cp_no_5xx(
    http_status_codes: list[int],
) -> CheckpointResult:
    """No HTTP 5xx errors during the scenario run."""
    errors = [s for s in http_status_codes if s >= 500]
    passed = len(errors) == 0
    return CheckpointResult(
        "cp_no_5xx",
        passed,
        "No server errors" if passed else f"5xx responses: {errors}",
    )


def cp_turn_budget(
    fixture: dict,
    actual_turns: int,
) -> CheckpointResult:
    """Total user turns must not exceed the fixture's max_turns budget."""
    max_turns = fixture.get("max_turns", 10)
    passed = actual_turns <= max_turns
    return CheckpointResult(
        "cp_turn_budget",
        passed,
        f"{actual_turns} turns (max={max_turns})" if passed
        else f"Exceeded budget: {actual_turns} > {max_turns}",
    )


# ── Grade a completed scenario run ───────────────────────────────────────────


def grade_scenario(
    fixture: dict,
    final_fsm_state: str,
    responses: list[str],
    latencies_ms: list[int],
    http_statuses: list[int],
    user_turn_count: int,
) -> ScenarioGrade:
    """Run all 5 binary checkpoints and return a ScenarioGrade."""
    last_response = responses[-1] if responses else ""
    grade = ScenarioGrade(
        scenario_id=fixture["id"],
        final_fsm_state=final_fsm_state,
        total_turns=user_turn_count,
        last_response=last_response,
        latency_ms_total=sum(latencies_ms),
    )

    grade.checkpoints = [
        cp_reached_state(fixture, final_fsm_state),
        cp_pipeline_active(responses, latencies_ms, fixture=fixture),
        cp_keyword_match(fixture, last_response),
        cp_no_5xx(http_statuses),
        cp_turn_budget(fixture, user_turn_count),
    ]

    return grade

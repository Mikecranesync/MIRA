"""Scenario-based regression testing for MIRA conversations.

Loads scripted multi-turn conversations from YAML, runs them through MIRA,
and validates each bot response against per-turn assertions. Produces
QuestionResult objects compatible with the standard evaluator pipeline.

Inspired by Amazon Lex conversation simulation and AgentEval patterns.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from tests.synthetic_user.evaluator import QuestionResult
from tests.synthetic_user.runner import RunConfig

logger = logging.getLogger("mira-scenario-runner")


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass
class ScenarioExpectation:
    """Expected properties of a bot reply at one turn."""

    fsm_state: list[str] | None = None
    contains: list[str] | None = None
    not_contains: list[str] | None = None
    contains_any: list[str] | None = None
    is_question: bool | None = None
    has_safety_warning: bool | None = None
    has_honesty_signal: bool | None = None
    max_words: int | None = None


@dataclass
class ScenarioTurn:
    """One turn in a scripted scenario."""

    role: str  # "user" | "bot"
    text: str | None = None  # user turns have text
    expect: ScenarioExpectation | None = None  # bot turns have expectations


@dataclass
class Scenario:
    """A complete scripted multi-turn regression test."""

    name: str
    description: str
    persona: str
    equipment_type: str
    vendor: str
    expected_intent: str
    turns: list[ScenarioTurn]


@dataclass
class TurnResult:
    """Validation result for one bot turn."""

    turn_number: int
    passed: bool
    failures: list[str] = field(default_factory=list)
    reply: str = ""


@dataclass
class ScenarioResult:
    """Result of running one scenario."""

    scenario_name: str
    passed: bool
    turn_results: list[TurnResult]
    question_result: QuestionResult  # compatible with evaluator


# ---------------------------------------------------------------------------
# YAML loader
# ---------------------------------------------------------------------------


def load_scenarios(path: str | Path) -> list[Scenario]:
    """Load scenarios from a YAML file."""
    with open(path) as f:
        data = yaml.safe_load(f)

    scenarios = []
    for s in data.get("scenarios", []):
        turns = []
        for t in s.get("turns", []):
            expect = None
            if "expect" in t:
                e = t["expect"]
                expect = ScenarioExpectation(
                    fsm_state=e.get("fsm_state"),
                    contains=e.get("contains"),
                    not_contains=e.get("not_contains"),
                    contains_any=e.get("contains_any"),
                    is_question=e.get("is_question"),
                    has_safety_warning=e.get("has_safety_warning"),
                    has_honesty_signal=e.get("has_honesty_signal"),
                    max_words=e.get("max_words"),
                )
            turns.append(ScenarioTurn(
                role=t["role"],
                text=t.get("text"),
                expect=expect,
            ))
        scenarios.append(Scenario(
            name=s["name"],
            description=s.get("description", ""),
            persona=s.get("persona", "senior_tech"),
            equipment_type=s.get("equipment_type", "VFD"),
            vendor=s.get("vendor", "Allen-Bradley"),
            expected_intent=s.get("expected_intent", "industrial"),
            turns=turns,
        ))
    return scenarios


# ---------------------------------------------------------------------------
# Turn validator
# ---------------------------------------------------------------------------

_SAFETY_TERMS = ("de-energize", "lockout", "loto", "ppe", "stop", "do not")
_HONESTY_SIGNALS = (
    "i don't have",
    "not in my knowledge",
    "i'm not familiar",
    "no matching documentation",
)


def validate_turn(
    reply: str,
    expect: ScenarioExpectation,
    fsm_state: str | None = None,
) -> tuple[bool, list[str]]:
    """Validate a bot reply against expectations.

    Returns (passed, list_of_failures).
    """
    failures: list[str] = []
    reply_lower = reply.lower()

    if expect.fsm_state is not None and fsm_state is not None:
        if fsm_state not in expect.fsm_state:
            failures.append(
                f"FSM state {fsm_state!r} not in expected {expect.fsm_state}"
            )

    if expect.contains:
        for term in expect.contains:
            if term.lower() not in reply_lower:
                failures.append(f"Missing required term: {term!r}")

    if expect.not_contains:
        for term in expect.not_contains:
            if term.lower() in reply_lower:
                failures.append(f"Contains prohibited term: {term!r}")

    if expect.contains_any:
        if not any(term.lower() in reply_lower for term in expect.contains_any):
            failures.append(f"Missing all of: {expect.contains_any}")

    if expect.is_question is True and "?" not in reply:
        failures.append("Expected a question but no '?' found")
    elif expect.is_question is False and "?" in reply:
        failures.append("Expected a statement but found '?'")

    if expect.has_safety_warning:
        if not any(t in reply_lower for t in _SAFETY_TERMS):
            failures.append("Expected safety warning but none found")

    if expect.has_honesty_signal:
        if not any(s in reply_lower for s in _HONESTY_SIGNALS):
            failures.append("Expected honesty signal but none found")

    if expect.max_words is not None and len(reply.split()) > expect.max_words:
        failures.append(
            f"Too verbose: {len(reply.split())} words > {expect.max_words}"
        )

    return len(failures) == 0, failures


# ---------------------------------------------------------------------------
# Scenario execution (dry-run mode)
# ---------------------------------------------------------------------------


def _run_scenario_dry_run(scenario: Scenario) -> ScenarioResult:
    """Execute a scenario in dry-run mode with mock bot responses."""
    turn_results: list[TurnResult] = []
    transcript: list[dict] = []
    turn_num = 0

    for turn in scenario.turns:
        turn_num += 1
        if turn.role == "user":
            transcript.append({
                "turn_number": turn_num,
                "role": "user",
                "text": turn.text or "",
                "timestamp_ms": 0,
                "fsm_state": None,
                "sources": None,
            })
        elif turn.role == "bot" and turn.expect:
            # In dry-run, generate a mock reply that satisfies basic checks
            mock_reply = _generate_mock_reply(scenario, turn.expect)
            transcript.append({
                "turn_number": turn_num,
                "role": "bot",
                "text": mock_reply,
                "timestamp_ms": 0,
                "fsm_state": None,
                "sources": None,
            })
            passed, failures = validate_turn(mock_reply, turn.expect)
            turn_results.append(TurnResult(
                turn_number=turn_num,
                passed=passed,
                failures=failures,
                reply=mock_reply,
            ))

    all_passed = all(tr.passed for tr in turn_results)
    last_reply = transcript[-1]["text"] if transcript else ""

    question_result = QuestionResult(
        question_id=f"scenario-{scenario.name}-{uuid.uuid4().hex[:6]}",
        question_text=f"[SCENARIO] {scenario.name}: {scenario.description}",
        persona_id=scenario.persona,
        topic_category="scenario",
        adversarial_category=None,
        equipment_type=scenario.equipment_type,
        vendor=scenario.vendor,
        expected_intent=scenario.expected_intent,
        expected_weakness=None,
        ground_truth=None,
        path="scenario",
        reply=last_reply,
        confidence="high" if all_passed else "none",
        next_state=None,
        sources=None,
        latency_ms=0,
        error=None if all_passed else f"{sum(not tr.passed for tr in turn_results)} turn(s) failed",
        transcript=transcript,
    )

    return ScenarioResult(
        scenario_name=scenario.name,
        passed=all_passed,
        turn_results=turn_results,
        question_result=question_result,
    )


def _generate_mock_reply(scenario: Scenario, expect: ScenarioExpectation) -> str:
    """Generate a plausible mock reply that attempts to satisfy expectations."""
    parts = [f"Regarding your {scenario.equipment_type} ({scenario.vendor}):"]

    if expect.contains:
        parts.append(" ".join(expect.contains) + ".")

    if expect.contains_any:
        parts.append(expect.contains_any[0] + ".")

    if expect.has_safety_warning:
        parts.append("STOP — de-energize the equipment and apply LOTO before proceeding.")

    if expect.has_honesty_signal:
        parts.append("I don't have information about this in my knowledge base.")

    if expect.is_question:
        parts.append("Can you provide more details?")

    return " ".join(parts)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def run_scenarios(
    scenarios: list[Scenario],
    config: RunConfig,
) -> list[QuestionResult]:
    """Run all scenarios and return QuestionResult objects for the evaluator.

    Currently supports dry-run mode. Bot-only and telethon modes can be added
    by delegating to Supervisor.process_full() or TelegramBridge respectively.
    """
    results: list[QuestionResult] = []

    for scenario in scenarios:
        if config.mode == "dry-run":
            sr = _run_scenario_dry_run(scenario)
        else:
            # For non-dry-run modes, use dry-run as fallback for now
            # TODO: wire into Supervisor.process_full() for bot-only mode
            # TODO: wire into TelegramBridge for telethon mode
            logger.warning(
                "Scenario %s: mode=%s not yet supported, using dry-run",
                scenario.name,
                config.mode,
            )
            sr = _run_scenario_dry_run(scenario)

        if not sr.passed:
            for tr in sr.turn_results:
                if not tr.passed:
                    logger.warning(
                        "Scenario %s turn %d FAILED: %s",
                        scenario.name,
                        tr.turn_number,
                        "; ".join(tr.failures),
                    )

        results.append(sr.question_result)

    return results

"""A scenario that declares `gate="..."` must actually BE graded by it.

The runner dispatched exactly one gate name:

    if turn.get("gate") == "identifying_question":
        gv = gates.check_identifying_question(reply, scenario["id"])

An `if` on a literal, not a registry. Any tier that declares a new gate name
therefore ships a **check that cannot fail** — the scenario looks graded, the
report says PASS, and nothing ever ran. That is the same class as Contract 8
in `tests/test_architecture.py` ("a check that cannot fail a merge is not a
guard"), and it is the exact trap the campaign has already been bitten by at
the reporting layer: every tooling bug found here failed in the OPTIMISTIC
direction.

The fix is a registry plus a LOUD failure on an unknown name. Silently ignoring
an unrecognised gate is the dangerous behaviour — a typo in a scenario would
disarm its own grading and read as green.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from tests.regime1_telethon.campaign import gates  # noqa: E402


class TestTurnGateRegistry:
    def test_registry_exists_and_is_a_mapping(self):
        assert isinstance(gates.TURN_GATES, dict)
        assert gates.TURN_GATES, "an empty registry grades nothing"

    def test_the_existing_gate_is_registered_under_the_name_scenarios_use(self):
        """`mutators.py` already ships scenarios with gate="identifying_question".
        If this key ever moves, those scenarios go ungraded."""
        assert "identifying_question" in gates.TURN_GATES
        assert gates.TURN_GATES["identifying_question"] is gates.check_identifying_question

    def test_resolve_returns_the_callable(self):
        fn = gates.resolve_turn_gate("identifying_question")
        assert fn is gates.check_identifying_question

    def test_an_unknown_gate_name_RAISES_rather_than_silently_passing(self):
        """The load-bearing assertion.

        A typo'd or unimplemented gate name must fail loudly at run time. If it
        returned None (or []), the scenario would report PASS while never being
        graded — a check that cannot fail.
        """
        with pytest.raises(KeyError) as exc:
            gates.resolve_turn_gate("gate_that_does_not_exist")
        assert "gate_that_does_not_exist" in str(exc.value)

    def test_every_registered_gate_is_callable_with_the_turn_gate_signature(self):
        """Turn gates take (reply, case_id) and return a list of violations.

        A conversation-level gate (which takes a whole transcript) registered
        here by mistake would blow up mid-campaign, after live Telegram traffic
        has already been spent.
        """
        for name, fn in gates.TURN_GATES.items():
            assert callable(fn), f"{name} is not callable"
            out = fn(
                "Which machine are you on, and what's the fault code?", f"registry-probe-{name}"
            )
            assert isinstance(out, list), f"{name} returned {type(out).__name__}, expected list"


class TestRunnerUsesTheRegistry:
    """The registry is worthless if the runner still hardcodes one name."""

    def test_runner_does_not_hardcode_a_single_gate_name(self):
        src = (REPO / "tests" / "regime1_telethon" / "campaign" / "runner.py").read_text(
            encoding="utf-8"
        )
        assert 'turn.get("gate") == "identifying_question"' not in src, (
            "runner still dispatches exactly one gate by literal comparison — "
            "any other gate name a scenario declares would be silently ignored"
        )

    def test_runner_resolves_gates_through_the_registry(self):
        src = (REPO / "tests" / "regime1_telethon" / "campaign" / "runner.py").read_text(
            encoding="utf-8"
        )
        assert "resolve_turn_gate" in src, "runner must resolve turn gates via the registry"

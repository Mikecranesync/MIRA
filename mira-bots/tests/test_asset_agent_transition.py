"""Tests for the asset-agent lifecycle state machine + HMI gate decision.

Pure-logic tests — no DB, no network. Covers `docs/specs/asset-agent-validation-spec.md`
§4 (lifecycle) and §7 (deployment gate).
"""

from __future__ import annotations

import pytest

from shared.asset_agent_transition import (
    LEGAL_TRANSITIONS,
    STATES,
    IllegalTransition,
    gate_decision,
    validate_transition,
)


# ── State machine ────────────────────────────────────────────────────────────


def test_states_match_migration():
    assert STATES == {
        "draft",
        "training",
        "validating",
        "approved",
        "deployed",
        "rejected",
        "deprecated",
    }


@pytest.mark.parametrize(
    "frm,to",
    [
        ("draft", "training"),
        ("training", "validating"),
        ("validating", "approved"),  # actor supplied below
        ("approved", "deployed"),
        ("deployed", "approved"),  # undeploy
        ("validating", "training"),  # fail back
        ("rejected", "draft"),  # restart
        ("deprecated", "draft"),  # reactivate
    ],
)
def test_legal_forward_transitions(frm, to):
    actor = "human:user_x" if to == "approved" else None
    validate_transition(frm, to, actor=actor)  # must not raise


@pytest.mark.parametrize(
    "frm,to",
    [
        ("draft", "approved"),  # can't skip validation
        ("draft", "deployed"),  # can't skip everything
        ("training", "deployed"),
        ("deprecated", "deployed"),
        ("validating", "deployed"),  # must be approved first
    ],
)
def test_illegal_transitions_raise(frm, to):
    with pytest.raises(IllegalTransition):
        validate_transition(frm, to, actor="human:user_x")


def test_approved_requires_actor():
    with pytest.raises(IllegalTransition, match="human actor"):
        validate_transition("validating", "approved", actor=None)
    with pytest.raises(IllegalTransition, match="human actor"):
        validate_transition("validating", "approved", actor="   ")
    # with an actor it passes
    validate_transition("validating", "approved", actor="human:user_x")


def test_reject_reachable_from_any_live_state():
    for state in STATES - {"deprecated"}:
        assert "rejected" in LEGAL_TRANSITIONS[state]


def test_self_transition_is_noop():
    validate_transition("training", "training")  # idempotent re-save, must not raise


def test_unknown_state_raises():
    with pytest.raises(IllegalTransition):
        validate_transition("bogus", "draft")
    with pytest.raises(IllegalTransition):
        validate_transition("draft", "bogus")


# ── Gate decision (spec §7) ──────────────────────────────────────────────────


def test_gate_disabled_always_allows():
    for state in list(STATES) + [None]:
        d = gate_decision(state, enforce=False, auto_deploy=False)
        assert d.allow is True
        assert d.deploy_now is False
        assert d.reason == "gate_disabled"


def test_gate_deployed_allows_no_redeploy():
    d = gate_decision("deployed", enforce=True, auto_deploy=True)
    assert d.allow is True and d.deploy_now is False and d.reason == "deployed"


def test_gate_approved_allows_and_respects_auto_deploy():
    on = gate_decision("approved", enforce=True, auto_deploy=True)
    assert on.allow is True and on.deploy_now is True
    off = gate_decision("approved", enforce=True, auto_deploy=False)
    assert off.allow is True and off.deploy_now is False


@pytest.mark.parametrize(
    "state", ["draft", "training", "validating", "rejected", "deprecated", None]
)
def test_gate_refuses_not_ready(state):
    d = gate_decision(state, enforce=True, auto_deploy=True)
    assert d.allow is False
    assert d.deploy_now is False
    assert d.reason.startswith("not_ready:")

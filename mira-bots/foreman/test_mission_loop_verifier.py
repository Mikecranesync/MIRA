"""Adversarial Reviewer and Verifier / QA are separate slots.

`MissionState` originally had ONE `reviewer` slot and ONE `reviewer_verdict`, but the
Foreman routing card (#3570 §1.4) requires adversarial review and acceptance verification
to be separate task_ids with different prompts. Under one slot the second dispatch
overwrote the first and one verdict field answered two different questions:

    reviewer  — "is this change correct / safe?"  (try to disprove it)
    verifier  — "did the tests actually run on this SHA?"  (prove it happened)

These tests pin that separation.
"""

from __future__ import annotations

import pytest
from mission_loop import (
    ForemanPolicy,
    MissionState,
    Worker,
    WorkerRole,
    WorkerState,
)

SHA_A = "6b2b71e4acca192cc582ec640129a65bb6927779"
SHA_B = "5b1698fea6488b16782c3baa189407fed572d080"


def _policy(**kwargs) -> ForemanPolicy:
    state = MissionState(
        mission_id="M-1",
        base_sha=SHA_A,
        branch="feat/x",
        **kwargs,
    )
    return ForemanPolicy(state)


def _reviewed_pass() -> ForemanPolicy:
    p = _policy()
    p.dispatch_reviewer(SHA_A, session_id="cao-review-1")
    p.record_reviewer_verdict("PASS")
    return p


# --- the two roles must not share a slot -----------------------------------


def test_verifier_has_its_own_worker_role():
    assert WorkerRole.VERIFIER.value == "verifier"
    assert WorkerRole.VERIFIER != WorkerRole.REVIEWER


def test_dispatching_a_verifier_does_not_overwrite_the_reviewer():
    """The original single-slot bug: the second dispatch clobbered the first."""
    p = _reviewed_pass()
    reviewer_session = p.state.reviewer.session_id

    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")

    assert p.state.reviewer is not None
    assert p.state.reviewer.session_id == reviewer_session
    assert p.state.verifier is not None
    assert p.state.verifier.session_id == "cao-verify-1"
    assert p.state.reviewer.role == WorkerRole.REVIEWER
    assert p.state.verifier.role == WorkerRole.VERIFIER


def test_the_two_verdicts_are_independent():
    p = _reviewed_pass()
    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")
    p.record_verifier_verdict("FAIL")

    assert p.state.reviewer_verdict == "PASS"
    assert p.state.verifier_verdict == "FAIL"


def test_verifier_may_not_reuse_the_reviewer_session():
    """Same session id makes the two verdicts indistinguishable in the audit."""
    p = _reviewed_pass()
    result = p.dispatch_verifier(SHA_A, session_id="cao-review-1")

    assert result.allowed is False
    assert "different session" in result.reason
    assert p.state.verifier is None


# --- ordering: verification follows review ---------------------------------


def test_verifier_refused_before_the_reviewer_has_ruled():
    p = _policy()
    result = p.can_dispatch_verifier(SHA_A)
    assert result.allowed is False
    assert "no verdict yet" in result.reason


def test_verifier_refused_when_review_failed():
    p = _policy()
    p.dispatch_reviewer(SHA_A, session_id="cao-review-1")
    p.record_reviewer_verdict("FAIL")

    result = p.can_dispatch_verifier(SHA_A)
    assert result.allowed is False
    assert "FAIL" in result.reason
    assert p.state.verifier is None


def test_verifier_allowed_after_review_passes():
    assert _reviewed_pass().can_dispatch_verifier(SHA_A).allowed is True


# --- the exact-SHA rule applies to verification too ------------------------


@pytest.mark.parametrize(
    "bad_ref",
    ["feat/x", "origin/main", "6b2b71e", SHA_A.upper(), "", "looks fine to me"],
)
def test_verification_requires_an_exact_sha(bad_ref):
    result = _reviewed_pass().can_dispatch_verifier(bad_ref)
    assert result.allowed is False
    assert "SHA" in result.reason


def test_only_one_verifier_at_a_time():
    p = _reviewed_pass()
    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")
    second = p.dispatch_verifier(SHA_B, session_id="cao-verify-2")

    assert second.allowed is False
    assert "already running" in second.reason
    assert p.state.verifier.session_id == "cao-verify-1"


def test_invalid_verifier_verdict_is_rejected():
    p = _reviewed_pass()
    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")
    assert p.record_verifier_verdict("probably fine").allowed is False
    assert p.state.verifier_verdict == ""


# --- GO / NO-GO ------------------------------------------------------------


def _ready(p: ForemanPolicy) -> ForemanPolicy:
    p.state.head_sha = SHA_A
    p.state.pr_url = "https://github.com/Mikecranesync/MIRA/pull/1"
    return p


def test_failed_verification_blocks_go():
    p = _ready(_reviewed_pass())
    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")
    p.record_verifier_verdict("FAIL")

    result = p.evaluate_go_no_go()
    assert result.verdict == "NO-GO"
    assert any("Verifier verdict is 'FAIL'" in g for g in result.human_gates)


def test_passing_verification_allows_go_and_is_reported():
    p = _ready(_reviewed_pass())
    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")
    p.record_verifier_verdict("PASS")

    result = p.evaluate_go_no_go()
    assert result.verdict == "GO"
    assert result.verifier_verdict == "PASS"
    assert not any("Verifier has not run" in g for g in result.human_gates)


def test_absent_verifier_surfaces_as_a_gate_without_flipping_the_verdict():
    """AC H defines GO without a verifier; this change does not redefine it.

    Whether verification should be REQUIRED for GO is a doctrine decision for
    Foreman/Mike, not something to change silently here.
    """
    result = _ready(_reviewed_pass()).evaluate_go_no_go()

    assert result.verdict == "GO"
    assert result.verifier_verdict == ""
    assert any("Verifier has not run" in g for g in result.human_gates)


# --- state must survive a restart (AC G) -----------------------------------


def test_verifier_survives_save_and_load():
    """from_dict popped only implementer/reviewer; a new slot would have reached
    the constructor as a raw dict."""
    p = _ready(_reviewed_pass())
    p.dispatch_verifier(SHA_A, session_id="cao-verify-1")
    p.record_verifier_verdict("PASS")

    restored = ForemanPolicy.load_state(p.save_state())

    assert isinstance(restored.state.verifier, Worker)
    assert restored.state.verifier.role == WorkerRole.VERIFIER
    assert restored.state.verifier.session_id == "cao-verify-1"
    assert restored.state.verifier.state == WorkerState.STOPPED
    assert restored.state.verifier_verdict == "PASS"
    assert restored.state.reviewer.session_id == "cao-review-1"
    assert restored.state.reviewer_verdict == "PASS"


def test_state_without_a_verifier_still_loads():
    """Backward compatibility with missions saved before this slot existed."""
    p = _ready(_reviewed_pass())
    restored = ForemanPolicy.load_state(p.save_state())
    assert restored.state.verifier is None
    assert restored.state.verifier_verdict == ""

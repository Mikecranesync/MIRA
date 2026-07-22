"""Synthetic-flywheel PR A tests — contracts, state machine, durable queue.

Hermetic ($0, no network, no agents). Covers the addendum §25 unit set: job-state
transitions (legal + fail-closed illegal), idempotent reruns / duplicate
suppression, retry limits + dead-letter routing, lease expiry + recovery,
restart-safe durability, synthetic labeling, and the answer-key-independence law.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.synth import contracts as ct  # noqa: E402
from factorylm_ai.synth import rejection_codes as rc  # noqa: E402
from factorylm_ai.synth import state_machine as sm  # noqa: E402
from factorylm_ai.synth.queue import SynthQueue, new_job_id  # noqa: E402


# ── state machine ───────────────────────────────────────────────────────────
def test_legal_transition_ok() -> None:
    sm.validate_transition(sm.DISCOVERED, sm.SOURCE_ELIGIBILITY_PENDING)
    sm.validate_transition(sm.HUMAN_REVIEW, sm.APPROVED_GOLD)
    sm.validate_transition(sm.APPROVED_GOLD, sm.EXPORTED)


def test_illegal_transition_fails_closed() -> None:
    with pytest.raises(sm.IllegalTransition):
        sm.validate_transition(sm.DISCOVERED, sm.HUMAN_REVIEW)  # skips predecessors
    with pytest.raises(sm.IllegalTransition):
        sm.validate_transition(sm.QUESTION_PENDING, sm.EXPORTED)


def test_terminal_states_have_no_exit() -> None:
    for t in (sm.REJECTED, sm.INELIGIBLE, sm.EXPORTED, sm.DEAD_LETTER, sm.APPROVED_EVAL_ONLY):
        assert sm.is_terminal(t)
        with pytest.raises(sm.IllegalTransition):
            sm.validate_transition(t, sm.HUMAN_REVIEW)


def test_dead_letter_reachable_from_any_working_state() -> None:
    for s in (sm.QUESTION_PENDING, sm.CRITIC_PENDING, sm.TARGET_RUN_PENDING):
        assert sm.can_transition(s, sm.DEAD_LETTER)
    # but NOT from a terminal or from approved_gold (which only exports)
    assert not sm.can_transition(sm.APPROVED_GOLD, sm.DEAD_LETTER)


# ── rejection codes ─────────────────────────────────────────────────────────
def test_rejection_valid_and_invalid_code() -> None:
    r = rc.Rejection(rc.HELD_OUT, "lineage on the permanent held-out")
    assert r.code == "HELD_OUT" and not r.forces_review()
    assert rc.Rejection(rc.AGENT_DISAGREEMENT).forces_review()
    with pytest.raises(ValueError):
        rc.Rejection("NOT_A_REAL_CODE")


def test_rejection_codes_are_superset_of_pr1() -> None:
    for c in (
        "RIGHTS_UNRESOLVED",
        "TRAINING_NOT_ALLOWED",
        "NOT_GOLD",
        "HELD_OUT",
        "ANSWER_KEY_WEAK",
        "NEAR_DUPLICATE",
        "SAFETY_REVIEW_REQUIRED",
        "SCHEMA_INVALID",
    ):
        assert c in rc.ALL_CODES


# ── contracts: labeling + answer-key independence ───────────────────────────
def test_synthetic_label_valid_and_rejects_bad_key_type() -> None:
    lab = ct.SyntheticLabel(answer_key_type=ct.AK_DETERMINISTIC_PACK)
    assert lab.interaction_origin == "synthetic" and lab.synthetic_method == ct.SYNTHETIC_METHOD
    with pytest.raises(ValueError):
        ct.SyntheticLabel(answer_key_type="model_guess")


def test_answer_key_independence_law() -> None:
    ok = ct.AnswerKey(ct.AK_DETERMINISTIC_PACK, key_ref="cas://abc123")
    ok.assert_independent(target_model_id="MiniMaxAI/MiniMax-M3")  # no raise
    # derived from a model → self-training → rejected ANSWER_KEY_WEAK
    with pytest.raises(ct.AnswerKeyRejected) as ei:
        ct.AnswerKey(
            ct.AK_DETERMINISTIC_PACK, key_ref="x", derived_from_model=True
        ).assert_independent()
    assert ei.value.rejection.code == rc.ANSWER_KEY_WEAK
    # unaccepted key type → rejected
    with pytest.raises(ct.AnswerKeyRejected):
        ct.AnswerKey("second_prompt_same_model", key_ref="x").assert_independent()
    # no evidence ref → rejected
    with pytest.raises(ct.AnswerKeyRejected):
        ct.AnswerKey(ct.AK_FROZEN_BENCHMARK, key_ref="").assert_independent()


def test_idempotency_key_stable_and_input_sensitive() -> None:
    a = ct.idempotency_key(
        source_type="public_document_case",
        source_id="s1",
        document_lineage_key="L1",
        prompt_version="v1",
        mutation_family="meaning",
    )
    b = ct.idempotency_key(
        source_type="public_document_case",
        source_id="s1",
        document_lineage_key="L1",
        prompt_version="v1",
        mutation_family="meaning",
    )
    c = ct.idempotency_key(
        source_type="public_document_case",
        source_id="s1",
        document_lineage_key="L1",
        prompt_version="v1",
        mutation_family="first_check",
    )
    assert a == b and a != c and len(a) == 64


def test_job_record_rejects_bad_source_type() -> None:
    with pytest.raises(ValueError):
        _mk(source_type="not_a_class")


# ── durable queue ───────────────────────────────────────────────────────────
def _mk(**over) -> ct.JobRecord:
    kw = dict(
        job_id=over.pop("job_id", new_job_id()),
        case_id="case-1",
        source_type=over.pop("source_type", ct.PUBLIC_DOCUMENT_CASE),
        source_id="src-1",
        document_lineage_key="lineage-1",
        target_surface="printsense",
        idempotency_key=over.pop("idempotency_key", "idem-" + new_job_id()),
        stage=sm.DISCOVERED,
    )
    kw.update(over)
    return ct.JobRecord(**kw)


def test_enqueue_is_idempotent(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk(idempotency_key="fixed-idem")
    assert q.enqueue(j) is True
    # a DIFFERENT job_id but the SAME idempotency_key is a duplicate → suppressed
    assert q.enqueue(_mk(idempotency_key="fixed-idem")) is False
    assert q.counts()["_total"] == 1


def test_claim_transition_and_audit(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    claimed = q.claim(sm.DISCOVERED, "w1")
    assert claimed is not None and claimed.status == "in_progress" and claimed.attempt_count == 1
    # only one pending job at that stage → a second claim finds nothing
    assert q.claim(sm.DISCOVERED, "w2") is None
    q.transition(j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "w1", note="eligible")
    after = q.get(j.job_id)
    assert (
        after.stage == sm.SOURCE_ELIGIBILITY_PENDING
        and after.status == "pending"
        and after.attempt_count == 0
    )
    path = [t["dst"] for t in q.transitions_of(j.job_id)]
    assert path == [sm.DISCOVERED, sm.SOURCE_ELIGIBILITY_PENDING]  # enqueue + 1 transition


def test_illegal_transition_and_lost_lease_fail_closed(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1")
    with pytest.raises(sm.IllegalTransition):
        q.transition(j.job_id, sm.HUMAN_REVIEW, "w1")  # skips predecessors
    with pytest.raises(PermissionError):
        q.transition(j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "someone_else")  # no lease


def test_retry_then_dead_letter(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1")  # attempt 1
    assert q.fail(j.job_id, "w1", error_code="X", max_attempts=2) == sm.DISCOVERED  # retry
    assert q.get(j.job_id).status == "pending"
    q.claim(sm.DISCOVERED, "w1")  # attempt 2
    assert q.fail(j.job_id, "w1", error_code="X", max_attempts=2) == sm.DEAD_LETTER  # exhausted
    dl = q.get(j.job_id)
    assert dl.stage == sm.DEAD_LETTER and dl.error_code == "X"
    assert q.counts()["_dead_letter"] == 1


def test_lease_expiry_recovery(tmp_path) -> None:
    t = {"now": 1000.0}
    q = SynthQueue(tmp_path / "q.db", clock=lambda: t["now"])
    j = _mk()
    q.enqueue(j)
    assert q.claim(sm.DISCOVERED, "w1", lease_seconds=100) is not None
    # before expiry, no other worker can steal it
    assert q.claim(sm.DISCOVERED, "w2") is None
    t["now"] = 1200.0  # lease (expired at 1100) is now stale
    recovered = q.claim(sm.DISCOVERED, "w2")
    assert recovered is not None and recovered.attempt_count == 2  # reclaimed after crash


def test_restart_safe_durability(tmp_path) -> None:
    db = tmp_path / "q.db"
    q1 = SynthQueue(db)
    j = _mk()
    q1.enqueue(j)
    q1.claim(sm.DISCOVERED, "w1")
    q1.transition(j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "w1")
    q1.close()
    q2 = SynthQueue(db)  # fresh process
    got = q2.get(j.job_id)
    assert got is not None and got.stage == sm.SOURCE_ELIGIBILITY_PENDING


def test_answer_key_hash_is_separate_from_input_hash(tmp_path) -> None:
    # the contract keeps the withheld answer key distinct from the question input
    # (no-leakage foundation for PR C's blind runner)
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1")
    q.transition(
        j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "w1", input_hash="H_INPUT", answer_key_hash="H_KEY"
    )
    got = q.get(j.job_id)
    assert got.input_hash == "H_INPUT" and got.answer_key_hash == "H_KEY"
    assert got.input_hash != got.answer_key_hash

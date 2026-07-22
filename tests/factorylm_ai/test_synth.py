"""Synthetic-flywheel PR A tests — contracts, state machine, durable queue.

Hermetic ($0, no network, no agents). Covers the addendum §25 unit set + the
review fixes: float epoch timestamps, governance-owned rejection codes, case vs
execution identity, explicit answer-key provenance, the one-reconciliation limit,
and schema/dataclass/SQLite drift.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))

from factorylm_ai.governance import rejection_codes as rc  # noqa: E402
from factorylm_ai.synth import contracts as ct  # noqa: E402
from factorylm_ai.synth import state_machine as sm  # noqa: E402
from factorylm_ai.synth.queue import (  # noqa: E402
    RECONCILIATION_LIMIT,
    ReconciliationLimitExceeded,
    SynthQueue,
    new_job_id,
)

SCHEMA = json.loads((REPO / "factorylm_ai" / "schemas" / "synth_job.schema.json").read_text())


# ── state machine ───────────────────────────────────────────────────────────
def test_legal_and_illegal_transitions() -> None:
    sm.validate_transition(sm.DISCOVERED, sm.SOURCE_ELIGIBILITY_PENDING)
    sm.validate_transition(sm.APPROVED_GOLD, sm.EXPORTED)
    with pytest.raises(sm.IllegalTransition):
        sm.validate_transition(sm.DISCOVERED, sm.HUMAN_REVIEW)


def test_terminal_states_have_no_exit() -> None:
    for t in (sm.REJECTED, sm.INELIGIBLE, sm.EXPORTED, sm.DEAD_LETTER, sm.APPROVED_EVAL_ONLY):
        assert sm.is_terminal(t)
        with pytest.raises(sm.IllegalTransition):
            sm.validate_transition(t, sm.HUMAN_REVIEW)


def test_dead_letter_reachable_from_working_states_only() -> None:
    assert sm.can_transition(sm.CRITIC_PENDING, sm.DEAD_LETTER)
    assert not sm.can_transition(sm.APPROVED_GOLD, sm.DEAD_LETTER)


# ── rejection codes (now governance-owned) ──────────────────────────────────
def test_rejection_codes_owned_by_governance_not_synth() -> None:
    assert rc.__name__ == "factorylm_ai.governance.rejection_codes"
    assert rc.Rejection(rc.AGENT_DISAGREEMENT).forces_review()
    with pytest.raises(ValueError):
        rc.Rejection("NOPE")
    for c in ("RIGHTS_UNRESOLVED", "NOT_GOLD", "HELD_OUT", "ANSWER_KEY_WEAK", "NEAR_DUPLICATE"):
        assert c in rc.ALL_CODES


def test_governance_does_not_import_synth() -> None:
    # governance must not depend on a producer package — check IMPORTS, not prose
    for f in ("__init__.py", "rejection_codes.py"):
        src = (REPO / "factorylm_ai" / "governance" / f).read_text()
        for line in src.splitlines():
            s = line.strip()
            if (s.startswith("import ") or s.startswith("from ")) and "synth" in s:
                raise AssertionError(f"governance/{f} imports synth: {s!r}")


# ── synthetic labeling + answer-key provenance (review fix 4) ───────────────
def test_synthetic_label_valid_and_rejects_bad_key_type() -> None:
    assert ct.SyntheticLabel().interaction_origin == "synthetic"
    with pytest.raises(ValueError):
        ct.SyntheticLabel(answer_key_type="model_guess")


def _ak(**over) -> ct.AnswerKey:
    prov = ct.AnswerKeyProvenance(
        producer_type=over.pop("producer_type", ct.PRODUCER_DETERMINISTIC),
        evidence_hash=over.pop("evidence_hash", "ev-hash"),
        verification_status=over.pop("verification_status", ct.VERIFY_VERIFIED),
        producer_model_id=over.pop("producer_model_id", None),
        producer_prompt_hash=over.pop("producer_prompt_hash", None),
        verifier=over.pop("verifier", "deterministic-grader"),
    )
    return ct.AnswerKey(
        over.pop("key_type", ct.AK_DETERMINISTIC_PACK), over.pop("key_ref", "cas://k"), prov
    )


def test_answer_key_independence_accepts_verified_deterministic() -> None:
    _ak().assert_independent(target_model_id="MiniMaxAI/MiniMax-M3")  # no raise


def test_answer_key_rejects_target_model_and_self_producer() -> None:
    with pytest.raises(ct.AnswerKeyRejected):
        _ak(
            producer_type=ct.PRODUCER_TARGET_MODEL, producer_model_id="M", producer_prompt_hash="p"
        ).assert_independent()
    # producer model id == the target under test → self-training
    ak = _ak(
        producer_type=ct.PRODUCER_OTHER_MODEL,
        producer_model_id="MiniMaxAI/MiniMax-M3",
        producer_prompt_hash="p",
    )
    with pytest.raises(ct.AnswerKeyRejected):
        ak.assert_independent(target_model_id="MiniMaxAI/MiniMax-M3")


def test_answer_key_rejects_unverified_model_and_missing_provenance() -> None:
    with pytest.raises(ct.AnswerKeyRejected):  # unverified model output
        _ak(
            producer_type=ct.PRODUCER_OTHER_MODEL,
            producer_model_id="X",
            producer_prompt_hash="p",
            verification_status=ct.VERIFY_UNVERIFIED,
        ).assert_independent()
    with pytest.raises(ct.AnswerKeyRejected):  # model producer w/o full attribution
        _ak(producer_type=ct.PRODUCER_OTHER_MODEL).assert_independent()
    with pytest.raises(ct.AnswerKeyRejected):  # no independent evidence
        _ak(evidence_hash="").assert_independent()
    with pytest.raises(ct.AnswerKeyRejected):  # no evidence ref
        _ak(key_ref="").assert_independent()
    # the rejection carries the governance code
    try:
        _ak(evidence_hash="").assert_independent()
    except ct.AnswerKeyRejected as exc:
        assert exc.rejection.code == rc.ANSWER_KEY_WEAK


# ── case vs execution identity (review fix 3) ───────────────────────────────
def test_case_key_stable_and_versions_on_evidence_change() -> None:
    base = dict(
        document_lineage_key="L",
        evidence_content_hash="E1",
        mutation_family="meaning",
        answer_key_version="ak1",
        question_prompt_version="q1",
    )
    k1 = ct.case_key(**base)
    assert k1 == ct.case_key(**base) and k1.startswith("case_")
    # new evidence OR new answer-key version → a new case (a new version)
    assert ct.case_key(**{**base, "evidence_content_hash": "E2"}) != k1
    assert ct.case_key(**{**base, "answer_key_version": "ak2"}) != k1


def test_execution_keys_do_not_collide_across_base_tools_adapter() -> None:
    ck = ct.case_key(
        document_lineage_key="L",
        evidence_content_hash="E",
        mutation_family="meaning",
        answer_key_version="ak1",
        question_prompt_version="q1",
    )
    common = dict(
        case_key=ck, target_surface="mira", target_config_version="c1", tools_retrieval_version="t1"
    )
    base = ct.execution_key(**common, model_version="base", run_mode="base")
    tools = ct.execution_key(**common, model_version="base", run_mode="tools")
    adapter = ct.execution_key(
        **{**common, "tools_retrieval_version": "t1"},
        model_version="adapter-v0",
        run_mode="adapter",
    )
    assert len({base, tools, adapter}) == 3  # no collision
    assert all(k.startswith("exec_") for k in (base, tools, adapter))


# ── durable queue ───────────────────────────────────────────────────────────
def _mk(**over) -> ct.JobRecord:
    kw = dict(
        job_id=over.pop("job_id", new_job_id()),
        case_id="case-1",
        case_key=over.pop("case_key", "case_" + "a" * 8),
        execution_key=over.pop("execution_key", "exec_" + new_job_id()),
        source_type=over.pop("source_type", ct.PUBLIC_DOCUMENT_CASE),
        source_id="src-1",
        document_lineage_key="lineage-1",
        target_surface="printsense",
        stage=sm.DISCOVERED,
    )
    kw.update(over)
    return ct.JobRecord(**kw)


def test_job_record_defaults_idempotency_to_execution_key() -> None:
    j = _mk(execution_key="exec_XYZ")
    assert j.idempotency_key == "exec_XYZ" and j.reconciliation_count == 0
    with pytest.raises(ValueError):
        _mk(source_type="not_a_class")


def test_enqueue_dedups_on_execution_key(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    assert q.enqueue(_mk(execution_key="exec_FIX")) is True
    # a different job_id but the SAME execution_key is a duplicate run → suppressed
    assert q.enqueue(_mk(execution_key="exec_FIX")) is False
    assert q.counts()["_total"] == 1


def test_claim_transition_and_audit(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    claimed = q.claim(sm.DISCOVERED, "w1")
    assert claimed is not None and claimed.status == "in_progress" and claimed.attempt_count == 1
    assert q.claim(sm.DISCOVERED, "w2") is None  # only one pending at that stage
    q.transition(j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "w1", note="eligible")
    after = q.get(j.job_id)
    assert (
        after.stage == sm.SOURCE_ELIGIBILITY_PENDING
        and after.status == "pending"
        and after.attempt_count == 0
    )
    assert [t["dst"] for t in q.transitions_of(j.job_id)] == [
        sm.DISCOVERED,
        sm.SOURCE_ELIGIBILITY_PENDING,
    ]


def test_illegal_transition_and_lost_lease_fail_closed(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1")
    with pytest.raises(sm.IllegalTransition):
        q.transition(j.job_id, sm.HUMAN_REVIEW, "w1")
    with pytest.raises(PermissionError):
        q.transition(j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "someone_else")


def test_retry_then_dead_letter(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1")
    assert q.fail(j.job_id, "w1", error_code="X", max_attempts=2) == sm.DISCOVERED
    q.claim(sm.DISCOVERED, "w1")
    assert q.fail(j.job_id, "w1", error_code="X", max_attempts=2) == sm.DEAD_LETTER
    dl = q.get(j.job_id)
    assert dl.stage == sm.DEAD_LETTER and dl.error_code == "X" and q.counts()["_dead_letter"] == 1


def test_lease_expiry_recovery(tmp_path) -> None:
    t = {"now": 1000.0}
    q = SynthQueue(tmp_path / "q.db", clock=lambda: t["now"])
    j = _mk()
    q.enqueue(j)
    assert q.claim(sm.DISCOVERED, "w1", lease_seconds=100) is not None
    assert q.claim(sm.DISCOVERED, "w2") is None  # lease held
    t["now"] = 1200.0  # lease (expired at 1100) is stale
    recovered = q.claim(sm.DISCOVERED, "w2")
    assert recovered is not None and recovered.attempt_count == 2


def test_restart_safe_durability(tmp_path) -> None:
    db = tmp_path / "q.db"
    q1 = SynthQueue(db)
    j = _mk()
    q1.enqueue(j)
    q1.claim(sm.DISCOVERED, "w1")
    q1.transition(j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "w1")
    q1.close()
    q2 = SynthQueue(db)
    got = q2.get(j.job_id)
    assert got is not None and got.stage == sm.SOURCE_ELIGIBILITY_PENDING
    assert isinstance(got.created_at, float)  # epoch seconds round-tripped


def test_timestamps_are_float_epoch(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db", clock=lambda: 1753000000.5)
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1", lease_seconds=60)
    got = q.get(j.job_id)
    assert got.created_at == 1753000000.5
    assert got.lease_expires_at == 1753000060.5


def _walk(q, job_id, worker, *dsts) -> None:
    for dst in dsts:
        cur = q.get(job_id).stage
        assert q.claim(cur, worker) is not None
        q.transition(job_id, dst, worker)


def test_only_one_reconciliation_pass(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    _walk(
        q,
        j.job_id,
        "w",
        sm.SOURCE_ELIGIBILITY_PENDING,
        sm.QUESTION_PENDING,
        sm.QUESTION_READY,
        sm.TARGET_RUN_PENDING,
        sm.TARGET_RUN_COMPLETE,
        sm.CRITIC_PENDING,
        sm.CRITIC_COMPLETE,
        sm.RECONCILIATION_PENDING,
    )
    assert q.get(j.job_id).reconciliation_count == 1 == RECONCILIATION_LIMIT
    _walk(q, j.job_id, "w", sm.HUMAN_REVIEW)
    # a SECOND automatic reconciliation is refused — must be a new linked revision
    cur = q.get(j.job_id).stage
    q.claim(cur, "w")
    with pytest.raises(ReconciliationLimitExceeded):
        q.transition(j.job_id, sm.RECONCILIATION_PENDING, "w")


def test_answer_key_hash_separate_from_input_hash(tmp_path) -> None:
    q = SynthQueue(tmp_path / "q.db")
    j = _mk()
    q.enqueue(j)
    q.claim(sm.DISCOVERED, "w1")
    q.transition(
        j.job_id, sm.SOURCE_ELIGIBILITY_PENDING, "w1", input_hash="H_IN", answer_key_hash="H_KEY"
    )
    got = q.get(j.job_id)
    assert (
        got.input_hash == "H_IN"
        and got.answer_key_hash == "H_KEY"
        and got.input_hash != got.answer_key_hash
    )


# ── schema / dataclass / SQLite drift (review fix 6) ────────────────────────
def test_no_drift_schema_dataclass_sqlite(tmp_path) -> None:
    dataclass_fields = set(ct.JOB_FIELDS) | {"labels"}
    schema_props = set(SCHEMA["properties"])
    assert schema_props == dataclass_fields, schema_props ^ dataclass_fields

    q = SynthQueue(tmp_path / "q.db")
    cols = {r[1] for r in q._conn.execute("PRAGMA table_info(jobs)").fetchall()}
    assert cols == dataclass_fields | {"worker_id"}, cols ^ (dataclass_fields | {"worker_id"})

    assert SCHEMA["additionalProperties"] is False
    # every REQUIRED schema field is a real dataclass field
    assert set(SCHEMA["required"]) <= dataclass_fields


def test_schema_example_conforms_to_closed_schema() -> None:
    # additionalProperties:false means the example uses ONLY declared fields
    ex = SCHEMA["examples"][0]
    assert set(ex) <= set(SCHEMA["properties"])
    assert set(SCHEMA["required"]) <= set(ex)

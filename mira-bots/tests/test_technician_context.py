"""WS1 context-contract adoption — hermetic tests (ADR-0033, PRD G1 + G6).

No DB, no network, no inference. These cover the pure half: assembly,
validation, the prompt projection, and the manifest that the audit row records.
The DB-backed half (the real `decision_traces` read, RLS, and the migration-071
round trip) lives in `tests/integration/test_ws1_context_contract.py`, which
runs against staging Neon under `migration-verify.yml`.
"""

from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.technician_context import (  # noqa: E402
    build_turn_context,
    contract_enabled,
    manifest_of,
    prompt_block,
)

from materialized_evidence.context_contract import (  # noqa: E402
    CONTEXT_CONTRACT_VERSION,
    EvidenceItem,
    EvidenceKind,
    TaskMode,
    validate_context,
)

TENANT = "staging"  # deliberately a SLUG, not a uuid — bot surfaces produce these

TRACE_ROWS = [
    {
        "id": "11111111-1111-1111-1111-111111111111",
        "recommendation": "Checked the GS10 overload trip; reseated the motor leads.",
        "outcome": "resolved",
        "ts": "2026-07-29T10:00:00+00:00",
    },
    {
        "id": "22222222-2222-2222-2222-222222222222",
        "recommendation": "Suspected a loose ferrule on terminal 12.",
        "outcome": None,
        "ts": "2026-07-28T09:00:00+00:00",
    },
]

UNS_CONTEXT = {
    "uns_path": "enterprise.garage.demo_cell.cv_101",
    "manufacturer": "Automation Direct",
    "model": "GS10",
    "confidence": "high",
    "source": "chat_resolver",
}


def _ctx(**overrides):
    kwargs = {
        "tenant_id": TENANT,
        "question": "why did the conveyor stop again?",
        "uns_context": UNS_CONTEXT,
        "prior_decisions": TRACE_ROWS,
    }
    kwargs.update(overrides)
    ctx, violations = build_turn_context(**kwargs)
    return ctx, violations


# ---------------------------------------------------------------------------
# The flag
# ---------------------------------------------------------------------------


def test_flag_defaults_off(monkeypatch):
    monkeypatch.delenv("MIRA_CONTEXT_CONTRACT", raising=False)
    assert contract_enabled() is False


@pytest.mark.parametrize("value", ["1", "true", "TRUE", "yes", "on"])
def test_flag_accepts_truthy_spellings(monkeypatch, value):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", value)
    assert contract_enabled() is True


def test_flag_is_read_per_call_not_at_import(monkeypatch):
    """Eval slice 13 must be able to run the same process both ways.

    A module-level constant would freeze whatever the environment was when the
    engine first imported this module, making the slice unbuildable in-process.
    """
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    assert contract_enabled() is True
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "0")
    assert contract_enabled() is False


# ---------------------------------------------------------------------------
# Assembly + validation
# ---------------------------------------------------------------------------


def test_build_turn_context_validates_clean():
    ctx, violations = _ctx()
    assert violations == []
    assert ctx is not None
    assert validate_context(ctx) == [], "assembled context must satisfy its own contract"
    assert ctx.contract_version == CONTEXT_CONTRACT_VERSION
    assert ctx.tenant_id == TENANT
    assert ctx.task_mode is TaskMode.GENERAL_TROUBLESHOOTING
    assert ctx.authorization_state == "read_only"


def test_prior_decisions_are_candidate_never_verified():
    """A past MIRA answer is a hypothesis. It cannot promote itself to truth."""
    ctx, _ = _ctx()
    assert len(ctx.evidence) == 2
    for item in ctx.evidence:
        assert item.kind is EvidenceKind.PRIOR_DECISION
        assert item.trust == "candidate"


def test_producer_cannot_override_trust():
    """Even if a row claims trust=verified, the adapter hard-codes candidate."""
    rows = [dict(TRACE_ROWS[0], trust="verified")]
    ctx, _ = _ctx(prior_decisions=rows)
    assert ctx.evidence[0].trust == "candidate"


def test_citation_ids_are_unique():
    """Duplicate citation_ids are a hard contract violation — prove we mint unique ones."""
    ctx, _ = _ctx()
    ids = [e.citation_id for e in ctx.evidence]
    assert len(ids) == len(set(ids))


def test_missing_tenant_is_a_violation_and_yields_no_context():
    """Fail-closed on the prompt: an invalid context produces no block at all."""
    ctx, violations = _ctx(tenant_id="")
    assert ctx is None
    assert any(v.startswith("tenant_id") for v in violations)


def test_unknown_task_mode_falls_back_rather_than_raising():
    ctx, violations = _ctx(task_mode_value="not_a_real_mode")
    assert violations == []
    assert ctx.task_mode is TaskMode.GENERAL_TROUBLESHOOTING


def test_asset_identity_is_adapted_not_reinvented():
    ctx, _ = _ctx()
    assert ctx.asset.uns_path == UNS_CONTEXT["uns_path"]
    assert ctx.asset.model == "GS10"
    assert ctx.asset.source == "chat_resolver"


def test_empty_priors_is_not_an_error():
    ctx, violations = _ctx(prior_decisions=[])
    assert violations == []
    assert ctx.evidence == []
    assert ctx.unknowns == []


# ---------------------------------------------------------------------------
# Requirement 6 — a failed lookup is OBSERVABLE, not silent
# ---------------------------------------------------------------------------


def test_recall_failure_becomes_an_explicit_unknown():
    ctx, _ = _ctx(prior_decisions=[], recall_error="prior_decisions_unavailable")
    assert "prior_decisions_unavailable" in ctx.unknowns


def test_recall_failure_is_visible_in_the_prompt_not_only_the_log():
    """ "No priors" and "could not look" must not render identically."""
    failed, _ = _ctx(prior_decisions=[], recall_error="prior_decisions_unavailable")
    empty, _ = _ctx(prior_decisions=[])
    assert prompt_block(empty) == ""
    assert "prior_decisions_unavailable" in prompt_block(failed)


# ---------------------------------------------------------------------------
# The prompt projection
# ---------------------------------------------------------------------------


def test_prompt_block_renders_prior_decisions():
    ctx, _ = _ctx()
    block = prompt_block(ctx)
    assert "PRIOR MIRA DECISIONS" in block
    assert "reseated the motor leads" in block
    assert "prior_decision" in block
    assert "candidate" in block


def test_prompt_block_marks_priors_as_non_citable():
    """The RAG reference block is what may be cited; priors explicitly may not."""
    ctx, _ = _ctx()
    block = prompt_block(ctx).lower()
    assert "never cite" in block


def test_prompt_block_excludes_manual_chunks_no_double_render():
    """Retrieval evidence reaches the prompt through the RAG worker's reference
    block. Rendering it here too would present one chunk under two trust labels
    — the projection must drop it."""
    ctx, _ = _ctx()
    ctx_with_manual = type(ctx)(
        contract_version=ctx.contract_version,
        task_mode=ctx.task_mode,
        tenant_id=ctx.tenant_id,
        environment=ctx.environment,
        asset=ctx.asset,
        question=ctx.question,
        evidence=[
            *ctx.evidence,
            EvidenceItem(
                kind=EvidenceKind.MANUAL_CHUNK,
                citation_id="M1",
                payload={"text": "SENTINEL_MANUAL_TEXT_DO_NOT_RENDER"},
            ),
        ],
    )
    block = prompt_block(ctx_with_manual)
    assert "SENTINEL_MANUAL_TEXT_DO_NOT_RENDER" not in block
    assert "reseated the motor leads" in block


def test_prompt_block_empty_when_nothing_new_to_say():
    ctx, _ = _ctx(prior_decisions=[])
    assert prompt_block(ctx) == ""


def test_prompt_block_is_deterministic():
    """Identical contexts must render byte-identically — the property the
    manifest hash depends on."""
    a, _ = _ctx()
    b, _ = _ctx()
    assert prompt_block(a) == prompt_block(b)


def test_prompt_block_on_none_is_empty_not_an_exception():
    assert prompt_block(None) == ""


# ---------------------------------------------------------------------------
# The manifest — G6, "audit row = prompt row"
# ---------------------------------------------------------------------------


def test_manifest_is_serializable_and_hashed():
    ctx, _ = _ctx()
    payload, sha = manifest_of(ctx)
    assert isinstance(payload, dict)
    assert len(sha) == 64
    json.dumps(payload)  # must survive the JSONB write path


def test_manifest_hash_is_stable_across_equal_contexts():
    a, _ = _ctx()
    b, _ = _ctx()
    assert manifest_of(a)[1] == manifest_of(b)[1]


def test_manifest_hash_changes_when_evidence_changes():
    """The whole point: a different prompt context cannot hash the same."""
    a, _ = _ctx()
    b, _ = _ctx(prior_decisions=TRACE_ROWS[:1])
    assert manifest_of(a)[1] != manifest_of(b)[1]


def test_manifest_carries_the_evidence_the_prompt_was_built_from():
    ctx, _ = _ctx()
    payload, _ = manifest_of(ctx)
    rendered = prompt_block(ctx)
    for item in payload["evidence"]:
        assert item["payload"]["summary"] in rendered, (
            "every evidence item in the audit manifest must be present in the "
            "prompt block it claims to describe (PRD G6)"
        )

"""PR E.1 — prompt-version + force_recompute controls (the two previously
unreachable Appendix E reason codes). Hermetic, no I/O."""
from __future__ import annotations

from materialized_evidence import (
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    InMemoryRegistry,
    RecallOutcome,
    RecallQuery,
    RecomputeDecision,
    TrustStatus,
    resolve_recall,
    with_hashes,
)


def _mm(dsv, *, tenant="t1", env=Environment.DEV, sources=None, prompt="p1", producer="1",
        model=True, **over) -> EvidenceManifest:
    """A model-produced manifest by default (carries prompt_contract_version, as the
    validator requires). ``model=False`` makes a non-model (deterministic) dataset."""
    base = EvidenceManifest(
        dataset_id="ds.ocr",
        dataset_version_id=dsv,
        dataset_type=DatasetType.OCR,
        schema_name="s",
        schema_version="1.0",
        tenant_id=tenant,
        environment=env,
        producer_name="vw",
        producer_version=producer,
        model_provider="together" if model else None,
        model_id="m" if model else None,
        prompt_contract_version=prompt if model else None,
        source_hashes=sources or ["shA"],
        trust_status=TrustStatus.TRUSTED,
        approval_status=ApprovalStatus.APPROVED,
        approval_refs=["ai:1"],
        **over,
    )
    return with_hashes(base, [])


def _reg(*ms) -> InMemoryRegistry:
    r = InMemoryRegistry()
    for m in ms:
        r.register(m)
    return r


def _q(**over) -> RecallQuery:
    base = dict(tenant_id="t1", dataset_type=DatasetType.OCR, source_hashes=["shA"],
                environment=Environment.DEV)
    base.update(over)
    return RecallQuery(**base)


# ── prompt-version compatibility ─────────────────────────────────────────────

def test_1_allowed_prompt_version_reuses():
    r = _reg(_mm("v1", prompt="p1"))
    res = resolve_recall(_q(allowed_prompt_versions=["p1", "p2"]), r)
    assert res.outcome == RecallOutcome.EXACT
    assert res.recompute_decision == RecomputeDecision.REUSED_EXACT


def test_2_disallowed_prompt_version_recomputes_prompt_changed():
    r = _reg(_mm("v1", prompt="p1"))
    res = resolve_recall(_q(allowed_prompt_versions=["p2"]), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_PROMPT_CHANGED
    assert "prompt_contract_version" in res.reason


def test_3_prompt_change_is_not_algorithm_changed():
    r = _reg(_mm("v1", prompt="p1", producer="1"))
    # producer is UNRESTRICTED; only the prompt is disallowed
    res = resolve_recall(_q(allowed_prompt_versions=["p2"]), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_PROMPT_CHANGED
    assert res.recompute_decision != RecomputeDecision.RECOMPUTED_ALGORITHM_CHANGED


def test_4_no_prompt_restriction_is_backward_compatible():
    r = _reg(_mm("v1", prompt="anything"))
    res = resolve_recall(_q(), r)  # no allowed_prompt_versions
    assert res.recompute_decision == RecomputeDecision.REUSED_EXACT


def test_prompt_gate_applies_only_to_model_datasets():
    # a NON-model (deterministic) dataset has no prompt; a prompt restriction must
    # not block it (its output does not depend on a prompt).
    r = _reg(_mm("v1", model=False))
    res = resolve_recall(_q(allowed_prompt_versions=["p2"]), r)
    assert res.recompute_decision == RecomputeDecision.REUSED_EXACT


# ── force_recompute ──────────────────────────────────────────────────────────

def test_5_force_overrides_exact_reuse():
    r = _reg(_mm("v1"))
    res = resolve_recall(_q(force_recompute=True), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_HUMAN_REQUESTED
    assert res.selected_versions == []  # did not select the reusable candidate


def test_6_force_overrides_partial_reuse():
    r = _reg(_mm("v1", sources=["shA"]))
    res = resolve_recall(_q(source_hashes=["shA", "shB"], force_recompute=True), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_HUMAN_REQUESTED
    assert res.missing_outputs == []  # bypassed partial-reuse selection entirely


def test_7_force_overrides_multiple_compatible_candidates():
    # two exact-compatible datasets (same content) — normally REUSED_EXACT
    r = _reg(_mm("v1"), _mm("v2"))
    assert resolve_recall(_q(), r).recompute_decision == RecomputeDecision.REUSED_EXACT
    res = resolve_recall(_q(force_recompute=True), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_HUMAN_REQUESTED
    assert res.incompatible_considered == []  # inspected/selected no candidate


def test_8_force_returns_human_requested_outcome_none():
    res = resolve_recall(_q(force_recompute=True), _reg(_mm("v1")))
    assert res.outcome == RecallOutcome.NONE
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_HUMAN_REQUESTED
    assert res.human_approval_required is False  # operator-requested, not blocked


def test_9_force_does_not_weaken_tenant_isolation():
    r = _reg(_mm("v1", tenant="t2"))  # only t2 evidence exists
    res = resolve_recall(_q(tenant_id="t1", force_recompute=True), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_HUMAN_REQUESTED
    assert res.incompatible_considered == []  # never referenced the t2 record
    assert r.get("v1", tenant_id="t2") is not None  # t2 evidence untouched


def test_10_force_does_not_weaken_environment_isolation():
    r = _reg(_mm("v1", env=Environment.PROD))
    res = resolve_recall(_q(environment=Environment.DEV, force_recompute=True), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_HUMAN_REQUESTED
    assert res.incompatible_considered == []  # did not act on the prod candidate


def test_11_gate_order_producer_before_prompt():
    # candidate is wrong on BOTH producer and prompt; producer (checked first)
    # deterministically wins → algorithm_changed, never prompt_changed.
    r = _reg(_mm("v1", producer="1", prompt="p1"))
    res = resolve_recall(_q(allowed_producer_versions=["2"], allowed_prompt_versions=["p2"]), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_ALGORITHM_CHANGED

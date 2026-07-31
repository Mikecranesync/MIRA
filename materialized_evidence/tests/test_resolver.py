"""Recall resolver tests (PR E) — one per Appendix E gate + conflict/stale/corrupt/cross-tenant.

Hermetic, no I/O. Each test sets up a registry state and asserts the resolver's
outcome + exact RecomputeDecision reason code + missing requirements.
"""

from __future__ import annotations

import dataclasses
import math

import pytest

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


def _m(
    dsv,
    *,
    tenant="t1",
    env=Environment.DEV,
    sources=None,
    schema=("s", "1.0"),
    producer_version="1",
    trust=TrustStatus.TRUSTED,
    approval=ApprovalStatus.APPROVED,
    approval_refs=None,
    parents=None,
    completeness=None,
    **over,
) -> EvidenceManifest:
    base = EvidenceManifest(
        dataset_id="ds.ocr",
        dataset_version_id=dsv,
        dataset_type=DatasetType.OCR,
        schema_name=schema[0],
        schema_version=schema[1],
        tenant_id=tenant,
        environment=env,
        producer_name="vision_worker",
        producer_version=producer_version,
        source_hashes=sources or ["shA"],
        trust_status=trust,
        approval_status=approval,
        approval_refs=approval_refs
        or (["ai_suggestions:1"] if trust == TrustStatus.TRUSTED else []),
        parent_dataset_versions=parents or [],
        completeness=completeness,
        **over,
    )
    return with_hashes(base, [])


def _reg(*ms) -> InMemoryRegistry:
    r = InMemoryRegistry()
    for m in ms:
        r.register(m)
    return r


def _q(**over) -> RecallQuery:
    base = dict(
        tenant_id="t1",
        dataset_type=DatasetType.OCR,
        source_hashes=["shA"],
        environment=Environment.DEV,
    )
    base.update(over)
    return RecallQuery(**base)


# ── the happy path ───────────────────────────────────────────────────────────


def test_exact_reuse():
    r = _reg(_m("v1", sources=["shA"]))
    res = resolve_recall(_q(source_hashes=["shA"]), r)
    assert res.outcome == RecallOutcome.EXACT
    assert res.recompute_decision == RecomputeDecision.REUSED_EXACT
    assert res.selected_versions == ["v1"]


def test_partial_reuse_reports_missing():
    r = _reg(_m("v1", sources=["shA"]))
    res = resolve_recall(_q(source_hashes=["shA", "shB"]), r)
    assert res.outcome == RecallOutcome.PARTIAL
    assert res.recompute_decision == RecomputeDecision.REUSED_PARTIAL
    assert res.missing_outputs == ["shB"]


# ── Gate 1 — tenancy + environment ───────────────────────────────────────────


def test_gate1_cross_tenant_rejected():
    r = _reg(_m("v1", tenant="t2"))  # evidence belongs to t2
    res = resolve_recall(_q(tenant_id="t1"), r)
    assert res.outcome == RecallOutcome.NONE
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT


def test_gate1_environment_mismatch():
    r = _reg(_m("v1", env=Environment.PROD))
    res = resolve_recall(_q(environment=Environment.DEV), r)
    assert res.outcome == RecallOutcome.NONE
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
    assert "environment" in res.reason


# ── Gate 2 — source identity ─────────────────────────────────────────────────


def test_gate2_source_changed():
    r = _reg(_m("v1", sources=["shOLD"]))
    res = resolve_recall(_q(source_hashes=["shNEW"]), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_SOURCE_CHANGED


def test_gate2_never_materialized():
    res = resolve_recall(_q(), InMemoryRegistry())
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT


# ── Gate 3 — output contract ─────────────────────────────────────────────────


def test_gate3_schema_changed():
    r = _reg(_m("v1", schema=("s", "1.0")))
    res = resolve_recall(_q(required_schema=("s", "2.0")), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_SCHEMA_CHANGED


def test_gate3_incomplete():
    r = _reg(_m("v1", completeness=0.5))
    res = resolve_recall(_q(required_completeness=0.9), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
    assert "completeness" in res.reason


def test_gate3_unknown_completeness_cannot_satisfy_a_numeric_requirement():
    """`completeness=None` means UNKNOWN, and unknown is not "good enough".

    `document_compiler` deliberately leaves `completeness` None on a
    document-scoped Page Identity dataset — precisely so a page-level recall
    query cannot mistake it for full page coverage. The gate has to honor that:
    comparing only when BOTH sides are numeric let the unknown side through as
    exact reuse, which is the opposite of what the producer intended.
    """
    r = _reg(_m("v1", completeness=None))

    res = resolve_recall(_q(required_completeness=1.0), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
    assert res.outcome == RecallOutcome.NONE
    assert "completeness" in res.reason

    # The counterfactual that proves the gate — and not some later gate — is what
    # rejected it: the SAME manifest is fully reusable when nothing is required.
    assert resolve_recall(_q(), r).recompute_decision == RecomputeDecision.REUSED_EXACT


def test_gate3_non_numeric_completeness_cannot_satisfy_a_numeric_requirement():
    """A descriptive completeness ("partial") is not comparable to 1.0."""
    r = _reg(_m("v1", completeness="partial"))
    res = resolve_recall(_q(required_completeness=1.0), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
    assert resolve_recall(_q(), r).recompute_decision == RecomputeDecision.REUSED_EXACT


def test_gate3_numeric_completeness_at_or_above_the_threshold_still_reuses():
    """The fix must not turn every completeness comparison into a recompute."""
    for have in (0.9, 1.0):
        r = _reg(_m("v1", completeness=have))
        res = resolve_recall(_q(required_completeness=0.9), r)
        assert res.recompute_decision == RecomputeDecision.REUSED_EXACT, have


# ── Gate 4 — producer version ────────────────────────────────────────────────


def test_gate4_producer_version_changed():
    r = _reg(_m("v1", producer_version="1"))
    res = resolve_recall(_q(allowed_producer_versions=["2"]), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_ALGORITHM_CHANGED


# ── Gate 5 — trust and approval ──────────────────────────────────────────────


def test_gate5_approval_revoked_blocks():
    r = _reg(_m("v1", approval=ApprovalStatus.REVOKED, trust=TrustStatus.BETA, approval_refs=["x"]))
    res = resolve_recall(_q(), r)
    assert res.recompute_decision == RecomputeDecision.BLOCKED_APPROVAL
    assert res.human_approval_required is True


def test_gate5_insufficient_trust_blocks():
    r = _reg(_m("v1", trust=TrustStatus.CANDIDATE, approval=ApprovalStatus.PENDING))
    res = resolve_recall(_q(allowed_trust_states=[TrustStatus.TRUSTED]), r)
    assert res.recompute_decision == RecomputeDecision.BLOCKED_APPROVAL


def test_gate5_stale_blocks_on_dependency():
    m = _m("v1")
    r = _reg(m)
    r.mark_stale("v1", ["parent changed"], tenant_id="t1")
    res = resolve_recall(_q(), r)
    assert res.outcome == RecallOutcome.STALE
    assert res.recompute_decision == RecomputeDecision.BLOCKED_DEPENDENCY


# ── Gate 6 — integrity ───────────────────────────────────────────────────────


def test_gate6_corrupt_manifest_hash():
    m = _m("v1")
    r = InMemoryRegistry()
    r._manifests["v1"] = dataclasses.replace(m, manifest_hash="deadbeef")  # tamper post-register
    res = resolve_recall(_q(), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_CORRUPT


def test_gate6_missing_parent_blocks():
    child = _m("v2", parents=["v1-missing"])
    r = _reg(child)  # parent never registered
    res = resolve_recall(_q(), r)
    assert res.recompute_decision == RecomputeDecision.BLOCKED_DEPENDENCY
    assert "parent" in res.reason


# ── conflict ─────────────────────────────────────────────────────────────────


def test_conflicting_results_block():
    # two exact-compatible datasets for the same source but DIFFERENT content
    a = with_hashes(
        dataclasses.replace(_m("v1"), content_hash=""), []
    )  # v1 content hash from empty records
    b = _m("v2")
    # force different content by giving b a different record set via with_hashes
    from materialized_evidence import EvidenceRecord

    b = with_hashes(
        dataclasses.replace(b, content_hash=""), [EvidenceRecord("r", "ds", "loc", {"x": 1})]
    )
    r = _reg(a, b)
    res = resolve_recall(_q(), r)
    assert res.outcome == RecallOutcome.CONFLICTING
    assert res.recompute_decision == RecomputeDecision.BLOCKED_CONFLICT
    assert set(res.incompatible_considered) == {"v1", "v2"}


# ── ordering: the first failing gate wins ────────────────────────────────────


def test_gate_order_source_before_schema():
    # candidate is BOTH wrong-source and wrong-schema; source (Gate 2) is evaluated
    # first, so the type-level source_none path yields SOURCE_CHANGED, not SCHEMA.
    r = _reg(_m("v1", sources=["shOLD"], schema=("s", "1.0")))
    res = resolve_recall(_q(source_hashes=["shNEW"], required_schema=("s", "2.0")), r)
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_SOURCE_CHANGED


# ── Gate 3 — non-finite / bool completeness must never enable reuse ───────────
#
# Three distinct silent-reuse holes, each from a different property of Python
# numerics rather than from the gate's own logic:
#   * `bool` is a subclass of `int`, so `True` passes an isinstance check and
#     compares as 1.0;
#   * every comparison against `NaN` is False, so `nan < 1.0` is False and NaN
#     falls THROUGH the `<` check as though it met the requirement;
#   * `inf` exceeds every threshold.
# All three must fail closed, on both sides of the comparison.


def _inject(reg: InMemoryRegistry, m: EvidenceManifest) -> InMemoryRegistry:
    """Place a manifest in the registry BYPASSING validation.

    `register` now rejects a non-finite completeness outright (see
    test_schema.py), so the only way to prove the RESOLVER also fails closed is
    to simulate a row persisted before that validation existed. That is
    defence-in-depth, not redundancy: the registry is a protocol with other
    backends, and the resolver must not assume every one of them validated.
    """
    reg._manifests[m.dataset_version_id] = m
    return reg


@pytest.mark.parametrize("bad", [math.nan, math.inf, -math.inf, True, False])
def test_gate3_non_finite_or_bool_completeness_cannot_satisfy_a_numeric_requirement(bad):
    """A TRUSTED + APPROVED manifest — one that clears every other gate — still
    must not be reused when its completeness is not a finite measure."""
    m = _m("v1", completeness=bad, trust=TrustStatus.TRUSTED, approval=ApprovalStatus.APPROVED)
    r = _inject(InMemoryRegistry(), m)

    res = resolve_recall(_q(required_completeness=1.0), r)

    assert res.outcome != RecallOutcome.EXACT, f"{bad!r} completeness enabled reuse"
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT
    assert "completeness" in res.reason

    # The counterfactual: the same manifest IS reusable when nothing is
    # required — so it was this gate, not trust/approval/source, that rejected it.
    assert resolve_recall(_q(), r).recompute_decision == RecomputeDecision.REUSED_EXACT


@pytest.mark.parametrize("bad_req", [math.nan, math.inf, -math.inf, True, False])
def test_gate3_non_finite_or_bool_requirement_cannot_silently_enable_reuse(bad_req):
    """A requirement that is not a finite number is one this gate cannot honour.

    Falling through to "non-numeric requirements are ungated" would be the worst
    outcome: `required_completeness=nan` would reuse ANYTHING, including a
    dataset with no completeness at all. Fail closed instead.
    """
    r = _reg(_m("v1", completeness=0.5))
    res = resolve_recall(_q(required_completeness=bad_req), r)

    assert res.outcome != RecallOutcome.EXACT, f"requirement {bad_req!r} enabled reuse"
    assert res.recompute_decision == RecomputeDecision.RECOMPUTED_MISSING_OUTPUT


def test_gate3_nan_requirement_does_not_reuse_a_dataset_with_unknown_completeness():
    """The sharpest form: NaN on BOTH sides must not resolve to reuse."""
    m = _m("v1", completeness=None)
    r = _inject(InMemoryRegistry(), m)
    res = resolve_recall(_q(required_completeness=math.nan), r)
    assert res.outcome != RecallOutcome.EXACT

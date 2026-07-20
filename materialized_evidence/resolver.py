"""Recall resolver (PR E) — reuse-before-recompute decisions over the registry.

Given a ``RecallQuery`` and a ``MaterializationRegistry`` (PR D), decide whether a
compatible prior evidence dataset can be reused, applying the PRD Appendix E gates
IN ORDER: (1) tenancy + environment, (2) source identity, (3) output contract,
(4) producer version, (5) trust/approval, (6) integrity. The first gate a
candidate fails determines its verdict.

Returns exactly one ``RecallResult`` — a clear **reuse / partial-reuse / recompute
/ blocked** decision with an exact ``RecomputeDecision`` reason code and the
missing requirements. It computes nothing else: it does NOT approve, invalidate,
orchestrate, or wire runtime, and it never mutates evidence (reads only). Vendor-
neutral — it codes against the ``MaterializationRegistry`` protocol, not a backend.

Scope boundaries (deliberate gaps, see the PR body):
- Gate 1 finer ACLs (per-user source/asset access, classification levels) are the
  runtime's job — this layer enforces tenant + environment only.
- Gate 4 distinguishes *producer version* (the scoped ask). Emitting
  ``recomputed_prompt_changed`` distinctly needs an ``allowed_prompt_versions``
  field on ``RecallQuery`` (a PR C follow-up); a prompt change surfaces here as a
  producer-version mismatch today.
- ``recomputed_human_requested`` needs a force-recompute flag on the query (not in
  the current contract); not emitted here.
"""

from __future__ import annotations

from dataclasses import dataclass

from .hashing import manifest_hash
from .registry import MaterializationRegistry
from .schema import (
    EvidenceManifest,
    RecallOutcome,
    RecallQuery,
    RecallResult,
    RecomputeDecision,
    StaleState,
)

# highest-priority (most actionable) failure first — used to pick THE decision when
# no candidate is reusable.
_FAILURE_PRIORITY = (
    RecomputeDecision.BLOCKED_CONFLICT,
    RecomputeDecision.BLOCKED_APPROVAL,
    RecomputeDecision.BLOCKED_DEPENDENCY,
    RecomputeDecision.RECOMPUTED_CORRUPT,
    RecomputeDecision.RECOMPUTED_SCHEMA_CHANGED,
    RecomputeDecision.RECOMPUTED_ALGORITHM_CHANGED,
    RecomputeDecision.RECOMPUTED_SOURCE_CHANGED,
    RecomputeDecision.RECOMPUTED_MISSING_OUTPUT,
)

_DECISION_TO_OUTCOME = {
    RecomputeDecision.REUSED_EXACT: RecallOutcome.EXACT,
    RecomputeDecision.REUSED_PARTIAL: RecallOutcome.PARTIAL,
    RecomputeDecision.BLOCKED_CONFLICT: RecallOutcome.CONFLICTING,
    RecomputeDecision.BLOCKED_DEPENDENCY: RecallOutcome.STALE,
    RecomputeDecision.BLOCKED_APPROVAL: RecallOutcome.NONE,
    RecomputeDecision.RECOMPUTED_SOURCE_CHANGED: RecallOutcome.NONE,
    RecomputeDecision.RECOMPUTED_ALGORITHM_CHANGED: RecallOutcome.NONE,
    RecomputeDecision.RECOMPUTED_SCHEMA_CHANGED: RecallOutcome.NONE,
    RecomputeDecision.RECOMPUTED_MISSING_OUTPUT: RecallOutcome.NONE,
    RecomputeDecision.RECOMPUTED_CORRUPT: RecallOutcome.NONE,
}


@dataclass(frozen=True)
class _Verdict:
    """Per-candidate evaluation result."""

    kind: str  # "exact_ok" | "partial_ok" | "fail" | "env_mismatch" | "source_none"
    candidate: EvidenceManifest
    decision: RecomputeDecision | None = None  # set for "fail"
    reason: str = ""
    missing: tuple[str, ...] = ()


def _source_coverage(q_sources: list[str], c_sources: list[str]) -> tuple[str, list[str]]:
    q, c = set(q_sources), set(c_sources)
    if not q:
        return "full", []  # no source constraint declared
    missing = sorted(q - c)
    if not missing:
        return "full", []
    if q & c:
        return "partial", missing
    return "none", missing


def _evaluate(query: RecallQuery, registry: MaterializationRegistry, m: EvidenceManifest) -> _Verdict:
    # Gate 1 — tenancy already enforced by registry.find (same-tenant only);
    # here we complete Gate 1 with the environment check.
    if m.environment != query.environment:
        return _Verdict("env_mismatch", m, reason=f"environment {m.environment.value} != {query.environment.value}")

    # Gate 2 — source identity
    cov, missing = _source_coverage(query.source_hashes, m.source_hashes)
    if cov == "none":
        return _Verdict("source_none", m, reason="no source overlap")

    # Gate 3 — output contract (schema + completeness; type already filtered by find)
    if query.required_schema is not None:
        want_name, want_ver = query.required_schema
        if (m.schema_name, m.schema_version) != (want_name, want_ver):
            return _Verdict(
                "fail", m, RecomputeDecision.RECOMPUTED_SCHEMA_CHANGED,
                f"schema {m.schema_name}/{m.schema_version} != required {want_name}/{want_ver}",
            )
    if (
        isinstance(query.required_completeness, (int, float))
        and isinstance(m.completeness, (int, float))
        and float(m.completeness) < float(query.required_completeness)
    ):
        return _Verdict(
            "fail", m, RecomputeDecision.RECOMPUTED_MISSING_OUTPUT,
            f"completeness {m.completeness} < required {query.required_completeness}",
        )

    # Gate 4 — producer version
    if query.allowed_producer_versions and m.producer_version not in query.allowed_producer_versions:
        return _Verdict(
            "fail", m, RecomputeDecision.RECOMPUTED_ALGORITHM_CHANGED,
            f"producer_version {m.producer_version!r} not in allowed {query.allowed_producer_versions}",
        )

    # Gate 5 — trust and approval (+ freshness)
    if m.approval_status.value == "revoked":
        return _Verdict("fail", m, RecomputeDecision.BLOCKED_APPROVAL, "approval revoked")
    if query.allowed_trust_states and m.trust_status not in query.allowed_trust_states:
        return _Verdict(
            "fail", m, RecomputeDecision.BLOCKED_APPROVAL,
            f"trust_status {m.trust_status.value} not in required {[t.value for t in query.allowed_trust_states]}",
        )
    eff_stale = registry.effective_stale_state(m.dataset_version_id, tenant_id=query.tenant_id)
    if eff_stale != StaleState.VALID:
        return _Verdict(
            "fail", m, RecomputeDecision.BLOCKED_DEPENDENCY,
            f"evidence is {eff_stale.value} (rebuild upstream before reuse)",
        )

    # Gate 6 — integrity (no I/O: manifest-hash + content-hash + parent availability)
    if not m.content_hash or manifest_hash(m) != m.manifest_hash:
        return _Verdict("fail", m, RecomputeDecision.RECOMPUTED_CORRUPT, "manifest/content hash mismatch")
    for parent in m.parent_dataset_versions:
        if registry.get(parent, tenant_id=query.tenant_id) is None:
            return _Verdict(
                "fail", m, RecomputeDecision.BLOCKED_DEPENDENCY,
                f"parent dataset version {parent!r} is unavailable",
            )

    return _Verdict("exact_ok" if cov == "full" else "partial_ok", m, missing=tuple(missing))


def resolve_recall(query: RecallQuery, registry: MaterializationRegistry) -> RecallResult:
    """Decide reuse vs recompute for ``query`` against ``registry`` (Appendix E)."""
    candidates = registry.find(tenant_id=query.tenant_id, dataset_type=query.dataset_type)
    verdicts = [_evaluate(query, registry, m) for m in candidates]

    exact_ok = [v for v in verdicts if v.kind == "exact_ok"]
    partial_ok = [v for v in verdicts if v.kind == "partial_ok"]

    # reuse — exact
    if exact_ok:
        hashes = {v.candidate.content_hash for v in exact_ok}
        if len(hashes) > 1:
            return RecallResult(
                outcome=RecallOutcome.CONFLICTING,
                reason=f"{len(hashes)} distinct compatible results for the same request",
                incompatible_considered=[v.candidate.dataset_version_id for v in exact_ok],
                incompatibility_reasons=["multiple valid datasets with different content_hash"],
                recompute_decision=RecomputeDecision.BLOCKED_CONFLICT,
            )
        chosen = exact_ok[0].candidate
        return RecallResult(
            outcome=RecallOutcome.EXACT,
            reason="exact compatible evidence found",
            selected_versions=[chosen.dataset_version_id],
            recompute_decision=RecomputeDecision.REUSED_EXACT,
        )

    # partial-reuse
    if partial_ok:
        best = min(partial_ok, key=lambda v: len(v.missing))
        return RecallResult(
            outcome=RecallOutcome.PARTIAL,
            reason="partial compatible evidence found; some sources not covered",
            selected_versions=[best.candidate.dataset_version_id],
            missing_outputs=list(best.missing),
            recompute_decision=RecomputeDecision.REUSED_PARTIAL,
        )

    # no reuse — surface the most actionable failure first
    fails = [v for v in verdicts if v.kind == "fail"]
    if fails:
        chosen = min(
            fails,
            key=lambda v: _FAILURE_PRIORITY.index(v.decision) if v.decision in _FAILURE_PRIORITY else 999,
        )
        assert chosen.decision is not None
        return RecallResult(
            outcome=_DECISION_TO_OUTCOME[chosen.decision],
            reason=chosen.reason,
            incompatible_considered=[v.candidate.dataset_version_id for v in fails],
            incompatibility_reasons=[v.reason for v in fails],
            missing_outputs=list(chosen.missing),
            recompute_decision=chosen.decision,
            human_approval_required=(chosen.decision == RecomputeDecision.BLOCKED_APPROVAL),
        )

    # same dataset TYPE exists but only for other source hashes → the source changed
    source_none = [v for v in verdicts if v.kind == "source_none"]
    if source_none:
        return RecallResult(
            outcome=RecallOutcome.NONE,
            reason="evidence of this type exists but only for different source hashes (source changed)",
            incompatible_considered=[v.candidate.dataset_version_id for v in source_none],
            recompute_decision=RecomputeDecision.RECOMPUTED_SOURCE_CHANGED,
        )

    # nothing in scope (empty, or only other-environment candidates)
    env_only = [v for v in verdicts if v.kind == "env_mismatch"]
    reason = (
        "no evidence for this environment (candidates exist only in another environment)"
        if env_only
        else "no compatible evidence exists — never materialized"
    )
    return RecallResult(
        outcome=RecallOutcome.NONE,
        reason=reason,
        incompatible_considered=[v.candidate.dataset_version_id for v in env_only],
        recompute_decision=RecomputeDecision.RECOMPUTED_MISSING_OUTPUT,
    )

"""Dependency invalidation tests (PR F) — the Appendix F executable behavior.

Hermetic, no I/O. Covers direct/transitive propagation, graph safety (cycle, dup
edges, diamond, fan-out, disconnected, missing nodes), tenant/environment
isolation incl. malformed cross-boundary edges, immutability of evidence/manifests/
hashes, invalidation provenance, and resolver integration.
"""
from __future__ import annotations

from materialized_evidence import (
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    InMemoryRegistry,
    RecallQuery,
    RecomputeDecision,
    StaleState,
    TrustStatus,
    invalidate,
    resolve_recall,
    with_hashes,
)


def _m(dsv, *, tenant="t1", env=Environment.DEV, parents=None) -> EvidenceManifest:
    base = EvidenceManifest(
        dataset_id="ds",
        dataset_version_id=dsv,
        dataset_type=DatasetType.OCR,
        schema_name="s",
        schema_version="1.0",
        tenant_id=tenant,
        environment=env,
        producer_name="p",
        producer_version="1",
        source_hashes=["sh_" + dsv],
        parent_dataset_versions=parents or [],
        trust_status=TrustStatus.TRUSTED,
        approval_status=ApprovalStatus.APPROVED,
        approval_refs=["a:1"],
    )
    return with_hashes(base, [])


def _reg(*ms) -> InMemoryRegistry:
    r = InMemoryRegistry()
    for m in ms:
        r.register(m)
    return r


def _stale(r, dsv, tenant="t1") -> bool:
    return r.effective_stale_state(dsv, tenant_id=tenant) == StaleState.STALE


# 1
def test_direct_invalidation():
    r = _reg(_m("A"))
    res = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert res.affected == ["A"] and _stale(r, "A")


# 2
def test_one_hop_propagation():
    r = _reg(_m("A"), _m("B", parents=["A"]))
    res = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert set(res.affected) == {"A", "B"} and _stale(r, "B")


# 3
def test_multi_hop_propagation():
    r = _reg(_m("A"), _m("B", parents=["A"]), _m("C", parents=["B"]), _m("D", parents=["C"]))
    res = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert set(res.affected) == {"A", "B", "C", "D"}


# 4
def test_fan_out_propagation():
    r = _reg(_m("A"), _m("B", parents=["A"]), _m("C", parents=["A"]), _m("D", parents=["A"]))
    res = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert set(res.affected) == {"A", "B", "C", "D"}


# 5 + 6
def test_diamond_graph_no_duplicates():
    r = _reg(_m("A"), _m("B", parents=["A"]), _m("C", parents=["A"]), _m("D", parents=["B", "C"]))
    res = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert set(res.affected) == {"A", "B", "C", "D"}
    assert res.affected.count("D") == 1  # no duplicate effect


# 7
def test_cycle_terminates_safely():
    r = _reg(_m("A", parents=["B"]), _m("B", parents=["A"]))
    res = invalidate(r, "A", tenant_id="t1", trigger="T")  # must not hang/crash
    assert set(res.affected) == {"A", "B"}


# 8
def test_duplicate_edges_no_duplicate_effect():
    r = _reg(_m("A"), _m("B", parents=["A", "A"]))  # B lists A twice
    res = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert res.affected.count("B") == 1


# 9
def test_idempotent_repeat():
    r = _reg(_m("A"), _m("B", parents=["A"]))
    first = invalidate(r, "A", tenant_id="t1", trigger="T")
    second = invalidate(r, "A", tenant_id="t1", trigger="T")
    assert set(first.newly_stale) == {"A", "B"}
    assert second.newly_stale == [] and set(second.already_stale) == {"A", "B"}
    # no duplicate overlays appended
    assert len(r.status_overlays("B", tenant_id="t1")) == 1


# 10
def test_already_stale_node_remains_stable():
    r = _reg(_m("A"))
    r.mark_stale("A", ["other cause"], tenant_id="t1", trigger="OTHER")
    assert _stale(r, "A")
    invalidate(r, "A", tenant_id="t1", trigger="T")  # a new cause
    assert _stale(r, "A")  # still stale, no crash


# 11
def test_unrelated_branch_stays_valid():
    r = _reg(_m("A"), _m("B", parents=["A"]), _m("X"), _m("Y", parents=["X"]))
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert not _stale(r, "X") and not _stale(r, "Y")


# 12
def test_disconnected_component_unchanged():
    r = _reg(_m("A"), _m("Z"))
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert not _stale(r, "Z")


# 13
def test_missing_target_handled_safely():
    r = _reg(_m("A"))
    res = invalidate(r, "GHOST", tenant_id="t1", trigger="T")
    assert res.affected == [] and res.origin_dataset_version_id is None


# 14
def test_missing_downstream_node_handled_safely():
    r = _reg(_m("A"), _m("B", parents=["A"]))
    del r._manifests["B"]  # B removed; edge is rebuilt from live manifests, so B vanishes
    res = invalidate(r, "A", tenant_id="t1", trigger="T")  # must not crash
    assert res.affected == ["A"]


# 15
def test_tenant_boundary_stops_propagation():
    r = _reg(_m("A", tenant="t1"), _m("B", tenant="t2", parents=["A"]))
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert r.effective_stale_state("B", tenant_id="t2") == StaleState.VALID


# 16
def test_environment_boundary_stops_propagation():
    r = _reg(_m("A", env=Environment.DEV), _m("B", env=Environment.PROD, parents=["A"]))
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert not _stale(r, "B")


# 17
def test_malformed_cross_tenant_edge_no_leak_or_mutate():
    other = _m("C", tenant="t2", parents=["A"])  # foreign tenant claims A as parent
    r = _reg(_m("A", tenant="t1"), other)
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert r.effective_stale_state("C", tenant_id="t2") == StaleState.VALID
    assert r.get("C", tenant_id="t2") == other  # unchanged


# 18
def test_malformed_cross_env_edge_no_leak_or_mutate():
    other = _m("C", env=Environment.PROD, parents=["A"])
    r = _reg(_m("A", env=Environment.DEV), other)
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert not _stale(r, "C")


# 19 + 20 + 21
def test_immutable_evidence_manifests_hashes_unchanged():
    a = _m("A")
    b = _m("B", parents=["A"])
    r = _reg(a, b)
    invalidate(r, "A", tenant_id="t1", trigger="T")
    assert r.get("A", tenant_id="t1") == a  # manifest object unchanged (immutable)
    assert r.get("B", tenant_id="t1") == b
    assert r.get("A", tenant_id="t1").content_hash == a.content_hash
    assert r.get("A", tenant_id="t1").manifest_hash == a.manifest_hash


# 22
def test_provenance_identifies_trigger():
    r = _reg(_m("A"), _m("B", parents=["A"]))
    invalidate(r, "A", tenant_id="t1", trigger="page-hash-changed")
    ov = r.status_overlays("B", tenant_id="t1")[0]
    assert ov.trigger == "page-hash-changed"
    assert ov.origin_dataset_version_id == "A"


# 23
def test_provenance_distinguishes_direct_from_propagated():
    r = _reg(_m("A"), _m("B", parents=["A"]))
    invalidate(r, "A", tenant_id="t1", trigger="T")
    a_ov = r.status_overlays("A", tenant_id="t1")[0]
    b_ov = r.status_overlays("B", tenant_id="t1")[0]
    assert a_ov.propagation == "direct" and a_ov.via_parent is None
    assert b_ov.propagation == "propagated" and b_ov.via_parent == "A"


# 24
def test_resolver_returns_blocked_dependency_for_invalidated():
    r = _reg(_m("A"))
    invalidate(r, "A", tenant_id="t1", trigger="T")
    q = RecallQuery(tenant_id="t1", dataset_type=DatasetType.OCR, source_hashes=["sh_A"],
                    environment=Environment.DEV)
    res = resolve_recall(q, r)
    assert res.recompute_decision == RecomputeDecision.BLOCKED_DEPENDENCY

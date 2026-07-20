"""Registry tests (PR D) — PRD §21.1 (recall/tenant) + §8 (what exists/valid/stale/downstream).

Hermetic, no I/O. Covers tenant isolation, immutable versions (ADR A3), source-hash
lookup, transitive lineage/downstream, stale overlays (not manifest mutation), and
the absence of any approval-mutation path.
"""
from __future__ import annotations

import dataclasses

import pytest

from materialized_evidence import (
    DatasetType,
    Environment,
    EvidenceManifest,
    InMemoryRegistry,
    RegistryError,
    StaleState,
    TrustStatus,
    with_hashes,
)


def _m(dsv: str, *, tenant="t1", dtype=DatasetType.OCR, parents=None, sources=None, **over) -> EvidenceManifest:
    base = EvidenceManifest(
        dataset_id=over.pop("dataset_id", f"ds.{dtype.value}"),
        dataset_version_id=dsv,
        dataset_type=dtype,
        schema_name="s",
        schema_version="1.0",
        tenant_id=tenant,
        environment=Environment.DEV,
        producer_name="p",
        producer_version="1",
        parent_dataset_versions=parents or [],
        source_hashes=sources or [],
        **over,
    )
    return with_hashes(base, [])


def _reg(*manifests) -> InMemoryRegistry:
    r = InMemoryRegistry()
    for m in manifests:
        r.register(m)
    return r


def test_register_and_get_roundtrip():
    m = _m("v1")
    r = _reg(m)
    assert r.get("v1", tenant_id="t1") == m


def test_tenant_isolation_get_and_find():
    r = _reg(_m("v1", tenant="t1"), _m("v2", tenant="t2"))
    assert r.get("v2", tenant_id="t1") is None  # cannot read another tenant's evidence
    assert [m.dataset_version_id for m in r.find(tenant_id="t1")] == ["v1"]


def test_register_rejects_unhashed_manifest():
    raw = dataclasses.replace(_m("v1"), content_hash="", manifest_hash="")
    with pytest.raises(RegistryError):
        _reg(raw)


def test_immutable_version_conflict():
    r = _reg(_m("v1", record_count=1))
    # same version id, different content → rejected (ADR A3)
    other = _m("v1", dataset_id="ds.DIFFERENT")
    with pytest.raises(RegistryError):
        r.register(other)
    # re-registering the IDENTICAL manifest is idempotent (no error)
    r.register(r.get("v1", tenant_id="t1"))


def test_find_by_source_hashes_requires_all_present():
    r = _reg(_m("v1", sources=["shA", "shB"]))
    assert r.find(tenant_id="t1", source_hashes=["shA"])  # subset present → match
    assert not r.find(tenant_id="t1", source_hashes=["shA", "shC"])  # shC absent → no match


def test_downstream_is_transitive():
    # v1 (page) -> v2 (ocr) -> v3 (devices); v9 unrelated
    r = _reg(_m("v1"), _m("v2", parents=["v1"]), _m("v3", parents=["v2"]), _m("v9"))
    got = {m.dataset_version_id for m in r.downstream_of("v1", tenant_id="t1")}
    assert got == {"v2", "v3"}
    assert r.downstream_of("v3", tenant_id="t1") == []  # leaf


def test_lineage_parents_and_children():
    r = _reg(_m("v1"), _m("v2", parents=["v1"]))
    lin = r.lineage("v2", tenant_id="t1")
    assert lin["parents"] == ["v1"] and lin["children"] == []
    assert r.lineage("v1", tenant_id="t1")["children"] == ["v2"]


def test_mark_stale_is_an_overlay_not_a_mutation():
    m = _m("v1")
    r = _reg(m)
    assert r.effective_stale_state("v1", tenant_id="t1") == StaleState.VALID
    r.mark_stale("v1", ["parent v0 changed"], tenant_id="t1")
    assert r.effective_stale_state("v1", tenant_id="t1") == StaleState.STALE
    # the stored manifest is UNCHANGED (payload + content_hash immutable, ADR A3)
    assert r.get("v1", tenant_id="t1").content_hash == m.content_hash
    assert r.get("v1", tenant_id="t1").stale_state == StaleState.VALID
    # find can filter on the EFFECTIVE stale state
    assert r.find(tenant_id="t1", stale_state=StaleState.STALE)
    assert not r.find(tenant_id="t1", stale_state=StaleState.VALID)


def test_mark_stale_cross_tenant_rejected():
    r = _reg(_m("v1", tenant="t1"))
    with pytest.raises(RegistryError):
        r.mark_stale("v1", ["x"], tenant_id="t2")


def test_no_approval_mutation_surface():
    # the registry has no approve/promote method — approval lives in the canonical
    # systems; the registry only records what the manifest carries (rule 9 / §8).
    r = InMemoryRegistry()
    assert not hasattr(r, "approve")
    assert not hasattr(r, "promote")
    # a trusted manifest must already carry approval_refs to even validate/register
    trusted = _m("v1", trust_status=TrustStatus.TRUSTED, approval_refs=["ai_suggestions:7"])
    r.register(trusted)
    assert r.get("v1", tenant_id="t1").approval_refs == ["ai_suggestions:7"]


def test_cost_summary_rolls_up():
    r = _reg(_m("v1", provider_cost_usd=0.01, compute_time_ms=100),
             _m("v2", provider_cost_usd=0.02, compute_time_ms=250))
    s = r.cost_summary(tenant_id="t1")
    assert s["datasets"] == 2 and s["provider_cost_usd"] == 0.03 and s["compute_time_ms"] == 350

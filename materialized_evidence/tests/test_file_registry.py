"""Durable JSON-snapshot registry (PR G).

The whole point of PR G is cross-run recall: the hermetic ``InMemoryRegistry``
dies with the process, so a durable backend must persist on write and hydrate on
construction. A "fresh" ``FileRegistry`` over the same snapshot models exactly
what the next process does.
"""

from __future__ import annotations

import pytest

from materialized_evidence import (
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    RecallOutcome,
    RecallQuery,
    StaleState,
    resolve_recall,
    with_hashes,
)
from materialized_evidence.backends import FileRegistry
from materialized_evidence.registry import RegistryError


def _manifest(
    dvid: str, *, tenant: str = "t1", sources: tuple[str, ...] = ("sha_a",)
) -> EvidenceManifest:
    rec = EvidenceRecord(
        record_id=f"rec:{dvid}", dataset_id="ds", source_locator="p", payload={"dvid": dvid}
    )
    m = EvidenceManifest(
        dataset_id="ds",
        dataset_version_id=dvid,
        dataset_type=DatasetType.OCR,
        schema_name="S",
        schema_version="1",
        tenant_id=tenant,
        environment=Environment.DEV,
        source_hashes=list(sources),
    )
    return with_hashes(m, [rec])


def test_register_survives_a_fresh_instance(tmp_path):
    snap = tmp_path / "reg.json"
    m = _manifest("ds@1")
    FileRegistry(snap).register(m)
    fresh = FileRegistry(snap)  # a new process would do exactly this
    assert fresh.get("ds@1", tenant_id="t1") == m
    assert fresh.find(tenant_id="t1", dataset_type=DatasetType.OCR) == [m]


def test_mark_stale_persists(tmp_path):
    snap = tmp_path / "reg.json"
    r1 = FileRegistry(snap)
    r1.register(_manifest("ds@1"))
    r1.mark_stale("ds@1", ["upstream changed"], tenant_id="t1", trigger="x")
    assert FileRegistry(snap).effective_stale_state("ds@1", tenant_id="t1") == StaleState.STALE


def test_resolve_recall_reuses_across_instances(tmp_path):
    snap = tmp_path / "reg.json"
    FileRegistry(snap).register(_manifest("ds@1", sources=("sha_a",)))
    # a fresh registry (i.e. a fresh process) still recalls it EXACT
    q = RecallQuery(
        tenant_id="t1",
        dataset_type=DatasetType.OCR,
        source_hashes=["sha_a"],
        required_schema=("S", "1"),
        environment=Environment.DEV,
    )
    res = resolve_recall(q, FileRegistry(snap))
    assert res.outcome == RecallOutcome.EXACT
    assert res.selected_versions == ["ds@1"]


def test_absent_snapshot_is_an_empty_registry(tmp_path):
    r = FileRegistry(tmp_path / "does_not_exist.json")
    assert r.find(tenant_id="t1") == []


def test_tenant_isolation_survives_persistence(tmp_path):
    snap = tmp_path / "reg.json"
    r = FileRegistry(snap)
    r.register(_manifest("ds@1", tenant="t1"))
    assert FileRegistry(snap).get("ds@1", tenant_id="t2") is None


def test_immutable_version_conflict_still_enforced(tmp_path):
    snap = tmp_path / "reg.json"
    r = FileRegistry(snap)
    r.register(_manifest("ds@1", sources=("sha_a",)))
    with pytest.raises(RegistryError):
        # same dataset_version_id, different content -> different manifest_hash
        r.register(_manifest("ds@1", sources=("sha_DIFFERENT",)))

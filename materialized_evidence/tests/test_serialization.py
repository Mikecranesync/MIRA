"""Round-trip (de)serialization for the durable file registry backend (PR G).

A manifest/overlay must survive ``to_dict`` -> ``from_dict`` unchanged so a
JSON-snapshot registry hydrates to exactly what it persisted. The fiddly part is
enum + tuple coercion (``to_dict`` flattens enums to ``.value`` strings and the
``time_range`` tuple to a list; ``from_dict`` must restore them)."""

from __future__ import annotations

from materialized_evidence import (
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    StageStatus,
    StaleState,
    TrustStatus,
    with_hashes,
)
from materialized_evidence.backends.serialization import (
    manifest_from_dict,
    overlay_from_dict,
    overlay_to_dict,
)
from materialized_evidence.registry import StatusOverlay


def _hashed_manifest() -> EvidenceManifest:
    rec = EvidenceRecord(
        record_id="r1",
        dataset_id="ds1",
        source_locator="page:abc",
        payload={"devices": [{"tag": "-3/F1"}]},
    )
    m = EvidenceManifest(
        dataset_id="ds1",
        dataset_version_id="ds1@v1",
        dataset_type=DatasetType.OCR,
        schema_name="PrintSynthGraph",
        schema_version="abc123",
        tenant_id="t1",
        environment=Environment.DEV,
        source_hashes=["sha_a", "sha_b"],
        time_range=("2026-01-01T00:00:00Z", "2026-01-02T00:00:00Z"),
        stage_status=StageStatus.COMPLETE,
        trust_status=TrustStatus.CANDIDATE,
        approval_status=ApprovalStatus.PENDING,
        stale_state=StaleState.VALID,
        provider_cost_usd=0.36,
        compute_time_ms=41230,
    )
    return with_hashes(m, [rec])


def test_manifest_round_trips_through_dict():
    m = _hashed_manifest()
    m2 = manifest_from_dict(m.to_dict())
    assert m2 == m


def test_manifest_from_dict_coerces_enums_and_tuple():
    m2 = manifest_from_dict(_hashed_manifest().to_dict())
    assert isinstance(m2.dataset_type, DatasetType)
    assert isinstance(m2.environment, Environment)
    assert isinstance(m2.stage_status, StageStatus)
    assert isinstance(m2.trust_status, TrustStatus)
    assert isinstance(m2.approval_status, ApprovalStatus)
    assert isinstance(m2.stale_state, StaleState)
    assert isinstance(m2.time_range, tuple)


def test_manifest_from_dict_ignores_unknown_keys():
    d = _hashed_manifest().to_dict()
    d["some_future_field"] = "ignored"
    m2 = manifest_from_dict(d)  # must not raise
    assert m2.dataset_id == "ds1"


def test_overlay_round_trips():
    ov = StatusOverlay(
        dataset_version_id="ds1@v1",
        stale_state=StaleState.STALE,
        stale_reasons=["upstream changed"],
        trigger="src-change",
        propagation="direct",
    )
    ov2 = overlay_from_dict(overlay_to_dict(ov))
    assert ov2 == ov
    assert isinstance(ov2.stale_state, StaleState)

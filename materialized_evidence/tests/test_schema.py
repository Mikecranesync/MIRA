"""Contract tests for the Materialized Evidence typed layer (PR C).

Covers PRD §21.2 materialization guarantees at the contract level: manifests
round-trip, hashes are stable + content-addressed, identical output deduplicates,
stamping hashes is idempotent, and the validator has teeth (inference lineage +
no self-promotion). Pure/offline — no network, no I/O.
"""
from __future__ import annotations

import dataclasses

from materialized_evidence import (
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    RecallOutcome,
    RecallResult,
    RecomputeDecision,
    TrustStatus,
    content_hash,
    manifest_hash,
    validate_manifest,
    with_hashes,
)


def _manifest(**over) -> EvidenceManifest:
    base = dict(
        dataset_id="ds.printsense.ocr.pkgA",
        dataset_version_id="v1",
        dataset_type=DatasetType.OCR,
        schema_name="ocr_tokens",
        schema_version="1.0",
        tenant_id="tenant-1",
        environment=Environment.DEV,
        producer_name="vision_worker",
        producer_version="3.178.1",
    )
    base.update(over)
    return EvidenceManifest(**base)


def _records() -> list[EvidenceRecord]:
    return [
        EvidenceRecord("r2", "ds", "page:2", {"text": "CE10"}, producer="tesseract"),
        EvidenceRecord("r1", "ds", "page:1", {"text": "GFF"}, producer="tesseract"),
    ]


def test_manifest_round_trips_and_enums_serialize():
    m = _manifest()
    d = m.to_dict()
    assert d["dataset_type"] == "OCREvidence"  # enum -> value
    assert d["environment"] == "dev"
    assert d["trust_status"] == "candidate"
    # dict is JSON-safe (only primitives / lists / dicts)
    assert isinstance(d["source_objects"], list)


def test_content_hash_is_order_independent_dedup():
    recs = _records()
    h1 = content_hash(recs)
    h2 = content_hash(list(reversed(recs)))
    assert h1 == h2  # identical output deduplicates regardless of order


def test_content_hash_changes_with_payload():
    recs = _records()
    changed = [dataclasses.replace(recs[0], payload={"text": "DIFFERENT"}), recs[1]]
    assert content_hash(recs) != content_hash(changed)


def test_with_hashes_is_idempotent():
    m = _manifest()
    recs = _records()
    once = with_hashes(m, recs)
    twice = with_hashes(once, recs)
    assert once.content_hash and once.manifest_hash
    assert once == twice  # stamping hashes onto an already-stamped manifest is a no-op
    assert once.record_count == 2


def test_manifest_hash_excludes_hash_fields():
    m = with_hashes(_manifest(), _records())
    # recomputing the manifest hash on the stamped manifest yields the stored one
    assert manifest_hash(m) == m.manifest_hash
    # a producer-version change DOES change the manifest hash (lineage matters)
    changed = dataclasses.replace(m, producer_version="9.9.9")
    assert manifest_hash(changed) != m.manifest_hash


def test_validator_accepts_valid_manifest():
    assert validate_manifest(_manifest()) == []


def test_validator_requires_inference_lineage():
    m = _manifest(model_provider="together")  # no model_id / prompt_contract_version
    problems = validate_manifest(m)
    assert any("inference lineage" in p for p in problems)


def test_validator_forbids_self_promotion_to_trusted():
    m = _manifest(trust_status=TrustStatus.TRUSTED)  # no approval_refs
    problems = validate_manifest(m)
    assert any("no self-promotion" in p for p in problems)
    # with an approval ref it passes
    ok = _manifest(trust_status=TrustStatus.TRUSTED, approval_refs=["ai_suggestions:42"])
    assert validate_manifest(ok) == []


def test_validator_requires_missing_fields():
    m = _manifest(tenant_id="")
    assert any("tenant_id" in p for p in validate_manifest(m))


def test_recall_result_is_explicit():
    r = RecallResult(outcome=RecallOutcome.NONE, reason="no compatible OCR for source hash",
                     recompute_decision=RecomputeDecision.RECOMPUTED_MISSING_OUTPUT)
    d = r.to_dict()
    assert d["outcome"] == "none" and d["recompute_decision"] == "recomputed_missing_output"


def test_approved_requires_approval_ref():
    m = _manifest(approval_status=ApprovalStatus.APPROVED)
    assert any("approval_refs" in p for p in validate_manifest(m))

"""Canonical model validation tests."""

from __future__ import annotations

from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalRelationship,
    EvidenceRef,
)


def _good_evidence() -> EvidenceRef:
    return EvidenceRef(
        evidence_type="work_order",
        source_description="WO 1048817",
        page_or_location="WONUM 1048817",
        confidence_contribution=0.6,
    )


def test_asset_base_validate_ok():
    a = CanonicalAsset(source_system="maximo", source_record_id="VFD-16-1", name="VFD", confidence=0.6)
    assert a.base_validate() == []


def test_asset_bad_confidence_flagged():
    a = CanonicalAsset(source_system="maximo", source_record_id="X", name="X", confidence=1.5)
    assert any("confidence" in e for e in a.base_validate())


def test_asset_missing_source_id_flagged():
    a = CanonicalAsset(source_system="maximo", source_record_id="", name="X")
    assert any("source_record_id" in e for e in a.base_validate())


def test_relationship_valid():
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1",
        relationship_type="OCCURS_ON", source_ref="VFD", target_ref="CONV16",
        evidence=[_good_evidence()],
    )
    assert rel.validate() == []


def test_relationship_self_loop_rejected():
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1",
        relationship_type="WIRED_TO", source_ref="A", target_ref="A",
        evidence=[_good_evidence()],
    )
    assert any("self-loop" in e for e in rel.validate())


def test_relationship_unknown_type_rejected():
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1",
        relationship_type="FROBNICATES", source_ref="A", target_ref="B",
        evidence=[_good_evidence()],
    )
    assert any("relationship_type" in e for e in rel.validate())


def test_relationship_without_evidence_rejected():
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1",
        relationship_type="OCCURS_ON", source_ref="A", target_ref="B",
        evidence=[],
    )
    assert any("no evidence" in e for e in rel.validate())


def test_evidence_bad_type_and_contribution():
    ev = EvidenceRef(evidence_type="telepathy", source_description="x", confidence_contribution=2.0)
    errs = ev.validate()
    assert any("evidence_type" in e for e in errs)
    assert any("confidence_contribution" in e for e in errs)

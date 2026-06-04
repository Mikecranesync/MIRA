"""Canonical-model invariants: proposed-by-default, payload preservation,
content hashing, governed vocabulary, and the validation report."""

from __future__ import annotations

import pytest

from canonical import (
    APPROVAL_PROPOSED,
    CanonicalEntity,
    CanonicalRelationship,
    NormalizedGraph,
    Proposal,
    SourceObject,
    ValidationReport,
    confidence_band,
    content_hash,
)


def test_entity_defaults_to_proposed():
    e = CanonicalEntity(entity_type="asset", name="A-1")
    assert e.approval_state == APPROVAL_PROPOSED
    assert e.key == "asset:A-1"


def test_relationship_defaults_to_proposed():
    r = CanonicalRelationship("asset:A", "component:B", "HAS_COMPONENT")
    assert r.approval_state == APPROVAL_PROPOSED


def test_unknown_entity_type_rejected():
    with pytest.raises(ValueError):
        CanonicalEntity(entity_type="gadget", name="x")


def test_unknown_relationship_type_rejected():
    with pytest.raises(ValueError):
        CanonicalRelationship("a", "b", "FROBS")


def test_unknown_suggestion_type_rejected():
    with pytest.raises(ValueError):
        Proposal(suggestion_type="nonsense", title="t", body="b")


def test_proposal_confidence_bounds():
    with pytest.raises(ValueError):
        Proposal(suggestion_type="kg_edge", title="t", body="b", confidence=1.5)


def test_content_hash_stable_and_order_independent():
    a = {"x": 1, "y": 2}
    b = {"y": 2, "x": 1}
    assert content_hash(a) == content_hash(b)
    assert content_hash({"x": 1}) != content_hash({"x": 2})


def test_source_object_autocomputes_hash():
    so = SourceObject("maximo", "asset", "A-1", {"ASSETNUM": "A-1"}, "0.1.0")
    assert so.content_hash and len(so.content_hash) == 64


def test_entity_autocomputes_hash_from_payload():
    e = CanonicalEntity(entity_type="asset", name="A-1", source_payload={"ASSETNUM": "A-1"})
    assert e.content_hash


def test_confidence_bands():
    assert confidence_band(0.4) == "low"
    assert confidence_band(0.5) == "medium"
    assert confidence_band(0.8) == "medium"
    assert confidence_band(0.81) == "high"


def test_graph_add_entity_upserts_by_key():
    g = NormalizedGraph()
    g.add_entity(
        CanonicalEntity(entity_type="asset", name="A", confidence=0.5, properties={"a": 1})
    )
    g.add_entity(
        CanonicalEntity(entity_type="asset", name="A", confidence=0.9, properties={"b": 2})
    )
    assert len(g.entities) == 1
    merged = g.get("asset:A")
    assert merged.properties == {"a": 1, "b": 2}
    assert merged.confidence == 0.9  # max kept


def test_validation_report_ok_and_buckets():
    rep = ValidationReport()
    assert rep.ok
    rep.add("warning", "w", "a warning")
    assert rep.ok and len(rep.warnings) == 1
    rep.add("error", "e", "an error")
    assert not rep.ok and len(rep.errors) == 1

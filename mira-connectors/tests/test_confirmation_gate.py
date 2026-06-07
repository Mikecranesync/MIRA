"""Technician confirmation gate — propose → confirm / correct / reject lifecycle.

Uses the in-memory store (no DB) and the real MaximoMockConnector for end-to-end realism.
Asserts the ADR-0017 status mapping and the kg_relationships materialization that mirrors
the Hub /api/proposals/[id]/decide route.
"""

from __future__ import annotations

import pytest

from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalRelationship,
    EvidenceRef,
    RecordType,
)
from mira_connectors.confirmation_gate import ConnectorConfirmationGate
from mira_connectors.mocks import MaximoMockConnector
from mira_connectors.store import InMemoryProposalStore

TENANT = "00000000-0000-0000-0000-0000000000aa"


@pytest.fixture
def store() -> InMemoryProposalStore:
    return InMemoryProposalStore()


@pytest.fixture
def gate(store: InMemoryProposalStore) -> ConnectorConfirmationGate:
    return ConnectorConfirmationGate(store)


def _asset(record_id: str, uns_path: str, *, serial: str | None = None) -> CanonicalAsset:
    return CanonicalAsset(
        source_system="maximo", source_record_id=record_id, name=record_id,
        manufacturer="ACME", model="M1", serial=serial, proposed_uns_path=uns_path, confidence=0.6,
    )


# ── propose / confirm entities ──────────────────────────────────────────────


def test_propose_entities_creates_pending_suggestions(gate, store):
    res = gate.propose(tenant_id=TENANT, provider="maximo", entities=[_asset("VFD-16-1", "enterprise.a.b.vfd")])
    assert len(res.entity_suggestion_ids) == 1
    sug = store.get_suggestion(TENANT, res.entity_suggestion_ids[0])
    assert sug.suggestion_type == "kg_entity"
    assert sug.status == "pending"
    assert sug.proposed_by == "import:maximo"
    assert sug.extracted_data["confidence_prior"] == 0.6


def test_confirm_entity_materializes_kg_entity(gate, store):
    res = gate.propose(tenant_id=TENANT, provider="maximo", entities=[_asset("VFD-16-1", "enterprise.a.b.vfd")])
    sid = res.entity_suggestion_ids[0]
    out = gate.confirm(TENANT, sid, reviewed_by="user_42")
    assert out.ok and out.entity_id
    assert store.entities[out.entity_id].approval_state == "verified"
    sug = store.get_suggestion(TENANT, sid)
    assert sug.status == "accepted"
    assert sug.reviewed_by == "human:user_42"
    # confidence_prior is preserved (never overwritten by confirmation)
    assert sug.extracted_data["confidence_prior"] == 0.6
    # the confirmed entity is now resolvable by its natural key (for edges)
    assert store.resolve_entity(TENANT, "VFD-16-1", "asset") == out.entity_id


# ── propose / confirm relationships (endpoints already resolve) ──────────────


def test_propose_edge_with_resolved_endpoints(gate, store):
    store.register_entity_key(TENANT, "asset", "CONV16", "ent-conv")
    store.register_entity_key(TENANT, "asset", "VFD-16-1", "ent-vfd")
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1", relationship_type="HAS_COMPONENT",
        source_ref="CONV16", source_ref_kind="asset", target_ref="VFD-16-1", target_ref_kind="asset",
        confidence=0.7, evidence=[EvidenceRef("manifest", "PARENT link", confidence_contribution=0.8)],
    )
    res = gate.propose(tenant_id=TENANT, provider="maximo", relationships=[rel])
    sug = store.get_suggestion(TENANT, res.edge_suggestion_ids[0])
    pid = sug.extracted_data["relationship_proposal_id"]
    prop = store.get_proposal(pid)
    assert prop.status == "proposed"
    assert prop.created_by == "import"
    assert prop.source_entity_id == "ent-conv"
    # evidence row created from the connector's evidence
    assert any(e.proposal_id == pid for e in store.evidence.values())


def test_confirm_edge_materializes_kg_relationship(gate, store):
    store.register_entity_key(TENANT, "asset", "CONV16", "ent-conv")
    store.register_entity_key(TENANT, "asset", "VFD-16-1", "ent-vfd")
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1", relationship_type="HAS_COMPONENT",
        source_ref="CONV16", source_ref_kind="asset", target_ref="VFD-16-1", target_ref_kind="asset",
        confidence=0.7, evidence=[EvidenceRef("manifest", "PARENT link", confidence_contribution=0.8)],
    )
    sid = gate.propose(tenant_id=TENANT, provider="maximo", relationships=[rel]).edge_suggestion_ids[0]
    out = gate.confirm(TENANT, sid, reviewed_by="tech_7", note="confirmed on the floor")
    assert out.ok and out.kg_relationship_id
    # proposal → verified
    pid = out.relationship_proposal_id
    assert store.get_proposal(pid).status == "verified"
    # kg_relationships row written (mirrors decide route)
    kg = store.relationships[out.kg_relationship_id]
    assert kg.approval_state == "verified"
    assert (kg.source_id, kg.target_id, kg.relationship_type) == ("ent-conv", "ent-vfd", "HAS_COMPONENT")
    # human_observation evidence row records "confidence after confirmation"
    human_ev = [e for e in store.evidence.values() if e.evidence_type == "human_observation"]
    assert len(human_ev) == 1
    assert human_ev[0].confidence_contribution > 0
    assert store.get_suggestion(TENANT, sid).status == "accepted"


def test_confirm_edge_dedupes_kg_relationship(gate, store):
    store.register_entity_key(TENANT, "asset", "CONV16", "ent-conv")
    store.register_entity_key(TENANT, "asset", "VFD-16-1", "ent-vfd")

    def mkrel():
        return CanonicalRelationship(
            source_system="maximo", source_record_id="r", relationship_type="HAS_COMPONENT",
            source_ref="CONV16", source_ref_kind="asset", target_ref="VFD-16-1", target_ref_kind="asset",
            confidence=0.7, evidence=[EvidenceRef("manifest", "x", confidence_contribution=0.5)],
        )

    s1 = gate.propose(tenant_id=TENANT, provider="maximo", relationships=[mkrel()]).edge_suggestion_ids[0]
    s2 = gate.propose(tenant_id=TENANT, provider="maximo", relationships=[mkrel()]).edge_suggestion_ids[0]
    r1 = gate.confirm(TENANT, s1, reviewed_by="t")
    r2 = gate.confirm(TENANT, s2, reviewed_by="t")
    # same edge identity → one kg_relationships row
    assert r1.kg_relationship_id == r2.kg_relationship_id
    assert len(store.relationships) == 1


# ── unresolved-then-resolved edge ────────────────────────────────────────────


def test_edge_unresolved_at_propose_then_resolves_after_entity_confirm(gate, store):
    # Propose the asset entities AND the edge in one go (entities not yet confirmed).
    conv = _asset("CONV16", "enterprise.a.b.conv16")
    vfd = _asset("VFD-16-1", "enterprise.a.b.conv16.vfd")
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1", relationship_type="HAS_COMPONENT",
        source_ref="CONV16", source_ref_kind="asset", target_ref="VFD-16-1", target_ref_kind="asset",
        confidence=0.7, evidence=[EvidenceRef("manifest", "PARENT", confidence_contribution=0.8)],
    )
    res = gate.propose(tenant_id=TENANT, provider="maximo", entities=[conv, vfd], relationships=[rel])
    edge_sid = res.edge_suggestion_ids[0]
    assert store.get_suggestion(TENANT, edge_sid).extracted_data.get("needs_resolution") is True

    # Confirming the edge now fails — endpoints not confirmed yet.
    early = gate.confirm(TENANT, edge_sid, reviewed_by="t")
    assert not early.ok and early.reason == "endpoints_unresolved"

    # Confirm both entities, then the edge resolves + materializes.
    for esid in res.entity_suggestion_ids:
        assert gate.confirm(TENANT, esid, reviewed_by="t").ok
    late = gate.confirm(TENANT, edge_sid, reviewed_by="t")
    assert late.ok and late.kg_relationship_id
    assert store.get_proposal(late.relationship_proposal_id).status == "verified"


# ── correct ──────────────────────────────────────────────────────────────────


def test_correct_supersedes_original_and_confirms_new(gate, store):
    # Tech says "it's TB2-15, not TB2-14".
    store.register_entity_key(TENANT, "asset", "PE-B16-2", "ent-pe")
    store.register_entity_key(TENANT, "tag", "TB2-14", "ent-tb14")
    store.register_entity_key(TENANT, "tag", "TB2-15", "ent-tb15")
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1", relationship_type="WIRED_TO",
        source_ref="PE-B16-2", source_ref_kind="asset", target_ref="TB2-14", target_ref_kind="tag",
        confidence=0.6, evidence=[EvidenceRef("technician_note", "photo crop", confidence_contribution=0.5)],
    )
    sid = gate.propose(tenant_id=TENANT, provider="maximo", relationships=[rel]).edge_suggestion_ids[0]
    old_pid = store.get_suggestion(TENANT, sid).extracted_data["relationship_proposal_id"]

    out = gate.correct(
        TENANT, sid, reviewed_by="tech_7",
        corrections={"target_ref": "TB2-15"}, note="actually TB2-15",
    )
    assert out.ok
    # original superseded (preserved, not deleted) + its proposal deprecated
    assert store.get_suggestion(TENANT, sid).status == "superseded"
    assert store.get_proposal(old_pid).status == "deprecated"
    # the corrected, confirmed edge points at TB2-15
    kg = store.relationships[out.confirm.kg_relationship_id]
    assert kg.target_id == "ent-tb15"
    new_sug = store.get_suggestion(TENANT, out.new_suggestion_id)
    assert new_sug.status == "accepted"
    assert new_sug.extracted_data["corrected_from"] == sid


# ── reject ─────────────────────────────────────────────────────────────────


def test_reject_marks_rejected_no_graph_write(gate, store):
    store.register_entity_key(TENANT, "asset", "CONV16", "ent-conv")
    store.register_entity_key(TENANT, "asset", "VFD-16-1", "ent-vfd")
    rel = CanonicalRelationship(
        source_system="maximo", source_record_id="r1", relationship_type="HAS_COMPONENT",
        source_ref="CONV16", source_ref_kind="asset", target_ref="VFD-16-1", target_ref_kind="asset",
        confidence=0.7, evidence=[EvidenceRef("manifest", "x", confidence_contribution=0.5)],
    )
    sid = gate.propose(tenant_id=TENANT, provider="maximo", relationships=[rel]).edge_suggestion_ids[0]
    pid = store.get_suggestion(TENANT, sid).extracted_data["relationship_proposal_id"]
    out = gate.reject(TENANT, sid, reviewed_by="tech_7", note="not real")
    assert out.ok
    assert store.get_suggestion(TENANT, sid).status == "rejected"
    assert store.get_proposal(pid).status == "rejected"
    assert len(store.relationships) == 0  # no graph write


# ── conflicts ────────────────────────────────────────────────────────────────


def test_conflicting_mappings_preserved_for_review(gate, store):
    # Two systems describe the same physical device (same serial) at different UNS paths.
    a = _asset("MX-VFD", "enterprise.bedford.line16.vfd", serial="SN-999")
    b = _asset("IGN-VFD", "enterprise.bedford.packaging.vfd", serial="SN-999")
    res = gate.propose(tenant_id=TENANT, provider="maximo", entities=[a, b])
    assert len(res.conflict_groups) == 1
    assert set(res.conflict_groups[0]) == set(res.entity_suggestion_ids)
    # both preserved as pending (not auto-rejected) with a shared conflict_group marker
    pend = gate.pending(TENANT, suggestion_type="kg_entity")
    assert len(pend) == 2
    groups = {s.extracted_data.get("conflict_group") for s in pend}
    assert len(groups) == 1 and None not in groups


def test_no_conflict_when_same_path(gate, store):
    a = _asset("MX-VFD", "enterprise.bedford.line16.vfd", serial="SN-1")
    b = _asset("IGN-VFD", "enterprise.bedford.line16.vfd", serial="SN-1")  # same path
    res = gate.propose(tenant_id=TENANT, provider="maximo", entities=[a, b])
    assert res.conflict_groups == []


# ── guards ───────────────────────────────────────────────────────────────────


def test_confirm_not_found(gate):
    assert gate.confirm(TENANT, "nope", reviewed_by="t").reason == "not_found"


def test_confirm_wrong_state(gate, store):
    sid = gate.propose(tenant_id=TENANT, provider="maximo", entities=[_asset("A", "enterprise.a")]).entity_suggestion_ids[0]
    assert gate.confirm(TENANT, sid, reviewed_by="t").ok
    second = gate.confirm(TENANT, sid, reviewed_by="t")
    assert not second.ok and second.reason.startswith("wrong_state")


def test_tenant_isolation(gate, store):
    sid = gate.propose(tenant_id=TENANT, provider="maximo", entities=[_asset("A", "enterprise.a")]).entity_suggestion_ids[0]
    assert gate.confirm("11111111-1111-1111-1111-111111111111", sid, reviewed_by="t").reason == "not_found"


# ── end-to-end with the real Maximo mock ─────────────────────────────────────


async def test_end_to_end_maximo_import_to_graph(gate, store, ro_config):
    conn = MaximoMockConnector(ro_config)
    # Import + normalize assets and documents; derive edges.
    records = []
    for rt in (RecordType.ASSET, RecordType.DOCUMENT, RecordType.WORK_ORDER):
        records.extend(conn.normalize(await conn.import_records(rt)))
    rels = conn.derive_relationships(records)
    entities = [r for r in records if r.record_type in (RecordType.ASSET, RecordType.DOCUMENT)]

    res = gate.propose(tenant_id=TENANT, provider="maximo", entities=entities, relationships=rels)
    assert res.entity_suggestion_ids
    assert res.edge_suggestion_ids

    # Confirm every entity suggestion → entities become resolvable.
    for esid in res.entity_suggestion_ids:
        assert gate.confirm(TENANT, esid, reviewed_by="tech").ok

    # Now confirm edges whose endpoints resolved (HAS_COMPONENT, HAS_DOCUMENT). LOCATED_IN
    # targets a location entity we didn't import here, so some stay unresolved — that's fine.
    confirmed_edges = 0
    for sid in res.edge_suggestion_ids:
        out = gate.confirm(TENANT, sid, reviewed_by="tech")
        if out.ok:
            confirmed_edges += 1
    assert confirmed_edges >= 1
    # at least one verified kg_relationship landed in the graph
    assert any(r.approval_state == "verified" for r in store.relationships.values())

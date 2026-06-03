"""Service layer — import_and_propose wires a connector to the gate in one call."""

from __future__ import annotations

from mira_connectors.canonical import RecordType
from mira_connectors.confirmation_gate import ConnectorConfirmationGate
from mira_connectors.mocks import IgnitionMockConnector, MaximoMockConnector
from mira_connectors.service import import_and_propose
from mira_connectors.store import InMemoryProposalStore


async def test_import_and_propose_maximo(ro_config):
    gate = ConnectorConfirmationGate(InMemoryProposalStore())
    conn = MaximoMockConnector(ro_config)
    res = await import_and_propose(
        conn, gate,
        record_types=[RecordType.ASSET, RecordType.DOCUMENT, RecordType.WORK_ORDER],
        tenant_id="00000000-0000-0000-0000-0000000000aa",
    )
    assert res.provider == "maximo"
    assert len(res.sync_results) == 3
    assert all(s.ok for s in res.sync_results)
    # assets + documents become entity suggestions; work orders do not (evidence only)
    assert res.propose.entity_suggestion_ids
    assert res.propose.edge_suggestion_ids
    # everything proposed is pending — nothing auto-written to the graph
    pending = gate.pending("00000000-0000-0000-0000-0000000000aa")
    assert len(pending) == len(res.propose.entity_suggestion_ids) + len(res.propose.edge_suggestion_ids)


async def test_import_and_propose_ignition_tags(ro_config):
    store = InMemoryProposalStore()
    gate = ConnectorConfirmationGate(store)
    conn = IgnitionMockConnector(ro_config)
    res = await import_and_propose(
        conn, gate, record_types=[RecordType.TAG],
        tenant_id="00000000-0000-0000-0000-0000000000aa",
    )
    # 11 tags → 11 kg_entity (tag) suggestions
    assert len(res.propose.entity_suggestion_ids) == 11
    # HAS_SIGNAL + LOCATED_IN edges proposed
    assert res.propose.edge_suggestion_ids
    assert res.relationship_count > 0

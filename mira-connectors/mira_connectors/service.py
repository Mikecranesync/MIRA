"""Service layer wiring a connector to the confirmation gate.

This is the "service function" deliverable for Phase 6: one call runs a connector's
import → normalize → derive_relationships lifecycle and routes the results through the
``ConnectorConfirmationGate`` as pending proposals. An HTTP route (FastAPI / Hub API)
is a thin async wrapper over ``import_and_propose``; the confirm/correct/reject endpoints
map 1:1 onto the gate methods.

Read-only by default at every layer: importing + proposing never mutates the source and
never writes the knowledge graph. Only a technician's ``gate.confirm()`` does.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from mira_connectors.base import Connector, SyncResult
from mira_connectors.canonical import CanonicalRecord, CanonicalRelationship, RecordType
from mira_connectors.confirmation_gate import ConnectorConfirmationGate, ProposeResult

# Record types that become knowledge-graph *entities* (nodes). Work orders, PM tasks, and
# meters are CMMS data that serve as *evidence*, not graph nodes, so they are not proposed
# as kg_entity suggestions here.
_ENTITY_RECORD_TYPES = {
    RecordType.ASSET,
    RecordType.LOCATION,
    RecordType.TAG,
    RecordType.DOCUMENT,
    RecordType.FAILURE_CODE,
    RecordType.PART,
}


@dataclass
class ImportProposeResult:
    provider: str
    sync_results: list[SyncResult] = field(default_factory=list)
    propose: Optional[ProposeResult] = None
    record_count: int = 0
    relationship_count: int = 0


async def import_and_propose(
    connector: Connector,
    gate: ConnectorConfirmationGate,
    *,
    record_types: list[RecordType],
    tenant_id: Optional[str] = None,
    limit: int = 500,
) -> ImportProposeResult:
    """Import the given record types from ``connector`` and route them through ``gate``.

    Returns the per-type sync logs and the resulting proposal ids. Does not confirm
    anything — every mapping lands as a pending ``ai_suggestions`` row for a technician.
    """
    tenant = tenant_id or connector.config.tenant_id
    out = ImportProposeResult(provider=connector.provider)

    all_records: list[CanonicalRecord] = []
    for rt in record_types:
        records, sync = await connector.sync(rt, limit=limit)  # type: ignore[attr-defined]
        out.sync_results.append(sync)
        all_records.extend(records)

    relationships: list[CanonicalRelationship] = connector.derive_relationships(all_records)  # type: ignore[attr-defined]
    entities = [r for r in all_records if r.record_type in _ENTITY_RECORD_TYPES]

    out.record_count = len(all_records)
    out.relationship_count = len(relationships)
    out.propose = gate.propose(
        tenant_id=tenant,
        provider=connector.provider,
        entities=entities,
        relationships=relationships,
    )
    return out

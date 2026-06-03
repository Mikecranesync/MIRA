"""SCADA connector type base (Ignition and other SCADA).

Extends the existing Ignition integration (``mira-pipeline/ignition_chat.py``,
``mira-relay/relay_server.py`` tag streaming) conceptually: a SCADA connector
*discovers a tag tree* and *imports tag definitions / live values*, normalizing them
into ``CanonicalTag`` rows that map to ``tag_entities``.

READ-ONLY BY CONSTRUCTION. Per ``.claude/rules/fieldbus-readonly.md``, ADR-0021, and
the Ignition-is-the-read-path rule, no customer-shipped MIRA surface writes to the
plant. ``export_records`` refuses regardless of ``ConnectorConfig.mode`` — a SCADA
connector physically cannot push values to the controller. Enrichment (UNS path,
component links) flows the other way: into MIRA's graph via the confirmation gate.
"""

from __future__ import annotations

from mira_connectors.base import BaseConnector, ConnectorKind, ExportResult
from mira_connectors.canonical import CanonicalRecord, RecordType

SCADA_RECORD_TYPES = [RecordType.TAG, RecordType.ASSET, RecordType.LOCATION]


class SCADAConnector(BaseConnector):
    """Base for SCADA connectors. Plant-facing → read-only by construction."""

    kind = ConnectorKind.SCADA

    async def export_records(self, enriched: list[CanonicalRecord]) -> ExportResult:
        # Doctrine override: never write to the plant, even in READ_WRITE mode.
        return ExportResult(
            refused=len(enriched),
            errors=[
                "SCADA connectors are read-only by construction — MIRA does not write "
                "to the plant (.claude/rules/fieldbus-readonly.md, ADR-0021)"
            ],
        )

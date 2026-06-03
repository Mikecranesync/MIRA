"""Historian connector type base — NEW type (AVEVA PI / OSIsoft, Canary, etc.).

A historian connector discovers the PI point catalog (or equivalent) and imports point
definitions + summarized history, normalizing into ``CanonicalTag`` (point metadata)
and ``CanonicalMeter`` (rolled-up readings). It does NOT stream raw high-frequency
samples — that firehose belongs to the relay/event-stream layer (master plan Phase 5).
A historian is a *system of record for time-series metadata*; MIRA reads point names,
units, and engineering ranges to enrich the asset graph.

READ-ONLY BY CONSTRUCTION, same doctrine as SCADA — a historian sits on the plant/OT
side. ``export_records`` refuses regardless of mode.
"""

from __future__ import annotations

from mira_connectors.base import BaseConnector, ConnectorKind, ExportResult
from mira_connectors.canonical import CanonicalRecord, RecordType

HISTORIAN_RECORD_TYPES = [RecordType.TAG, RecordType.METER, RecordType.ASSET]


class HistorianConnector(BaseConnector):
    """Base for historian connectors (PI, OSIsoft, Canary). Read-only by construction."""

    kind = ConnectorKind.HISTORIAN

    async def export_records(self, enriched: list[CanonicalRecord]) -> ExportResult:
        return ExportResult(
            refused=len(enriched),
            errors=[
                "Historian connectors are read-only by construction — MIRA does not "
                "write back to the plant historian (.claude/rules/fieldbus-readonly.md)"
            ],
        )

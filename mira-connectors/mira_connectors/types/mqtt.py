"""MQTT / UNS connector type base (MQTT, Sparkplug B).

Extends the existing ``mira-bridge`` / ``mira-relay`` MQTT path conceptually: an MQTT
connector discovers a broker's namespace (Sparkplug B group/edge/device topics, or a
plain UNS topic tree) and imports the namespace structure + last-known values,
normalizing topics into ``CanonicalTag`` and the topic hierarchy into
``CanonicalLocation`` / ``CanonicalAsset`` candidates.

The Sparkplug B namespace IS a UNS identity source (see
``.claude/rules/direct-connection-uns-certified.md``) — so the proposed UNS paths from
this connector are higher-confidence than free-text CMMS location strings.

READ-ONLY BY CONSTRUCTION. Publishing back to the broker (writing tags) is a plant
write and is refused regardless of mode. Subscribing/reading is the only mode.
"""

from __future__ import annotations

from mira_connectors.base import BaseConnector, ConnectorKind, ExportResult
from mira_connectors.canonical import CanonicalRecord, RecordType

MQTT_RECORD_TYPES = [RecordType.TAG, RecordType.LOCATION, RecordType.ASSET]


class MQTTConnector(BaseConnector):
    """Base for MQTT / Sparkplug B / UNS broker connectors. Read-only by construction."""

    kind = ConnectorKind.MQTT

    async def export_records(self, enriched: list[CanonicalRecord]) -> ExportResult:
        return ExportResult(
            refused=len(enriched),
            errors=[
                "MQTT/UNS connectors are read-only by construction — MIRA subscribes, it "
                "does not publish tag writes to the plant broker (ADR-0021)"
            ],
        )

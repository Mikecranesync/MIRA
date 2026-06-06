"""CMMS / EAM connector type base.

Generalizes the existing ``mira-mcp/cmms/base.py:CMMSAdapter`` (Atlas, MaintainX,
Limble, Fiix) into the connector framework. CMMS is one of the two connector types
that *can* write back (work-order create/complete) — but write-back is still gated by
``ConnectorConfig.mode``/``dry_run`` and defaults to read-only.

Concrete CMMS connectors implement the abstract ``Connector`` methods. ``export_records``
write-back, when supported, goes to the CMMS API — NOT to the plant — so it is allowed
under doctrine (unlike SCADA/Historian/MQTT).
"""

from __future__ import annotations

from mira_connectors.base import BaseConnector, ConnectorKind
from mira_connectors.canonical import RecordType

CMMS_RECORD_TYPES = [
    RecordType.LOCATION,
    RecordType.ASSET,
    RecordType.WORK_ORDER,
    RecordType.PM_TASK,
    RecordType.FAILURE_CODE,
    RecordType.METER,
    RecordType.PART,
    RecordType.DOCUMENT,  # doclinks
]


class CMMSConnector(BaseConnector):
    """Base for CMMS / EAM connectors (Maximo, MaintainX, Limble, Fiix, Atlas)."""

    kind = ConnectorKind.CMMS
    # CMMS write-back is permitted (work-order create/complete) — it targets the CMMS
    # API, not the plant — but stays subject to the read-only-by-default mode guard in
    # BaseConnector.export_records. Concrete connectors override _do_export to enable it.

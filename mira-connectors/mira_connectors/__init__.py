"""mira-connectors — generic connector framework for MIRA.

A connector turns an external system (CMMS/EAM, SCADA, Historian, document store,
MQTT/UNS broker) into MIRA's canonical model, then routes proposed asset/component/
location/relationship mappings through the technician confirmation gate so a human
confirms before the knowledge graph changes.

Design + rules: ``docs/mira/connector-framework.md`` and
``docs/mira/technician-confirmation-gate.md``.
"""

from __future__ import annotations

from mira_connectors.base import (
    BaseConnector,
    Connector,
    ConnectorCapabilities,
    ConnectorConfig,
    ConnectorError,
    ConnectorKind,
    ConnectorMode,
    ExportResult,
    SyncResult,
    ValidationIssue,
    ValidationResult,
)
from mira_connectors.canonical import (
    CanonicalAsset,
    CanonicalDocument,
    CanonicalFailureCode,
    CanonicalLocation,
    CanonicalMeter,
    CanonicalPart,
    CanonicalPMTask,
    CanonicalRecord,
    CanonicalRelationship,
    CanonicalTag,
    CanonicalWorkOrder,
    EvidenceRef,
    RawRecord,
    RecordType,
)
from mira_connectors.factory import available_providers, create_connector

__all__ = [
    "BaseConnector",
    "Connector",
    "ConnectorCapabilities",
    "ConnectorConfig",
    "ConnectorError",
    "ConnectorKind",
    "ConnectorMode",
    "ExportResult",
    "SyncResult",
    "ValidationIssue",
    "ValidationResult",
    "CanonicalAsset",
    "CanonicalDocument",
    "CanonicalFailureCode",
    "CanonicalLocation",
    "CanonicalMeter",
    "CanonicalPart",
    "CanonicalPMTask",
    "CanonicalRecord",
    "CanonicalRelationship",
    "CanonicalTag",
    "CanonicalWorkOrder",
    "EvidenceRef",
    "RawRecord",
    "RecordType",
    "available_providers",
    "create_connector",
]

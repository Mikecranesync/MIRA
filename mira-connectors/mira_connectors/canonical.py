"""MIRA canonical data model — the normalized shapes every connector maps into.

A connector's job is to turn a vendor-specific record (a Maximo ``ASSETNUM`` row,
an Ignition tag node, a PI point) into one of the canonical records below. The
canonical record is provider-agnostic and maps onto MIRA's existing Postgres
tables:

| Canonical record        | Target MIRA table(s)                              |
|-------------------------|---------------------------------------------------|
| ``CanonicalAsset``      | ``kg_entities`` / ``installed_component_instances`` / ``cmms_equipment`` |
| ``CanonicalLocation``   | ``kg_entities`` (LOCATED_IN hierarchy)            |
| ``CanonicalTag``        | ``tag_entities``                                  |
| ``CanonicalWorkOrder``  | CMMS work-order store (Atlas ``cmms_*``)          |
| ``CanonicalPMTask``     | ``pm_schedules``                                  |
| ``CanonicalFailureCode``| ``fault_codes``                                   |
| ``CanonicalMeter``      | ``live_signal_cache`` / meter store               |
| ``CanonicalPart``       | parts/inventory store                             |
| ``CanonicalDocument``   | ``knowledge_entries`` / documents                 |
| ``CanonicalRelationship``| ``relationship_proposals`` + ``relationship_evidence`` |

Nothing here writes to those tables — normalization is pure. The Postgres write
goes through the confirmation gate (``confirmation_gate.py``), which routes every
proposed mapping through ``ai_suggestions`` / ``relationship_proposals`` so a human
confirms before the knowledge graph changes (see
``.claude/rules/uns-confirmation-gate.md`` and TOO Invariant #4).

UNS rule: ``proposed_uns_path`` is a *candidate* only. Connectors never mint a final
UNS path — they propose one and let the gate + ``mira-crawler/ingest/uns.py`` builders
canonicalize it. See ``.claude/rules/uns-compliance.md``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional


class RecordType(str, Enum):
    """The kinds of record a connector can import and normalize."""

    ASSET = "asset"
    LOCATION = "location"
    WORK_ORDER = "work_order"
    PM_TASK = "pm_task"
    FAILURE_CODE = "failure_code"
    METER = "meter"
    PART = "part"
    DOCUMENT = "document"
    TAG = "tag"
    RELATIONSHIP = "relationship"


# Relationship types — MUST stay in sync with the CHECK constraint on
# relationship_proposals.relationship_type (mira-hub/db/migrations/018_*.sql) and
# docs/specs/mira-component-intelligence-architecture.md §"Controlled vocabulary".
RELATIONSHIP_TYPES: frozenset[str] = frozenset(
    {
        # Hierarchy
        "HAS_COMPONENT", "INSTANCE_OF", "LOCATED_IN", "HAS_PART",
        # Documentation
        "HAS_DOCUMENT", "HAS_CHUNK", "REFERENCES", "HAS_PROCEDURE",
        # Wiring & power
        "WIRED_TO", "POWERED_BY", "MAPS_TO", "PUBLISHED_AS",
        # Logic & control
        "USED_IN_LOGIC", "TRIGGERS", "CAUSES",
        # Faults & resolution
        "OCCURS_ON", "RESOLVED_BY", "HAS_FAILURE_MODE",
        # Signals
        "HAS_SIGNAL", "HAS_ALIAS",
        # Topology
        "DEPENDS_ON", "UPSTREAM_OF", "DOWNSTREAM_OF", "REPLACES",
        # Evidence meta
        "CONFIRMED_BY", "CONTRADICTED_BY",
    }
)

# Evidence types — MUST stay in sync with relationship_evidence.evidence_type
# CHECK constraint (mira-hub/db/migrations/018_*.sql).
EVIDENCE_TYPES: frozenset[str] = frozenset(
    {
        "document_page", "plc_rung", "tag_list", "work_order",
        "technician_note", "live_data", "manifest", "oem_kb", "human_observation",
    }
)


@dataclass(slots=True)
class RawRecord:
    """A single record exactly as the source system returned it.

    ``fields`` preserves the vendor's native field names (ASSETNUM, WONUM, the
    Ignition tag path, …) so we never lose provenance. Normalization reads from
    here; nothing mutates it.
    """

    source_system: str  # "maximo" | "ignition" | "pi" | ...
    record_type: RecordType
    source_record_id: str  # the vendor's primary key for this row
    fields: dict[str, Any]
    fetched_at: Optional[str] = None  # ISO-8601; None in mock/offline mode


@dataclass(slots=True)
class EvidenceRef:
    """One piece of evidence behind a proposed relationship.

    Maps to a ``relationship_evidence`` row. ``confidence_contribution`` in
    [-1.0, 1.0]; negative means the evidence *contradicts* the proposal.
    """

    evidence_type: str  # one of EVIDENCE_TYPES
    source_description: str
    page_or_location: Optional[str] = None  # "page 42", "Rung 12", "HR:104"
    excerpt: Optional[str] = None
    confidence_contribution: float = 0.0
    source_id: Optional[str] = None  # FK resolved at the gate/store layer

    def validate(self) -> list[str]:
        errs: list[str] = []
        if self.evidence_type not in EVIDENCE_TYPES:
            errs.append(f"unknown evidence_type {self.evidence_type!r}")
        if not (-1.0 <= self.confidence_contribution <= 1.0):
            errs.append("confidence_contribution out of [-1.0, 1.0]")
        return errs


@dataclass(kw_only=True)
class CanonicalRecord:
    """Base for all normalized records.

    ``kw_only=True`` so subclasses can add required fields without the
    "non-default argument follows default argument" dataclass pitfall.
    """

    record_type: RecordType
    source_system: str
    source_record_id: str
    confidence: float = 0.5  # 0..1; the connector's honest calibration
    proposed_uns_path: Optional[str] = None  # candidate only — gate canonicalizes
    raw: dict[str, Any] = field(default_factory=dict)  # original vendor fields

    def base_validate(self) -> list[str]:
        errs: list[str] = []
        if not (0.0 <= self.confidence <= 1.0):
            errs.append("confidence out of [0.0, 1.0]")
        if not self.source_record_id:
            errs.append("missing source_record_id")
        return errs


@dataclass(kw_only=True)
class CanonicalAsset(CanonicalRecord):
    name: str
    manufacturer: Optional[str] = None
    model: Optional[str] = None
    serial: Optional[str] = None
    asset_type: Optional[str] = None
    parent_uns_path: Optional[str] = None
    parent_source_id: Optional[str] = None
    criticality: Optional[str] = None  # low|medium|high|safety_critical
    location_path: Optional[str] = None
    attributes: dict[str, Any] = field(default_factory=dict)
    record_type: RecordType = RecordType.ASSET


@dataclass(kw_only=True)
class CanonicalLocation(CanonicalRecord):
    name: str
    location_type: Optional[str] = None  # site|area|line|cell
    parent_uns_path: Optional[str] = None
    parent_source_id: Optional[str] = None
    record_type: RecordType = RecordType.LOCATION


@dataclass(kw_only=True)
class CanonicalWorkOrder(CanonicalRecord):
    wo_number: str
    title: str
    description: str = ""
    status: Optional[str] = None  # mapped to OPEN|IN_PROGRESS|COMPLETE|...
    work_type: Optional[str] = None  # corrective|preventive|emergency
    priority: Optional[str] = None
    asset_source_id: Optional[str] = None
    asset_uns_path: Optional[str] = None
    failure_code: Optional[str] = None
    reported_by: Optional[str] = None
    reported_at: Optional[str] = None
    completed_at: Optional[str] = None
    record_type: RecordType = RecordType.WORK_ORDER


@dataclass(kw_only=True)
class CanonicalPMTask(CanonicalRecord):
    pm_number: str
    description: str = ""
    asset_source_id: Optional[str] = None
    frequency: Optional[int] = None
    frequency_unit: Optional[str] = None  # day|week|month|runtime_hours
    job_plan: Optional[str] = None
    next_due: Optional[str] = None
    record_type: RecordType = RecordType.PM_TASK


@dataclass(kw_only=True)
class CanonicalFailureCode(CanonicalRecord):
    code: str
    description: str = ""
    failure_class: Optional[str] = None
    problem: Optional[str] = None
    cause: Optional[str] = None
    remedy: Optional[str] = None
    record_type: RecordType = RecordType.FAILURE_CODE


@dataclass(kw_only=True)
class CanonicalMeter(CanonicalRecord):
    name: str
    asset_source_id: Optional[str] = None
    last_reading: Optional[float] = None
    unit: Optional[str] = None
    meter_type: Optional[str] = None  # continuous|gauge|characteristic
    record_type: RecordType = RecordType.METER


@dataclass(kw_only=True)
class CanonicalPart(CanonicalRecord):
    item_number: str
    description: str = ""
    store_location: Optional[str] = None
    issue_unit: Optional[str] = None
    qty_on_hand: Optional[float] = None
    record_type: RecordType = RecordType.PART


@dataclass(kw_only=True)
class CanonicalDocument(CanonicalRecord):
    title: str
    doc_type: Optional[str] = None  # manual|wiring|datasheet|sop
    uri: Optional[str] = None
    asset_source_id: Optional[str] = None
    page_count: Optional[int] = None
    record_type: RecordType = RecordType.DOCUMENT


@dataclass(kw_only=True)
class CanonicalTag(CanonicalRecord):
    tag_id: str  # MIRA-side stable id, e.g. "Lake_Wales.Bench.Conveyor.Motor.Speed"
    data_type: str = "float"  # bool|int|float|string|enum
    engineering_unit: Optional[str] = None
    scada_path: Optional[str] = None  # vendor path, e.g. "[default]Lake_Wales/..."
    address: Optional[str] = None  # opcItemPath / Modbus HR / PI point id
    history_enabled: bool = False
    asset_source_id: Optional[str] = None
    attributes: dict[str, Any] = field(default_factory=dict)
    record_type: RecordType = RecordType.TAG


@dataclass(kw_only=True)
class CanonicalRelationship(CanonicalRecord):
    """A proposed edge — maps to a ``relationship_proposals`` row + evidence.

    ``source_ref`` / ``target_ref`` are connector-local references (source_system
    record ids or proposed UNS paths). The gate resolves them to ``kg_entities``
    UUIDs before insert.
    """

    relationship_type: str  # one of RELATIONSHIP_TYPES
    source_ref: str
    target_ref: str
    # ref_kind tells the gate which entity type / table to resolve the ref against:
    # asset|location|tag|document|failure_code|part|uns_path. Two refs with the same
    # natural id but different kinds (e.g. asset "CONV16" LOCATED_IN location "CONV16")
    # are NOT a self-loop — entity type disambiguates them.
    source_ref_kind: str = "asset"
    target_ref_kind: str = "asset"
    risk_level: str = "low"  # low|medium|high|safety_critical
    reasoning: Optional[str] = None
    evidence: list[EvidenceRef] = field(default_factory=list)
    record_type: RecordType = RecordType.RELATIONSHIP

    def validate(self) -> list[str]:
        errs = self.base_validate()
        if self.relationship_type not in RELATIONSHIP_TYPES:
            errs.append(f"unknown relationship_type {self.relationship_type!r}")
        if self.source_ref == self.target_ref and self.source_ref_kind == self.target_ref_kind:
            errs.append("self-loop relationship (same ref and kind)")
        if not self.evidence:
            errs.append("relationship has no evidence — cannot be promoted past 'proposed'")
        for ev in self.evidence:
            errs.extend(ev.validate())
        return errs

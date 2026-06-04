"""The MIRA canonical asset-graph model that every connector normalizes into.

This module is a faithful **in-memory mirror** of the live NeonDB schema
described in ``docs/mira/canonical-asset-graph.md`` and
``docs/mira/source-record-preservation.md``. It deliberately uses the *live*
column names (verified in ``docs/mira/current-repo-inventory.md`` §2.1):

* ``kg_entities``        → :class:`CanonicalEntity`
* ``kg_relationships``   → :class:`CanonicalRelationship`
  (``source_id`` / ``target_id`` / ``relationship_type`` — **NOT**
  ``source_entity`` / ``target_entity`` / ``relation_type``; the PR #1443 trap)
* ``ai_suggestions``     → :class:`Proposal`  (the six ``suggestion_type`` values)
* ``source_objects``     → :class:`SourceObject`  (raw record, never destroyed)

Connectors produce a :class:`NormalizedGraph` of these objects. They do **not**
write to NeonDB — a future writer (master-plan Phase 2/3) maps these straight
onto rows. Keeping the shape identical means that writer is a thin translation,
not a redesign.

Two hard rules baked in here, both from ``.claude/CLAUDE.md`` and the canonical
docs:

1. **Nothing a connector emits is ``verified``.** Every entity and relationship
   defaults to ``approval_state="proposed"``. Promotion to ``verified`` is a
   human/admin action. Auto-verifying is a bug.
2. **The raw record is never destroyed.** Every normalized entity carries its
   complete original payload in ``source_payload``; the matching
   :class:`SourceObject` is the canonical raw store (``raw_payload``).
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Optional

# ---------------------------------------------------------------------------
# Governed vocabulary (canonical-asset-graph.md §2 entity types, §3 edge types)
# ---------------------------------------------------------------------------

# `kg_entities.entity_type` is free TEXT (no CHECK) — these constants are the
# governed vocabulary writers agree on, not a schema constraint (§2.1).
ENTITY_TYPES: frozenset[str] = frozenset(
    {
        "enterprise",
        "site",
        "area",
        "line",
        "cell",
        "asset",  # canonical doc allows asset|equipment; we use `asset` consistently
        "equipment",
        "component",
        "component_template",
        "signal",
        "tag",
        "alarm",
        "fault_event",
        "fault_code",
        "work_order",
        "pm_task",
        "failure_mode",
        "root_cause",
        "remedy",
        "part",
        "document",
        "wiring_diagram",
        "procedure",
        "external_system",
    }
)

# `relationship_proposals.relationship_type` has a CHECK (Hub 028, 28 values);
# `kg_relationships.relationship_type` is free TEXT. The four NEW_* entries are
# the genuinely-new edge types proposed in canonical-asset-graph.md mig 038.
REL_TYPES: frozenset[str] = frozenset(
    {
        # Hub 028 (28 existing)
        "HAS_COMPONENT",
        "INSTANCE_OF",
        "LOCATED_IN",
        "HAS_PART",
        "HAS_DOCUMENT",
        "HAS_CHUNK",
        "REFERENCES",
        "HAS_PROCEDURE",
        "WIRED_TO",
        "POWERED_BY",
        "MAPS_TO",
        "PUBLISHED_AS",
        "USED_IN_LOGIC",
        "TRIGGERS",
        "CAUSES",
        "DRIVES",
        "IS_DRIVEN_BY",
        "OCCURS_ON",
        "RESOLVED_BY",
        "HAS_FAILURE_MODE",
        "HAS_SIGNAL",
        "HAS_ALIAS",
        "DEPENDS_ON",
        "UPSTREAM_OF",
        "DOWNSTREAM_OF",
        "REPLACES",
        "CONFIRMED_BY",
        "CONTRADICTED_BY",
        # NEW for the asset-graph vision (canonical-asset-graph.md mig 038 proposal)
        "HAS_ALARM",
        "HAS_WORK_ORDER",
        "HAS_PM_TASK",
        "USES_PART",
    }
)

# `ai_suggestions.suggestion_type` CHECK (Hub 027) — exactly these six.
SUGGESTION_TYPES: frozenset[str] = frozenset(
    {
        "kg_edge",  # header on a relationship_proposals row
        "kg_entity",  # new entity (component instance, tag, location, asset)
        "tag_mapping",  # a tag_entities row proposed by ingestion
        "component_profile",  # a component_templates row proposed by extraction
        "uns_confirmation",  # the UNS Gate "is this the right asset?" prompt
        "namespace_move",  # a drag-drop / rename on the namespace tree
    }
)

# `ai_suggestions.status` / approval states.
APPROVAL_PROPOSED = "proposed"
APPROVAL_VERIFIED = "verified"
APPROVAL_REJECTED = "rejected"
APPROVAL_NEEDS_REVIEW = "needs_review"

# `ai_suggestions.risk_level` CHECK (Hub 027).
RISK_LEVELS: frozenset[str] = frozenset({"low", "medium", "high", "safety_critical"})


def content_hash(payload: Any) -> str:
    """SHA-256 of the canonicalized payload — the ``source_objects.content_hash``
    used for re-import dedup (source-record-preservation.md §4)."""
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def confidence_band(confidence: float) -> str:
    """The Hub UI bands (migration 027): low <0.5, medium 0.5-0.8, high >0.8."""
    if confidence < 0.5:
        return "low"
    if confidence <= 0.8:
        return "medium"
    return "high"


# ---------------------------------------------------------------------------
# Source-record preservation layer (source-record-preservation.md §2.3)
# ---------------------------------------------------------------------------


@dataclass
class SourceObject:
    """One raw imported record — the ``source_objects`` row that "never destroys
    original customer fields". ``raw_payload`` is the unmodified source record.
    """

    system_kind: str  # 'maximo'|'sap'|'maintainx'|'ignition'|'historian'...
    object_type: str  # 'asset'|'work_order'|'pm'|'location'|'part'|'tag'|'fault'...
    external_object_id: str  # the source system's own ID (ASSETNUM, EQUNR, PI tag)
    raw_payload: dict[str, Any]  # ORIGINAL record, unmodified (requirement 4)
    connector_version: str
    content_hash: str = ""
    mapping_status: str = "unmapped"  # unmapped|mapped|conflict|stale|error
    mapped_entity_key: Optional[str] = None  # → CanonicalEntity.key once normalized
    mapping_errors: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if not self.content_hash:
            self.content_hash = content_hash(self.raw_payload)


# ---------------------------------------------------------------------------
# Canonical spine: nodes + edges (kg_entities / kg_relationships)
# ---------------------------------------------------------------------------


@dataclass
class CanonicalEntity:
    """A ``kg_entities`` row.

    ``name`` is the natural-key component (UNIQUE ``(tenant_id, entity_type,
    name)``) and is keyed off the source system's **unique ID** (ASSETNUM /
    EQUNR / PI tag) — never the free-text description, which is not unique. The
    human label lives in ``properties['description']``.
    """

    entity_type: str
    name: str
    uns_path: Optional[str] = None
    properties: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.7
    approval_state: str = APPROVAL_PROPOSED  # rule #1: connectors never auto-verify
    # Source-system identity (canonical-asset-graph.md §4 req 1).
    source_system: Optional[str] = None
    object_type: Optional[str] = None
    external_object_id: Optional[str] = None
    source_payload: dict[str, Any] = field(default_factory=dict)  # ALL original fields
    content_hash: str = ""

    def __post_init__(self) -> None:
        if self.entity_type not in ENTITY_TYPES:
            raise ValueError(f"unknown entity_type {self.entity_type!r}")
        if self.source_payload and not self.content_hash:
            self.content_hash = content_hash(self.source_payload)

    @property
    def key(self) -> str:
        """Stable in-memory join key mirroring the natural key
        ``(entity_type, name)``. Relationships reference entities by this."""
        return f"{self.entity_type}:{self.name}"


@dataclass
class CanonicalRelationship:
    """A ``kg_relationships`` row. Uses the **live** column names
    (``source_id``/``target_id``/``relationship_type``). ``source_key`` /
    ``target_key`` hold the in-memory :attr:`CanonicalEntity.key`; a writer
    resolves them to the real ``kg_entities.id`` UUIDs."""

    source_key: str  # → CanonicalEntity.key  (becomes source_id UUID)
    target_key: str  # → CanonicalEntity.key  (becomes target_id UUID)
    relationship_type: str
    confidence: float = 0.6
    approval_state: str = APPROVAL_PROPOSED  # rule #1
    properties: dict[str, Any] = field(default_factory=dict)
    # relationship_evidence rows (Hub 018): {kind, ref, detail}
    evidence: list[dict[str, Any]] = field(default_factory=list)

    def __post_init__(self) -> None:
        if self.relationship_type not in REL_TYPES:
            raise ValueError(f"unknown relationship_type {self.relationship_type!r}")


@dataclass
class Proposal:
    """An ``ai_suggestions`` row — the Hub ``/proposals`` work-queue unit for an
    ambiguous or cross-system mapping that needs a human decision.

    ``proposed_by`` follows the migration-027 actor vocabulary; connector
    imports use ``import:<connector>``.
    """

    suggestion_type: str  # one of SUGGESTION_TYPES
    title: str
    body: str
    extracted_data: dict[str, Any] = field(default_factory=dict)
    confidence: float = 0.5
    risk_level: str = "low"
    status: str = "pending"  # ai_suggestions lifecycle starts at pending
    proposed_by: str = "import:unknown"
    source_kind: Optional[str] = None  # ai_suggestions.source_kind (Hub 027 CHECK)
    source_id: Optional[str] = None

    def __post_init__(self) -> None:
        if self.suggestion_type not in SUGGESTION_TYPES:
            raise ValueError(f"unknown suggestion_type {self.suggestion_type!r}")
        if self.risk_level not in RISK_LEVELS:
            raise ValueError(f"unknown risk_level {self.risk_level!r}")
        if not 0.0 <= self.confidence <= 1.0:
            raise ValueError("confidence must be in [0.0, 1.0]")


# ---------------------------------------------------------------------------
# Validation report (Connector.validate)
# ---------------------------------------------------------------------------


@dataclass
class ValidationIssue:
    severity: str  # 'error' | 'warning' | 'info'
    code: str  # machine-readable, e.g. 'invalid_uns_path', 'orphan_relationship'
    message: str
    entity_key: Optional[str] = None


@dataclass
class ValidationReport:
    issues: list[ValidationIssue] = field(default_factory=list)

    def add(
        self, severity: str, code: str, message: str, entity_key: Optional[str] = None
    ) -> None:
        self.issues.append(ValidationIssue(severity, code, message, entity_key))

    @property
    def ok(self) -> bool:
        """True when there are no ``error``-severity issues (warnings are fine —
        they typically become proposals, not blockers)."""
        return not any(i.severity == "error" for i in self.issues)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "error"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "warning"]


# ---------------------------------------------------------------------------
# The normalized graph a connector produces
# ---------------------------------------------------------------------------


@dataclass
class NormalizedGraph:
    """Everything a connector's ``normalize()`` produces for one import: the
    canonical entities + relationships, the proposals for ambiguous mappings,
    and the preserved raw source records."""

    entities: dict[str, CanonicalEntity] = field(default_factory=dict)  # keyed by .key
    relationships: list[CanonicalRelationship] = field(default_factory=list)
    proposals: list[Proposal] = field(default_factory=list)
    source_objects: list[SourceObject] = field(default_factory=list)

    def add_entity(self, entity: CanonicalEntity) -> CanonicalEntity:
        """Upsert by natural key. On collision, merge properties/source_payload
        (last write wins per field) and keep the higher confidence — mirrors the
        ``ON CONFLICT (tenant_id, entity_type, name)`` upsert a writer would do."""
        existing = self.entities.get(entity.key)
        if existing is None:
            self.entities[entity.key] = entity
            return entity
        existing.properties.update(entity.properties)
        existing.source_payload.update(entity.source_payload)
        existing.confidence = max(existing.confidence, entity.confidence)
        if entity.uns_path and not existing.uns_path:
            existing.uns_path = entity.uns_path
        return existing

    def add_relationship(self, rel: CanonicalRelationship) -> CanonicalRelationship:
        self.relationships.append(rel)
        return rel

    def add_proposal(self, proposal: Proposal) -> Proposal:
        self.proposals.append(proposal)
        return proposal

    def add_source_object(self, obj: SourceObject) -> SourceObject:
        self.source_objects.append(obj)
        return obj

    def by_type(self, entity_type: str) -> list[CanonicalEntity]:
        return [e for e in self.entities.values() if e.entity_type == entity_type]

    def get(self, key: str) -> Optional[CanonicalEntity]:
        return self.entities.get(key)

    def merge(self, other: NormalizedGraph) -> None:
        """Fold another graph into this one (used by the cross-reference demo)."""
        for e in other.entities.values():
            self.add_entity(e)
        self.relationships.extend(other.relationships)
        self.proposals.extend(other.proposals)
        self.source_objects.extend(other.source_objects)

    def summary(self) -> dict[str, int]:
        proposed_edges = sum(
            1 for r in self.relationships if r.approval_state == APPROVAL_PROPOSED
        )
        return {
            "entities": len(self.entities),
            "relationships": len(self.relationships),
            "proposed_relationships": proposed_edges,
            "proposals": len(self.proposals),
            "source_objects": len(self.source_objects),
        }

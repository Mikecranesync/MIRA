"""Materialized Evidence — typed contract (PR C of the North Star amendment).

The vendor-neutral, dependency-light typed contract for the Materialized Evidence
layer. Doctrine: ``NORTH_STAR.md`` § "Materialized Evidence and Recall-First
Architecture"; architecture: ``docs/architecture/materialized-evidence.md``;
decisions: ``docs/adr/0029-materialized-evidence.md``.

Frozen dataclasses + stdlib only (no new deps, matching ``printsense/cas.py`` and
``factorylm_ai`` idiom). This module is a CONTRACT — it defines the shape of an
evidence dataset manifest, an evidence record, and the recall query/result. It
does NOT store, resolve, or wire anything (those are PRs D/E). Public contracts
carry no vendor-specific types (ADR A6).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import Any

SCHEMA_CONTRACT_VERSION = "1.0"


# ── controlled vocabularies (the reason codes / status enums the doctrine names) ──


class DatasetType(str, Enum):
    """The initial evidence dataset types (one shared contract, typed payloads —
    NOT a registry per type). Extend this enum; do not fork the manifest."""

    SOURCE_INVENTORY = "SourceInventoryEvidence"
    PAGE_IDENTITY = "PageIdentityEvidence"
    OCR = "OCREvidence"
    PAGE_CLASSIFICATION = "PageClassificationEvidence"
    DEVICE_INVENTORY = "DeviceInventoryEvidence"
    FAULT_EXTRACTION = "FaultExtractionEvidence"
    PARAMETER_EXTRACTION = "ParameterExtractionEvidence"
    CROSS_REFERENCE = "CrossReferenceEvidence"
    WIRING = "WiringEvidence"
    PLC_LOGIC = "PLCLogicEvidence"
    MACHINE_EVENT = "MachineEventEvidence"
    VIDEO_DETECTION = "VideoDetectionEvidence"
    TELEMETRY_FEATURE = "TelemetryFeatureEvidence"
    CONTRADICTION = "ContradictionEvidence"
    HUMAN_REVIEW = "HumanReviewEvidence"
    PACK_BUILD = "PackBuildEvidence"


class Environment(str, Enum):
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


class StageStatus(str, Enum):
    COMPLETE = "complete"
    PARTIAL = "partial"
    FAILED = "failed"
    DEGRADED = "degraded"
    CANCELLED = "cancelled"


class TrustStatus(str, Enum):
    CANDIDATE = "candidate"
    INTERNAL = "internal"
    BETA = "beta"
    TRUSTED = "trusted"
    REJECTED = "rejected"
    DEPRECATED = "deprecated"


class ApprovalStatus(str, Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    REVOKED = "revoked"


class StaleState(str, Enum):
    VALID = "valid"
    SUSPECT = "suspect"
    STALE = "stale"
    BLOCKED = "blocked"


class RecomputeDecision(str, Enum):
    """Every expensive stage logs one of these — recomputation is observable."""

    REUSED_EXACT = "reused_exact"
    REUSED_PARTIAL = "reused_partial"
    RECOMPUTED_SOURCE_CHANGED = "recomputed_source_changed"
    RECOMPUTED_ALGORITHM_CHANGED = "recomputed_algorithm_changed"
    RECOMPUTED_SCHEMA_CHANGED = "recomputed_schema_changed"
    RECOMPUTED_PROMPT_CHANGED = "recomputed_prompt_changed"
    RECOMPUTED_MISSING_OUTPUT = "recomputed_missing_output"
    RECOMPUTED_CORRUPT = "recomputed_corrupt"
    RECOMPUTED_HUMAN_REQUESTED = "recomputed_human_requested"
    BLOCKED_CONFLICT = "blocked_conflict"
    BLOCKED_APPROVAL = "blocked_approval"
    BLOCKED_DEPENDENCY = "blocked_dependency"


class RecallOutcome(str, Enum):
    EXACT = "exact"
    PARTIAL = "partial"
    STALE = "stale"
    CONFLICTING = "conflicting"
    NONE = "none"


# ── the manifest (PRD Appendix C) ────────────────────────────────────────────


@dataclass(frozen=True)
class EvidenceManifest:
    """The stable manifest of one materialized evidence dataset version.

    ``content_hash``/``manifest_hash`` are computed by ``materialized_evidence.hashing``
    — never hand-set. Payloads are immutable by version (ADR A3); status fields
    (trust/approval/stale) are overlays that may transition without mutating the
    payload or its ``content_hash``.
    """

    # identity
    dataset_id: str
    dataset_version_id: str
    dataset_type: DatasetType
    schema_name: str
    schema_version: str
    tenant_id: str
    environment: Environment
    content_hash: str = ""
    manifest_hash: str = ""
    # source scope
    source_objects: list[str] = field(default_factory=list)
    source_hashes: list[str] = field(default_factory=list)
    source_revision: str | None = None
    asset_refs: list[str] = field(default_factory=list)
    uns_paths: list[str] = field(default_factory=list)
    time_range: tuple[str, str] | None = None
    page_or_segment_scope: str | None = None
    # producer lineage
    producer_name: str = ""
    producer_version: str = ""
    repository_commit: str | None = None
    container_image: str | None = None
    model_provider: str | None = None
    model_id: str | None = None
    model_revision: str | None = None
    prompt_contract_id: str | None = None
    prompt_contract_version: str | None = None
    configuration_hash: str | None = None
    parent_dataset_versions: list[str] = field(default_factory=list)
    # quality & trust
    stage_status: StageStatus = StageStatus.COMPLETE
    completeness: float | str | None = None
    confidence_summary: float | str | None = None
    trust_status: TrustStatus = TrustStatus.CANDIDATE
    approval_status: ApprovalStatus = ApprovalStatus.PENDING
    approval_refs: list[str] = field(default_factory=list)
    known_gaps: list[str] = field(default_factory=list)
    contradiction_count: int = 0
    unresolved_count: int = 0
    validation_results: dict[str, Any] = field(default_factory=dict)
    # operations
    storage_ref: str | None = None
    index_refs: list[str] = field(default_factory=list)
    record_count: int = 0
    supersedes: str | None = None
    stale_state: StaleState = StaleState.VALID
    stale_reasons: list[str] = field(default_factory=list)
    retention_policy: str | None = None
    repair_doc_ref: str | None = None
    workflow_run_ref: str | None = None
    temporal_workflow_id: str | None = None
    temporal_run_id: str | None = None
    created_at: str | None = None  # RFC3339; caller stamps (no Date.now here)
    # economics
    wall_time_ms: int | None = None
    queue_time_ms: int | None = None
    compute_time_ms: int | None = None
    model_input_units: int | None = None
    model_output_units: int | None = None
    provider_cost_usd: float | None = None
    internal_cost_estimate_usd: float | None = None
    retry_count: int = 0
    reused_parent_count: int = 0
    avoided_recompute_estimate: float | None = None

    def to_dict(self) -> dict[str, Any]:
        return _enum_safe(asdict(self))


@dataclass(frozen=True)
class EvidenceRecord:
    """One record within a dataset (PRD §7.2). ``payload`` is the typed,
    dataset-type-specific content; ``evidence_hash`` is content-addressed."""

    record_id: str
    dataset_id: str
    source_locator: str
    payload: dict[str, Any]
    confidence: float | str | None = None
    deterministic_reasons: list[str] = field(default_factory=list)
    producer: str = ""
    status: TrustStatus = TrustStatus.CANDIDATE
    evidence_hash: str = ""
    source_excerpt_ref: str | None = None
    approval_ref: str | None = None
    contradiction_refs: list[str] = field(default_factory=list)
    correction_history: list[dict[str, Any]] = field(default_factory=list)
    created_at: str | None = None
    updated_at: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return _enum_safe(asdict(self))


@dataclass(frozen=True)
class RecallQuery:
    """A request to reuse prior evidence before running an expensive stage (§7.3)."""

    tenant_id: str
    dataset_type: DatasetType
    source_hashes: list[str] = field(default_factory=list)
    asset_scope: str | None = None
    required_schema: tuple[str, str] | None = None  # (schema_name, schema_version)
    allowed_producer_versions: list[str] = field(default_factory=list)
    allowed_trust_states: list[TrustStatus] = field(default_factory=list)
    required_completeness: float | str | None = None
    requested_capability: str | None = None
    freshness_policy: str | None = None
    environment: Environment = Environment.DEV

    def to_dict(self) -> dict[str, Any]:
        return _enum_safe(asdict(self))


@dataclass(frozen=True)
class RecallResult:
    """The resolver's answer (§7.3) — an outcome + reason, never a silent guess."""

    outcome: RecallOutcome
    reason: str
    selected_versions: list[str] = field(default_factory=list)
    incompatible_considered: list[str] = field(default_factory=list)
    incompatibility_reasons: list[str] = field(default_factory=list)
    missing_outputs: list[str] = field(default_factory=list)
    recompute_decision: RecomputeDecision | None = None
    human_approval_required: bool = False

    def to_dict(self) -> dict[str, Any]:
        return _enum_safe(asdict(self))


# ── minimal validator (no new deps; returns a list of problems, empty == ok) ──

_REQUIRED_MANIFEST_FIELDS = (
    "dataset_id",
    "dataset_version_id",
    "dataset_type",
    "schema_name",
    "schema_version",
    "tenant_id",
    "environment",
)


def validate_manifest(m: EvidenceManifest) -> list[str]:
    """Return a list of contract violations (empty == valid). Cheap, offline,
    no I/O — the kind of gate a stage can run before writing."""
    problems: list[str] = []
    for f in _REQUIRED_MANIFEST_FIELDS:
        if not getattr(m, f):
            problems.append(f"missing required field: {f}")
    if not isinstance(m.dataset_type, DatasetType):
        problems.append("dataset_type must be a DatasetType")
    if not isinstance(m.environment, Environment):
        problems.append("environment must be an Environment")
    if m.contradiction_count < 0 or m.unresolved_count < 0:
        problems.append("counts must be non-negative")
    # a model-produced dataset must carry model lineage (rule 6)
    if m.model_provider and not (m.model_id and m.prompt_contract_version):
        problems.append(
            "model_provider set but model_id/prompt_contract_version missing "
            "(inference lineage is required — rule 6)"
        )
    # a trusted/approved dataset must reference its approval (rule 9 / ADR A3)
    if m.trust_status == TrustStatus.TRUSTED and not m.approval_refs:
        problems.append("trust_status=trusted requires approval_refs (no self-promotion — rule 9)")
    if m.approval_status == ApprovalStatus.APPROVED and not m.approval_refs:
        problems.append("approval_status=approved requires approval_refs")
    return problems


def _enum_safe(d: dict[str, Any]) -> dict[str, Any]:
    """Recursively convert Enum values to their ``.value`` for canonical JSON."""
    out: dict[str, Any] = {}
    for k, v in d.items():
        out[k] = _coerce(v)
    return out


def _coerce(v: Any) -> Any:
    if isinstance(v, Enum):
        return v.value
    if isinstance(v, dict):
        return {k: _coerce(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_coerce(x) for x in v]
    return v

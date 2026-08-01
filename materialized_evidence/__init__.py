"""Materialized Evidence — the vendor-neutral typed contract layer.

Doctrine: ``NORTH_STAR.md`` § "Materialized Evidence and Recall-First Architecture".
Architecture: ``docs/architecture/materialized-evidence.md``. Decisions:
``docs/adr/0029-materialized-evidence.md``. Rules: ``.claude/rules/materialized-evidence.md``.

This package is the CONTRACT only (PR C): manifest, record, recall query/result,
controlled-vocabulary enums, a minimal validator, and content-addressed hashing.
It stores/resolves/wires nothing (registry = PR D, resolver = PR E).

``context_contract`` (ADR-0033, "one technician brain") extends this by
composition: ``TechnicianContext`` is the single per-answer runtime object every
producer feeds via the pure ``evidence_from_*`` adapters; ``validate_context``
enforces the read-only law; ``to_prompt_block`` renders it deterministically.
Per-turn assembly lives in ``mira-bots/shared/technician_context.py`` (flag
``MIRA_CONTEXT_CONTRACT``). Plain-language explainer: ``materialized_evidence/README.md``.
"""

from __future__ import annotations

from .context_contract import (
    ALLOWED_ACTION_VOCAB,
    CONTEXT_CONTRACT_VERSION,
    FORBIDDEN_ACTION_SUBSTRINGS,
    AssetIdentity,
    Contradiction,
    EvidenceItem,
    EvidenceKind,
    Freshness,
    LiveStateOverlay,
    TaskMode,
    TechnicianContext,
    asset_from_uns_context,
    evidence_from_drive_pack_answer,
    evidence_from_historian_window,
    evidence_from_kg_context,
    evidence_from_ontology_validation,
    evidence_from_printsense_graph,
    evidence_from_prior_decisions,
    evidence_from_recall_chunks,
    evidence_from_technician_corrections,
    evidence_from_visual_session,
    evidence_from_work_orders,
    live_overlay_from_machine_packet,
    to_prompt_block,
    validate_context,
)
from .hashing import (
    canonical_json,
    content_hash,
    manifest_hash,
    record_hash,
    sha256_bytes,
    with_hashes,
)
from .invalidation import InvalidationResult, invalidate
from .redaction import (
    NETWORK_SCHEMES,
    redact_uri,
    redact_uris,
    scrub_text_uris,
    uri_leaks_credentials,
)
from .registry import (
    InMemoryRegistry,
    MaterializationRegistry,
    RegistryError,
    StatusOverlay,
)
from .resolver import resolve_recall
from .schema import (
    SCHEMA_CONTRACT_VERSION,
    ApprovalStatus,
    DatasetType,
    Environment,
    EvidenceManifest,
    EvidenceRecord,
    RecallOutcome,
    RecallQuery,
    RecallResult,
    RecomputeDecision,
    StageStatus,
    StaleState,
    TrustStatus,
    validate_manifest,
)

__all__ = [
    "SCHEMA_CONTRACT_VERSION",
    "ApprovalStatus",
    "DatasetType",
    "Environment",
    "EvidenceManifest",
    "EvidenceRecord",
    "RecallOutcome",
    "RecallQuery",
    "RecallResult",
    "RecomputeDecision",
    "StageStatus",
    "StaleState",
    "TrustStatus",
    "validate_manifest",
    "canonical_json",
    "content_hash",
    "manifest_hash",
    "record_hash",
    "sha256_bytes",
    "with_hashes",
    "InMemoryRegistry",
    "MaterializationRegistry",
    "RegistryError",
    "StatusOverlay",
    "resolve_recall",
    "invalidate",
    "InvalidationResult",
    "NETWORK_SCHEMES",
    "redact_uri",
    "redact_uris",
    "scrub_text_uris",
    "uri_leaks_credentials",
    # ADR-0033 runtime context contract (extends this package by composition;
    # assembled per turn via mira-bots/shared/technician_context.py)
    "CONTEXT_CONTRACT_VERSION",
    "ALLOWED_ACTION_VOCAB",
    "FORBIDDEN_ACTION_SUBSTRINGS",
    "TechnicianContext",
    "EvidenceItem",
    "AssetIdentity",
    "LiveStateOverlay",
    "Contradiction",
    "TaskMode",
    "EvidenceKind",
    "Freshness",
    "validate_context",
    "to_prompt_block",
    "asset_from_uns_context",
    "evidence_from_recall_chunks",
    "evidence_from_drive_pack_answer",
    "evidence_from_kg_context",
    "evidence_from_printsense_graph",
    "evidence_from_ontology_validation",
    "evidence_from_historian_window",
    "evidence_from_work_orders",
    "evidence_from_prior_decisions",
    "evidence_from_technician_corrections",
    "evidence_from_visual_session",
    "live_overlay_from_machine_packet",
]

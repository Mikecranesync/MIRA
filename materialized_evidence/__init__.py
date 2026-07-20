"""Materialized Evidence — the vendor-neutral typed contract layer.

Doctrine: ``NORTH_STAR.md`` § "Materialized Evidence and Recall-First Architecture".
Architecture: ``docs/architecture/materialized-evidence.md``. Decisions:
``docs/adr/0029-materialized-evidence.md``. Rules: ``.claude/rules/materialized-evidence.md``.

This package is the CONTRACT only (PR C): manifest, record, recall query/result,
controlled-vocabulary enums, a minimal validator, and content-addressed hashing.
It stores/resolves/wires nothing (registry = PR D, resolver = PR E).
"""

from __future__ import annotations

from .hashing import (
    canonical_json,
    content_hash,
    manifest_hash,
    record_hash,
    sha256_bytes,
    with_hashes,
)
from .registry import (
    InMemoryRegistry,
    MaterializationRegistry,
    RegistryError,
    StatusOverlay,
)
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
]

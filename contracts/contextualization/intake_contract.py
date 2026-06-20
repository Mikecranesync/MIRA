"""HubV3 — Shared Contextualization Intake Contract (Python twin).

The single normalized envelope every ingest route submits to the Hub. The Hub
is the system of record; clients only collect evidence and create proposals.

This is the Python twin of:
  - mira-hub/src/lib/contextualization/intake-contract.ts  (authoritative types + validator)
  - mira-hub/src/lib/contextualization/intake-contract.schema.json  (JSON Schema)

Keep all three in lockstep — change them together. This module is intentionally
dependency-free (stdlib only) so the offline Contextualizer (mira-contextualizer)
and the Telegram thin client (mira-bots) can each import it without pulling a
validation framework. Those clients are wired in HubV3 Phases 5/6; this contract
ships first (Phase 0) so they have one shape to target.

Identity model: UUIDs are identity; names / numbers / serials / models /
controller IPs / UNS paths are MATCHING EVIDENCE, never the sole key.
`review_status` is always "proposed" on intake — nothing is auto-approved.

Spec: docs/plans/2026-06-20-hubv3-contextualization-intake-prd.md §2
ADR:  docs/adr/0023-hub-system-of-record-contextualization.md
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

CONTRACT_VERSION = "contextualization-intake/v1"

INGEST_ROUTES = ("offline", "telegram", "hub_upload")
SOURCE_TYPES = ("l5x", "st", "plcopen", "csv", "manual", "other")

_SHA256_RE = re.compile(r"^[0-9a-f]{64}$", re.IGNORECASE)


@dataclass
class AssetHints:
    """Identity + matching-evidence hints; never the sole key."""

    name: str | None = None
    number: str | None = None
    manufacturer: str | None = None
    model: str | None = None
    serial: str | None = None
    controller: str | None = None
    controller_ip: str | None = None
    uns_path: str | None = None


@dataclass
class SourceMetadata:
    file_name: str
    mime: str | None = None
    size: int | None = None
    captured_at: str | None = None
    uploader: str | None = None
    location: str | None = None


@dataclass
class IntakeSource:
    source_sha256: str  # per-source dedup key (sha256 hex)
    source_type: str  # one of SOURCE_TYPES
    source_metadata: SourceMetadata
    source_uuid: str | None = None  # Hub mints if absent


@dataclass
class ProposedSignal:
    tag_name: str
    roles: list[str] = field(default_factory=list)
    uns_path: str | None = None
    i3x_element_id: str | None = None
    confidence: float | None = None
    evidence: dict = field(default_factory=dict)
    source_sha256: str | None = None


@dataclass
class IntakeContract:
    """The full intake envelope (HubV3 §2)."""

    ingest_route: str  # one of INGEST_ROUTES
    sources: list[IntakeSource]
    contract_version: str = CONTRACT_VERSION
    review_status: str = "proposed"  # always "proposed" on intake
    bundle_sha256: str | None = None  # whole-submission fingerprint
    project_hint: str | None = None
    asset_hints: AssetHints | None = None
    evidence: list[dict] = field(default_factory=list)
    entities: list[dict] = field(default_factory=list)
    proposed_signals: list[ProposedSignal] = field(default_factory=list)
    proposed_uns: list[dict] = field(default_factory=list)
    proposed_i3x: list[dict] = field(default_factory=list)
    proposed_faults: list[dict] = field(default_factory=list)
    proposed_parameters: list[dict] = field(default_factory=list)
    proposed_relationships: list[dict] = field(default_factory=list)
    provenance: dict = field(default_factory=dict)
    confidence: str | float | None = None

    def to_envelope(self) -> dict:
        """Serialize to the wire envelope the Hub import endpoint accepts."""
        return {
            "contract_version": self.contract_version,
            "ingest_route": self.ingest_route,
            "review_status": self.review_status,
            "bundle_sha256": self.bundle_sha256,
            "project_hint": self.project_hint,
            "asset_hints": _asdict_opt(self.asset_hints),
            "sources": [
                {
                    "source_sha256": s.source_sha256,
                    "source_type": s.source_type,
                    "source_uuid": s.source_uuid,
                    "source_metadata": {
                        k: v
                        for k, v in vars(s.source_metadata).items()
                        if v is not None
                    },
                }
                for s in self.sources
            ],
            "evidence": self.evidence,
            "entities": self.entities,
            "proposed_signals": [vars(sig) for sig in self.proposed_signals],
            "proposed_uns": self.proposed_uns,
            "proposed_i3x": self.proposed_i3x,
            "proposed_faults": self.proposed_faults,
            "proposed_parameters": self.proposed_parameters,
            "proposed_relationships": self.proposed_relationships,
            "provenance": self.provenance,
            "confidence": self.confidence,
        }


def _asdict_opt(obj) -> dict | None:
    if obj is None:
        return None
    return {k: v for k, v in vars(obj).items() if v is not None}


def validate_envelope(payload: dict) -> list[str]:
    """Validate a raw envelope dict. Returns a list of errors ([] == valid).

    Mirrors validateIntakeContract() in intake-contract.ts. Kept deliberately
    in sync with the TS validator's rules and messages.
    """
    errors: list[str] = []
    if not isinstance(payload, dict):
        return ["intake contract must be a JSON object"]

    if payload.get("contract_version") != CONTRACT_VERSION:
        errors.append(f'contract_version must be "{CONTRACT_VERSION}"')

    if payload.get("ingest_route") not in INGEST_ROUTES:
        errors.append(f"ingest_route must be one of {', '.join(INGEST_ROUTES)}")

    review_status = payload.get("review_status")
    if review_status is not None and review_status != "proposed":
        errors.append('review_status must be "proposed" on intake')

    bundle = payload.get("bundle_sha256")
    if bundle is not None and not (isinstance(bundle, str) and _SHA256_RE.match(bundle)):
        errors.append("bundle_sha256 must be a 64-char hex string")

    sources = payload.get("sources")
    if not isinstance(sources, list) or len(sources) == 0:
        errors.append("sources must be a non-empty array")
    else:
        for i, s in enumerate(sources):
            if not isinstance(s, dict):
                errors.append(f"sources[{i}] must be an object")
                continue
            sha = s.get("source_sha256")
            if not (isinstance(sha, str) and _SHA256_RE.match(sha)):
                errors.append(f"sources[{i}].source_sha256 must be a 64-char hex string")
            if s.get("source_type") not in SOURCE_TYPES:
                errors.append(f"sources[{i}].source_type must be one of {', '.join(SOURCE_TYPES)}")
            meta = s.get("source_metadata")
            if not (isinstance(meta, dict) and isinstance(meta.get("file_name"), str) and meta["file_name"].strip()):
                errors.append(f"sources[{i}].source_metadata.file_name is required")

    return errors

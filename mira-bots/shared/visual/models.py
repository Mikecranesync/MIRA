"""Data contracts for the VisualSession spine (ADR-0027 Phase 1).

Frozen dataclasses matching ``mira-hub/db/migrations/063_visual_sessions.sql``
column-for-column: ``VisualSession``, ``EvidenceItem``, ``RegionOfInterest``,
``Observation`` mirror the four ledger tables a session accumulates.
``AnswerClaim`` + ``AnswerEnvelope`` are the PRD's structured answer contract
(ADR-0027 D3) — every consequential Visual Technician answer returns the
envelope ``{answer, claims, next_best_evidence, safety_notes}``, never bare
prose. ``QualityScore`` is the FR-3 image-quality-gate result.

All dataclasses are ``frozen`` (the ledger is append-only) and ``kw_only``
(so field order can mirror the SQL column order for readability without the
"non-default fields first" constraint forcing a different order). Use
``from_row()`` to build an instance from a DB row (``Mapping``-like, e.g. a
SQLAlchemy ``RowMapping``) and ``to_dict()`` to get a JSON-serializable dict
(used for the answer envelope, the PRD Section 8 wire contract).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Mapping

from .evidence_state import EvidenceState

__all__ = [
    "VisualSession",
    "EvidenceItem",
    "RegionOfInterest",
    "Observation",
    "AnswerClaim",
    "AnswerEnvelope",
    "QualityScore",
]


def _coerce_state(value: EvidenceState | str) -> EvidenceState:
    """Accept either an ``EvidenceState`` or its raw string value."""
    return value if isinstance(value, EvidenceState) else EvidenceState(value)


def _iso(value: Any) -> str | None:
    """Best-effort ISO-8601 stringify for a DB timestamp (datetime or str)."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    isoformat = getattr(value, "isoformat", None)
    return isoformat() if callable(isoformat) else str(value)


def _opt_str(value: Any) -> str | None:
    return str(value) if value is not None else None


@dataclass(frozen=True, slots=True, kw_only=True)
class VisualSession:
    """Mirrors the ``visual_session`` table."""

    session_id: str
    tenant_id: str
    asset_id: str | None = None
    uns_path: str | None = None
    title: str | None = None
    status: str = "active"  # CHECK: active | published | archived
    current_revision: str | None = None
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> VisualSession:
        return cls(
            session_id=str(row["session_id"]),
            tenant_id=str(row["tenant_id"]),
            asset_id=_opt_str(row.get("asset_id")),
            uns_path=row.get("uns_path"),
            title=row.get("title"),
            status=row.get("status") or "active",
            current_revision=_opt_str(row.get("current_revision")),
            created_by=row.get("created_by"),
            created_at=_iso(row.get("created_at")),
            updated_at=_iso(row.get("updated_at")),
            metadata=dict(row.get("metadata") or {}),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class EvidenceItem:
    """Mirrors the ``evidence_item`` table."""

    evidence_id: str
    session_id: str
    tenant_id: str
    source_type: str = "unknown"
    drawing_type: str | None = None
    original_uri: str | None = None
    original_hash: str | None = None
    derived_uri: str | None = None
    derived_hash: str | None = None
    capture_meta: dict[str, Any] = field(default_factory=dict)
    quality_score: float | None = None
    page_ref: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> EvidenceItem:
        return cls(
            evidence_id=str(row["evidence_id"]),
            session_id=str(row["session_id"]),
            tenant_id=str(row["tenant_id"]),
            source_type=row.get("source_type") or "unknown",
            drawing_type=row.get("drawing_type"),
            original_uri=row.get("original_uri"),
            original_hash=row.get("original_hash"),
            derived_uri=row.get("derived_uri"),
            derived_hash=row.get("derived_hash"),
            capture_meta=dict(row.get("capture_meta") or {}),
            quality_score=(
                float(row["quality_score"]) if row.get("quality_score") is not None else None
            ),
            page_ref=row.get("page_ref"),
            created_at=_iso(row.get("created_at")),
            metadata=dict(row.get("metadata") or {}),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class RegionOfInterest:
    """Mirrors the ``region_of_interest`` table."""

    region_id: str
    evidence_id: str
    tenant_id: str
    geometry: dict[str, Any] = field(default_factory=dict)
    label: str | None = None
    origin: str = "system"  # CHECK: user | system
    transform_to_original: dict[str, Any] | None = None
    created_at: str | None = None

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> RegionOfInterest:
        return cls(
            region_id=str(row["region_id"]),
            evidence_id=str(row["evidence_id"]),
            tenant_id=str(row["tenant_id"]),
            geometry=dict(row.get("geometry") or {}),
            label=row.get("label"),
            origin=row.get("origin") or "system",
            transform_to_original=row.get("transform_to_original"),
            created_at=_iso(row.get("created_at")),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class Observation:
    """Mirrors the ``observation`` table — the atomic-claim ledger.

    ``evidence_state`` is always coerced to an ``EvidenceState`` member
    (never a bare string) so composer code can call its semantics methods
    (``is_inference()`` etc.) without a caller having to remember to wrap it.
    """

    observation_id: str
    session_id: str
    tenant_id: str
    evidence_id: str | None = None
    region_id: str | None = None
    obs_kind: str = "entity"  # CHECK: entity | property | relation
    raw_value: str | None = None
    normalized_value: str | None = None
    evidence_state: EvidenceState = EvidenceState.NEEDS_CONTEXT
    confidence: float | None = None
    extractor: str | None = None  # vision_worker|print_worker|schematic_intelligence|ocr|technician
    review_state: str = "unreviewed"  # CHECK: unreviewed|confirmed|corrected|rejected
    superseded_by: str | None = None
    created_at: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_state", _coerce_state(self.evidence_state))

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> Observation:
        return cls(
            observation_id=str(row["observation_id"]),
            session_id=str(row["session_id"]),
            tenant_id=str(row["tenant_id"]),
            evidence_id=_opt_str(row.get("evidence_id")),
            region_id=_opt_str(row.get("region_id")),
            obs_kind=row["obs_kind"],
            raw_value=row.get("raw_value"),
            normalized_value=row.get("normalized_value"),
            evidence_state=_coerce_state(row["evidence_state"]),
            confidence=(float(row["confidence"]) if row.get("confidence") is not None else None),
            extractor=row.get("extractor"),
            review_state=row.get("review_state") or "unreviewed",
            superseded_by=_opt_str(row.get("superseded_by")),
            created_at=_iso(row.get("created_at")),
            metadata=dict(row.get("metadata") or {}),
        )


@dataclass(frozen=True, slots=True, kw_only=True)
class AnswerClaim:
    """One claim inside an ``AnswerEnvelope``. Mirrors ``answer_claim`` plus
    ``claim_id``/``claim_type`` for DB round-tripping.

    Shape matches the PRD/spec literal contract:
    ``{text, evidence_state, supporting_observation_ids, doc_citations,
    uncertainty, safety_flag}``.
    """

    text: str
    evidence_state: EvidenceState
    supporting_observation_ids: list[str] = field(default_factory=list)
    doc_citations: list[dict[str, Any]] = field(default_factory=list)
    uncertainty: str | None = None
    safety_flag: bool = False
    claim_id: str | None = None
    claim_type: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "evidence_state", _coerce_state(self.evidence_state))

    @classmethod
    def from_row(cls, row: Mapping[str, Any]) -> AnswerClaim:
        return cls(
            claim_id=_opt_str(row.get("claim_id")),
            text=row["text"],
            claim_type=row.get("claim_type"),
            evidence_state=_coerce_state(row["evidence_state"]),
            supporting_observation_ids=[
                str(x) for x in (row.get("supporting_observation_ids") or [])
            ],
            doc_citations=list(row.get("doc_citations") or []),
            uncertainty=row.get("uncertainty"),
            safety_flag=bool(row.get("safety_flag", False)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "claim_id": self.claim_id,
            "text": self.text,
            "claim_type": self.claim_type,
            "evidence_state": self.evidence_state.value,
            "supporting_observation_ids": list(self.supporting_observation_ids),
            "doc_citations": list(self.doc_citations),
            "uncertainty": self.uncertainty,
            "safety_flag": self.safety_flag,
        }


@dataclass(frozen=True, slots=True, kw_only=True)
class AnswerEnvelope:
    """The grounded-answer contract for every Visual Technician surface
    (ADR-0027 D3, PRD Section 8). Thin clients render ``answer`` as prose but
    MUST receive the full envelope — never a weaker, uncited answer path.
    """

    answer: str
    claims: list[AnswerClaim] = field(default_factory=list)
    next_best_evidence: str | None = None
    safety_notes: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "answer": self.answer,
            "claims": [c.to_dict() for c in self.claims],
            "next_best_evidence": self.next_best_evidence,
            "safety_notes": list(self.safety_notes),
        }


@dataclass(frozen=True, slots=True, kw_only=True)
class QualityScore:
    """FR-3 image-quality-gate result. ``score`` in ``[0.0, 1.0]``."""

    score: float
    ok: bool
    reasons: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {"score": self.score, "ok": self.ok, "reasons": list(self.reasons)}

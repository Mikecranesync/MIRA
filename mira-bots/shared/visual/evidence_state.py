"""EvidenceState — the answer-claim / observation evidence vocabulary (ADR-0027 D2).

This enum is a VIEW over existing vocabularies, NOT a new one. ADR-0026's lesson
is binding: divergent provenance vocabularies with no documented mapping produce
silent breakage. Each state is defined by what backs it in systems that already
exist. Ships ONCE here (Python) + as a SQL CHECK in migration 063; a TypeScript
mirror lands when the Hub review UI needs it.

Mapping (ADR-0027 D2):
    VISIBLE                     -> an observation whose extractor read it off the image (OCR/vision).
    DOCUMENTED                  -> a cited knowledge_entries chunk, or a DrivePack item with
                                   provenance.tier in {manual_cited, bench_verified}.
    MACHINE_VERIFIED            -> a kg_entities/wiring_connections row with approval_state='verified'
                                   within the asset's revision scope (ADR-0017).
    LIKELY                      -> model inference; NEVER auto-written as a verified edge — lands as a
                                   proposed candidate with confidence.
    NEEDS_CONTEXT               -> no resolving observation/citation exists; triggers next-best-evidence.
    CONFLICTING                 -> >=2 observations disagree; the ADR-0017 `contradict` transition.
    FIELD_VERIFICATION_REQUIRED -> the Print Pack "APPROVABLE WITH FIELD VERIFICATION" tier / an open item.
    REJECTED / SUPERSEDED       -> the ADR-0017 rejected / superseded states.

Keep the string values byte-identical to migration 063's CHECK constraint.
"""

from __future__ import annotations

from enum import Enum


class EvidenceState(str, Enum):
    """String enum so a value is usable directly as a DB text value / JSON."""

    VISIBLE = "VISIBLE"
    DOCUMENTED = "DOCUMENTED"
    MACHINE_VERIFIED = "MACHINE_VERIFIED"
    LIKELY = "LIKELY"
    NEEDS_CONTEXT = "NEEDS_CONTEXT"
    CONFLICTING = "CONFLICTING"
    FIELD_VERIFICATION_REQUIRED = "FIELD_VERIFICATION_REQUIRED"
    REJECTED = "REJECTED"
    SUPERSEDED = "SUPERSEDED"

    # ── Semantics used by the composer / candidate builder ──────────────────

    def is_inference(self) -> bool:
        """LIKELY is the only state that is a model guess. It must never become a
        verified edge automatically (PRD FR-6, hard rule)."""
        return self is EvidenceState.LIKELY

    def may_become_verified_edge(self) -> bool:
        """Only directly-grounded states may back a candidate promoted toward the
        verified machine artifact. Inference / missing-context / conflict may NOT."""
        return self in {
            EvidenceState.VISIBLE,
            EvidenceState.DOCUMENTED,
            EvidenceState.MACHINE_VERIFIED,
        }

    def requires_next_evidence(self) -> bool:
        """States that mean 'the answer is blocked — ask for the single most useful
        next photo/sheet/label' (PRD FR-6)."""
        return self in {EvidenceState.NEEDS_CONTEXT, EvidenceState.CONFLICTING}

    def is_active(self) -> bool:
        """Excluded-from-current-answers-by-default states (retained for audit)."""
        return self not in {EvidenceState.REJECTED, EvidenceState.SUPERSEDED}


# The exact set the SQL CHECK in migration 063 enforces. A drift-guard test
# (tests/test_evidence_state_parity.py) asserts these match the migration.
ALL_STATES: tuple[str, ...] = tuple(s.value for s in EvidenceState)

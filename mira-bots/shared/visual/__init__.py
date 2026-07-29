"""MIRA Visual Technician — the persistent visual-evidence session spine.

ADR-0027. This package owns the VisualSession / EvidenceItem / RegionOfInterest /
Observation / AnswerClaim contracts (the genuine new surface) and wires the
EXISTING extraction workers (VisionWorker, PrintWorker, SchematicIntelligence)
and grounding (citation_compliance) into an evidence-graded, follow-up-capable
answer. Entity/connection candidates and pack revisions are NOT owned here —
they reuse kg_entities / wiring_connections / the Print Pack.
"""

from .evidence_state import EvidenceState

__all__ = ["EvidenceState"]

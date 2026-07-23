"""``DatasetRecord`` — one training example bound to its PR-1 governance envelope.

The governance layer (PR 1) decides whether a *source* may be trained on; a training example
carries the actual content (chat ``messages``) plus a human approval. This record joins the
two so dataset assembly can gate content by the source's eligibility without re-implementing
any governance logic — it delegates to the candidate's ``check()`` / ``assigned_split()``.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass

from factorylm_ai.adapters.source_candidate import SourceCandidate
from factorylm_ai.governance import eligibility as el

# The technician behaviors the grounding LoRA is meant to learn. The paid gate requires a
# floor of these so the dataset teaches calibrated uncertainty / honest refusal / correction
# — not just confident answers.
VALUED_INTERACTION_TYPES: frozenset[str] = frozenset({"uncertainty", "refusal", "correction"})

# An explicit tag marking a training example as safety-sensitive (LOTO / arc-flash / confined
# space / energized work). The readiness gate counts these by this tag ONLY — never by
# free-form inference over the message text, which would be unauditable.
SAFETY_SENSITIVE_TAG = "safety-sensitive"


@dataclass(frozen=True)
class DatasetRecord:
    """A training example (``messages``) plus its source governance envelope (``candidate``).

    Dataset-eligible only when the source passes the PR-1 gate (which already requires gold,
    resolved training rights, train-side lineage, validation, safety, provenance, non-sensitive)
    AND the example carries a human ``approved_by`` — the same approval the flywheel export
    write-gate requires."""

    candidate: SourceCandidate
    messages: list[dict]
    approved_by: str | None = None
    interaction_type: str | None = None
    tags: tuple[str, ...] = ()

    @property
    def record_id(self) -> str:
        return self.candidate.record_id

    @property
    def source_system(self) -> str:
        """The corpus adapter this example came from (``printsense`` / ``drive_commander`` /
        ``simlab`` / ``mira`` …) — used for readiness source-composition evidence."""
        return self.candidate.source_system

    @property
    def document_lineage_key(self) -> str | None:
        return self.candidate.document_lineage_key

    def eligibility(self) -> el.EligibilityResult:
        return self.candidate.check()

    def is_dataset_eligible(self) -> bool:
        """Governance-eligible AND human-approved."""
        return self.eligibility().eligible and bool(self.approved_by)

    def is_valued_interaction(self) -> bool:
        return (self.interaction_type or "") in VALUED_INTERACTION_TYPES

    def is_safety_sensitive(self) -> bool:
        """Safety-sensitive only when explicitly tagged :data:`SAFETY_SENSITIVE_TAG` — the
        readiness gate never infers this from free-form message text."""
        return SAFETY_SENSITIVE_TAG in self.tags

    def content_hash(self) -> str:
        """A stable hash of the training content — the manifest's per-record content address
        when the source carries no evidence id."""
        return hashlib.sha256(
            json.dumps(self.messages, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

    def token_estimate(self) -> int:
        """Conservative token count (chars/4, rounded up) for cost estimation. Over-estimating
        keeps the paid-gate cost check fail-closed."""
        chars = sum(len(str(m.get("content", ""))) for m in self.messages)
        return (chars + 3) // 4

    def to_manifest_entry(self) -> dict:
        """The identity/governance fields the corpus manifest hashes over.

        ``content_hash`` is ALWAYS the hash of the training content (``messages``): the
        manifest is a fingerprint of what would be trained on, so changed ``messages`` MUST
        change the manifest even when the source's ``evidence_id`` is unchanged. The source
        evidence id is kept separately (``source_evidence_id``) for provenance — it is NOT the
        content address, because one source document can yield many distinct training examples."""
        return {
            "record_id": self.record_id,
            "document_lineage_key": self.document_lineage_key,
            "split": self.candidate.assigned_split(),
            "content_hash": self.content_hash(),
            "source_evidence_id": self.candidate.evidence_id,
            "training_eligibility": self.eligibility().training_eligibility,
        }

    def to_leakage_record(self) -> dict:
        """The light dict the PR-1 leakage guard consumes."""
        return self.candidate.to_leakage_record()

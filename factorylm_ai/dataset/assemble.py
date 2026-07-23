"""Assemble dataset v0 from governance-enveloped training records.

Partitions :class:`DatasetRecord` s into the **training-eligible** set (governance PASS AND
human-approved) and a typed **reject** list carrying each blocked record's reasons, then
computes a reproducible, content-addressed corpus manifest over the eligible set (reusing the
PR-1 :func:`factorylm_ai.governance.manifest.corpus_manifest`). Pure — no I/O, no network.
"""

from __future__ import annotations

from dataclasses import dataclass

from factorylm_ai.governance import manifest as mf
from factorylm_ai.governance import rejection_codes as rc
from factorylm_ai.governance import splits as sp

from .record import MESSAGE_INVALID, DatasetRecord

# A dataset-layer reason (not a governance code): the source is eligible but the example was
# never human-approved for export.
APPROVAL_MISSING = "APPROVAL_MISSING"


@dataclass(frozen=True)
class RejectedRecord:
    """A record excluded from dataset v0, with its typed reasons."""

    record_id: str
    codes: list[str]
    approved: bool

    def to_dict(self) -> dict:
        return {"record_id": self.record_id, "codes": self.codes, "approved": self.approved}


@dataclass
class DatasetV0:
    """The assembled dataset: the eligible training records, the rejects, and the manifest.

    ``source_systems`` is derived from the **eligible** (trainable) set ONLY — a rejected record
    does NOT count toward source representation, or a rejected Drive Commander record with
    unresolved rights could satisfy the trainable-source requirement while the actual training set
    is all PrintSense."""

    dataset_version: str
    eligible: list[DatasetRecord]
    rejected: list[RejectedRecord]
    manifest: dict

    @property
    def record_count(self) -> int:
        return len(self.eligible)

    @property
    def lineage_keys(self) -> set[str]:
        return {r.document_lineage_key for r in self.eligible if r.document_lineage_key}

    @property
    def lineage_count(self) -> int:
        return len(self.lineage_keys)

    @property
    def valued_interaction_count(self) -> int:
        return sum(1 for r in self.eligible if r.is_valued_interaction())

    @property
    def safety_sensitive_count(self) -> int:
        """Eligible training examples explicitly tagged safety-sensitive."""
        return sum(1 for r in self.eligible if r.is_safety_sensitive())

    @property
    def source_systems(self) -> set[str]:
        return {r.source_system for r in self.eligible}

    def invalid_eligible_records(self) -> list[DatasetRecord]:
        """Eligible records that do NOT actually satisfy :meth:`DatasetRecord.is_dataset_eligible`.

        :func:`assemble_dataset_v0` never admits such a record, but a :class:`DatasetV0` can be
        constructed by hand. The paid gate re-checks this so a hand-assembled dataset cannot
        smuggle unapproved or governance-ineligible content past the counts/rights/splits."""
        return [r for r in self.eligible if not r.is_dataset_eligible()]

    def invalid_message_records(self) -> list[DatasetRecord]:
        """Eligible records whose chat payload is not valid training content."""
        return [r for r in self.eligible if not r.messages_valid()]

    def leakage(self) -> list[rc.Rejection]:
        """Run the PR-1 leakage guard over the eligible set (empty ⇒ clean)."""
        return sp.find_leakage([r.to_leakage_record() for r in self.eligible])

    def to_dict(self) -> dict:
        return {
            "dataset_version": self.dataset_version,
            "record_count": self.record_count,
            "lineage_count": self.lineage_count,
            "valued_interaction_count": self.valued_interaction_count,
            "safety_sensitive_count": self.safety_sensitive_count,
            "source_systems": sorted(self.source_systems),
            "rejected_count": len(self.rejected),
            "manifest_sha256": self.manifest.get("manifest_sha256"),
        }


def assemble_dataset_v0(records: list[DatasetRecord], *, dataset_version: str = "v0") -> DatasetV0:
    """Partition ``records`` into dataset v0's eligible set + typed rejects, and build the
    reproducible manifest over the eligible set.

    A record is eligible only when the governance gate passes AND it is human-approved.
    Rejected records carry the governance rejection codes, plus ``APPROVAL_MISSING`` when the
    only thing missing is the human approval."""
    eligible: list[DatasetRecord] = []
    rejected: list[RejectedRecord] = []
    for r in records:
        result = r.eligibility()
        approved = bool(r.approved_by)
        message_errors = r.message_validation_errors()
        if result.eligible and approved and not message_errors:
            eligible.append(r)
            continue
        codes = list(result.codes)
        if not approved:
            codes.append(APPROVAL_MISSING)
        if message_errors:
            codes.append(MESSAGE_INVALID)
        rejected.append(RejectedRecord(record_id=r.record_id, codes=codes, approved=approved))

    manifest = mf.corpus_manifest(
        [r.to_manifest_entry() for r in eligible], dataset_version=dataset_version
    )
    return DatasetV0(
        dataset_version=dataset_version,
        eligible=eligible,
        rejected=rejected,
        manifest=manifest,
    )

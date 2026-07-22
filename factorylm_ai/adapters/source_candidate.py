"""The shared ``SourceCandidate`` shape every corpus adapter produces (PR 2).

A candidate carries the *signals* the PR-1 governance gate needs, plus the pieces an
adapter is uniquely responsible for getting right: a real ``document_lineage_key`` (never
a bare content/pack hash — those are evidence identifiers, kept in ``evidence_id``) and a
fail-closed ``corpus-source.v1`` rights object. The candidate itself does no policy: it
lowers into governance and lets ``resolve_rights`` / ``assign_split`` /
``check_training_eligibility`` / ``find_leakage`` decide.

Pure + deterministic. No I/O, no network.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from factorylm_ai.governance import eligibility as el
from factorylm_ai.governance import lineage as ln
from factorylm_ai.governance import splits as sp
from factorylm_ai.governance.rights import RightsStatus, resolve_rights

CORPUS_SOURCE_SCHEMA = "factorylm.clf.corpus-source.v1"

# A sentinel gold status for material that has NOT been human/proof-graded. The gate
# treats anything != "gold" as NOT_GOLD, so this is simply an honest default.
UNGRADED = "ungraded"


def build_corpus_source(
    *,
    license_class: str,
    confidentiality_class: str,
    rights_resolved: bool = False,
    training_allowed: bool = False,
    evaluation_allowed: bool = False,
    public_export_allowed: bool = False,
    cross_tenant_reuse_allowed: bool = False,
    derivatives_retained: bool = False,
    policy_ref: str | None = None,
) -> dict:
    """Assemble a ``corpus-source.v1`` dict for :func:`resolve_rights`.

    Every rights flag defaults ``False`` (fail closed) — an adapter must set a flag on
    purpose. ``resolve_rights`` still overrides: an unknown/eval-only license can never
    train regardless of the flags passed here."""
    return {
        "schema": CORPUS_SOURCE_SCHEMA,
        "license_class": license_class,
        "confidentiality_class": confidentiality_class,
        "rights": {
            "rights_resolved": rights_resolved,
            "training_allowed": training_allowed,
            "evaluation_allowed": evaluation_allowed,
            "public_export_allowed": public_export_allowed,
            "cross_tenant_reuse_allowed": cross_tenant_reuse_allowed,
            "derivatives_retained": derivatives_retained,
            "policy_ref": policy_ref,
        },
    }


def frozen_lineage_key(source: str, ident: str) -> str:
    """A stable ``<source>:<ident>`` lineage key for synthetic/frozen benchmark material.

    Passes PR-1 lineage validation (non-empty, not a bare content hash) so a SimLab
    scenario or a frozen MIRA benchmark has a durable lineage that never forks per run."""
    s, i = ln.slug(source), ln.slug(ident)
    if not s or not i:
        raise ValueError("frozen lineage key needs a source and an identifier")
    key = f"{s}:{i}"
    if ln.is_bare_content_hash(key):  # defensive — a slugged colon-form is never 64-hex
        raise ValueError("frozen lineage key must not be a bare content hash")
    return key


@dataclass(frozen=True)
class SourceCandidate:
    """One corpus record, normalized to feed the PR-1 governance gate.

    ``corpus_source`` is a ``corpus-source.v1`` dict resolved by :func:`resolve_rights`
    (never poked directly). ``document_lineage_key`` must be a real lineage key — a bare
    content hash is rejected at construction. Content/pack/render/crop hashes live in
    ``evidence_id`` and are never used as lineage."""

    source_system: str
    record_id: str
    document_lineage_key: str | None
    corpus_source: dict
    gold_status: str = UNGRADED
    validation_passed: bool = False
    safety_status: str = el.SAFETY_CLEAR
    provenance_present: bool = False
    schema_valid: bool = True
    frozen_eval: bool = False
    sensitive: bool = False
    tenant_id: str | None = None
    confidentiality_class: str | None = None
    evidence_id: str | None = None
    metadata: dict = field(default_factory=dict)

    def __post_init__(self) -> None:
        key = self.document_lineage_key
        if key is not None and ln.is_bare_content_hash(key):
            raise ValueError(
                "document_lineage_key must not be a bare content hash — a hash forks the "
                "lineage on every revision; use a public/tenant/frozen lineage key and "
                "keep the hash in evidence_id"
            )

    @property
    def rights(self) -> RightsStatus:
        """Fail-closed rights, resolved once from ``corpus_source``."""
        return resolve_rights(self.corpus_source)

    def assigned_split(self) -> str | None:
        """The deterministic split for this candidate's lineage (``None`` if it has no
        usable lineage key). Assignment is always via :func:`governance.lineage.assign_split`
        so every sibling of a lineage lands in the same partition."""
        key = self.document_lineage_key
        if not key or ln.is_bare_content_hash(key):
            return None
        return ln.assign_split(key)

    def to_eligibility_input(self) -> el.EligibilityInput:
        """Lower into the PR-1 gate's input. A missing lineage becomes an empty split so
        the gate fails it closed (LINEAGE_MISSING + SPLIT_INVALID)."""
        split = self.assigned_split()
        return el.EligibilityInput(
            gold_status=self.gold_status,
            rights=self.rights,
            split=split if split is not None else "",
            document_lineage_key=self.document_lineage_key,
            validation_passed=self.validation_passed,
            safety_status=self.safety_status,
            provenance_present=self.provenance_present,
            schema_valid=self.schema_valid,
            frozen_eval=self.frozen_eval,
            sensitive=self.sensitive,
            tenant_id=self.tenant_id,
            confidentiality_class=self.confidentiality_class,
        )

    def check(self) -> el.EligibilityResult:
        """Run the training-eligibility gate on this candidate."""
        return el.check_training_eligibility(self.to_eligibility_input())

    def is_training_eligible(self) -> bool:
        return self.check().eligible

    def to_leakage_record(self) -> dict:
        """A light dict for :func:`governance.splits.find_leakage` — lineage, its assigned
        split, and this candidate's own training-eligibility (so the guard can catch an
        eligible record that landed on the eval side)."""
        return {
            "record_id": self.record_id,
            "document_lineage_key": self.document_lineage_key,
            "split": self.assigned_split(),
            "training_eligibility": self.check().training_eligibility,
        }


def find_candidate_leakage(candidates: list[SourceCandidate]) -> list:
    """Convenience: run the PR-1 leakage guard over a set of candidates."""
    return sp.find_leakage([c.to_leakage_record() for c in candidates])

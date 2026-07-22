"""Shared machine-readable rejection codes (addendum §19 — the superset).

Defined ONCE here so both the PR-1 export-eligibility gate and the synthetic
Evidence Critic consume the same vocabulary (reconciliation note §7). A rejection
is always a typed code + human detail, never a free-text-only log line.
"""

from __future__ import annotations

from dataclasses import dataclass

# Rights / governance
RIGHTS_UNRESOLVED = "RIGHTS_UNRESOLVED"
TRAINING_NOT_ALLOWED = "TRAINING_NOT_ALLOWED"
NOT_GOLD = "NOT_GOLD"
SENSITIVE_TENANT = "SENSITIVE_TENANT"
PROVENANCE_MISSING = "PROVENANCE_MISSING"
VALIDATION_FAILED = "VALIDATION_FAILED"
# Lineage / leakage
LINEAGE_MISSING = "LINEAGE_MISSING"
LINEAGE_ON_EVAL_SIDE = "LINEAGE_ON_EVAL_SIDE"
HELD_OUT = "HELD_OUT"
FROZEN_EVAL = "FROZEN_EVAL"
DUPLICATE = "DUPLICATE"
NEAR_DUPLICATE = "NEAR_DUPLICATE"
# Synthetic-flywheel specific
AGENT_DISAGREEMENT = "AGENT_DISAGREEMENT"
SAFETY_REVIEW_REQUIRED = "SAFETY_REVIEW_REQUIRED"
ANSWER_KEY_WEAK = "ANSWER_KEY_WEAK"
SCHEMA_INVALID = "SCHEMA_INVALID"

ALL_CODES: frozenset[str] = frozenset(
    {
        RIGHTS_UNRESOLVED,
        TRAINING_NOT_ALLOWED,
        NOT_GOLD,
        SENSITIVE_TENANT,
        PROVENANCE_MISSING,
        VALIDATION_FAILED,
        LINEAGE_MISSING,
        LINEAGE_ON_EVAL_SIDE,
        HELD_OUT,
        FROZEN_EVAL,
        DUPLICATE,
        NEAR_DUPLICATE,
        AGENT_DISAGREEMENT,
        SAFETY_REVIEW_REQUIRED,
        ANSWER_KEY_WEAK,
        SCHEMA_INVALID,
    }
)

# Codes that force a HUMAN_REVIEW hop rather than an outright reject (a human may
# still salvage the case as eval-only / a rule / a negative example).
REVIEW_NOT_REJECT: frozenset[str] = frozenset(
    {AGENT_DISAGREEMENT, SAFETY_REVIEW_REQUIRED, ANSWER_KEY_WEAK}
)


@dataclass(frozen=True)
class Rejection:
    """A typed rejection: a code from :data:`ALL_CODES` + a human-readable detail."""

    code: str
    detail: str = ""

    def __post_init__(self) -> None:
        if self.code not in ALL_CODES:
            raise ValueError(f"unknown rejection code: {self.code!r}")

    def forces_review(self) -> bool:
        return self.code in REVIEW_NOT_REJECT

    def to_dict(self) -> dict:
        return {"code": self.code, "detail": self.detail}

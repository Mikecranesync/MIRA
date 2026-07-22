"""Fail-closed rights resolution over `corpus-source.v1` (CLF data-rights law).

Rights FAIL CLOSED: ``rights_resolved=false`` OR any flag absent ⇒ the capability
is denied. ``license_class`` of ``unknown`` also denies training. Only an explicit
``true`` on a resolved manifest grants a discretionary capability. This is the one
place the `corpus-source.v1` rights object is interpreted; every governance gate
reads a :class:`RightsStatus` from here rather than poking the raw dict.
"""

from __future__ import annotations

from dataclasses import dataclass

CORPUS_SOURCE_SCHEMA = "factorylm.clf.corpus-source.v1"

LICENSE_PUBLIC_EVAL_ONLY = "public-eval-only"
LICENSE_PUBLIC_EVAL_AND_TRAIN = "public-eval-and-train"
LICENSE_CUSTOMER_PRIVATE = "customer-private"
LICENSE_SYNTHETIC = "synthetic"
LICENSE_UNKNOWN = "unknown"

# License classes that can EVER permit training (still gated by the rights flags).
_TRAINABLE_LICENSES: frozenset[str] = frozenset(
    {LICENSE_PUBLIC_EVAL_AND_TRAIN, LICENSE_CUSTOMER_PRIVATE, LICENSE_SYNTHETIC}
)


@dataclass(frozen=True)
class RightsStatus:
    """Resolved, fail-closed rights. Every field defaults False — an absent flag
    is a denied flag."""

    rights_resolved: bool = False
    training_allowed: bool = False
    evaluation_allowed: bool = False
    public_export_allowed: bool = False
    cross_tenant_reuse_allowed: bool = False
    derivatives_retained: bool = False
    license_class: str = LICENSE_UNKNOWN
    confidentiality_class: str = "unknown"
    policy_ref: str | None = None

    def to_dict(self) -> dict:
        return {
            "rights_resolved": self.rights_resolved,
            "training_allowed": self.training_allowed,
            "evaluation_allowed": self.evaluation_allowed,
            "public_export_allowed": self.public_export_allowed,
            "cross_tenant_reuse_allowed": self.cross_tenant_reuse_allowed,
            "derivatives_retained": self.derivatives_retained,
            "license_class": self.license_class,
            "confidentiality_class": self.confidentiality_class,
            "policy_ref": self.policy_ref,
        }


def _flag(rights: dict, name: str) -> bool:
    """A flag is True only when explicitly present AND boolean-true (fail closed)."""
    return rights.get(name) is True


def resolve_rights(corpus_source: dict) -> RightsStatus:
    """Interpret a `corpus-source.v1` dict into a fail-closed :class:`RightsStatus`.

    Any missing rights object, unresolved rights, or unknown license denies
    training regardless of the individual flags."""
    rights = corpus_source.get("rights") or {}
    resolved = _flag(rights, "rights_resolved")
    license_class = corpus_source.get("license_class", LICENSE_UNKNOWN) or LICENSE_UNKNOWN

    # training requires: resolved rights AND the explicit flag AND a trainable license.
    training = (
        resolved and _flag(rights, "training_allowed") and license_class in _TRAINABLE_LICENSES
    )
    evaluation = resolved and _flag(rights, "evaluation_allowed")
    return RightsStatus(
        rights_resolved=resolved,
        training_allowed=training,
        evaluation_allowed=evaluation,
        public_export_allowed=resolved and _flag(rights, "public_export_allowed"),
        cross_tenant_reuse_allowed=resolved and _flag(rights, "cross_tenant_reuse_allowed"),
        derivatives_retained=resolved and _flag(rights, "derivatives_retained"),
        license_class=license_class,
        confidentiality_class=corpus_source.get("confidentiality_class", "unknown") or "unknown",
        policy_ref=rights.get("policy_ref"),
    )

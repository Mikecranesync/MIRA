"""The pre-export training-eligibility gate (CLF promotion-policy §"third gate").

Training eligibility is **not** implied by gold, and **`approved_by` alone is
insufficient**. A record is exportable for training only when ALL hold (fail
closed — any doubt is ineligible), each reported as a typed governance rejection
code so callers get a machine-readable reason set:

1. schema-valid, with a real ``document_lineage_key`` (not a bare content hash),
2. ``gold_status == "gold"`` (a human/proof approval, never a model's own output),
3. ``rights.training_allowed == true`` on resolved rights (else RIGHTS_UNRESOLVED /
   TRAINING_NOT_ALLOWED),
4. not a frozen eval-only row, not ``held_out``, and its lineage on the **train**
   side (never validation/test),
5. validation passed (unresolved contradictions ⇒ VALIDATION_FAILED),
6. safety clear or explicitly approved,
7. provenance present,
8. sensitive/tenant policy passed (customer-private stays private by default).

Consumes the shared ``factorylm_ai.governance.rejection_codes`` vocabulary. Pure:
signals in, an :class:`EligibilityResult` out. No I/O.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from . import lineage as ln
from . import rejection_codes as rc
from . import splits as sp
from .rights import LICENSE_CUSTOMER_PRIVATE, RightsStatus

GOLD = "gold"
SAFETY_CLEAR = "clear"
SAFETY_APPROVED = "approved"  # a human explicitly approved a safety-sensitive case

_TENANT_CONFIDENTIAL = "customer-confidential"


@dataclass
class EligibilityInput:
    """Every signal the gate needs. A corpus adapter (PR 2) fills these from a
    source record; the gate never trusts a single field to imply the rest."""

    gold_status: str
    rights: RightsStatus
    split: str
    document_lineage_key: str | None = None
    validation_passed: bool = False
    safety_status: str = SAFETY_CLEAR
    provenance_present: bool = False
    schema_valid: bool = True
    frozen_eval: bool = False
    sensitive: bool = False
    tenant_id: str | None = None
    confidentiality_class: str | None = None


@dataclass
class EligibilityResult:
    eligible: bool
    rejections: list[rc.Rejection] = field(default_factory=list)

    @property
    def training_eligibility(self) -> str:
        return "eligible" if self.eligible else "ineligible"

    @property
    def codes(self) -> list[str]:
        return [r.code for r in self.rejections]

    def to_dict(self) -> dict:
        return {
            "training_eligibility": self.training_eligibility,
            "eligible": self.eligible,
            "rejections": [r.to_dict() for r in self.rejections],
        }


def check_training_eligibility(inp: EligibilityInput) -> EligibilityResult:
    """Return the full set of blocking reasons (empty ⇒ eligible). Fail closed."""
    rej: list[rc.Rejection] = []
    split = ln.canonical_split(inp.split)

    if not inp.schema_valid:
        rej.append(rc.Rejection(rc.SCHEMA_INVALID, "record failed schema validation"))

    key = inp.document_lineage_key
    if not key:
        rej.append(rc.Rejection(rc.LINEAGE_MISSING, "no document_lineage_key"))
    elif ln.is_bare_content_hash(key):
        rej.append(rc.Rejection(rc.LINEAGE_MISSING, "lineage key is a bare content hash"))

    # gate 2 — gold (human/proof approval); approved_by alone is NOT gold.
    if inp.gold_status != GOLD:
        rej.append(rc.Rejection(rc.NOT_GOLD, f"gold_status={inp.gold_status!r} (not gold)"))

    # gate 3 — rights, fail closed.
    if not inp.rights.rights_resolved:
        rej.append(rc.Rejection(rc.RIGHTS_UNRESOLVED, "rights not resolved"))
    if not inp.rights.training_allowed:
        rej.append(
            rc.Rejection(
                rc.TRAINING_NOT_ALLOWED,
                f"training_allowed=false (license={inp.rights.license_class})",
            )
        )

    # gate 4 — lineage side / quarantine / frozen.
    if inp.frozen_eval:
        rej.append(rc.Rejection(rc.FROZEN_EVAL, "frozen eval-only row"))
    split_rej = sp.training_split_rejection(split)
    if split_rej:
        rej.append(split_rej)

    # gate 5 — validation (unresolved contradictions fail here).
    if not inp.validation_passed:
        rej.append(rc.Rejection(rc.VALIDATION_FAILED, "evidence validation did not pass"))

    # gate 6 — safety.
    if inp.safety_status not in (SAFETY_CLEAR, SAFETY_APPROVED):
        rej.append(rc.Rejection(rc.SAFETY_REVIEW_REQUIRED, f"safety_status={inp.safety_status!r}"))

    # gate 7 — provenance.
    if not inp.provenance_present:
        rej.append(rc.Rejection(rc.PROVENANCE_MISSING, "provenance chain missing"))

    # gate 8 — sensitive / tenant. Customer-private stays private by default; a
    # tenant record needs explicit cross-tenant reuse rights to enter a shared corpus.
    tenant_blocked = inp.tenant_id is not None and not inp.rights.cross_tenant_reuse_allowed
    confidentiality_class = inp.confidentiality_class or inp.rights.confidentiality_class
    customer_private = inp.rights.license_class == LICENSE_CUSTOMER_PRIVATE
    if inp.sensitive or tenant_blocked or customer_private or confidentiality_class != "public":
        rej.append(
            rc.Rejection(
                rc.SENSITIVE_TENANT,
                f"sensitive/tenant record (conf={confidentiality_class}, tenant={inp.tenant_id})",
            )
        )

    return EligibilityResult(eligible=not rej, rejections=rej)

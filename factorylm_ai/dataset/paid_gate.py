"""The Phase-3 paid gate — evidence that a metered fine-tune run is justified.

The plan's paid gate (technician-grounding LoRA program), tightened per the parent-plan
addendum. A metered LoRA-SFT job is only justified when the assembled dataset v0 clears ALL of
a **fixed** policy (the thresholds are module constants — NOT caller-configurable, so the gate
cannot be relaxed at a call site):

1. every eligible record is *actually* dataset-eligible (governance PASS AND human-approved),
2. ``>= 100`` training-eligible records,
3. ``>= 20`` distinct document lineages,
4. ``>= 20`` uncertainty/refusal/correction (valued) interactions,
5. every eligible record's source rights allow training — AND a rights report is referenced,
6. no held-out contamination (leakage guard clean; every eligible record on the train side),
7. ``>= 5`` reserved held-out lineages, each a real key that deterministically assigns to
   ``held_out`` (the keys are audited, not just counted),
8. ``>= 15`` safety-sensitive training examples (explicitly tagged),
9. **trainable** PrintSense AND Drive Commander representation in the *eligible* set,
10. a frozen SimLab/MIRA benchmark baseline is referenced (benchmark bucket — SimLab/MIRA are
    eval-only and never training records, so their representation is attested, not trained),
11. a real-vs-synthetic composition report is referenced,
12. a base-vs-tools benchmark report is referenced,
13. estimated cost ``<= $5`` (LoRA-SFT, base ``<= 16B``),
14. base-model serverless FT support confirmed — with provenance (the intended ``together`` +
    ``Qwen/Qwen3.5-9B`` target, an ISO ``checked_at``, and a recognized method / receipt).

**This is EVIDENCE, not an action.** :func:`evaluate_paid_gate` computes PASS/BLOCKED, the
per-check detail, and an ``evidence`` block of the audit refs; it never spends, never calls the
network, never launches a job. A PASS is *necessary but not sufficient* — the actual metered run
still requires Mike's explicit go (spend law). Reuses the frozen pricing constants; adds no new
pricing policy.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime

from factorylm_ai.governance import lineage as ln
from factorylm_ai.pricing import FT_LORA_SFT_USD_PER_MTOK_LE16B, FT_MIN_JOB_USD

from .assemble import DatasetV0

# ── Fixed Phase-3 policy (module constants — NOT overridable at a call site) ──────────────────
MIN_RECORDS = 100
MIN_LINEAGES = 20
MIN_VALUED_INTERACTIONS = 20
MIN_HELD_OUT_LINEAGES = 5
MIN_SAFETY_SENSITIVE = 15
COST_CAP_USD = 5.00
DEFAULT_EPOCHS = 3

# The intended paid-event target. Model-support evidence for anything else is not evidence for
# THIS job — it must name this provider + base model.
TARGET_PROVIDER = "together"
TARGET_MODEL_ID = "Qwen/Qwen3.5-9B"
ALLOWED_MODEL_CHECK_METHODS: frozenset[str] = frozenset({"serverless-catalog", "api-probe"})

# The corpus's *trainable* set must draw from both technician-facing sources. SimLab/MIRA are
# eval-only by construction (never a training record) — their representation is a benchmark
# baseline reference, checked separately.
REQUIRED_TRAINABLE_SOURCES: frozenset[str] = frozenset({"printsense", "drive_commander"})

VERDICT_PASS = "PAID_GATE_PASS"
VERDICT_BLOCKED = "PAID_GATE_BLOCKED"


def estimate_finetune_cost(
    train_tokens: int,
    *,
    epochs: int = DEFAULT_EPOCHS,
    rate_usd_per_mtok: float = FT_LORA_SFT_USD_PER_MTOK_LE16B,
) -> float:
    """Conservative LoRA-SFT cost estimate for a base ``<= 16B`` (e.g. ``Qwen/Qwen3.5-9B``).

    Together bills per token processed across all epochs; a job is floored at
    :data:`~factorylm_ai.pricing.FT_MIN_JOB_USD`. Over-estimation is deliberate — the cost
    check must fail closed, never a false pass."""
    raw = (max(0, train_tokens) * max(1, epochs) / 1_000_000) * rate_usd_per_mtok
    return max(FT_MIN_JOB_USD, raw)


def _is_iso_timestamp(value: object) -> bool:
    """True when ``value`` is a parseable ISO-8601 timestamp string (``Z`` accepted)."""
    if not isinstance(value, str) or not value:
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


@dataclass(frozen=True)
class ReadinessEvidence:
    """Auditable corpus-level readiness evidence the gate cannot derive from the training records.

    Held-out lineages are quarantined benchmark lineages that never become training records, so
    they are supplied as **keys** (not a bare count) and validated — unique, and each must
    deterministically assign to the ``held_out`` split. The ``*_ref`` fields point at the reports
    the spec requires (corpus/rights/synthetic-composition/frozen-benchmark/base-vs-tools); a
    check that depends on a report passes only when its ref is non-empty. Everything defaults to
    the fail-closed value so an unset field BLOCKS its check."""

    held_out_lineage_keys: tuple[str, ...] = ()
    synthetic_composition_report_ref: str | None = None
    base_vs_tools_benchmark_ref: str | None = None
    rights_report_ref: str | None = None
    frozen_benchmark_baseline_ref: str | None = None

    def unique_held_out_keys(self) -> set[str]:
        return set(self.held_out_lineage_keys)

    def held_out_keys_valid(self) -> bool:
        """Keys are unique AND each deterministically assigns to ``held_out``."""
        keys = self.held_out_lineage_keys
        if not keys or len(set(keys)) != len(keys):
            return False
        return all(ln.assign_split(k) == ln.SPLIT_HELD_OUT for k in keys)

    def held_out_count(self) -> int:
        return len(self.unique_held_out_keys())


@dataclass(frozen=True)
class ModelSupportEvidence:
    """Provenance that the *target* base model's serverless FT support was actually checked.

    A bare ``supported=True`` is not evidence — the check passes only when the evidence names the
    intended paid-event target (``together`` + ``Qwen/Qwen3.5-9B``), carries a parseable ISO
    ``checked_at``, and used a recognized ``method`` (or supplies a ``receipt_ref``). Pure: this
    records the result of a check; it does NOT perform one (the live probe is PR 4)."""

    model_id: str
    provider: str
    checked_at: str
    method: str
    supported: bool
    receipt_ref: str | None = None

    def rejection_reason(self) -> str | None:
        """Why this evidence does NOT confirm support (``None`` when it does)."""
        if not self.supported:
            return f"model {self.model_id!r} NOT supported for serverless FT"
        if self.model_id != TARGET_MODEL_ID:
            return f"wrong model {self.model_id!r} (target {TARGET_MODEL_ID!r})"
        if self.provider != TARGET_PROVIDER:
            return f"wrong provider {self.provider!r} (target {TARGET_PROVIDER!r})"
        if not _is_iso_timestamp(self.checked_at):
            return f"checked_at {self.checked_at!r} is not an ISO timestamp"
        if self.method not in ALLOWED_MODEL_CHECK_METHODS and not self.receipt_ref:
            return f"method {self.method!r} not recognized and no receipt_ref"
        return None

    def is_confirmed(self) -> bool:
        return self.rejection_reason() is None

    def to_dict(self) -> dict:
        return {
            "model_id": self.model_id,
            "provider": self.provider,
            "checked_at": self.checked_at,
            "method": self.method,
            "supported": self.supported,
            "receipt_ref": self.receipt_ref,
            "confirmed": self.is_confirmed(),
        }


@dataclass(frozen=True)
class GateCheck:
    name: str
    passed: bool
    detail: str

    def to_dict(self) -> dict:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


@dataclass
class PaidGateReport:
    passed: bool
    verdict: str
    checks: list[GateCheck]
    evidence: dict = field(default_factory=dict)

    @property
    def blocking(self) -> list[str]:
        return [c.name for c in self.checks if not c.passed]

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "verdict": self.verdict,
            "blocking": self.blocking,
            "checks": [c.to_dict() for c in self.checks],
            "evidence": self.evidence,
        }


def evaluate_paid_gate(
    dataset: DatasetV0,
    *,
    readiness: ReadinessEvidence | None = None,
    model_support: ModelSupportEvidence | None = None,
    est_cost_usd: float | None = None,
    train_tokens: int | None = None,
) -> PaidGateReport:
    """Evaluate the fixed Phase-3 paid gate over an assembled dataset. Evidence only — no spend,
    no network, no job launch. Thresholds are module constants and are **not** parameters: the
    policy cannot be relaxed at a call site.

    ``readiness`` / ``model_support`` default to fail-closed evidence (an absent object BLOCKS the
    checks it feeds). The cost used is the ``max`` of the dataset's own token-derived estimate and
    any supplied ``est_cost_usd`` / ``train_tokens`` estimate, so a supplied value can never
    *under*-state a known cost."""
    readiness = readiness or ReadinessEvidence()
    checks: list[GateCheck] = []

    # 1. Re-assert dataset eligibility over the eligible set — a hand-built DatasetV0 can lie.
    invalid = dataset.invalid_eligible_records()
    checks.append(
        GateCheck(
            "all_records_dataset_eligible",
            not invalid,
            "every eligible record is governance-eligible AND approved"
            if not invalid
            else f"{len(invalid)} 'eligible' record(s) are NOT dataset-eligible: "
            f"{[r.record_id for r in invalid]}",
        )
    )

    n = dataset.record_count
    checks.append(
        GateCheck("min_records", n >= MIN_RECORDS, f"{n} eligible (need >= {MIN_RECORDS})")
    )

    lineages = dataset.lineage_count
    checks.append(
        GateCheck(
            "min_lineages",
            lineages >= MIN_LINEAGES,
            f"{lineages} lineages (need >= {MIN_LINEAGES})",
        )
    )

    valued = dataset.valued_interaction_count
    checks.append(
        GateCheck(
            "min_valued_interactions",
            valued >= MIN_VALUED_INTERACTIONS,
            f"{valued} uncertainty/refusal/correction (need >= {MIN_VALUED_INTERACTIONS})",
        )
    )

    # 5. Rights: every eligible source trainable AND a rights report referenced.
    all_train_allowed = all(r.candidate.rights.training_allowed for r in dataset.eligible)
    rights_ref_ok = bool(readiness.rights_report_ref)
    rights_ok = all_train_allowed and rights_ref_ok
    if not all_train_allowed:
        rights_detail = "an eligible record's source is not training_allowed"
    elif not rights_ref_ok:
        rights_detail = "rights report ref missing"
    else:
        rights_detail = "every eligible source allows training; rights report referenced"
    checks.append(GateCheck("all_rights_training_allowed", rights_ok, rights_detail))

    leaks = dataset.leakage()
    all_train_side = all(r.candidate.assigned_split() == "train" for r in dataset.eligible)
    no_contamination = not leaks and all_train_side
    checks.append(
        GateCheck(
            "no_held_out_contamination",
            no_contamination,
            "leakage guard clean; all eligible on train side"
            if no_contamination
            else f"contamination: {[x.code for x in leaks]} train_side={all_train_side}",
        )
    )

    # 7. Held-out benchmark reserved — audited keys, not a trusted count.
    held_valid = readiness.held_out_keys_valid()
    held_count = readiness.held_out_count()
    held_ok = held_valid and held_count >= MIN_HELD_OUT_LINEAGES
    if not held_valid:
        held_detail = "held-out keys invalid (non-unique, empty, or not on the held_out split)"
    else:
        held_detail = f"{held_count} held-out lineages reserved (need >= {MIN_HELD_OUT_LINEAGES})"
    checks.append(GateCheck("min_held_out_lineages", held_ok, held_detail))

    # 8. Safety-sensitive coverage in the training data (explicitly tagged).
    safety = dataset.safety_sensitive_count
    checks.append(
        GateCheck(
            "min_safety_sensitive",
            safety >= MIN_SAFETY_SENSITIVE,
            f"{safety} safety-sensitive examples (need >= {MIN_SAFETY_SENSITIVE})",
        )
    )

    # 9. Trainable source representation — DERIVED from the eligible records themselves, never
    # the cached `dataset.source_systems` field (a hand-built DatasetV0 could set that field to
    # claim a source its eligible set does not actually contain). Same re-derive-from-records
    # discipline as `all_records_dataset_eligible` above.
    present = {r.source_system for r in dataset.eligible}
    missing_required = sorted(REQUIRED_TRAINABLE_SOURCES - present)
    checks.append(
        GateCheck(
            "trainable_source_representation",
            not missing_required,
            "trainable printsense + drive_commander both present in the eligible set"
            if not missing_required
            else f"eligible set missing trainable source(s): {missing_required} "
            f"(present: {sorted(present)})",
        )
    )

    # 10. Frozen SimLab/MIRA benchmark baseline referenced (benchmark bucket).
    checks.append(
        GateCheck(
            "frozen_benchmark_baseline",
            bool(readiness.frozen_benchmark_baseline_ref),
            "frozen SimLab/MIRA benchmark baseline referenced"
            if readiness.frozen_benchmark_baseline_ref
            else "frozen benchmark baseline ref missing",
        )
    )

    # 11. Real-vs-synthetic composition report referenced.
    checks.append(
        GateCheck(
            "synthetic_composition_disclosed",
            bool(readiness.synthetic_composition_report_ref),
            "synthetic-composition report referenced"
            if readiness.synthetic_composition_report_ref
            else "synthetic-composition report ref missing",
        )
    )

    # 12. Base-vs-tools benchmark report referenced.
    checks.append(
        GateCheck(
            "base_vs_tools_benchmark_complete",
            bool(readiness.base_vs_tools_benchmark_ref),
            "base-vs-tools benchmark referenced"
            if readiness.base_vs_tools_benchmark_ref
            else "base-vs-tools benchmark ref missing",
        )
    )

    # 13. Cost — the MAX of every available estimate, so a low supplied value can't understate.
    cost_estimates = [estimate_finetune_cost(sum(r.token_estimate() for r in dataset.eligible))]
    if train_tokens is not None:
        cost_estimates.append(estimate_finetune_cost(train_tokens))
    if est_cost_usd is not None:
        cost_estimates.append(est_cost_usd)
    est = max(cost_estimates)
    checks.append(
        GateCheck(
            "cost_within_cap", est <= COST_CAP_USD, f"est ${est:.2f} (cap ${COST_CAP_USD:.2f})"
        )
    )

    # 14. Model support — evidence with provenance for the intended target.
    model_reason = (
        "no model-support evidence (live probe required before spend)"
        if model_support is None
        else model_support.rejection_reason()
    )
    model_ok = model_reason is None
    model_detail = (
        f"{TARGET_MODEL_ID} FT support confirmed on {TARGET_PROVIDER}"
        if model_ok
        else f"model support NOT confirmed: {model_reason}"
    )
    checks.append(GateCheck("model_support_confirmed", model_ok, model_detail))

    evidence = {
        "held_out_lineage_keys": sorted(readiness.unique_held_out_keys()),
        "held_out_lineage_count": readiness.held_out_count(),
        "rights_report_ref": readiness.rights_report_ref,
        "frozen_benchmark_baseline_ref": readiness.frozen_benchmark_baseline_ref,
        "synthetic_composition_report_ref": readiness.synthetic_composition_report_ref,
        "base_vs_tools_benchmark_ref": readiness.base_vs_tools_benchmark_ref,
        "eligible_source_systems": sorted(present),
        "est_cost_usd": round(est, 4),
        "model_support": model_support.to_dict() if model_support is not None else None,
    }

    passed = all(c.passed for c in checks)
    return PaidGateReport(
        passed=passed,
        verdict=VERDICT_PASS if passed else VERDICT_BLOCKED,
        checks=checks,
        evidence=evidence,
    )

"""The Phase-3 paid gate — evidence that a metered fine-tune run is justified.

The plan's paid gate (technician-grounding LoRA program), tightened per the parent-plan
addendum: a metered LoRA-SFT job is only justified when the assembled dataset v0 clears ALL of:

1. every eligible record is *actually* dataset-eligible (governance PASS AND human-approved),
2. ``>= 100`` training-eligible records,
3. ``>= 20`` distinct document lineages,
4. ``>= 20`` uncertainty/refusal/correction (valued) interactions,
5. every eligible record's source rights allow training,
6. no held-out contamination (leakage guard clean; every eligible record on the train side),
7. ``>= 5`` held-out lineages reserved (permanent quarantine benchmark),
8. ``>= 15`` safety-sensitive training examples (explicitly tagged),
9. PrintSense + Drive Commander + SimLab/MIRA all represented in the corpus build,
10. synthetic composition disclosed,
11. base-vs-tools benchmark complete,
12. estimated cost ``<= $5`` (LoRA-SFT, base ``<= 16B``),
13. base-model serverless fine-tune support live-confirmed (with evidence, not a bare boolean).

**This is EVIDENCE, not an action.** :func:`evaluate_paid_gate` computes PASS/BLOCKED and the
per-check detail; it never spends, never calls the network, never launches a job. A PASS is
*necessary but not sufficient* — the actual metered run still requires Mike's explicit go
(spend law). Reuses the frozen pricing constants; adds no new pricing policy.
"""

from __future__ import annotations

from dataclasses import dataclass

from factorylm_ai.pricing import FT_LORA_SFT_USD_PER_MTOK_LE16B, FT_MIN_JOB_USD

from .assemble import DatasetV0

MIN_RECORDS = 100
MIN_LINEAGES = 20
MIN_VALUED_INTERACTIONS = 20
MIN_HELD_OUT_LINEAGES = 5
MIN_SAFETY_SENSITIVE = 15
COST_CAP_USD = 5.00
DEFAULT_EPOCHS = 3

# The corpus must draw from all three intelligence sources. SimLab/MIRA material is eval-only
# by construction (it can never be a *training* record), so representation is measured over the
# whole build (``DatasetV0.source_systems``), not the train-eligible set. ``simlab`` / ``mira``
# either satisfies the frozen-benchmark bucket.
REQUIRED_SOURCE_SYSTEMS: frozenset[str] = frozenset({"printsense", "drive_commander"})
BENCHMARK_SOURCE_SYSTEMS: frozenset[str] = frozenset({"simlab", "mira"})

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


@dataclass(frozen=True)
class ReadinessEvidence:
    """Corpus-level readiness facts the paid gate cannot derive from the training records alone.

    Held-out lineages are quarantined benchmark lineages that never become training records, so
    the count is a corpus-registry fact, not something in ``dataset.eligible``. Synthetic-
    composition disclosure and the base-vs-tools benchmark are process attestations. All default
    to the fail-closed value (``0`` / ``False``) so an unset field BLOCKS the gate."""

    held_out_lineage_count: int = 0
    synthetic_composition_disclosed: bool = False
    base_vs_tools_benchmark_complete: bool = False


@dataclass(frozen=True)
class ModelSupportEvidence:
    """Evidence that the base model's serverless fine-tune support was actually checked.

    A bare ``True`` is not enough — the model-support check passes only when ``supported`` is
    ``True`` AND every provenance field is present (what model, which provider, when, and how it
    was checked). Kept pure: this records the result of a check, it does NOT perform one (no
    network here — the live probe happens in the orchestration layer, PR 4)."""

    model_id: str
    provider: str
    checked_at: str
    method: str
    supported: bool

    def is_complete(self) -> bool:
        """All provenance fields present (non-empty)."""
        return all(bool(f) for f in (self.model_id, self.provider, self.checked_at, self.method))

    def is_confirmed(self) -> bool:
        """Supported AND fully attested — the only state that clears the gate."""
        return self.supported and self.is_complete()


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

    @property
    def blocking(self) -> list[str]:
        return [c.name for c in self.checks if not c.passed]

    def to_dict(self) -> dict:
        return {
            "passed": self.passed,
            "verdict": self.verdict,
            "blocking": self.blocking,
            "checks": [c.to_dict() for c in self.checks],
        }


def evaluate_paid_gate(
    dataset: DatasetV0,
    *,
    readiness: ReadinessEvidence | None = None,
    model_support: ModelSupportEvidence | None = None,
    est_cost_usd: float | None = None,
    train_tokens: int | None = None,
    cost_cap_usd: float = COST_CAP_USD,
    min_records: int = MIN_RECORDS,
    min_lineages: int = MIN_LINEAGES,
    min_valued: int = MIN_VALUED_INTERACTIONS,
    min_held_out: int = MIN_HELD_OUT_LINEAGES,
    min_safety_sensitive: int = MIN_SAFETY_SENSITIVE,
    epochs: int = DEFAULT_EPOCHS,
) -> PaidGateReport:
    """Evaluate the Phase-3 paid gate over an assembled dataset. Evidence only — no spend, no
    network, no job launch.

    ``readiness`` / ``model_support`` default to fail-closed evidence (an absent object BLOCKS
    the checks it feeds). When ``est_cost_usd`` is not supplied it is estimated from the eligible
    records' token counts. A supplied ``est_cost_usd`` can never *under*-state a known token cost:
    if ``train_tokens`` is also given, the cost used is ``max(supplied, tokens-derived)``."""
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
        GateCheck("min_records", n >= min_records, f"{n} eligible (need >= {min_records})")
    )

    lineages = dataset.lineage_count
    checks.append(
        GateCheck(
            "min_lineages",
            lineages >= min_lineages,
            f"{lineages} lineages (need >= {min_lineages})",
        )
    )

    valued = dataset.valued_interaction_count
    checks.append(
        GateCheck(
            "min_valued_interactions",
            valued >= min_valued,
            f"{valued} uncertainty/refusal/correction (need >= {min_valued})",
        )
    )

    all_train_allowed = all(r.candidate.rights.training_allowed for r in dataset.eligible)
    checks.append(
        GateCheck(
            "all_rights_training_allowed",
            all_train_allowed,
            "every eligible source allows training"
            if all_train_allowed
            else "an eligible record's source is not training_allowed",
        )
    )

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

    # 7. Held-out benchmark reserved (corpus-level evidence).
    held_out = readiness.held_out_lineage_count
    checks.append(
        GateCheck(
            "min_held_out_lineages",
            held_out >= min_held_out,
            f"{held_out} held-out lineages reserved (need >= {min_held_out})",
        )
    )

    # 8. Safety-sensitive coverage in the training data (explicitly tagged).
    safety = dataset.safety_sensitive_count
    checks.append(
        GateCheck(
            "min_safety_sensitive",
            safety >= min_safety_sensitive,
            f"{safety} safety-sensitive examples (need >= {min_safety_sensitive})",
        )
    )

    # 9. Source-composition: PrintSense + Drive Commander + a SimLab/MIRA benchmark.
    present = dataset.source_systems
    missing_required = sorted(REQUIRED_SOURCE_SYSTEMS - present)
    has_benchmark = bool(BENCHMARK_SOURCE_SYSTEMS & present)
    source_ok = not missing_required and has_benchmark
    checks.append(
        GateCheck(
            "source_representation",
            source_ok,
            "printsense + drive_commander + a simlab/mira benchmark represented"
            if source_ok
            else f"missing required={missing_required} benchmark_present={has_benchmark}",
        )
    )

    # 10. Synthetic composition disclosed.
    checks.append(
        GateCheck(
            "synthetic_composition_disclosed",
            readiness.synthetic_composition_disclosed,
            "synthetic composition disclosed"
            if readiness.synthetic_composition_disclosed
            else "synthetic composition NOT disclosed",
        )
    )

    # 11. Base-vs-tools benchmark complete.
    checks.append(
        GateCheck(
            "base_vs_tools_benchmark_complete",
            readiness.base_vs_tools_benchmark_complete,
            "base-vs-tools benchmark complete"
            if readiness.base_vs_tools_benchmark_complete
            else "base-vs-tools benchmark NOT complete",
        )
    )

    # 12. Cost. A supplied estimate can never under-state a known token-derived cost.
    token_cost = (
        estimate_finetune_cost(train_tokens, epochs=epochs) if train_tokens is not None else None
    )
    if est_cost_usd is None:
        if token_cost is not None:
            est_cost_usd = token_cost
        else:
            est_cost_usd = estimate_finetune_cost(
                sum(r.token_estimate() for r in dataset.eligible), epochs=epochs
            )
    elif token_cost is not None:
        est_cost_usd = max(est_cost_usd, token_cost)
    checks.append(
        GateCheck(
            "cost_within_cap",
            est_cost_usd <= cost_cap_usd,
            f"est ${est_cost_usd:.2f} (cap ${cost_cap_usd:.2f})",
        )
    )

    # 13. Model support — evidence, not a bare boolean.
    model_ok = model_support is not None and model_support.is_confirmed()
    if model_support is None:
        model_detail = "no model-support evidence (live probe required before spend)"
    elif not model_support.is_complete():
        model_detail = "model-support evidence incomplete (model_id/provider/checked_at/method)"
    elif not model_support.supported:
        model_detail = f"model {model_support.model_id!r} NOT supported for serverless FT"
    else:
        model_detail = (
            f"{model_support.model_id} FT support confirmed via {model_support.method} "
            f"@ {model_support.checked_at}"
        )
    checks.append(GateCheck("model_support_confirmed", model_ok, model_detail))

    passed = all(c.passed for c in checks)
    return PaidGateReport(
        passed=passed,
        verdict=VERDICT_PASS if passed else VERDICT_BLOCKED,
        checks=checks,
    )

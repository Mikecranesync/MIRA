"""The Phase-3 paid gate — evidence that a metered fine-tune run is justified.

The plan's paid gate (technician-grounding LoRA program): a metered LoRA-SFT job is only
justified when the assembled dataset v0 clears ALL of:

1. ``>= 100`` training-eligible records,
2. ``>= 15`` distinct document lineages,
3. ``>= 20`` uncertainty/refusal/correction (valued) interactions,
4. every eligible record's source rights allow training,
5. no held-out contamination (leakage guard clean; every eligible record on the train side),
6. estimated cost ``<= $5`` (LoRA-SFT, base ``<= 16B``),
7. base-model serverless fine-tune support live-confirmed.

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
MIN_LINEAGES = 15
MIN_VALUED_INTERACTIONS = 20
COST_CAP_USD = 5.00
DEFAULT_EPOCHS = 3

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
    est_cost_usd: float | None = None,
    train_tokens: int | None = None,
    model_support_confirmed: bool = False,
    cost_cap_usd: float = COST_CAP_USD,
    min_records: int = MIN_RECORDS,
    min_lineages: int = MIN_LINEAGES,
    min_valued: int = MIN_VALUED_INTERACTIONS,
    epochs: int = DEFAULT_EPOCHS,
) -> PaidGateReport:
    """Evaluate the Phase-3 paid gate over an assembled dataset. Evidence only — no spend, no
    network, no job launch. When ``est_cost_usd`` is not supplied it is estimated from the
    eligible records' token counts (conservative)."""
    checks: list[GateCheck] = []

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

    if est_cost_usd is None:
        tokens = (
            train_tokens
            if train_tokens is not None
            else sum(r.token_estimate() for r in dataset.eligible)
        )
        est_cost_usd = estimate_finetune_cost(tokens, epochs=epochs)
    checks.append(
        GateCheck(
            "cost_within_cap",
            est_cost_usd <= cost_cap_usd,
            f"est ${est_cost_usd:.2f} (cap ${cost_cap_usd:.2f})",
        )
    )

    checks.append(
        GateCheck(
            "model_support_confirmed",
            bool(model_support_confirmed),
            "base-model serverless FT support live-confirmed"
            if model_support_confirmed
            else "base-model FT support NOT confirmed (live probe required before spend)",
        )
    )

    passed = all(c.passed for c in checks)
    return PaidGateReport(
        passed=passed,
        verdict=VERDICT_PASS if passed else VERDICT_BLOCKED,
        checks=checks,
    )

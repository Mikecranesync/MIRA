"""Together serverless pricing table — the source of truth for cost estimates.

ZTA role: every provider response and every :class:`~factorylm_ai.telemetry.ModelRun`
carries an ``estimated_cost_usd`` computed here, so the budget guard
(:mod:`factorylm_ai.budget`) and the proofpack cost report are never
guessing. Prices are $/M (per one million) tokens, verified 2026-07-19
against together.ai/pricing (see ``docs/zta/together-liquid-model-strategy.md``
for the full recon). An unpriced model gets a deliberately conservative
(expensive) fallback rather than being treated as free — see
:func:`estimate_cost`.
"""

from __future__ import annotations

PRICING_AS_OF = "2026-07-19"

# Dedicated-endpoint / batch / fine-tuning economics (contract §B/§C).
DEDICATED_H100_USD_PER_HOUR = 5.49
BATCH_DISCOUNT = 0.5  # flat 50% off serverless, text models only, no vision
FT_LORA_SFT_USD_PER_MTOK_LE16B = 0.48  # LoRA SFT, base models <= 16B params
FT_LORA_DPO_USD_PER_MTOK_LE16B = 0.54  # LoRA DPO, base models <= 16B params (strategy §2.1 table)
FT_MIN_JOB_USD = 4.00

# Conservative fallback for a model with no PRICING entry — deliberately
# expensive ($3.00/M in, $3.00/M out) so an unpriced/unknown model call is
# over-estimated, never silently treated as cheap or free.
_UNKNOWN_MODEL_PRICE: tuple[float, float] = (3.0, 3.0)

# model id -> ($/M input tokens, $/M output tokens). Embeddings/rerank use
# (price, 0.0) since there is no output-token cost.
PRICING: dict[str, tuple[float, float]] = {
    # M01 vision intake, M03 print region extract — only vision model with
    # proven serverless access on this account (2026-07-19 live probe).
    "google/gemma-3n-E4B-it": (0.06, 0.12),
    # M05 intent router, M10 answer writer, M12 feedback curator — cheapest
    # serverless text model on the platform; a Liquid model served on
    # Together (the strategy convergence point).
    "LiquidAI/LFM2.5-8B-A1B": (0.03, 0.12),
    # M07 embeddings — the ONLY serverless embedding model; hard 514-token
    # input cap (chunk law lives in flywheel/splits.py + docs).
    "intfloat/multilingual-e5-large-instruct": (0.02, 0.0),
    # M09 tool selector — cheapest serverless model with confirmed function
    # calling + JSON mode.
    "openai/gpt-oss-20b": (0.05, 0.20),
    # Escalation model documented for M09/M10 if the cheap tier under-performs.
    "openai/gpt-oss-120b": (0.15, 0.60),
    "Qwen/Qwen2.5-7B-Instruct-Turbo": (0.30, 0.30),
    "Qwen/Qwen3.5-9B": (0.17, 0.25),
    # Text-cascade default in mira-bots/shared/inference/router.py — kept
    # here too as the together.py chat fallback model's price.
    "meta-llama/Llama-3.3-70B-Instruct-Turbo": (1.04, 1.04),
}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    """Estimate USD cost for a call to ``model`` with the given token counts.

    Uses :data:`PRICING` when ``model`` is a known key; otherwise falls back
    to the conservative ``(3.0, 3.0)`` $/M rate so an unpriced model is never
    under-estimated (and so :class:`~factorylm_ai.budget.BudgetGuard.precheck`
    stays a real hard-stop instead of a false pass).
    """
    price_in, price_out = PRICING.get(model, _UNKNOWN_MODEL_PRICE)
    return (input_tokens / 1_000_000) * price_in + (output_tokens / 1_000_000) * price_out

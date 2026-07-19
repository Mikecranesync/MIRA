"""Tests for factorylm_ai.budget and factorylm_ai.pricing.

Hermetic: no network, env via monkeypatch only.
"""

from __future__ import annotations

import pytest

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.pricing import PRICING, estimate_cost

# ---------------------------------------------------------------------------
# BudgetGuard
# ---------------------------------------------------------------------------


def test_budget_guard_default_cap_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACTORYLM_AI_BUDGET_USD", "2.50")
    guard = BudgetGuard()
    assert guard.cap_usd == 2.50
    assert guard.spent_usd == 0.0


def test_budget_guard_default_cap_when_env_unset(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FACTORYLM_AI_BUDGET_USD", raising=False)
    guard = BudgetGuard()
    assert guard.cap_usd == 1.00


def test_budget_guard_default_cap_when_env_is_empty_string(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # or-form law: a compose-mapped ${FACTORYLM_AI_BUDGET_USD:-} delivers "".
    monkeypatch.setenv("FACTORYLM_AI_BUDGET_USD", "")
    guard = BudgetGuard()
    assert guard.cap_usd == 1.00


def test_budget_guard_explicit_cap_overrides_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACTORYLM_AI_BUDGET_USD", "99.00")
    guard = BudgetGuard(cap_usd=0.10)
    assert guard.cap_usd == 0.10


def test_precheck_passes_under_cap() -> None:
    guard = BudgetGuard(cap_usd=1.0)
    guard.precheck(0.50)  # must not raise


def test_precheck_blocks_over_cap() -> None:
    guard = BudgetGuard(cap_usd=1.0)
    with pytest.raises(BudgetExceeded):
        guard.precheck(1.01)


def test_precheck_accounts_for_already_spent() -> None:
    guard = BudgetGuard(cap_usd=1.0)
    guard.record(0.80)
    with pytest.raises(BudgetExceeded):
        guard.precheck(0.30)
    guard.precheck(0.20)  # 0.80 + 0.20 == 1.00 exactly -> not over cap, passes


def test_record_accumulates() -> None:
    guard = BudgetGuard(cap_usd=10.0)
    guard.record(1.0)
    guard.record(2.5)
    assert guard.spent_usd == pytest.approx(3.5)


def test_budget_guard_negative_cap_rejected() -> None:
    with pytest.raises(ValueError):
        BudgetGuard(cap_usd=-1.0)


# ---------------------------------------------------------------------------
# pricing
# ---------------------------------------------------------------------------


def test_pricing_known_model_exact_math_lfm() -> None:
    # Contract-pinned example: LFM2.5-8B-A1B, 1M in + 1M out = $0.15.
    cost = estimate_cost("LiquidAI/LFM2.5-8B-A1B", 1_000_000, 1_000_000)
    assert cost == pytest.approx(0.15)


def test_pricing_known_model_matches_table_formula() -> None:
    price_in, price_out = PRICING["google/gemma-3n-E4B-it"]
    cost = estimate_cost("google/gemma-3n-E4B-it", 500_000, 250_000)
    expected = 0.5 * price_in + 0.25 * price_out
    assert cost == pytest.approx(expected)


def test_pricing_unknown_model_conservative_fallback() -> None:
    cost = estimate_cost("totally/unknown-model-id", 1_000_000, 1_000_000)
    assert cost == pytest.approx(6.0)  # (3.0 + 3.0) $/M * 1M tokens each


def test_pricing_zero_tokens_is_zero_cost() -> None:
    assert estimate_cost("LiquidAI/LFM2.5-8B-A1B", 0, 0) == 0.0


def test_pricing_table_has_all_addendum_models() -> None:
    expected_models = {
        "google/gemma-3n-E4B-it",
        "LiquidAI/LFM2.5-8B-A1B",
        "intfloat/multilingual-e5-large-instruct",
        "openai/gpt-oss-20b",
        "openai/gpt-oss-120b",
        "Qwen/Qwen2.5-7B-Instruct-Turbo",
        "Qwen/Qwen3.5-9B",
        "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    }
    assert expected_models <= set(PRICING)


def test_pricing_embedding_model_has_zero_output_price() -> None:
    _price_in, price_out = PRICING["intfloat/multilingual-e5-large-instruct"]
    assert price_out == 0.0

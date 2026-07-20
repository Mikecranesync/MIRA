"""Tests for factorylm_ai.providers — mock determinism + together network gate.

Hermetic: no network, no wall clock assertions, env via monkeypatch only.
"""

from __future__ import annotations

import httpx
import pytest

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.providers import get_provider
from factorylm_ai.providers import together as together_module
from factorylm_ai.providers.base import ModelRequest, NetworkDisabledError
from factorylm_ai.providers.local_liquid import LocalLiquidProvider
from factorylm_ai.providers.mock import MockProvider
from factorylm_ai.providers.together import TogetherProvider

# ---------------------------------------------------------------------------
# Mock provider — determinism
# ---------------------------------------------------------------------------


async def test_mock_chat_deterministic_same_input_twice() -> None:
    req = ModelRequest(task_id="M01", messages=[{"role": "user", "content": "a print of K1"}])
    provider = MockProvider()
    r1 = await provider.complete(req)
    r2 = await provider.complete(req)
    assert r1 == r2
    assert r1.parsed is not None
    assert r1.estimated_cost_usd == 0.0
    assert r1.latency_ms == 1
    assert r1.provider == "mock"


async def test_mock_chat_different_inputs_can_select_different_variants() -> None:
    provider = MockProvider()
    req_a = ModelRequest(task_id="M01", messages=[{"role": "user", "content": "aaaaaaaaaaaa"}])
    req_b = ModelRequest(task_id="M01", messages=[{"role": "user", "content": "bbbbbbbbbbbb"}])
    resp_a = await provider.complete(req_a)
    resp_b = await provider.complete(req_b)
    # Not asserting they differ (hash collision into the same bucket is
    # legal) — only that each is independently stable.
    assert resp_a == await provider.complete(req_a)
    assert resp_b == await provider.complete(req_b)


async def test_mock_embeddings_deterministic_and_8dim() -> None:
    req = ModelRequest(
        task_id="M07",
        messages=[],
        input_kind="embedding",
        embed_inputs=["hello world", "second chunk of text"],
    )
    provider = MockProvider()
    r1 = await provider.complete(req)
    r2 = await provider.complete(req)
    assert r1.embeddings == r2.embeddings
    assert r1.embeddings is not None
    assert len(r1.embeddings) == 2
    assert all(len(vec) == 8 for vec in r1.embeddings)
    assert r1.embeddings[0] != r1.embeddings[1]
    assert r1.estimated_cost_usd == 0.0


async def test_mock_rerank_deterministic_and_descending() -> None:
    req = ModelRequest(
        task_id="M08",
        messages=[],
        input_kind="rerank",
        rerank_query="K1 relay",
        rerank_documents=["doc about K1", "doc about X4", "unrelated doc"],
    )
    provider = MockProvider()
    r1 = await provider.complete(req)
    r2 = await provider.complete(req)
    assert r1.rerank_scores == r2.rerank_scores
    assert r1.rerank_scores is not None
    assert len(r1.rerank_scores) == 3
    assert r1.rerank_scores == sorted(r1.rerank_scores, reverse=True)


async def test_mock_tool_selection_matches_keyword_in_case_text() -> None:
    tools = [
        {"type": "function", "function": {"name": "search_print_pages", "parameters": {}}},
        {"type": "function", "function": {"name": "lookup_wiring_db", "parameters": {}}},
    ]
    req = ModelRequest(
        task_id="M09",
        messages=[{"role": "user", "content": "please lookup_wiring_db for K1"}],
        tools=tools,
    )
    provider = MockProvider()
    r1 = await provider.complete(req)
    r2 = await provider.complete(req)
    assert r1 == r2
    assert r1.parsed is not None
    assert r1.parsed["tool_calls"][0]["name"] == "lookup_wiring_db"
    assert r1.parsed["tool_calls"][0]["arguments"]["query"] == "K1"
    assert r1.parsed["answered_from_memory"] is False


async def test_mock_tool_selection_falls_back_to_first_tool() -> None:
    tools = [{"type": "function", "function": {"name": "search_print_pages", "parameters": {}}}]
    req = ModelRequest(
        task_id="M09",
        messages=[{"role": "user", "content": "what about it"}],
        tools=tools,
    )
    provider = MockProvider()
    resp = await provider.complete(req)
    assert resp.parsed is not None
    assert resp.parsed["tool_calls"][0]["name"] == "search_print_pages"


async def test_mock_m10_refusal_variant_on_empty_evidence() -> None:
    provider = MockProvider()
    req = ModelRequest(
        task_id="M10",
        messages=[{"role": "user", "content": 'claim: K1 is live. context: "evidence": []'}],
    )
    resp = await provider.complete(req)
    assert resp.parsed is not None
    assert resp.parsed["evidence"] == []
    assert resp.parsed["not_proven"]


async def test_mock_m05_routes_by_keyword() -> None:
    provider = MockProvider()
    resp = await provider.complete(
        ModelRequest(
            task_id="M05", messages=[{"role": "user", "content": "here is a wiring photo"}]
        )
    )
    assert resp.parsed is not None
    assert resp.parsed["route"] == "printsense_photo"
    assert resp.parsed["should_ask_clarification"] is False


async def test_mock_m05_unknown_route_asks_clarification() -> None:
    provider = MockProvider()
    resp = await provider.complete(
        ModelRequest(task_id="M05", messages=[{"role": "user", "content": "xyz totally unrelated"}])
    )
    assert resp.parsed is not None
    assert resp.parsed["route"] == "unknown"
    assert resp.parsed["should_ask_clarification"] is True


# ---------------------------------------------------------------------------
# get_provider factory
# ---------------------------------------------------------------------------


def test_get_provider_default_is_mock(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("FACTORYLM_AI_PROVIDER", raising=False)
    provider = get_provider()
    assert isinstance(provider, MockProvider)
    assert provider.name == "mock"


def test_get_provider_reads_env_when_name_is_none(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FACTORYLM_AI_PROVIDER", "local_liquid")
    provider = get_provider()
    assert isinstance(provider, LocalLiquidProvider)


def test_get_provider_unknown_raises_value_error() -> None:
    with pytest.raises(ValueError):
        get_provider("not-a-real-provider")


def test_get_provider_together_and_local_liquid_construct_cleanly() -> None:
    assert isinstance(get_provider("together"), TogetherProvider)
    assert isinstance(get_provider("local_liquid"), LocalLiquidProvider)


# ---------------------------------------------------------------------------
# Together provider — network gate
# ---------------------------------------------------------------------------


def test_together_is_configured_false_without_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    assert TogetherProvider().is_configured() is False


async def test_together_complete_raises_when_key_set_but_flag_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("TOGETHERAI_API_KEY", "fake-test-key-not-real")
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    provider = TogetherProvider()
    assert provider.is_configured() is False
    req = ModelRequest(task_id="M05", messages=[{"role": "user", "content": "hi"}])
    with pytest.raises(NetworkDisabledError):
        await provider.complete(req)


async def test_together_complete_raises_when_flag_set_but_key_unset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "true")
    provider = TogetherProvider()
    assert provider.is_configured() is False
    req = ModelRequest(task_id="M05", messages=[{"role": "user", "content": "hi"}])
    with pytest.raises(NetworkDisabledError):
        await provider.complete(req)


class _ExplodingAsyncClient:
    """A httpx.AsyncClient replacement that fails the test if constructed."""

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise AssertionError("httpx.AsyncClient must not be constructed when unconfigured")


async def test_together_never_touches_httpx_when_unconfigured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _ExplodingAsyncClient)

    provider = TogetherProvider()
    req = ModelRequest(task_id="M05", messages=[{"role": "user", "content": "hi"}])
    with pytest.raises(NetworkDisabledError):
        await provider.complete(req)


async def test_together_finetune_helpers_respect_network_gate(
    monkeypatch: pytest.MonkeyPatch, tmp_path
) -> None:
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _ExplodingAsyncClient)

    dummy_file = tmp_path / "train.jsonl"
    dummy_file.write_text('{"messages": []}\n', encoding="utf-8")

    with pytest.raises(NetworkDisabledError):
        await together_module.upload_file(str(dummy_file))
    with pytest.raises(NetworkDisabledError):
        await together_module.create_finetune_job(
            "file-id",
            "some/model",
            suffix="factorylm_test",
            budget=BudgetGuard(cap_usd=100.0),
            est_training_tokens=500_000,
        )
    with pytest.raises(NetworkDisabledError):
        await together_module.get_finetune_job("job-id")


async def test_create_finetune_job_budget_precheck_precedes_network_gate(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Spend law: the budget hard-stop fires BEFORE the network gate.

    A fine-tune job whose estimated cost exceeds the BudgetGuard cap must
    raise BudgetExceeded even with no credentials configured — proving the
    mechanical dollar stop is unconditional, not contingent on env state.
    The $4.00 job minimum means even a tiny dataset cannot slip under a
    sub-$4 cap.
    """
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _ExplodingAsyncClient)

    with pytest.raises(BudgetExceeded):
        await together_module.create_finetune_job(
            "file-id",
            "some/model",
            suffix="factorylm_test",
            budget=BudgetGuard(cap_usd=1.0),  # below the $4.00 job minimum
            est_training_tokens=1_000,
        )

    guard = BudgetGuard(cap_usd=100.0)
    with pytest.raises(NetworkDisabledError):
        # 10M tokens x 3 epochs x $0.48/M = $14.40 > the $4 floor -> precheck
        # passes under a $100 cap, then the network gate (still unset) fires.
        await together_module.create_finetune_job(
            "file-id",
            "some/model",
            suffix="factorylm_test",
            budget=guard,
            est_training_tokens=10_000_000,
        )
    assert guard.spent_usd == 0.0  # nothing recorded — the POST never happened


async def test_create_finetune_job_rejects_invalid_training_method(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A bad training_method is a shape error caught BEFORE the budget precheck
    and the network gate — nothing is spent, no HTTP happens."""
    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _ExplodingAsyncClient)
    with pytest.raises(ValueError, match="training_method"):
        await together_module.create_finetune_job(
            "file-id",
            "some/model",
            suffix="factorylm_test",
            budget=BudgetGuard(cap_usd=100.0),
            est_training_tokens=500_000,
            training_method="rlhf",
        )


async def test_create_finetune_job_dpo_method_accepted_and_gated(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """training_method='dpo' with the DPO rate is accepted (no ValueError) and
    still stops at the network gate — the payload is built but no POST fires."""
    from factorylm_ai.pricing import FT_LORA_DPO_USD_PER_MTOK_LE16B

    monkeypatch.delenv("TOGETHERAI_API_KEY", raising=False)
    monkeypatch.delenv("FACTORYLM_AI_ALLOW_NETWORK", raising=False)
    monkeypatch.setattr(httpx, "AsyncClient", _ExplodingAsyncClient)
    guard = BudgetGuard(cap_usd=100.0)
    with pytest.raises(NetworkDisabledError):
        await together_module.create_finetune_job(
            "file-id",
            "some/model",
            suffix="factorylm_dpo",
            budget=guard,
            est_training_tokens=500_000,
            usd_per_mtok=FT_LORA_DPO_USD_PER_MTOK_LE16B,
            training_method="dpo",
        )
    assert guard.spent_usd == 0.0  # network gate fired before record()


def test_together_download_finetune_note_is_pure_and_mentions_no_serverless() -> None:
    note = together_module.download_finetune_note("ft-12345")
    assert "ft-12345" in note
    assert "serverless" in note.lower()


# ---------------------------------------------------------------------------
# local_liquid provider — placeholder
# ---------------------------------------------------------------------------


def test_local_liquid_not_configured() -> None:
    assert LocalLiquidProvider().is_configured() is False


async def test_local_liquid_complete_raises_not_implemented() -> None:
    provider = LocalLiquidProvider()
    req = ModelRequest(task_id="M05", messages=[{"role": "user", "content": "hi"}])
    with pytest.raises(NotImplementedError):
        await provider.complete(req)

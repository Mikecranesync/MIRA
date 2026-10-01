"""Hermetic tests for photo_diagnosis.budget. No network — FakeProvider only."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

TOOLS_QA = Path(__file__).resolve().parents[2] / "tools" / "qa"
if str(TOOLS_QA) not in sys.path:
    sys.path.insert(0, str(TOOLS_QA))

from photo_diagnosis.budget import BudgetExhausted, Ledger, MeteredProvider  # noqa: E402
from photo_diagnosis.providers import FakeProvider, OpenAIProvider, UnknownModelError  # noqa: E402


def test_reserve_within_cap_succeeds():
    ledger = Ledger(cap_usd=10.0)
    token = ledger.reserve(1.0)
    assert ledger.reserved_usd == 1.0
    ledger.settle(token, 0.8)
    assert ledger.spent_usd == 0.8
    assert ledger.reserved_usd == 0.0


def test_reserve_over_cap_raises_budget_exhausted():
    ledger = Ledger(cap_usd=1.0)
    ledger.reserve(0.9)
    with pytest.raises(BudgetExhausted):
        ledger.reserve(0.2)


def test_release_frees_reservation_without_spending():
    ledger = Ledger(cap_usd=1.0)
    token = ledger.reserve(0.9)
    ledger.release(token)
    assert ledger.reserved_usd == 0.0
    assert ledger.spent_usd == 0.0
    # the freed capacity can be reserved again
    ledger.reserve(0.9)


def test_settle_unknown_token_raises_keyerror():
    ledger = Ledger(cap_usd=10.0)
    with pytest.raises(KeyError):
        ledger.settle("never-reserved", 1.0)


# ---------------------------------------------------------------------------
# ledger.call — the critical AC: a reservation that would exceed the cap
# means the provider is NEVER invoked.


def test_call_under_cap_invokes_provider_once_and_settles():
    ledger = Ledger(cap_usd=10.0)
    fake = FakeProvider(
        responses=[json.dumps({"H": True})], price_in_per_mtok=1.0, price_out_per_mtok=1.0
    )
    text, usage = ledger.call(fake, [{"role": "user", "content": "hello"}], max_tokens=50)
    assert fake.calls == 1
    assert json.loads(text) == {"H": True}
    assert ledger.spent_usd > 0
    assert ledger.reserved_usd == 0.0
    assert ledger.call_log[0]["provider"] == "fake"


def test_call_over_cap_raises_and_provider_never_called():
    ledger = Ledger(cap_usd=0.0000001)  # effectively zero headroom
    fake = FakeProvider(price_in_per_mtok=1_000_000.0, price_out_per_mtok=1_000_000.0)
    with pytest.raises(BudgetExhausted):
        ledger.call(fake, [{"role": "user", "content": "x" * 10_000}], max_tokens=500)
    assert fake.calls == 0  # the whole point of reserve-before-call


def test_call_failure_settles_at_estimate_not_released():
    ledger = Ledger(cap_usd=10.0)
    fake = FakeProvider(
        raise_on_call=RuntimeError("down"), price_in_per_mtok=1.0, price_out_per_mtok=1.0
    )
    with pytest.raises(RuntimeError):
        ledger.call(fake, [{"role": "user", "content": "hello"}], max_tokens=50, retries=1)
    assert fake.calls == 1
    assert ledger.reserved_usd == 0.0
    assert ledger.spent_usd > 0  # conservative spend, not a free retry


def test_call_estimates_image_tokens_when_images_present():
    # The RESERVATION (made before the call, from the estimate — not the
    # final settled spend, which tracks actual usage) must be larger when
    # an image is attached, or image cost is invisible until it's too late.
    ledger = Ledger(cap_usd=10.0)
    fake = FakeProvider(responses=["{}"], price_in_per_mtok=1.0, price_out_per_mtok=0.0)
    ledger.call(fake, [{"role": "user", "content": "short"}], max_tokens=10, images=["base64blob"])
    with_image_estimate = ledger.call_log[0]["estimate_usd"]

    ledger2 = Ledger(cap_usd=10.0)
    fake2 = FakeProvider(responses=["{}"], price_in_per_mtok=1.0, price_out_per_mtok=0.0)
    ledger2.call(fake2, [{"role": "user", "content": "short"}], max_tokens=10, images=None)
    without_image_estimate = ledger2.call_log[0]["estimate_usd"]

    assert with_image_estimate > without_image_estimate


# ---------------------------------------------------------------------------
# manual-search counter


def test_manual_search_counter_raises_past_cap():
    ledger = Ledger(cap_usd=10.0, manual_search_cap=3)
    ledger.record_manual_search(3)
    with pytest.raises(BudgetExhausted):
        ledger.record_manual_search(1)


def test_manual_search_from_packet_tolerates_missing_keys():
    ledger = Ledger(cap_usd=10.0)
    ledger.record_manual_search_from_packet({})  # no 'retrieval' key at all
    ledger.record_manual_search_from_packet({"retrieval": {}})  # no manual_acquisition
    ledger.record_manual_search_from_packet(None)
    assert ledger.manual_search_queries == 0


def test_manual_search_from_packet_reads_query_count():
    ledger = Ledger(cap_usd=10.0)
    ledger.record_manual_search_from_packet(
        {"retrieval": {"manual_acquisition": {"query_count": 2}}}
    )
    assert ledger.manual_search_queries == 2


# ---------------------------------------------------------------------------
# MeteredProvider — the Provider-shaped ledger wrapper


def test_metered_provider_routes_through_ledger():
    ledger = Ledger(cap_usd=10.0)
    fake = FakeProvider(responses=[json.dumps({"H": True})])
    metered = MeteredProvider(fake, ledger)
    assert metered.name == "fake"
    assert metered.model == "fake-judge"
    metered.complete([{"role": "user", "content": "hi"}], max_tokens=20)
    assert fake.calls == 1
    assert len(ledger.call_log) == 1


def test_metered_provider_over_cap_still_raises_and_skips_inner():
    ledger = Ledger(cap_usd=0.0000001)
    fake = FakeProvider(price_in_per_mtok=1_000_000.0, price_out_per_mtok=1_000_000.0)
    metered = MeteredProvider(fake, ledger)
    with pytest.raises(BudgetExhausted):
        metered.complete([{"role": "user", "content": "x" * 10_000}], max_tokens=500)
    assert fake.calls == 0


def test_summary_shape():
    ledger = Ledger(cap_usd=5.0, manual_search_cap=40)
    fake = FakeProvider(responses=["{}"])
    ledger.call(fake, [{"role": "user", "content": "hi"}], max_tokens=10)
    s = ledger.summary()
    for key in (
        "cap_usd",
        "spent_usd",
        "reserved_usd",
        "remaining_usd",
        "calls",
        "manual_search_queries",
        "manual_search_cap",
    ):
        assert key in s
    assert s["calls"] == 1


# ---------------------------------------------------------------------------
# Zero-token rule — an unpriced model refuses to run, no network triggered


def test_openai_provider_unknown_model_refuses_before_any_network_call():
    with pytest.raises(UnknownModelError):
        OpenAIProvider("totally-unpriced-model-xyz", api_key="sk-test-not-real")

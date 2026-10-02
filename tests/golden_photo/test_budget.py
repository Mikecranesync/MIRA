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


def test_manual_search_record_never_raises_past_cap():
    # F4: recording happens AFTER a turn ran and must never raise — the
    # turn already happened and cannot be un-run. Enforcement is the
    # caller's job, BEFORE the turn, via manual_search_cap_exceeded().
    ledger = Ledger(cap_usd=10.0, manual_search_cap=3)
    ledger.record_manual_search(3)
    ledger.record_manual_search(1)  # does not raise
    assert ledger.manual_search_queries == 4


def test_manual_search_cap_exceeded_is_the_pre_turn_gate():
    ledger = Ledger(cap_usd=10.0, manual_search_cap=5, queries_per_search=4)
    assert ledger.manual_search_cap_exceeded() is False  # 0 + 4 <= 5
    ledger.record_manual_search(2)
    assert ledger.manual_search_cap_exceeded() is True  # 2 + 4 > 5
    assert ledger.manual_search_cap_exceeded(additional=2) is False  # 2 + 2 <= 5


# ---------------------------------------------------------------------------
# F4 — record_manual_search_from_packet reads the REAL packet shape
# (mira-hub .../turn-evidence-packet.ts: retrieval.manual_acquisition =
# {state, started_this_turn, candidate_host} | None;
# retrieval.photo_part_manual_lookup = {action, searched, ...} | None).
# A null field is a legitimate "no search"; a MISSING field, or a
# packet/retrieval that isn't a dict, fails closed (charged as a start).


def test_manual_search_from_packet_null_fields_are_legitimate_no_search():
    ledger = Ledger(cap_usd=10.0, queries_per_search=4)
    ledger.record_manual_search_from_packet(
        {"retrieval": {"manual_acquisition": None, "photo_part_manual_lookup": None}},
        chat_turn=False,  # packet parsing alone; chat-turn charging is tested below
    )
    assert ledger.manual_search_queries == 0


def test_manual_search_from_packet_started_this_turn_charges_one_search_worth():
    ledger = Ledger(cap_usd=10.0, queries_per_search=4)
    ledger.record_manual_search_from_packet(
        {
            "retrieval": {
                "manual_acquisition": {
                    "state": "running",
                    "started_this_turn": True,
                    "candidate_host": "example.com",
                },
                "photo_part_manual_lookup": None,
            }
        }
    )
    assert ledger.manual_search_queries == 4


def test_manual_search_from_packet_not_started_charges_nothing():
    ledger = Ledger(cap_usd=10.0, queries_per_search=4)
    ledger.record_manual_search_from_packet(
        {
            "retrieval": {
                "manual_acquisition": {
                    "state": "idle",
                    "started_this_turn": False,
                    "candidate_host": None,
                },
                "photo_part_manual_lookup": {
                    "action": "proposed",
                    "searched": False,
                    "part_number_sha256": None,
                    "found": False,
                    "candidate_host": None,
                },
            }
        },
        chat_turn=False,
    )
    assert ledger.manual_search_queries == 0


def test_manual_search_from_packet_both_fields_started_charges_two_searches_worth():
    ledger = Ledger(cap_usd=10.0, queries_per_search=4)
    ledger.record_manual_search_from_packet(
        {
            "retrieval": {
                "manual_acquisition": {"started_this_turn": True},
                "photo_part_manual_lookup": {"searched": True},
            }
        }
    )
    assert ledger.manual_search_queries == 8


def test_manual_search_from_packet_missing_fields_fail_closed():
    ledger = Ledger(cap_usd=10.0, queries_per_search=4)
    ledger.record_manual_search_from_packet({"retrieval": {}})  # both fields missing
    assert ledger.manual_search_queries == 8  # one worst-case start per missing field


def test_manual_search_from_packet_missing_retrieval_or_packet_fails_closed():
    ledger = Ledger(cap_usd=10.0, queries_per_search=4)
    ledger.record_manual_search_from_packet({})  # no 'retrieval' key at all
    ledger.record_manual_search_from_packet(None)
    ledger.record_manual_search_from_packet({"retrieval": "not-a-dict"})
    assert ledger.manual_search_queries == 12  # 3 x one worst-case search


def test_manual_search_from_packet_integration_small_cap_stops_further_work():
    # The "Test to prove" from the review: feed real packet shapes through
    # the pre-turn gate and prove a small configured cap actually stops
    # further work rather than silently staying at zero.
    ledger = Ledger(cap_usd=10.0, manual_search_cap=4, queries_per_search=4)
    assert ledger.manual_search_cap_exceeded() is False
    ledger.record_manual_search_from_packet(
        {
            "retrieval": {
                "manual_acquisition": {"started_this_turn": True},
                "photo_part_manual_lookup": None,
            }
        }
    )
    assert ledger.manual_search_queries == 4
    assert ledger.manual_search_cap_exceeded() is True  # 4 + 4 > 4 -- next turn must stop


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


def test_openai_provider_without_explicit_prices_refuses_before_any_network_call():
    with pytest.raises(UnknownModelError):
        OpenAIProvider("any-model", api_key="sk-test-not-real")
    with pytest.raises(UnknownModelError):
        OpenAIProvider("any-model", api_key="sk-test-not-real", price_in_per_mtok=1.0)


def test_openai_provider_cost_uses_the_operator_rates():
    p = OpenAIProvider(
        "any-model", api_key="sk-test-not-real", price_in_per_mtok=2.0, price_out_per_mtok=8.0
    )
    assert p.est_cost(1_000_000, 500_000) == pytest.approx(6.0)


def test_r4_f4_every_chat_turn_with_null_acquisition_is_charged_worst_case():
    # A photo OR a typed manual request can start a CANDIDATE acquisition that
    # neither counted field reports, so each chat turn is charged worst case.
    led = Ledger(cap_usd=1.0, manual_search_cap=100, queries_per_search=4)
    null_packet = {"retrieval": {"manual_acquisition": None, "photo_part_manual_lookup": None}}
    led.record_manual_search_from_packet(null_packet)
    led.record_manual_search_from_packet(null_packet)
    assert led.manual_search_queries == 8
    # control: a packet that did not come from a chat dispatch is a legitimate zero
    led.record_manual_search_from_packet(null_packet, chat_turn=False)
    assert led.manual_search_queries == 8


@pytest.mark.parametrize("actual", [1.0, 1.2])
def test_r5_f15_settling_at_or_above_the_cap_marks_the_ledger_exhausted(actual):
    led = Ledger(cap_usd=1.0)
    token = led.reserve(0.5)
    led.settle(token, actual)
    assert led.usd_exhausted is True


def test_r5_f15_settling_below_the_cap_leaves_the_ledger_open():
    led = Ledger(cap_usd=1.0)
    led.settle(led.reserve(0.5), 0.4)
    assert led.usd_exhausted is False


def test_r6_f15_an_in_flight_reservation_holding_the_cap_stops_dispatch():
    led = Ledger(cap_usd=1.0)
    led.reserve(1.0)  # not settled yet, so usd_exhausted is still False
    assert led.usd_exhausted is False
    assert led.usd_stopped() is True

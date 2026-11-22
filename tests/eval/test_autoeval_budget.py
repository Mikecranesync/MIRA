"""Hermetic proofs for the autoeval spend guard. No network, no key, no ~/.factorylm.

Every "must stop" test has a "must pass" control next to it. The transport counts
requests and the key provider counts fetches, so a stop is proven to happen BEFORE
any request (criterion 4). tests/eval/autoeval_mutate.py removes each guard in turn.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import pytest

REPO = Path(os.environ.get("AUTOEVAL_REPO") or Path(__file__).resolve().parents[2])
SCRIPTS = Path(os.environ.get("AUTOEVAL_SCRIPTS") or REPO / "evals" / "scripts")
sys.path.insert(0, str(SCRIPTS))

import autoeval_budget as ab  # noqa: E402

MODEL = "claude-sonnet-4-6"
ORG = "org-confirmed"
PROMPT = "grade this answer " * 40
FAR_FUTURE = "2099-01-01T00:00:00+00:00"
NOON = 1_800_000_000.0  # 2027-01-15T08:00:00Z, fixed clock


class Spy:
    """Counts transport calls and key fetches."""

    def __init__(self, handler=None):
        self.requests = 0
        self.keys = 0
        self.handler = handler or _ok()

    def transport(self):
        def _wrapped(request):
            self.requests += 1
            return self.handler(request)

        return httpx.MockTransport(_wrapped)

    def key(self):
        self.keys += 1
        return "sk-ant-test-not-a-secret"


def _ok(usage=None, org=ORG, stop="end_turn", text='{"a": 1}'):
    body = {"model": MODEL, "stop_reason": stop, "content": [{"type": "text", "text": text}]}
    body["usage"] = usage if usage is not None else {"input_tokens": 1000, "output_tokens": 200}
    return lambda request: httpx.Response(
        200, json=body, headers={"anthropic-organization-id": org, "request-id": "req_test"}
    )


def _cfg(tmp_path, **over):
    base = dict(
        total_cap_usd=10.0,
        daily_cap_usd=10.0,
        paid_not_after=FAR_FUTURE,
        expect_org=ORG,
        sentinel=tmp_path / "STOP",
    )
    base.update(over)
    return ab.BudgetConfig(**base)


def _run(tmp_path, spy, cfg=None, clock=NOON, model=MODEL, prompt=PROMPT, sleep=lambda s: None):
    cfg = cfg or _cfg(tmp_path)
    ledger = ab.Ledger(tmp_path / "ledger.jsonl", cfg, clock=lambda: clock)
    client = httpx.Client(transport=spy.transport())
    return ab.claude_text(
        prompt, model, cfg=cfg, ledger=ledger, key_provider=spy.key, client=client, sleep=sleep
    ), ledger


def _refused(tmp_path, spy, **over):
    """Run with a config override that must stop; assert it stopped before any request."""
    cfg_over = {k: v for k, v in over.items() if k not in ("model", "clock")}
    with pytest.raises(ab.BudgetStop):
        _run(
            tmp_path,
            spy,
            cfg=_cfg(tmp_path, **cfg_over),
            model=over.get("model", MODEL),
            clock=over.get("clock", NOON),
        )
    assert spy.requests == 0, "a refused call reached the transport"
    assert spy.keys == 0, "a refused call fetched the key"


def test_control_call_passes_and_books_actual_cost(tmp_path):
    spy = Spy()
    reply, ledger = _run(tmp_path, spy)
    assert reply.text == '{"a": 1}' and reply.org == ORG
    assert spy.requests == 1 and spy.keys == 1
    assert ledger.spent_total() == pytest.approx((1000 * 3 + 200 * 15) / 1e6)


def test_total_cap_stops_before_any_request(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, total_cap_usd=0.0001)


def test_total_cap_control_passes_when_cap_is_enough(tmp_path):
    spy = Spy()
    _run(tmp_path, spy, cfg=_cfg(tmp_path, total_cap_usd=1.0))
    assert spy.requests == 1


def test_total_cap_counts_prior_spend_seeded_in_config(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, total_cap_usd=5.0, spent_before_usd=4.9999)


def test_daily_cap_stops_before_any_request(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, daily_cap_usd=0.0001)


def test_daily_cap_control_passes(tmp_path):
    spy = Spy()
    _run(tmp_path, spy, cfg=_cfg(tmp_path, daily_cap_usd=1.0))
    assert spy.requests == 1


def test_daily_bucket_resets_on_the_next_utc_day(tmp_path):
    cfg = _cfg(tmp_path, daily_cap_usd=0.02)
    spy = Spy()
    _run(tmp_path, spy, cfg=cfg, clock=NOON)  # spends about $0.006 today
    with pytest.raises(ab.BudgetStop):  # a second call the same day would exceed the daily cap
        _run(tmp_path, spy, cfg=cfg, clock=NOON)
    assert spy.requests == 1
    _run(tmp_path, spy, cfg=cfg, clock=NOON + 86400)  # next UTC day: bucket is empty again
    assert spy.requests == 2


def test_paid_not_after_stops_before_any_request(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, paid_not_after="2026-11-17T19:00:00+00:00", clock=NOON + 10**9)


def test_paid_not_after_control_passes_before_the_deadline(tmp_path):
    spy = Spy()
    _run(tmp_path, spy, cfg=_cfg(tmp_path, paid_not_after="2099-01-01T00:00:00+00:00"))
    assert spy.requests == 1


def test_unset_paid_not_after_refuses(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, paid_not_after="")


def test_kill_sentinel_stops_before_any_request(tmp_path):
    (tmp_path / "STOP").write_text("halt")
    spy = Spy()
    _refused(tmp_path, spy)


def test_kill_sentinel_control_passes_without_the_file(tmp_path):
    spy = Spy()
    _run(tmp_path, spy)
    assert spy.requests == 1


def test_unpriced_model_is_refused_before_any_request(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, model="claude-unpriced-9")


def test_priced_model_control_passes(tmp_path):
    spy = Spy()
    _run(tmp_path, spy, model=MODEL)
    assert spy.requests == 1


def test_empty_expect_org_refuses_before_any_request(tmp_path):
    spy = Spy()
    _refused(tmp_path, spy, expect_org="")


def test_foreign_org_already_in_ledger_refuses_before_any_request(tmp_path):
    spy = Spy()
    cfg = _cfg(tmp_path)
    ledger = ab.Ledger(tmp_path / "ledger.jsonl", cfg, clock=lambda: NOON)
    rid = ledger.reserve(0.001, model=MODEL)
    ledger.settle(rid, 0.001, status=200, org="org-someone-else")
    with pytest.raises(ab.BudgetStop):
        _run(tmp_path, spy, cfg=cfg)
    assert spy.requests == 0 and spy.keys == 0


def test_same_org_already_in_ledger_control_passes(tmp_path):
    spy = Spy()
    cfg = _cfg(tmp_path)
    ledger = ab.Ledger(tmp_path / "ledger.jsonl", cfg, clock=lambda: NOON)
    rid = ledger.reserve(0.001, model=MODEL)
    ledger.settle(rid, 0.001, status=200, org=ORG)
    _run(tmp_path, spy, cfg=cfg)
    assert spy.requests == 1


def test_wrong_org_on_the_response_stops_after_booking(tmp_path):
    spy = Spy(_ok(org="org-wrong"))
    with pytest.raises(ab.BudgetStop, match="not the confirmed org"):
        _run(tmp_path, spy)
    assert spy.requests == 1
    assert ab.Ledger(tmp_path / "ledger.jsonl", _cfg(tmp_path)).settled_orgs() == {"org-wrong"}


def test_correct_org_on_the_response_control_passes(tmp_path):
    spy = Spy(_ok(org=ORG))
    reply, _ = _run(tmp_path, spy)
    assert reply.org == ORG


def test_missing_usage_stops_and_keeps_worst_case_booked(tmp_path):
    body = {"model": MODEL, "stop_reason": "end_turn", "content": [{"type": "text", "text": "x"}]}
    spy = Spy(lambda r: httpx.Response(200, json=body, headers={"anthropic-organization-id": ORG}))
    with pytest.raises(ab.BudgetStop, match="without usage"):
        _run(tmp_path, spy)
    cfg = _cfg(tmp_path)
    assert ab.Ledger(tmp_path / "ledger.jsonl", cfg).spent_total() > 0


def test_usage_present_control_settles_to_actual(tmp_path):
    spy = Spy()
    _, ledger = _run(tmp_path, spy)
    assert ledger.spent_total() < 0.01


def test_billing_error_stops_without_fallback(tmp_path):
    spy = Spy(lambda r: httpx.Response(400, json={"error": "billing"}))
    with pytest.raises(ab.BudgetStop, match="no fallback"):
        _run(tmp_path, spy)
    assert spy.requests == 1  # a 400 is not retried


def test_non_200_control_is_not_an_error_path(tmp_path):
    spy = Spy()
    reply, _ = _run(tmp_path, spy)
    assert reply.stop_reason == "end_turn"


def test_truncated_output_is_reported_not_scored(tmp_path):
    spy = Spy(_ok(stop="max_tokens", text="partial"))
    reply, _ = _run(tmp_path, spy)
    assert reply.stop_reason == "max_tokens"  # the judge layer turns this into an error


def test_untruncated_control_has_end_turn(tmp_path):
    spy = Spy(_ok(stop="end_turn"))
    reply, _ = _run(tmp_path, spy)
    assert reply.stop_reason == "end_turn"


def test_corrupt_ledger_stops(tmp_path):
    (tmp_path / "ledger.jsonl").write_text('{"t": "reserve"\n')
    spy = Spy()
    _refused(tmp_path, spy)


def test_intact_ledger_control_is_readable(tmp_path):
    ledger = ab.Ledger(tmp_path / "ledger.jsonl", _cfg(tmp_path), clock=lambda: NOON)
    ledger.reserve(0.001, model=MODEL)
    assert ledger.spent_total() == pytest.approx(0.001)


def test_unsettled_reservation_counts_as_spent(tmp_path):
    ledger = ab.Ledger(tmp_path / "ledger.jsonl", _cfg(tmp_path), clock=lambda: NOON)
    ledger.reserve(0.25, model=MODEL)
    assert ledger.spent_total() == pytest.approx(0.25)


def test_settled_reservation_counts_only_the_actual(tmp_path):
    ledger = ab.Ledger(tmp_path / "ledger.jsonl", _cfg(tmp_path), clock=lambda: NOON)
    rid = ledger.reserve(0.25, model=MODEL)
    ledger.settle(rid, 0.01, status=200, org=ORG)
    assert ledger.spent_total() == pytest.approx(0.01)


def test_transport_error_twice_stops(tmp_path):
    def boom(request):
        raise httpx.ConnectError("refused")

    spy = Spy(boom)
    with pytest.raises(ab.BudgetStop, match="transport error twice"):
        _run(tmp_path, spy)
    assert spy.requests == 2


def test_stop_is_a_systemexit_so_harness_except_cannot_swallow_it():
    assert issubclass(ab.BudgetStop, SystemExit)
    assert not issubclass(ab.BudgetStop, Exception)


def test_threshold_crossings_report_each_threshold_once():
    assert ab.threshold_crossings(4.0, 5.5, 10.0) == [50]
    assert ab.threshold_crossings(7.9, 10.1, 10.0) == [80, 100]


def test_threshold_control_no_move_no_crossing():
    assert ab.threshold_crossings(5.5, 5.5, 10.0) == []
    assert (
        ab.threshold_crossings(5.0, 5.0, 10.0) == []
    )  # exactly on a line that was already reached
    assert ab.threshold_crossings(1.0, 4.0, 10.0) == []


def test_threshold_zero_cap_reports_nothing():
    assert ab.threshold_crossings(0.0, 1.0, 0.0) == []


def test_payload_is_pinned_per_model_and_carries_model_params(tmp_path):
    seen = []

    def capture(request):
        seen.append(json.loads(request.content))
        return _ok()(request)

    _run(tmp_path, Spy(capture), model=MODEL)
    assert seen[0]["max_tokens"] == 1024 and seen[0]["temperature"] == 0


# --- Concurrent commands share one ledger (Codex r1 F1 on #5569) ---------------


def _race(tmp_path, monkeypatch, usd, cap):
    import threading
    import time as _t

    cfg = _cfg(tmp_path, total_cap_usd=cap, daily_cap_usd=cap)
    real = ab.Ledger.spent_day

    def slow_spent_day(self, day):
        v = real(self, day)
        _t.sleep(0.2)  # widen the read-then-append window so an unlocked reserve races
        return v

    monkeypatch.setattr(ab.Ledger, "spent_day", slow_spent_day)
    admitted, refused = [], []

    def one():
        ledger = ab.Ledger(tmp_path / "ledger.jsonl", cfg, clock=lambda: NOON)
        try:
            admitted.append(ledger.reserve(usd, model=MODEL))
        except ab.BudgetStop:
            refused.append(1)

    ts = [threading.Thread(target=one) for _ in range(2)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return admitted, refused, ab.Ledger(tmp_path / "ledger.jsonl", cfg).spent_total()


def test_two_concurrent_reservations_cannot_both_pass_the_cap(tmp_path, monkeypatch):
    admitted, refused, booked = _race(tmp_path, monkeypatch, usd=0.75, cap=1.0)
    assert len(admitted) == 1 and len(refused) == 1
    assert booked <= 1.0


def test_control_concurrent_reservations_that_fit_both_pass(tmp_path, monkeypatch):
    admitted, refused, booked = _race(tmp_path, monkeypatch, usd=0.4, cap=1.0)
    assert len(admitted) == 2 and not refused
    assert abs(booked - 0.8) < 1e-9

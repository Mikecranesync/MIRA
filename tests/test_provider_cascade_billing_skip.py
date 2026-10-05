"""A provider that cannot succeed must be classified honestly and skipped cheaply.

FOUND 2026-09-03, in production. The provider-health canary had failed on EVERY
run for at least a day with:

    cerebras  DOWN  (gpt-oss-120b) - HTTP 402:
    {"message":"Payment required to access this resource. Visit your billing tab.",
     "type":"payment_required_error","param":"quota","code":"payment_required"}

Two defects sat behind that red run.

1. MISCLASSIFICATION. `_classify_http_error` mapped 400 -> "billing" but had no
   case for 402 - the status code whose entire meaning is "Payment Required".
   402 fell through to "unknown", so a billing outage was logged and counted
   as an unclassified blip, indistinguishable from a transient one.

2. NO COOLDOWN. `complete()` walks the cascade in order on every call with no
   memory of what just failed. Cerebras is second (groq -> cerebras -> together),
   so every request that falls past Groq paid a full round-trip - up to
   `provider.timeout` - to be told again that the bill is unpaid, before
   reaching Together. Days of that.

The distinction these tests defend is between failures that self-heal and
failures that do not. `rate_limit` and `service` MUST keep being retried: a
cooldown there would turn a transient blip into a self-inflicted outage. `auth`
and `billing` will not fix themselves, and a human has to act.
"""

from __future__ import annotations

import asyncio
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "mira-bots", "shared"))

from inference.router import (  # noqa: E402
    _DEAD_PROVIDER_COOLDOWN_S,
    _UNRECOVERABLE_REASONS,
    _classify_http_error,
    _Provider,
    _ProviderSkip,
    InferenceRouter,
)


class TestErrorClassification:
    def test_402_is_billing_not_unknown(self):
        """THE regression. 402 is literally 'Payment Required'."""
        assert _classify_http_error(402) == "billing"

    def test_400_remains_billing(self):
        """Unchanged: a provider in this cascade has used 400 for quota too."""
        assert _classify_http_error(400) == "billing"

    @pytest.mark.parametrize("status", [401, 403])
    def test_auth_codes(self, status: int):
        assert _classify_http_error(status) == "auth"

    def test_429_is_rate_limit_and_therefore_recoverable(self):
        assert _classify_http_error(429) == "rate_limit"
        assert "rate_limit" not in _UNRECOVERABLE_REASONS

    @pytest.mark.parametrize("status", [500, 502, 503, 529])
    def test_service_codes_are_recoverable(self, status: int):
        assert _classify_http_error(status) == "service"
        assert "service" not in _UNRECOVERABLE_REASONS

    def test_unrecoverable_set_is_exactly_auth_and_billing(self):
        """Pin the set. Widening it silently is how a transient failure becomes
        a self-inflicted outage; narrowing it re-opens the latency tax."""
        assert _UNRECOVERABLE_REASONS == frozenset({"auth", "billing"})


class TestCooldownBehaviour:
    """Drives the REAL cascade loop in `InferenceRouter.complete()`.

    An earlier draft of this file asserted a local reimplementation of the skip
    rule, which would have passed with the feature reverted. These call the
    shipped code and count attempts.
    """

    @staticmethod
    def _router(reason: str):
        """A 2-provider cascade whose FIRST provider always fails with `reason`
        and whose second always answers. Returns (router, attempts)."""
        r = InferenceRouter.__new__(InferenceRouter)  # bypass env-dependent __init__
        r.backend = "cloud"
        r.enabled = True
        r._provider_call_windows = {}
        r._last_model_by_session = {}
        r._provider_cooldown = {}
        r.providers = [
            _Provider(name="dead", api_url="http://x", api_key="k", model="m"),
            _Provider(name="alive", api_url="http://y", api_key="k", model="m"),
        ]
        attempts: list[str] = []

        async def fake_call(provider, messages, max_tokens, session_id, has_image):
            attempts.append(provider.name)
            if provider.name == "dead":
                raise _ProviderSkip(provider.name, reason)
            return "ok", {"provider": provider.name}

        r._call_openai_compat = fake_call  # type: ignore[method-assign]
        r._track_provider_call = lambda *a, **k: None  # type: ignore[method-assign]
        r._record_session_model = lambda *a, **k: None  # type: ignore[method-assign]
        return r, attempts

    @pytest.mark.parametrize("reason", ["billing", "auth"])
    def test_an_unrecoverable_provider_is_dialled_once_then_skipped(self, reason: str):
        """THE fix. Before it, "dead" was attempted on every single call."""
        r, attempts = self._router(reason)
        for _ in range(5):
            content, _usage = asyncio.run(r.complete([{"role": "user", "content": "hi"}]))
            assert content == "ok"  # the cascade still answers, from "alive"
        assert attempts.count("dead") == 1, attempts
        assert attempts.count("alive") == 5, attempts

    @pytest.mark.parametrize("reason", ["rate_limit", "service", "unknown"])
    def test_a_recoverable_provider_keeps_being_retried(self, reason: str):
        """The safety property: a transient failure must NOT self-inflict an
        outage by evicting a provider that would have recovered."""
        r, attempts = self._router(reason)
        for _ in range(3):
            asyncio.run(r.complete([{"role": "user", "content": "hi"}]))
        assert attempts.count("dead") == 3, attempts

    def test_the_cooldown_expires_so_a_fixed_account_self_heals(self):
        """No redeploy needed once the bill is paid."""
        r, attempts = self._router("billing")
        asyncio.run(r.complete([{"role": "user", "content": "hi"}]))
        assert attempts.count("dead") == 1
        # Expire it by hand rather than sleeping 300s.
        r._provider_cooldown["dead"] = time.monotonic() - 1
        asyncio.run(r.complete([{"role": "user", "content": "hi"}]))
        assert attempts.count("dead") == 2, attempts

    def test_cooldown_is_bounded_and_self_expiring(self):
        assert 0 < _DEAD_PROVIDER_COOLDOWN_S <= 3600

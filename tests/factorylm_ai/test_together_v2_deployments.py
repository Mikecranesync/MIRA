"""Hermetic v2-deployment lifecycle tests — the v2 mirror of the proven v1
teardown suite. No network: the single HTTP seam (``_v2_request``) is replaced
by a scripted fake; the trusted verifier is monkeypatched; sleeps are zeroed.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from typing import Any

import pytest

from factorylm_ai.budget import BudgetExceeded, BudgetGuard
from factorylm_ai.finetune import PaidEventAuthorization
from factorylm_ai.providers import together_v2 as v2
from factorylm_ai.providers.base import ProviderError

AUTH = PaidEventAuthorization(
    authorization_id="test-auth-1",
    provider="together",
    action="together.temporary_endpoint_benchmark",
    dataset_manifest_hash="a" * 64,
    model="projects/p1/models/m1",
    request_hash="sha256:" + "b" * 64,
    currency="USD",
    spend_cap_usd=5.0,
    issued_by="mikecranesync",
    authority_ref="test",
    issued_at="2026-07-27T00:00:00Z",
    expires_at="2027-07-27T00:00:00Z",
    receipt_ref="test",
)

SPEC = v2.V2CreateSpec(
    project_id="p1",
    project_slug="proj",
    endpoint_name="ep-eval",
    deployment_name="dep-eval",
    model="projects/p1/models/m1",
    enable_lora=True,
)


class FakeV2:
    """Scripted v2 management API: records calls, walks a state script."""

    def __init__(self, states: list[str] | None = None):
        self.calls: list[tuple[str, str, dict | None]] = []
        self.states = list(states or [v2.STATE_READY, v2.STATE_STOPPED])
        self._state_i = 0
        self.fail_deployment_create = False
        self.patch_responses: list[Any] = []  # exceptions or None per PATCH call
        self.get_404_after_stop = False
        self._stopped = False
        self.etag_serial = 0

    def _next_state(self) -> str:
        s = self.states[min(self._state_i, len(self.states) - 1)]
        self._state_i += 1
        return s

    async def __call__(
        self,
        method: str,
        path: str,
        api_key: str,
        payload: dict | None = None,
        timeout: float = 60.0,
    ) -> dict:
        self.calls.append((method, path, payload))
        if method == "POST" and path.endswith("/endpoints"):
            return {"id": "ep-123", "name": "ep-eval"}
        if method == "POST" and path.endswith("/deployments"):
            if self.fail_deployment_create:
                raise ProviderError("together v2 POST deployments HTTP 400: bad config")
            return {"id": "dep-456"}
        if method == "GET" and "/deployments/" in path:
            if self._stopped and self.get_404_after_stop:
                raise ProviderError("together v2 GET x HTTP 404: gone")
            state = v2.STATE_STOPPED if self._stopped else self._next_state()
            self.etag_serial += 1
            return {
                "id": "dep-456",
                "etag": f"etag-{self.etag_serial}",
                "status": {"state": state, "message": "scripted"},
            }
        if method == "PATCH":
            if self.patch_responses:
                r = self.patch_responses.pop(0)
                if isinstance(r, Exception):
                    raise r
            self._stopped = True
            return {"id": "dep-456", "status": {"state": v2.STATE_STOPPED}}
        if method == "DELETE":
            return {}
        return {}


@pytest.fixture()
def env(monkeypatch, tmp_path):
    monkeypatch.setenv("TOGETHERAI_API_KEY", "test-key")
    monkeypatch.setenv("FACTORYLM_AI_ALLOW_NETWORK", "1")

    class _FakeVerifier:
        consumed: list[dict] = []

        @classmethod
        def from_environment(cls):
            return cls()

        def verify_and_consume(self, auth, **kw):
            _FakeVerifier.consumed.append({"auth": auth.authorization_id, **kw})
            return {"state": "consumed"}

    _FakeVerifier.consumed = []
    import factorylm_ai.providers.paid_authorization_guard as guard

    monkeypatch.setattr(guard, "TrustedPaidAuthorizationVerifier", _FakeVerifier)

    async def _nosleep(_secs):
        return None

    monkeypatch.setattr(v2.asyncio, "sleep", _nosleep)
    return {"verifier": _FakeVerifier, "ledger": tmp_path / "leases.jsonl"}


def _run(spec=SPEC, *, fake, env, budget=None, benchmark=None, **kw):
    async def _bench(name: str):
        return {"served": name}

    return asyncio.run(
        v2.run_temporary_v2_deployment(
            spec,
            benchmark or _bench,
            budget=budget or BudgetGuard(cap_usd=5.0),
            est_usd=3.6,
            dataset_manifest_hash="c" * 64,
            approval_evidence=AUTH,
            ledger_path=env["ledger"],
            poll_interval_seconds=0.0,
            **kw,
        )
    )


def _ledger_events(env):
    return [
        json.loads(line)["event"]
        for line in env["ledger"].read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def test_happy_path_stop_verified_and_ledger_resolved(monkeypatch, env):
    fake = FakeV2(states=[v2.STATE_READY])
    monkeypatch.setattr(v2, "_v2_request", fake)
    run = _run(fake=fake, env=env)
    assert run.stopped_verified is True
    assert run.benchmark_result == {"served": "proj/ep-eval"}
    assert run.qualified_name == "proj/ep-eval"
    assert _ledger_events(env) == ["created", "stopped_verified"]
    # lease was written IMMEDIATELY after create — before any polling GET
    create_i = next(
        i for i, c in enumerate(fake.calls) if c[0] == "POST" and c[1].endswith("/deployments")
    )
    first_get = next(i for i, c in enumerate(fake.calls) if c[0] == "GET")
    assert create_i < first_get


def test_authorization_consumed_before_any_resource_creation(monkeypatch, env):
    fake = FakeV2()
    order: list[str] = []
    orig_consume = env["verifier"].verify_and_consume

    def _consume(self, auth, **kw):
        order.append("consume")
        return orig_consume(self, auth, **kw)

    env["verifier"].verify_and_consume = _consume

    async def _tracking(method, path, key, payload=None, timeout=60.0):
        order.append(f"{method} {path.rsplit('/', 1)[-1]}")
        return await fake(method, path, key, payload, timeout)

    monkeypatch.setattr(v2, "_v2_request", _tracking)
    _run(fake=fake, env=env)
    assert order[0] == "consume"


def test_budget_precheck_fires_before_consume_and_network(monkeypatch, env):
    fake = FakeV2()
    monkeypatch.setattr(v2, "_v2_request", fake)
    with pytest.raises(BudgetExceeded):
        _run(fake=fake, env=env, budget=BudgetGuard(cap_usd=1.0))  # est 3.6 > cap 1.0
    assert fake.calls == []
    assert env["verifier"].consumed == []


def test_partial_creation_releases_endpoint_and_raises(monkeypatch, env):
    fake = FakeV2()
    fake.fail_deployment_create = True
    monkeypatch.setattr(v2, "_v2_request", fake)
    with pytest.raises(ProviderError, match="bad config"):
        _run(fake=fake, env=env)
    deletes = [c for c in fake.calls if c[0] == "DELETE" and c[1].endswith("/endpoints/ep-123")]
    assert deletes, "endpoint must be released after failed deployment create"
    assert not env["ledger"].exists() or "created" not in _ledger_events(env)


def test_benchmark_failure_still_stops_and_verifies(monkeypatch, env):
    fake = FakeV2(states=[v2.STATE_READY])
    monkeypatch.setattr(v2, "_v2_request", fake)

    async def _boom(name: str):
        raise RuntimeError("inference exploded")

    with pytest.raises(RuntimeError, match="inference exploded"):
        _run(fake=fake, env=env, benchmark=_boom)
    assert any(c[0] == "PATCH" for c in fake.calls), "stop must run on benchmark failure"
    assert _ledger_events(env) == ["created", "stopped_verified"]


def test_persistent_stop_failure_raises_cleanup_error_and_marks_unverified(monkeypatch, env):
    fake = FakeV2(
        states=[v2.STATE_READY, v2.STATE_READY, v2.STATE_READY, v2.STATE_READY, v2.STATE_READY]
    )
    fake.patch_responses = [ProviderError("together v2 PATCH x HTTP 500: boom")] * 5
    monkeypatch.setattr(v2, "_v2_request", fake)
    with pytest.raises(v2.V2DeploymentCleanupError, match="UNVERIFIED"):
        _run(fake=fake, env=env)
    assert _ledger_events(env) == ["created", "stop_unverified"]


def test_transient_stop_failure_retries_then_succeeds(monkeypatch, env):
    fake = FakeV2(states=[v2.STATE_READY, v2.STATE_READY])
    fake.patch_responses = [ProviderError("together v2 PATCH x HTTP 503: transient")]
    monkeypatch.setattr(v2, "_v2_request", fake)
    run = _run(fake=fake, env=env)
    assert run.stopped_verified is True
    patches = [c for c in fake.calls if c[0] == "PATCH"]
    assert len(patches) == 2


def test_etag_conflict_refreshes_and_retries(monkeypatch, env):
    fake = FakeV2(states=[v2.STATE_READY, v2.STATE_READY])
    fake.patch_responses = [ProviderError("together v2 PATCH x HTTP 409: etag mismatch")]
    monkeypatch.setattr(v2, "_v2_request", fake)
    run = _run(fake=fake, env=env)
    assert run.stopped_verified is True
    patch_etags = [c[2].get("etag") for c in fake.calls if c[0] == "PATCH"]
    assert len(patch_etags) == 2 and patch_etags[0] != patch_etags[1], "etag must be refreshed"


def test_stale_ledger_recovery_stops_orphan(monkeypatch, env):
    ledger = v2.TogetherV2DeploymentLeaseLedger(env["ledger"])
    ledger.record_created(
        lease={"project_id": "p1", "endpoint_id": "ep-123", "deployment_id": "dep-456"},
        authorization_id="orphaned-auth",
    )
    fake = FakeV2(states=[v2.STATE_READY])  # orphan still running
    monkeypatch.setattr(v2, "_v2_request", fake)
    outcomes = asyncio.run(
        v2.cleanup_orphaned_v2_deployments(env["ledger"], poll_interval_seconds=0.0)
    )
    assert outcomes == [{"deployment_id": "dep-456", "outcome": "stopped_verified"}]
    assert v2.TogetherV2DeploymentLeaseLedger(env["ledger"]).unresolved_leases() == []


def test_idempotent_teardown_on_already_gone_deployment(monkeypatch, env):
    ledger = v2.TogetherV2DeploymentLeaseLedger(env["ledger"])
    ledger.record_created(
        lease={"project_id": "p1", "endpoint_id": "ep-123", "deployment_id": "dep-456"},
        authorization_id="gone-auth",
    )

    async def _always_404(method, path, key, payload=None, timeout=60.0):
        raise ProviderError("together v2 GET x HTTP 404: gone")

    monkeypatch.setattr(v2, "_v2_request", _always_404)
    outcomes = asyncio.run(
        v2.cleanup_orphaned_v2_deployments(env["ledger"], poll_interval_seconds=0.0)
    )
    assert outcomes[0]["outcome"] == "stopped_verified"
    # replaying recovery on the now-resolved ledger is a no-op (idempotent)
    outcomes2 = asyncio.run(
        v2.cleanup_orphaned_v2_deployments(env["ledger"], poll_interval_seconds=0.0)
    )
    assert outcomes2 == []


def test_failed_state_raises_and_still_tears_down(monkeypatch, env):
    fake = FakeV2(states=[v2.STATE_FAILED])
    monkeypatch.setattr(v2, "_v2_request", fake)
    with pytest.raises(ProviderError, match="DEPLOYMENT_STATE_FAILED"):
        _run(fake=fake, env=env)
    assert any(
        c[0] == "PATCH" or (c[0] == "GET" and "/deployments/" in c[1]) for c in fake.calls
    ), "teardown path must still run"
    assert _ledger_events(env)[-1] in ("stopped_verified", "stop_unverified")


def test_no_verifier_injection_parameter_exists():
    params = inspect.signature(v2.run_temporary_v2_deployment).parameters
    assert "authorization_verifier" not in params, (
        "the execution environment must not be able to supply its own verifier"
    )


def test_missing_authorization_refused_before_any_call(monkeypatch, env):
    fake = FakeV2()
    monkeypatch.setattr(v2, "_v2_request", fake)

    async def _bench(name):
        return None

    with pytest.raises(v2.PaidEventNotAuthorizedV2, match="missing paid authorization"):
        asyncio.run(
            v2.run_temporary_v2_deployment(
                SPEC,
                _bench,
                budget=BudgetGuard(cap_usd=5.0),
                est_usd=3.6,
                dataset_manifest_hash="c" * 64,
                approval_evidence=None,
                ledger_path=env["ledger"],
                poll_interval_seconds=0.0,
            )
        )
    assert fake.calls == []

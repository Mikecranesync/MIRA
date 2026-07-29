"""Together Dedicated Endpoints **v2** deployment lifecycle (management API).

v1 (`/v1/endpoints`, in :mod:`together`) was retired by Together
(``endpoints_v1_create_access_disabled``). v2 is a different resource model:

    project -> endpoint (stable inference name) -> deployment (replicas of a
    model revision, optionally pinned to a published config revision)

Billing starts when a deployment reaches ``READY`` and stops at ``STOPPED``
(zero replicas). There is NO ``inactive_timeout`` in v2 — a deployment runs
until it is explicitly stopped, which makes guaranteed teardown the load-
bearing safety property of this module:

- the deployment id is written to an append-only lease ledger IMMEDIATELY
  after creation (before any polling), so a crash can never orphan silently;
- ``stop`` = PATCH autoscaling to min=max=0 with etag concurrency, retried
  on transient failures and etag conflicts;
- completion requires observing ``DEPLOYMENT_STATE_STOPPED`` (or 404), then
  best-effort delete — teardown is verified, never assumed;
- :func:`cleanup_orphaned_v2_deployments` replays unresolved ledger leases
  after a crash (idempotent: already-stopped/deleted leases resolve cleanly).

Spend governance is unchanged from v1: a single-use signed
``PaidEventAuthorization`` (action ``together.temporary_endpoint_benchmark``,
request-hash-bound to the exact create spec) is verified AND consumed through
the trusted ledger before any resource is created, and the verifier is ALWAYS
built from the environment — this module accepts no caller-supplied verifier,
so the execution environment cannot inject a permissive one.

No function here is exercised against the real API in tests; the single HTTP
seam (:func:`_v2_request`) is hermetically mocked.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx

from factorylm_ai.budget import BudgetGuard
from factorylm_ai.finetune import (
    ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
    PaidEventAuthorization,
    canonical_paid_action_request_hash,
)
from factorylm_ai.providers.base import ProviderError

logger = logging.getLogger("factorylm-ai-together-v2")

V2_BASE = "https://api.together.ai/v2"
WHOAMI_URL = "https://api.together.ai/v1/whoami"
STATE_READY = "DEPLOYMENT_STATE_READY"
STATE_STOPPED = "DEPLOYMENT_STATE_STOPPED"
STATE_FAILED = "DEPLOYMENT_STATE_FAILED"
_TERMINAL_BAD = {STATE_FAILED}
_STOP_RETRIES = 3
_TRANSIENT_BACKOFF_SECONDS = 2.0


class V2DeploymentCleanupError(ProviderError):
    """Teardown could not be VERIFIED — treat as an active billing risk."""


class PaidEventNotAuthorizedV2(ProviderError):
    """A billable v2 operation lacked durable authorization evidence."""


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _network_allowed() -> bool:
    return str(os.getenv("FACTORYLM_AI_ALLOW_NETWORK") or "").strip().lower() in {"1", "true"}


def _api_key() -> str:
    return os.getenv("TOGETHERAI_API_KEY") or ""


def _require_network() -> str:
    key = _api_key()
    if not key or not _network_allowed():
        raise ProviderError(
            "together v2 management call refused: TOGETHERAI_API_KEY and "
            "FACTORYLM_AI_ALLOW_NETWORK are both required"
        )
    return key


async def _v2_request(
    method: str,
    path: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    """The single HTTP seam for the v2 management API (hermetically mocked in tests).

    One 429 retry; >=400 raises ProviderError carrying the status code text.
    ``path`` is joined onto ``V2_BASE`` unless it is already an absolute URL
    (the whoami identity route lives on the v1 base).
    """
    url = path if path.startswith("https://") else f"{V2_BASE}{path}"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    async with httpx.AsyncClient(timeout=timeout) as client:
        for attempt in (1, 2):
            try:
                resp = await client.request(method, url, headers=headers, json=payload)
            except httpx.TimeoutException as exc:
                raise ProviderError(f"together v2 {method} {path} timed out") from exc
            if resp.status_code == 429 and attempt == 1:
                await asyncio.sleep(2.0)
                continue
            break
        if resp.status_code >= 400:
            raise ProviderError(
                f"together v2 {method} {path} HTTP {resp.status_code}: {resp.text[:300]}"
            )
        if not resp.content:
            return {}
        return resp.json()


# --------------------------------------------------------------------------
# lease ledger (crash recovery)
# --------------------------------------------------------------------------
def _default_ledger_path() -> Path:
    return Path.home() / ".factorylm" / "together_v2_deployment_leases.jsonl"


class TogetherV2DeploymentLeaseLedger:
    """Append-only lease ledger for v2 deployments (mirrors the proven v1 ledger)."""

    def __init__(self, path: str | Path | None = None) -> None:
        self._path = Path(path) if path is not None else _default_ledger_path()

    @property
    def path(self) -> Path:
        return self._path

    def _append(self, record: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=True, sort_keys=True) + "\n")
            fh.flush()
            os.fsync(fh.fileno())

    def _read_all(self) -> list[dict[str, Any]]:
        if not self._path.exists():
            return []
        rows: list[dict[str, Any]] = []
        for line in self._path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
        return rows

    def record_created(self, *, lease: dict[str, Any], authorization_id: str) -> None:
        self._append(
            {
                "event": "created",
                "lease": dict(lease),
                "authorization_id": authorization_id,
                "recorded_at": _utc_now_iso(),
            }
        )

    def record_stopped_verified(self, deployment_id: str) -> None:
        self._append(
            {
                "event": "stopped_verified",
                "deployment_id": deployment_id,
                "recorded_at": _utc_now_iso(),
            }
        )

    def record_stop_unverified(self, deployment_id: str, reason: str) -> None:
        self._append(
            {
                "event": "stop_unverified",
                "deployment_id": deployment_id,
                "reason": str(reason)[:500],
                "recorded_at": _utc_now_iso(),
            }
        )

    def unresolved_leases(self) -> list[dict[str, Any]]:
        """Leases with a ``created`` event but no ``stopped_verified`` yet."""
        created: dict[str, dict[str, Any]] = {}
        resolved: set[str] = set()
        for row in self._read_all():
            if row.get("event") == "created":
                lease = row.get("lease") or {}
                did = str(lease.get("deployment_id") or "")
                if did:
                    created[did] = lease
            elif row.get("event") == "stopped_verified":
                resolved.add(str(row.get("deployment_id") or ""))
        return [lease for did, lease in created.items() if did not in resolved]


# --------------------------------------------------------------------------
# resource helpers ($0 reads + lifecycle writes)
# --------------------------------------------------------------------------
async def get_project_identity(api_key: str | None = None) -> dict[str, Any]:
    """Resolve the API key's project/org identity via ``GET /v1/whoami``.

    There is no list-projects route on the v2 management API (verified live
    2026-07-27: ``GET /v2/projects`` is 404); whoami returns ``project_id``,
    ``project_slug``, ``organization_id`` for the authenticated key.
    """
    key = api_key or _require_network()
    return await _v2_request("GET", WHOAMI_URL, key)


async def list_configs(
    project_id: str, reference_model_id: str, api_key: str | None = None
) -> list[dict[str, Any]]:
    """List deployment configs compatible with ``reference_model_id``.

    The route rejects a bare call ("referenceModelId or referenceModel is
    required", verified live 2026-07-27) — the reference model is mandatory.
    """
    key = api_key or _require_network()
    data = await _v2_request(
        "GET", f"/projects/{project_id}/configs?referenceModelId={reference_model_id}", key
    )
    return data.get("configs") or data.get("data") or []


async def find_model_resource(
    project_id: str, model_name: str, api_key: str | None = None
) -> dict[str, Any] | None:
    key = api_key or _require_network()
    data = await _v2_request("GET", f"/projects/{project_id}/models", key)
    for m in data.get("models") or data.get("data") or []:
        if model_name in (m.get("name"), m.get("id"), m.get("displayName")):
            return m
    return None


async def get_deployment(
    project_id: str, endpoint_id: str, deployment_id: str, api_key: str
) -> dict[str, Any]:
    return await _v2_request(
        "GET",
        f"/projects/{project_id}/endpoints/{endpoint_id}/deployments/{deployment_id}",
        api_key,
    )


def _state_of(deployment: dict[str, Any]) -> str:
    status = deployment.get("status") or {}
    return str(status.get("state") or "")


async def stop_deployment(
    project_id: str, endpoint_id: str, deployment_id: str, api_key: str
) -> None:
    """PATCH autoscaling to 0/0 with etag concurrency; retries transient + conflict."""
    last_exc: Exception | None = None
    for attempt in range(1, _STOP_RETRIES + 1):
        try:
            current = await get_deployment(project_id, endpoint_id, deployment_id, api_key)
        except ProviderError as exc:
            if "HTTP 404" in str(exc):
                return  # already gone — stopping is moot (idempotent teardown)
            last_exc = exc
            await asyncio.sleep(_TRANSIENT_BACKOFF_SECONDS)
            continue
        if _state_of(current) == STATE_STOPPED:
            return  # idempotent: already stopped
        payload = {
            "autoscaling": {"minReplicas": 0, "maxReplicas": 0},
            "etag": current.get("etag"),
        }
        try:
            await _v2_request(
                "PATCH",
                f"/projects/{project_id}/endpoints/{endpoint_id}/deployments/{deployment_id}",
                api_key,
                payload,
            )
            return
        except ProviderError as exc:
            last_exc = exc
            text = str(exc)
            if "HTTP 409" in text or "HTTP 412" in text or "etag" in text.lower():
                continue  # etag conflict — refresh and retry
            if any(f"HTTP {code}" in text for code in (500, 502, 503, 504)):
                await asyncio.sleep(_TRANSIENT_BACKOFF_SECONDS)
                continue
            raise
    raise V2DeploymentCleanupError(
        f"stop_deployment {deployment_id!r}: retries exhausted: {last_exc}"
    )


async def wait_for_deployment_state(
    project_id: str,
    endpoint_id: str,
    deployment_id: str,
    api_key: str,
    *,
    want: str,
    timeout_seconds: float,
    poll_interval_seconds: float,
    missing_ok: bool = False,
) -> dict[str, Any] | None:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            dep = await get_deployment(project_id, endpoint_id, deployment_id, api_key)
        except ProviderError as exc:
            if missing_ok and "HTTP 404" in str(exc):
                return None
            raise
        state = _state_of(dep)
        if state == want:
            return dep
        if state in _TERMINAL_BAD and want != STATE_FAILED:
            msg = (dep.get("status") or {}).get("message", "")
            raise ProviderError(f"deployment {deployment_id!r} entered {state}: {msg}")
        if time.monotonic() >= deadline:
            raise ProviderError(
                f"deployment {deployment_id!r} did not reach {want} within "
                f"{timeout_seconds}s (last state {state!r})"
            )
        await asyncio.sleep(poll_interval_seconds)


async def stop_and_verify_deployment(
    project_id: str,
    endpoint_id: str,
    deployment_id: str,
    api_key: str,
    *,
    stop_timeout_seconds: float = 300.0,
    poll_interval_seconds: float = 10.0,
    delete_after: bool = True,
) -> None:
    """Stop -> observe STOPPED (or 404) -> best-effort delete. Idempotent."""
    await stop_deployment(project_id, endpoint_id, deployment_id, api_key)
    dep = await wait_for_deployment_state(
        project_id,
        endpoint_id,
        deployment_id,
        api_key,
        want=STATE_STOPPED,
        timeout_seconds=stop_timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
        missing_ok=True,
    )
    if delete_after and dep is not None:
        try:
            await _v2_request(
                "DELETE",
                f"/projects/{project_id}/endpoints/{endpoint_id}/deployments/{deployment_id}",
                api_key,
            )
        except ProviderError as exc:
            if "HTTP 404" not in str(exc):
                logger.warning(
                    "v2 deployment %s delete failed (stopped, not billing): %s", deployment_id, exc
                )


# --------------------------------------------------------------------------
# the governed temporary-deployment runner
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class V2CreateSpec:
    """The exact resources the authorization request-hash binds to."""

    project_id: str
    project_slug: str
    endpoint_name: str
    deployment_name: str
    model: str  # projects/{p}/models/{m}[/revisions/{r}]
    config: str | None = None  # projects/{p}/configs/{configRevisionId}
    enable_lora: bool = False
    autoscaling: dict[str, int] = field(
        default_factory=lambda: {"minReplicas": 1, "maxReplicas": 1}
    )

    def canonical_payload(self) -> dict[str, Any]:
        return {
            "project_id": self.project_id,
            "project_slug": self.project_slug,
            "endpoint_name": self.endpoint_name,
            "deployment_name": self.deployment_name,
            "model": self.model,
            "config": self.config,
            "enable_lora": self.enable_lora,
            "autoscaling": dict(self.autoscaling),
        }

    def deployment_payload(self) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "name": self.deployment_name,
            "model": self.model,
            "autoscaling": dict(self.autoscaling),
        }
        if self.config:
            payload["config"] = self.config
        if self.enable_lora:
            payload["enableLora"] = True
        return payload


@dataclass(frozen=True)
class V2DeploymentRun:
    endpoint_id: str
    deployment_id: str
    qualified_name: str
    benchmark_result: Any
    stopped_verified: bool


async def run_temporary_v2_deployment(
    spec: V2CreateSpec,
    benchmark: Callable[[str], Awaitable[Any]],
    *,
    budget: BudgetGuard,
    est_usd: float,
    dataset_manifest_hash: str,
    approval_evidence: PaidEventAuthorization | None,
    ledger_path: str | Path | None = None,
    ready_timeout_seconds: float = 900.0,
    stop_timeout_seconds: float = 300.0,
    poll_interval_seconds: float = 15.0,
) -> V2DeploymentRun:
    """Create a temporary v2 deployment, benchmark it, and ALWAYS stop+verify it.

    Order of operations is the safety contract:
    budget precheck -> authorization consume -> endpoint create -> deployment
    create -> ledger lease written -> poll READY -> benchmark -> [finally]
    stop -> observe STOPPED -> delete -> ledger resolve -> budget record.
    """
    budget.precheck(est_usd)
    if not dataset_manifest_hash:
        raise PaidEventNotAuthorizedV2("v2 deployment refused: missing dataset_manifest_hash")
    if approval_evidence is None:
        raise PaidEventNotAuthorizedV2("v2 deployment refused: missing paid authorization")
    request_hash = canonical_paid_action_request_hash(
        provider="together",
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        payload=spec.canonical_payload(),
    )
    # The verifier is ALWAYS environment-built — no injection parameter exists.
    from factorylm_ai.providers.paid_authorization_guard import (
        TrustedPaidAuthorizationVerifier,
    )

    verifier = TrustedPaidAuthorizationVerifier.from_environment()
    verifier.verify_and_consume(
        approval_evidence,
        request_hash=request_hash,
        provider="together",
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        max_approved_cost=budget.cap_usd,
        currency="USD",
        consumer_ref=f"v2-deployment:{request_hash}",
    )
    api_key = _require_network()
    ledger = TogetherV2DeploymentLeaseLedger(ledger_path)

    endpoint = await _v2_request(
        "POST",
        f"/projects/{spec.project_id}/endpoints",
        api_key,
        {"name": spec.endpoint_name, "visibility": "VISIBILITY_PRIVATE"},
    )
    endpoint_id = str(endpoint.get("id") or "")
    if not endpoint_id:
        raise ProviderError("v2 endpoint create returned no id")

    try:
        deployment = await _v2_request(
            "POST",
            f"/projects/{spec.project_id}/endpoints/{endpoint_id}/deployments",
            api_key,
            spec.deployment_payload(),
        )
    except BaseException:
        # partial creation: endpoint exists, deployment does not — release it
        try:
            await _v2_request(
                "DELETE", f"/projects/{spec.project_id}/endpoints/{endpoint_id}", api_key
            )
        except ProviderError as cleanup_exc:
            logger.warning(
                "v2 endpoint %s cleanup after failed deployment create: %s",
                endpoint_id,
                cleanup_exc,
            )
        raise
    deployment_id = str(deployment.get("id") or "")
    if not deployment_id:
        raise ProviderError("v2 deployment create returned no id")

    lease = {
        "project_id": spec.project_id,
        "endpoint_id": endpoint_id,
        "deployment_id": deployment_id,
        "endpoint_name": spec.endpoint_name,
        "model": spec.model,
        "created_at": _utc_now_iso(),
    }
    ledger.record_created(lease=lease, authorization_id=approval_evidence.authorization_id)

    result: Any = None
    original_exc: BaseException | None = None
    stopped_verified = False
    try:
        await wait_for_deployment_state(
            spec.project_id,
            endpoint_id,
            deployment_id,
            api_key,
            want=STATE_READY,
            timeout_seconds=ready_timeout_seconds,
            poll_interval_seconds=poll_interval_seconds,
        )
        result = await benchmark(f"{spec.project_slug}/{spec.endpoint_name}")
    except BaseException as exc:
        original_exc = exc
        raise
    finally:
        try:
            await stop_and_verify_deployment(
                spec.project_id,
                endpoint_id,
                deployment_id,
                api_key,
                stop_timeout_seconds=stop_timeout_seconds,
                poll_interval_seconds=poll_interval_seconds,
            )
            stopped_verified = True
            ledger.record_stopped_verified(deployment_id)
            try:
                await _v2_request(
                    "DELETE", f"/projects/{spec.project_id}/endpoints/{endpoint_id}", api_key
                )
            except ProviderError as exc:
                logger.warning(
                    "v2 endpoint %s delete (deployment already stopped): %s", endpoint_id, exc
                )
        except Exception as cleanup_exc:
            ledger.record_stop_unverified(deployment_id, str(cleanup_exc))
            if original_exc is not None:
                raise V2DeploymentCleanupError(
                    f"v2 deployment {deployment_id!r} teardown UNVERIFIED after original "
                    f"error {original_exc!r}: {cleanup_exc}"
                ) from original_exc
            raise V2DeploymentCleanupError(
                f"v2 deployment {deployment_id!r} teardown UNVERIFIED: {cleanup_exc}"
            ) from cleanup_exc
        finally:
            budget.record(est_usd)
    return V2DeploymentRun(
        endpoint_id=endpoint_id,
        deployment_id=deployment_id,
        qualified_name=f"{spec.project_slug}/{spec.endpoint_name}",
        benchmark_result=result,
        stopped_verified=stopped_verified,
    )


async def cleanup_orphaned_v2_deployments(
    ledger_path: str | Path | None = None,
    *,
    stop_timeout_seconds: float = 300.0,
    poll_interval_seconds: float = 10.0,
) -> list[dict[str, Any]]:
    """Stop+verify every unresolved lease (crash recovery). Idempotent."""
    api_key = _require_network()
    ledger = TogetherV2DeploymentLeaseLedger(ledger_path)
    outcomes: list[dict[str, Any]] = []
    for lease in ledger.unresolved_leases():
        did = str(lease.get("deployment_id") or "")
        try:
            await stop_and_verify_deployment(
                str(lease.get("project_id")),
                str(lease.get("endpoint_id")),
                did,
                api_key,
                stop_timeout_seconds=stop_timeout_seconds,
                poll_interval_seconds=poll_interval_seconds,
            )
            ledger.record_stopped_verified(did)
            outcomes.append({"deployment_id": did, "outcome": "stopped_verified"})
        except Exception as exc:  # noqa: BLE001 — recovery must attempt every lease
            ledger.record_stop_unverified(did, str(exc))
            outcomes.append({"deployment_id": did, "outcome": f"UNRESOLVED: {exc}"})
    return outcomes

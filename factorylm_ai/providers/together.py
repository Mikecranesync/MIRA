"""Together AI serverless provider — the hosted proving ground.

ZTA role: this is where a task graduates from mock fixtures to a real model,
strictly behind two gates: a non-empty ``TOGETHERAI_API_KEY`` AND
``FACTORYLM_AI_ALLOW_NETWORK`` truthy. Neither gate is ever set in tests or
CI, so ``complete()`` always raises :class:`~factorylm_ai.providers.base.NetworkDisabledError`
there, before any ``httpx`` use. Every call that DOES run is budget-checked
by the caller (:mod:`factorylm_ai.budget`) — this module never enforces a
budget itself, it only reports what a call cost via
:func:`factorylm_ai.pricing.estimate_cost`.

Base URL is ``https://api.together.ai/v1`` (the current documented host —
``api.together.xyz/v1`` is a legacy alias that ``mira-bots/shared/inference/router.py``
still uses; this is new code, so it uses the current one; see
``docs/zta/together-liquid-model-strategy.md`` §A). This module is entirely
isolated from the production cascade — nothing here is imported by
``mira-bots/**``, and nothing in ``mira-bots/**`` is imported here.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

from ..budget import BudgetGuard
from ..finetune import (
    ACTION_CREATE_FINETUNE_JOB,
    ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
    FineTuneApprovalEvidence,
    PaidEventAuthorization,
    TogetherPriceEstimate,
)
from ..pricing import estimate_cost, estimate_finetune_cost
from ..provider_registry import PROVIDERS as _REGISTRY
from .base import (
    ModelProvider,
    ModelRequest,
    ModelResponse,
    NetworkDisabledError,
    NotServerlessError,
    ProviderError,
)

logger = logging.getLogger("factorylm-ai")

# Canonical host comes from the shared provider registry (ADR-0031 PR 2) —
# ONE place owns it. The registry also carries the cascade's legacy .xyz host
# separately; see provider_registry.ProviderSpec.
_BASE_URL = _REGISTRY["together"].canonical_url
_CHAT_ENDPOINT = "/chat/completions"
_EMBEDDINGS_ENDPOINT = "/embeddings"
_RERANK_ENDPOINT = "/rerank"
_FILES_ENDPOINT = "/files/upload"
_FINETUNE_ENDPOINT = "/fine-tunes"
_FINETUNE_ESTIMATE_ENDPOINT = "/fine-tunes/estimate-price"
_FINETUNE_DOWNLOAD_ENDPOINT = "/finetune/download"
_ENDPOINTS_ENDPOINT = "/endpoints"

# Defensive fallbacks only — in normal operation the tasks layer always
# resolves `req.model` from TaskSpec.default_models["together"] before
# building the ModelRequest (see factorylm_ai/tasks/__init__.py).
_DEFAULT_CHAT_MODEL = _REGISTRY["together"].text_model_default
_DEFAULT_EMBED_MODEL = "intfloat/multilingual-e5-large-instruct"

_RETRY_CAP_SECONDS = 30.0
_DEFAULT_RETRY_SECONDS = 5.0


class PaidEventNotAuthorized(ProviderError):
    """Raised when a billable Together operation lacks durable authorization evidence."""


class EndpointCleanupError(ProviderError):
    """Raised when endpoint deletion was attempted but not verified."""


def _extract_authorization(
    evidence: FineTuneApprovalEvidence | PaidEventAuthorization | None,
) -> PaidEventAuthorization | None:
    if isinstance(evidence, FineTuneApprovalEvidence):
        return evidence.authorization
    if isinstance(evidence, PaidEventAuthorization):
        return evidence
    return None


def _require_paid_event_authorization(
    evidence: FineTuneApprovalEvidence | PaidEventAuthorization | None,
    *,
    action: str,
    dataset_manifest_hash: str,
    model: str,
    spend_cap_usd: float,
) -> None:
    auth = _extract_authorization(evidence)
    if auth is None:
        raise PaidEventNotAuthorized(
            f"{action} refused: missing durable paid-event authorization evidence. "
            "A metered fine-tune or temporary endpoint requires Mike's explicit approval receipt."
        )
    blockers = auth.blockers_for(
        action=action,
        dataset_manifest_hash=dataset_manifest_hash,
        model=model,
        spend_cap_usd=spend_cap_usd,
    )
    if blockers:
        raise PaidEventNotAuthorized(
            f"{action} refused: invalid paid-event authorization evidence: {', '.join(blockers)}"
        )


def _require_finetune_approval(
    evidence: FineTuneApprovalEvidence | None,
    *,
    dataset_manifest_hash: str,
    model: str,
    spend_cap_usd: float,
    local_estimate_usd: float,
    local_training_tokens: int,
    local_validation_tokens: int,
) -> None:
    if evidence is None:
        raise PaidEventNotAuthorized(
            "together create_finetune_job refused: missing fine-tune approval evidence"
        )
    blockers = evidence.blockers_for(
        action=ACTION_CREATE_FINETUNE_JOB,
        dataset_manifest_hash=dataset_manifest_hash,
        model=model,
        spend_cap_usd=spend_cap_usd,
        local_estimate_usd=local_estimate_usd,
        local_training_tokens=local_training_tokens,
        local_validation_tokens=local_validation_tokens,
    )
    if blockers:
        raise PaidEventNotAuthorized(
            "together create_finetune_job refused: incomplete fine-tune approval evidence: "
            f"{', '.join(blockers)}"
        )


def _network_allowed() -> bool:
    # Canonical gate (ADR-0031 §6.2): FACTORYLM_NETWORK_MODE wins; the legacy
    # FACTORYLM_AI_ALLOW_NETWORK and INFERENCE_BACKEND=cloud both map to
    # enabled; contradictory legacy values raise INVALID_CONFIGURATION.
    from factorylm_ai.network_gate import network_enabled

    return network_enabled()


def _api_key() -> str:
    return os.getenv("TOGETHERAI_API_KEY") or ""


def _timeout_seconds() -> float:
    # `or` form is mandatory (repo law): a compose-mapped
    # ${FACTORYLM_AI_TOGETHER_TIMEOUT:-} delivers an empty string, and a bare
    # float(os.getenv(...)) on "" raises and crash-loops at call time — the
    # exact trap documented on TOGETHERAI_TIMEOUT in router.py.
    return float(os.getenv("FACTORYLM_AI_TOGETHER_TIMEOUT") or "90")


def _require_network() -> str:
    """Return the API key, or raise NetworkDisabledError if the gate is closed.

    Shared by the module-level fine-tune helpers (:func:`upload_file`,
    :func:`create_finetune_job`, :func:`get_finetune_job`) — same gate as
    :meth:`TogetherProvider.complete`: non-empty ``TOGETHERAI_API_KEY`` AND
    ``FACTORYLM_AI_ALLOW_NETWORK`` truthy. Checked BEFORE any httpx use.
    """
    key = _api_key()
    if not (key and _network_allowed()):
        raise NetworkDisabledError(
            "together fine-tune helper refused: requires TOGETHERAI_API_KEY set "
            "AND FACTORYLM_AI_ALLOW_NETWORK truthy (1/true)."
        )
    return key


def _redact_raw(data: Any) -> dict[str, Any]:
    """Defense in depth: strip any Authorization-like key before storing ``raw``.

    Together's response bodies never echo request headers, so this should
    never fire in practice — it exists so "Authorization is stripped from
    any raw/error capture" is literally true, not just true-by-omission.
    """

    def _scrub(value: Any) -> Any:
        if isinstance(value, dict):
            return {k: _scrub(v) for k, v in value.items() if k.lower() != "authorization"}
        if isinstance(value, list):
            return [_scrub(v) for v in value]
        return value

    return _scrub(data) if isinstance(data, dict) else {}


def _extract_json_object(text: str) -> dict[str, Any] | None:
    """Parse ``text`` as a JSON object; on failure, extract the first balanced
    ``{...}`` block and try again. Returns ``None`` if nothing parses.

    Together's structured-output mode is prompt-reinforced constrained
    decoding (there is no ``strict`` flag / grammar guarantee), so a model
    can wrap its JSON in prose or markdown fences — this is the defensive
    fallback the contract requires.
    """
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else None
    except (json.JSONDecodeError, TypeError):
        pass

    start = text.find("{")
    if start == -1:
        return None
    depth = 0
    for i in range(start, len(text)):
        if text[i] == "{":
            depth += 1
        elif text[i] == "}":
            depth -= 1
            if depth == 0:
                candidate = text[start : i + 1]
                try:
                    obj = json.loads(candidate)
                    return obj if isinstance(obj, dict) else None
                except (json.JSONDecodeError, TypeError):
                    return None
    return None


def _inject_schema_reinforcement(
    messages: list[dict[str, Any]], schema: dict[str, Any]
) -> list[dict[str, Any]]:
    """Append a schema-reinforcement instruction to (or add) the system message.

    LAW (contract §A): when ``json_schema`` is requested, the schema is
    ALWAYS sent both ways — as ``response_format`` AND as text in the system
    message. Never mutates the caller's ``messages`` list.
    """
    reinforcement = "Return ONLY a JSON object matching this schema: " + json.dumps(
        schema, separators=(",", ":")
    )
    out = [dict(m) for m in messages]
    for msg in out:
        if msg.get("role") == "system":
            content = msg.get("content")
            if isinstance(content, str):
                msg["content"] = f"{content}\n\n{reinforcement}"
            elif isinstance(content, list):
                msg["content"] = [*content, {"type": "text", "text": reinforcement}]
            else:
                msg["content"] = reinforcement
            return out
    out.insert(0, {"role": "system", "content": reinforcement})
    return out


def _parse_ratelimit_reset(resp: httpx.Response) -> float:
    header = resp.headers.get("x-ratelimit-reset", "")
    try:
        return min(float(header), _RETRY_CAP_SECONDS) if header else _DEFAULT_RETRY_SECONDS
    except ValueError:
        return _DEFAULT_RETRY_SECONDS


def _build_http_error(endpoint: str, resp: httpx.Response) -> ProviderError:
    """Translate an HTTP error response into the right exception type.

    400 + code=="model_not_available" (or a "non-serverless" message) ->
    NotServerlessError. Everything else -> ProviderError. Never includes
    request headers (so Authorization can't leak into the message).
    """
    body_text = resp.text[:500]
    body_json: dict[str, Any] = {}
    try:
        parsed_body = resp.json()
        if isinstance(parsed_body, dict):
            body_json = parsed_body
    except (json.JSONDecodeError, ValueError):
        pass

    error_obj = body_json.get("error")
    error_obj = error_obj if isinstance(error_obj, dict) else {}
    code = str(error_obj.get("code") or "")
    message = str(error_obj.get("message") or body_text)

    if resp.status_code == 400 and (
        code == "model_not_available" or "non-serverless" in message.lower()
    ):
        return NotServerlessError(
            f"together {endpoint}: model not available via serverless — {message[:300]}"
        )
    return ProviderError(f"together {endpoint} HTTP {resp.status_code}: {message[:300]}")


async def _http_post_json(
    endpoint: str, api_key: str, payload: dict[str, Any], timeout: float
) -> tuple[dict[str, Any], int]:
    """POST JSON with a single 429 retry. Returns ``(response_json, elapsed_ms)``.

    Raises :class:`NotServerlessError` on a 400 model_not_available response,
    :class:`ProviderError` on any other failure — including a 429 that is
    still rate-limited after the one retry (no second retry, no recursion).
    """
    url = f"{_BASE_URL}{endpoint}"
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    t0 = time.monotonic()
    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(url, headers=headers, json=payload)
        except httpx.TimeoutException as exc:
            raise ProviderError(
                f"together request to {endpoint} timed out after {timeout}s"
            ) from exc

        if resp.status_code == 429:
            wait = _parse_ratelimit_reset(resp)
            logger.info(
                "together 429 rate_limited endpoint=%s — single retry after %.1fs", endpoint, wait
            )
            await asyncio.sleep(wait)
            try:
                resp = await client.post(url, headers=headers, json=payload)
            except httpx.TimeoutException as exc:
                raise ProviderError(
                    f"together retry to {endpoint} timed out after {timeout}s"
                ) from exc

        if resp.status_code >= 400:
            raise _build_http_error(endpoint, resp)
        data = resp.json()
    elapsed_ms = int((time.monotonic() - t0) * 1000)
    return data, elapsed_ms


async def _http_get_json(
    endpoint: str,
    api_key: str,
    timeout: float,
    *,
    params: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{_BASE_URL}{endpoint}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"}, params=params)
    if resp.status_code >= 400:
        raise _build_http_error(endpoint, resp)
    data = resp.json()
    return data if isinstance(data, dict) else {}


async def _http_get_bytes(
    endpoint: str,
    api_key: str,
    timeout: float,
    *,
    params: dict[str, Any] | None = None,
) -> bytes:
    url = f"{_BASE_URL}{endpoint}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"}, params=params)
    if resp.status_code >= 400:
        raise _build_http_error(endpoint, resp)
    return resp.content


async def _http_delete(endpoint: str, api_key: str, timeout: float) -> None:
    url = f"{_BASE_URL}{endpoint}"
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.delete(url, headers={"Authorization": f"Bearer {api_key}"})
    if resp.status_code >= 400:
        raise _build_http_error(endpoint, resp)


@dataclass(frozen=True)
class TemporaryEndpointRun:
    endpoint_id: str
    endpoint_name: str
    benchmark_result: Any
    deleted: bool


def _utc_now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _default_endpoint_ledger_path() -> Path:
    data_dir = os.getenv("FACTORYLM_AI_DATA_DIR") or "factorylm_ai/data"
    return Path(data_dir) / "together_endpoint_leases.jsonl"


class TogetherEndpointLeaseLedger:
    """Append-only ledger for short-lived Together endpoint leases."""

    def __init__(self, path: str | Path | None = None) -> None:
        self._path = Path(path) if path is not None else _default_endpoint_ledger_path()

    @property
    def path(self) -> Path:
        return self._path

    def record_created(
        self,
        *,
        endpoint_id: str,
        endpoint_name: str,
        create_payload: dict[str, Any],
        authorization_id: str,
    ) -> None:
        self._append(
            {
                "event": "created",
                "endpoint_id": endpoint_id,
                "endpoint_name": endpoint_name,
                "create_payload": dict(create_payload),
                "authorization_id": authorization_id,
                "recorded_at": _utc_now_iso(),
            }
        )

    def record_deleted_verified(self, endpoint_id: str) -> None:
        self._append(
            {
                "event": "deleted_verified",
                "endpoint_id": endpoint_id,
                "recorded_at": _utc_now_iso(),
            }
        )

    def record_delete_unverified(self, endpoint_id: str, reason: str) -> None:
        self._append(
            {
                "event": "delete_unverified",
                "endpoint_id": endpoint_id,
                "reason": reason,
                "recorded_at": _utc_now_iso(),
            }
        )

    def unresolved_endpoint_ids(self, *, older_than_seconds: float = 0.0) -> list[str]:
        latest: dict[str, dict[str, Any]] = {}
        for record in self._read_all():
            endpoint_id = str(record.get("endpoint_id") or "")
            if endpoint_id:
                latest[endpoint_id] = record
        now = datetime.now(UTC)
        unresolved: list[str] = []
        for endpoint_id, record in latest.items():
            if record.get("event") == "deleted_verified":
                continue
            recorded_at = _parse_ledger_time(record.get("recorded_at"))
            if recorded_at is None:
                unresolved.append(endpoint_id)
                continue
            age = (now - recorded_at).total_seconds()
            if age >= older_than_seconds:
                unresolved.append(endpoint_id)
        return sorted(unresolved)

    def _append(self, record: dict[str, Any]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with self._path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, sort_keys=True))
            f.write("\n")

    def _read_all(self) -> list[dict[str, Any]]:
        if not self._path.is_file():
            return []
        rows: list[dict[str, Any]] = []
        with self._path.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    rows.append(json.loads(line))
        return rows


def _parse_ledger_time(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=UTC)
    except ValueError:
        return None


class TogetherProvider(ModelProvider):
    """Together AI serverless — chat, structured JSON, tools, embeddings, rerank.

    Every public method reads its env gate fresh at call time (never cached
    on the instance), so construction never fails and never touches the
    network — only ``complete()`` and the fine-tune helpers do, and only
    when both the key and the network flag are present.
    """

    name = "together"

    def is_configured(self) -> bool:
        return bool(_api_key()) and _network_allowed()

    async def complete(self, req: ModelRequest) -> ModelResponse:
        if not self.is_configured():
            raise NetworkDisabledError(
                "TogetherProvider.complete() refused: requires TOGETHERAI_API_KEY "
                "set AND FACTORYLM_AI_ALLOW_NETWORK truthy (1/true) — this is the "
                "spend-law network gate; neither is ever set in tests or CI."
            )
        if req.input_kind == "embedding":
            return await self._complete_embedding(req)
        if req.input_kind == "rerank":
            return await self._complete_rerank(req)
        return await self._complete_chat(req)

    async def _post_with_retry(
        self, endpoint: str, api_key: str, payload: dict[str, Any]
    ) -> tuple[dict[str, Any], int]:
        return await _http_post_json(endpoint, api_key, payload, _timeout_seconds())

    async def _complete_chat(self, req: ModelRequest) -> ModelResponse:
        api_key = _api_key()
        model = req.model or _DEFAULT_CHAT_MODEL
        messages = req.messages
        payload: dict[str, Any] = {
            "model": model,
            "messages": messages,
            "max_tokens": req.max_tokens,
            "temperature": req.temperature,
        }
        if req.json_schema is not None:
            messages = _inject_schema_reinforcement(messages, req.json_schema)
            payload["messages"] = messages
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": req.task_id, "schema": req.json_schema},
            }
        if req.tools is not None:
            payload["tools"] = req.tools
        if req.adapter:
            # Together serves a fine-tuned LoRA adapter as an addressable
            # model id (see create_finetune_job's result-id shape below) —
            # callers pass the fully resolved
            # "<account>/<base>:<suffix>:<job_id>" via req.model. There is no
            # separate wire-level "adapter" chat param; this is logged only.
            logger.debug("together.complete adapter=%s (served via model id)", req.adapter)

        data, elapsed_ms = await self._post_with_retry(_CHAT_ENDPOINT, api_key, payload)

        choices = data.get("choices") or [{}]
        message = choices[0].get("message") or {}
        text = message.get("content")
        tool_calls = message.get("tool_calls")

        parsed: dict[str, Any] | None = None
        if req.json_schema is not None and text:
            parsed = _extract_json_object(text)

        usage = data.get("usage") or {}
        input_tokens = int(usage.get("prompt_tokens") or 0)
        output_tokens = int(usage.get("completion_tokens") or 0)
        cost = estimate_cost(model, input_tokens, output_tokens)

        logger.info(
            "TOGETHER_CALL task=%s model=%s latency_ms=%d input=%d output=%d cost_usd=%.5f",
            req.task_id,
            model,
            elapsed_ms,
            input_tokens,
            output_tokens,
            cost,
        )

        return ModelResponse(
            text=text,
            parsed=parsed,
            tool_calls=tool_calls,
            embeddings=None,
            rerank_scores=None,
            model=model,
            provider=self.name,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            latency_ms=elapsed_ms,
            estimated_cost_usd=cost,
            raw=_redact_raw(data),
        )

    async def _complete_embedding(self, req: ModelRequest) -> ModelResponse:
        api_key = _api_key()
        model = req.model or _DEFAULT_EMBED_MODEL
        payload: dict[str, Any] = {"model": model, "input": req.embed_inputs or []}
        data, elapsed_ms = await self._post_with_retry(_EMBEDDINGS_ENDPOINT, api_key, payload)

        rows = sorted(data.get("data") or [], key=lambda r: r.get("index", 0))
        embeddings = [row.get("embedding") or [] for row in rows]
        usage = data.get("usage") or {}
        input_tokens = int(usage.get("prompt_tokens") or usage.get("total_tokens") or 0)
        cost = estimate_cost(model, input_tokens, 0)

        return ModelResponse(
            text=None,
            parsed=None,
            tool_calls=None,
            embeddings=embeddings,
            rerank_scores=None,
            model=model,
            provider=self.name,
            input_tokens=input_tokens,
            output_tokens=0,
            latency_ms=elapsed_ms,
            estimated_cost_usd=cost,
            raw=_redact_raw(data),
        )

    async def _complete_rerank(self, req: ModelRequest) -> ModelResponse:
        # Zero serverless rerank models exist on this account (dedicated
        # $5.49/hr endpoint only) — this method is implemented per the
        # recon-addendum endpoint contract and exercised only via the mock
        # provider in tests; a real call is expected to fail with
        # NotServerlessError until a dedicated endpoint is stood up.
        api_key = _api_key()
        model = req.model or ""
        if not model:
            raise ProviderError(
                "together rerank requires an explicit model id — there is no "
                "default serverless rerank model on this account"
            )
        payload: dict[str, Any] = {
            "model": model,
            "query": req.rerank_query or "",
            "documents": req.rerank_documents or [],
        }
        data, elapsed_ms = await self._post_with_retry(_RERANK_ENDPOINT, api_key, payload)

        choices = sorted(data.get("choices") or [], key=lambda c: c.get("index", 0))
        scores = [float(c.get("relevance_score") or 0.0) for c in choices]
        # Rerank responses carry no usage block — approximate input tokens at
        # chars/4 so a wrapping BudgetGuard registers nonzero spend if a
        # dedicated rerank endpoint is ever wired up.
        approx_input_tokens = (
            len(req.rerank_query or "") + sum(len(d) for d in (req.rerank_documents or []))
        ) // 4
        cost = estimate_cost(model, approx_input_tokens, 0)

        return ModelResponse(
            text=None,
            parsed=None,
            tool_calls=None,
            embeddings=None,
            rerank_scores=scores,
            model=model,
            provider=self.name,
            input_tokens=approx_input_tokens,
            output_tokens=0,
            latency_ms=elapsed_ms,
            estimated_cost_usd=cost,
            raw=_redact_raw(data),
        )


# ---------------------------------------------------------------------------
# Fine-tuning helpers (module-level; used by flywheel docs/ops, not by the
# proofpack runtime). Same network gate as TogetherProvider.complete().
# ---------------------------------------------------------------------------


async def upload_file(path: str) -> str:
    """Upload a training JSONL file to Together; return the file id.

    Multipart ``POST /files/upload`` with ``purpose="fine-tune"``. Behind the
    network gate — raises :class:`NetworkDisabledError` before any httpx use
    if not configured.
    """
    api_key = _require_network()
    file_path = Path(path)
    file_bytes = file_path.read_bytes()
    files = {"file": (file_path.name, file_bytes, "application/jsonl")}
    data = {"purpose": "fine-tune", "file_name": file_path.name}

    async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
        resp = await client.post(
            f"{_BASE_URL}{_FILES_ENDPOINT}",
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files=files,
        )
    if resp.status_code >= 400:
        raise _build_http_error(_FILES_ENDPOINT, resp)
    body = resp.json()
    file_id = body.get("id") or body.get("file_id")
    if not file_id:
        raise ProviderError(f"together {_FILES_ENDPOINT}: response had no file id")
    return str(file_id)


async def create_finetune_job(
    training_file_id: str,
    model: str,
    *,
    suffix: str,
    budget: BudgetGuard,
    est_training_tokens: int,
    dataset_manifest_hash: str | None = None,
    approval_evidence: FineTuneApprovalEvidence | None = None,
    validation_file: str | None = None,
    est_validation_tokens: int = 0,
    n_epochs: int = 3,
    n_evals: int = 0,
    n_checkpoints: int | None = None,
    seed: int | None = None,
    train_on_inputs: bool | str | None = None,
    packing: bool | None = None,
    learning_rate: float | None = None,
    lora_r: int | None = None,
    lora_alpha: int | None = None,
    lora_dropout: float | None = None,
    lora_trainable_modules: str | None = None,
    lora: bool = True,
    training_method: str = "sft",
) -> dict[str, Any]:
    """Create a Together fine-tune job. ``POST /fine-tunes`` off the v1 base.

    Job states: pending -> queued -> running -> uploading -> completed
    (terminal: completed / error / cancelled). Result model id on completion:
    ``"<account>/<base_model>:<suffix>:<job_id>"``.

    Spend law (ZTA Hard Rule 1): this is the single most expensive action in
    the package. It REQUIRES a :class:`BudgetGuard`, caller-supplied local
    token counts, the dataset manifest hash, and a full
    :class:`FineTuneApprovalEvidence` package. The budget precheck runs BEFORE
    the network gate: a job over budget is refused even before the env gate is
    consulted. Together bills post-hoc, so the recorded amount is the max of
    the fixed-policy local estimate and Together's authoritative estimate.

    ``training_method`` selects the fine-tune objective: ``"sft"`` (default) or
    ``"dpo"``. For a DPO job, pass ``training_method="dpo"`` and give it a
    preference training file produced by
    :func:`factorylm_ai.flywheel.export.export_together_dpo_jsonl`. The cost path
    is otherwise identical, using the fixed reviewed DPO rate in
    :mod:`factorylm_ai.pricing`.

    ``n_epochs=3`` (not Together's own platform default of 1) matches the
    fine-tuning economics worked example in
    ``docs/zta/together-liquid-model-strategy.md`` (500 records x 1k tokens x
    3 epochs ~= 1.5M tokens ~= $0.72, billed at the $4.00 minimum) — a
    deliberate, documented choice for this helper, not a copy of the
    platform default.
    """
    if training_method not in ("sft", "dpo"):
        raise ValueError(
            f"create_finetune_job: training_method must be 'sft' or 'dpo', got {training_method!r}"
        )
    est_usd = estimate_finetune_cost(
        training_tokens=est_training_tokens,
        validation_tokens=est_validation_tokens,
        epochs=n_epochs,
        n_evals=n_evals,
        method=training_method,
    )
    together_est_usd = (
        approval_evidence.together_estimate.estimated_total_price
        if approval_evidence is not None and approval_evidence.together_estimate is not None
        else est_usd
    )
    recorded_est_usd = max(est_usd, together_est_usd)
    budget.precheck(recorded_est_usd)
    api_key = _require_network()
    if not dataset_manifest_hash:
        raise PaidEventNotAuthorized(
            "together create_finetune_job refused: missing dataset_manifest_hash"
        )
    _require_finetune_approval(
        approval_evidence,
        dataset_manifest_hash=dataset_manifest_hash,
        model=model,
        spend_cap_usd=budget.cap_usd,
        local_estimate_usd=est_usd,
        local_training_tokens=est_training_tokens,
        local_validation_tokens=est_validation_tokens,
    )
    method_payload: dict[str, Any] = {"method": training_method}
    if train_on_inputs is not None:
        method_payload["train_on_inputs"] = train_on_inputs
    type_payload: dict[str, Any] = {"type": "Lora" if lora else "Full"}
    if lora:
        if lora_r is not None:
            type_payload["lora_r"] = lora_r
        if lora_alpha is not None:
            type_payload["lora_alpha"] = lora_alpha
        if lora_dropout is not None:
            type_payload["lora_dropout"] = lora_dropout
        if lora_trainable_modules is not None:
            type_payload["lora_trainable_modules"] = lora_trainable_modules

    payload: dict[str, Any] = {
        "training_file": training_file_id,
        "model": model,
        "n_epochs": n_epochs,
        "n_evals": n_evals,
        "suffix": suffix,
        "training_method": method_payload,
        "training_type": type_payload,
    }
    if validation_file is not None:
        payload["validation_file"] = validation_file
    if n_checkpoints is not None:
        payload["n_checkpoints"] = n_checkpoints
    if packing is not None:
        payload["packing"] = packing
    if learning_rate is not None:
        payload["learning_rate"] = learning_rate
    if seed is not None:
        payload["random_seed"] = seed
    data, _elapsed_ms = await _http_post_json(
        _FINETUNE_ENDPOINT, api_key, payload, _timeout_seconds()
    )
    budget.record(recorded_est_usd)
    return data


async def estimate_finetune_price(
    training_file_id: str,
    model: str,
    *,
    receipt_ref: str,
    validation_file: str | None = None,
    n_epochs: int = 3,
    n_evals: int = 0,
    train_on_inputs: bool | str | None = None,
    lora: bool = True,
    training_method: str = "sft",
) -> TogetherPriceEstimate:
    """Call Together's authoritative ``POST /fine-tunes/estimate-price`` endpoint.

    This is network-gated and does not launch a job. Callers must persist the
    response and pass its durable ``receipt_ref`` into
    :class:`FineTuneApprovalEvidence` before :func:`create_finetune_job`.
    """
    if training_method not in ("sft", "dpo"):
        raise ValueError(
            f"estimate_finetune_price: training_method must be 'sft' or 'dpo', got {training_method!r}"
        )
    api_key = _require_network()
    method_payload: dict[str, Any] = {"method": training_method}
    if train_on_inputs is not None:
        method_payload["train_on_inputs"] = train_on_inputs
    payload: dict[str, Any] = {
        "training_file": training_file_id,
        "model": model,
        "n_epochs": n_epochs,
        "n_evals": n_evals,
        "training_method": method_payload,
        "training_type": {"type": "Lora" if lora else "Full"},
    }
    if validation_file is not None:
        payload["validation_file"] = validation_file
    data, _elapsed_ms = await _http_post_json(
        _FINETUNE_ESTIMATE_ENDPOINT, api_key, payload, _timeout_seconds()
    )
    return TogetherPriceEstimate.from_response(data, receipt_ref=receipt_ref)


async def get_finetune_job(job_id: str) -> dict[str, Any]:
    """Poll a fine-tune job's status. ``GET /fine-tunes/{job_id}``."""
    api_key = _require_network()
    return await _http_get_json(f"{_FINETUNE_ENDPOINT}/{job_id}", api_key, _timeout_seconds())


async def get_finetune_events(job_id: str) -> dict[str, Any]:
    """List a fine-tune job's events. ``GET /fine-tunes/{job_id}/events``."""
    api_key = _require_network()
    return await _http_get_json(
        f"{_FINETUNE_ENDPOINT}/{job_id}/events", api_key, _timeout_seconds()
    )


async def list_finetune_checkpoints(job_id: str) -> dict[str, Any]:
    """List a fine-tune job's checkpoints. ``GET /fine-tunes/{job_id}/checkpoints``."""
    api_key = _require_network()
    return await _http_get_json(
        f"{_FINETUNE_ENDPOINT}/{job_id}/checkpoints", api_key, _timeout_seconds()
    )


async def download_finetune_checkpoint(
    job_id: str,
    out_path: str | Path,
    *,
    checkpoint: str = "adapter",
    checkpoint_step: int | None = None,
) -> Path:
    """Download a completed fine-tune checkpoint to ``out_path``.

    Uses Together's ``GET /finetune/download`` endpoint. ``checkpoint`` is
    ignored by the API when ``checkpoint_step`` is supplied.
    """
    api_key = _require_network()
    params: dict[str, Any] = {"ft_id": job_id}
    if checkpoint_step is not None:
        params["checkpoint_step"] = checkpoint_step
    else:
        params["checkpoint"] = checkpoint
    content = await _http_get_bytes(
        _FINETUNE_DOWNLOAD_ENDPOINT, api_key, _timeout_seconds(), params=params
    )
    p = Path(out_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(content)
    return p


async def _create_dedicated_endpoint(payload: dict[str, Any]) -> dict[str, Any]:
    """Create a dedicated endpoint. Behind the canonical network gate."""
    api_key = _require_network()
    data, _elapsed_ms = await _http_post_json(
        _ENDPOINTS_ENDPOINT, api_key, dict(payload), _timeout_seconds()
    )
    return data


async def _get_dedicated_endpoint(endpoint_id: str) -> dict[str, Any]:
    """Retrieve a dedicated endpoint by id."""
    api_key = _require_network()
    return await _http_get_json(f"{_ENDPOINTS_ENDPOINT}/{endpoint_id}", api_key, _timeout_seconds())


async def _delete_dedicated_endpoint(endpoint_id: str) -> None:
    """Delete a dedicated endpoint to stop billing."""
    api_key = _require_network()
    await _http_delete(f"{_ENDPOINTS_ENDPOINT}/{endpoint_id}", api_key, _timeout_seconds())


def _endpoint_id(endpoint: dict[str, Any]) -> str:
    endpoint_id = endpoint.get("id") or endpoint.get("endpoint_id")
    if not endpoint_id:
        raise ProviderError("together endpoint response had no id")
    return str(endpoint_id)


def _endpoint_name(endpoint: dict[str, Any]) -> str:
    return str(endpoint.get("name") or endpoint.get("model") or endpoint.get("endpoint") or "")


def _endpoint_ready(endpoint: dict[str, Any]) -> bool:
    status = endpoint.get("status")
    if isinstance(status, dict):
        ready_replicas = status.get("readyReplicas") or status.get("ready_replicas") or 0
        if isinstance(ready_replicas, int) and ready_replicas > 0:
            return True
        status_text = str(
            status.get("state") or status.get("status") or status.get("message") or ""
        )
    else:
        status_text = str(status or endpoint.get("state") or "")
    status_text = status_text.lower()
    return any(token in status_text for token in ("ready", "running", "started"))


def _require_inactive_timeout(create_payload: dict[str, Any]) -> None:
    timeout = create_payload.get("inactive_timeout")
    if not isinstance(timeout, int | float) or timeout <= 0:
        raise ValueError("temporary Together endpoints require inactive_timeout > 0")


async def _verify_dedicated_endpoint_deleted(endpoint_id: str) -> None:
    try:
        endpoint = await _get_dedicated_endpoint(endpoint_id)
    except ProviderError as exc:
        if "HTTP 404" in str(exc):
            return
        raise
    state = str(endpoint.get("state") or endpoint.get("status") or "").lower()
    if any(token in state for token in ("deleted", "not_found", "not found")):
        return
    raise EndpointCleanupError(
        f"Together endpoint {endpoint_id!r} deletion not verified; latest state={state!r}"
    )


async def _delete_and_verify_endpoint(
    endpoint_id: str,
    *,
    ledger: TogetherEndpointLeaseLedger,
) -> None:
    try:
        await _delete_dedicated_endpoint(endpoint_id)
        await _verify_dedicated_endpoint_deleted(endpoint_id)
    except Exception as exc:
        ledger.record_delete_unverified(endpoint_id, str(exc))
        if isinstance(exc, EndpointCleanupError):
            raise
        raise EndpointCleanupError(
            f"Together endpoint {endpoint_id!r} deletion not verified: {exc}"
        ) from exc
    ledger.record_deleted_verified(endpoint_id)


async def wait_for_dedicated_endpoint_ready(
    endpoint_id: str,
    *,
    poll_interval_seconds: float = 60.0,
    timeout_seconds: float = 600.0,
) -> dict[str, Any]:
    """Poll a dedicated endpoint until it is ready or the timeout expires."""
    deadline = time.monotonic() + timeout_seconds
    while True:
        endpoint = await _get_dedicated_endpoint(endpoint_id)
        if _endpoint_ready(endpoint):
            return endpoint
        if time.monotonic() >= deadline:
            raise TimeoutError(f"Together endpoint {endpoint_id!r} was not ready in time")
        await asyncio.sleep(poll_interval_seconds)


async def run_temporary_endpoint_benchmark(
    create_payload: dict[str, Any],
    benchmark: Callable[[str], Awaitable[Any]],
    *,
    budget: BudgetGuard,
    est_endpoint_usd: float,
    dataset_manifest_hash: str | None = None,
    approval_evidence: FineTuneApprovalEvidence | PaidEventAuthorization | None = None,
    endpoint_ledger_path: str | Path | None = None,
    poll_interval_seconds: float = 60.0,
    timeout_seconds: float = 600.0,
) -> TemporaryEndpointRun:
    """Create a temporary endpoint, benchmark it, and always delete it.

    ``est_endpoint_usd`` is prechecked before any network call. The endpoint id
    is persisted immediately after creation, then deleted in ``finally`` even
    when the benchmark raises. ``deleted=True`` is returned only after deletion
    verification.
    """
    _require_inactive_timeout(create_payload)
    budget.precheck(est_endpoint_usd)
    _require_network()
    if not dataset_manifest_hash:
        raise PaidEventNotAuthorized(
            "together temporary endpoint benchmark refused: missing dataset_manifest_hash"
        )
    model = str(create_payload.get("model") or "")
    _require_paid_event_authorization(
        approval_evidence,
        action=ACTION_TEMPORARY_ENDPOINT_BENCHMARK,
        dataset_manifest_hash=dataset_manifest_hash,
        model=model,
        spend_cap_usd=budget.cap_usd,
    )
    auth = _extract_authorization(approval_evidence)
    ledger = TogetherEndpointLeaseLedger(endpoint_ledger_path)
    endpoint = await _create_dedicated_endpoint(create_payload)
    endpoint_id = _endpoint_id(endpoint)
    endpoint_name = _endpoint_name(endpoint)
    ledger.record_created(
        endpoint_id=endpoint_id,
        endpoint_name=endpoint_name,
        create_payload=create_payload,
        authorization_id=auth.authorization_id if auth is not None else "",
    )
    result: Any = None
    try:
        ready = await wait_for_dedicated_endpoint_ready(
            endpoint_id,
            poll_interval_seconds=poll_interval_seconds,
            timeout_seconds=timeout_seconds,
        )
        endpoint_name = _endpoint_name(ready) or endpoint_name
        result = await benchmark(endpoint_name)
    finally:
        try:
            await _delete_and_verify_endpoint(endpoint_id, ledger=ledger)
        finally:
            budget.record(est_endpoint_usd)
    return TemporaryEndpointRun(
        endpoint_id=endpoint_id,
        endpoint_name=endpoint_name,
        benchmark_result=result,
        deleted=True,
    )


async def cleanup_orphaned_together_endpoints(
    *,
    ledger_path: str | Path | None = None,
    older_than_seconds: float = 300.0,
) -> list[str]:
    """Delete any endpoint lease recorded without a verified deletion event.

    Idempotent: a second call sees the terminal ``deleted_verified`` ledger row
    and performs no duplicate delete.
    """
    _require_network()
    ledger = TogetherEndpointLeaseLedger(ledger_path)
    cleaned: list[str] = []
    for endpoint_id in ledger.unresolved_endpoint_ids(older_than_seconds=older_than_seconds):
        await _delete_and_verify_endpoint(endpoint_id, ledger=ledger)
        cleaned.append(endpoint_id)
    return cleaned


def download_finetune_note(job_id: str) -> str:
    """Doc-stub: how to retrieve a completed fine-tune's weights (no HTTP call).

    Together has NO serverless serving for fine-tuned LoRA adapters (verified
    across 5 doc pages, 2026-07-19) — the durable path is: download the
    checkpoint (``.tar.zst``, checkpoint type ``merged`` or ``adapter``;
    adapter weights ARE exportable for local serving), then serve it locally
    via vLLM / llama.cpp / Ollama. This function performs no network call —
    it exists so the procedure is discoverable from code, not only from
    docs. See ``docs/zta/together-liquid-model-strategy.md`` for the full
    fine-tuning economics writeup.
    """
    return (
        f"Fine-tune job {job_id}: once state is 'completed', download its "
        "checkpoint via the Together CLI/dashboard as a .tar.zst archive "
        "(checkpoint_type='merged' for a standalone model, 'adapter' for "
        "LoRA-only weights). There is no serverless serving for fine-tuned "
        "adapters — serve the downloaded weights locally (vLLM / llama.cpp / "
        "Ollama) or via a short-lived scale-to-zero dedicated endpoint for "
        "benchmark bursts only. See docs/zta/together-liquid-model-strategy.md."
    )

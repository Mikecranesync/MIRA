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
from pathlib import Path
from typing import Any

import httpx

from ..budget import BudgetGuard
from ..pricing import FT_LORA_SFT_USD_PER_MTOK_LE16B, FT_MIN_JOB_USD, estimate_cost
from .base import (
    ModelProvider,
    ModelRequest,
    ModelResponse,
    NetworkDisabledError,
    NotServerlessError,
    ProviderError,
)

logger = logging.getLogger("factorylm-ai")

_BASE_URL = "https://api.together.ai/v1"
_CHAT_ENDPOINT = "/chat/completions"
_EMBEDDINGS_ENDPOINT = "/embeddings"
_RERANK_ENDPOINT = "/rerank"
_FILES_ENDPOINT = "/files/upload"
_FINETUNE_ENDPOINT = "/fine-tunes"

# Defensive fallbacks only — in normal operation the tasks layer always
# resolves `req.model` from TaskSpec.default_models["together"] before
# building the ModelRequest (see factorylm_ai/tasks/__init__.py).
_DEFAULT_CHAT_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo"
_DEFAULT_EMBED_MODEL = "intfloat/multilingual-e5-large-instruct"

_RETRY_CAP_SECONDS = 30.0
_DEFAULT_RETRY_SECONDS = 5.0


def _network_allowed() -> bool:
    return (os.getenv("FACTORYLM_AI_ALLOW_NETWORK") or "").lower() in {"1", "true"}


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
    n_epochs: int = 3,
    lora: bool = True,
    usd_per_mtok: float = FT_LORA_SFT_USD_PER_MTOK_LE16B,
) -> dict[str, Any]:
    """Create a Together fine-tune job. ``POST /fine-tunes`` off the v1 base.

    Job states: pending -> queued -> running -> uploading -> completed
    (terminal: completed / error / cancelled). Result model id on completion:
    ``"<account>/<base_model>:<suffix>:<job_id>"``.

    Spend law (ZTA Hard Rule 1): this is the single most expensive action in
    the package — training bills ``n_epochs x dataset tokens`` at
    ``usd_per_mtok`` with a hard $4.00 job minimum, so the call REQUIRES a
    :class:`BudgetGuard` and a caller-supplied ``est_training_tokens`` (the
    total token count of the training JSONL, one epoch). The budget precheck
    runs BEFORE the network gate: a job over budget is refused even before
    the env gate is consulted. Together bills post-hoc, so the recorded
    amount is the estimate — reconcile against the dashboard.
    ``usd_per_mtok`` defaults to the <=16B LoRA SFT rate; pass the correct
    per-model rate for larger/specialty bases (see pricing tables in
    ``docs/zta/together-liquid-model-strategy.md``).

    ``n_epochs=3`` (not Together's own platform default of 1) matches the
    fine-tuning economics worked example in
    ``docs/zta/together-liquid-model-strategy.md`` (500 records x 1k tokens x
    3 epochs ~= 1.5M tokens ~= $0.72, billed at the $4.00 minimum) — a
    deliberate, documented choice for this helper, not a copy of the
    platform default.
    """
    est_usd = max(
        FT_MIN_JOB_USD,
        (est_training_tokens * n_epochs / 1_000_000) * usd_per_mtok,
    )
    budget.precheck(est_usd)
    api_key = _require_network()
    payload: dict[str, Any] = {
        "training_file": training_file_id,
        "model": model,
        "n_epochs": n_epochs,
        "lora": lora,
        "suffix": suffix,
        "n_evals": 0,
    }
    data, _elapsed_ms = await _http_post_json(
        _FINETUNE_ENDPOINT, api_key, payload, _timeout_seconds()
    )
    budget.record(est_usd)
    return data


async def get_finetune_job(job_id: str) -> dict[str, Any]:
    """Poll a fine-tune job's status. ``GET /fine-tunes/{job_id}``."""
    api_key = _require_network()
    url = f"{_BASE_URL}{_FINETUNE_ENDPOINT}/{job_id}"
    async with httpx.AsyncClient(timeout=_timeout_seconds()) as client:
        resp = await client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    if resp.status_code >= 400:
        raise _build_http_error(_FINETUNE_ENDPOINT, resp)
    return resp.json()


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

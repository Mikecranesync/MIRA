"""Provider contract for the ZTA model lab.

ZTA role: this is the seam every provider (mock, together, local_liquid) and
every downstream consumer (tasks/, proofpack/, flywheel/) codes against. It is
a plain-dataclass contract deliberately kept boring and provider-agnostic —
OpenAI-compat message shape in, a normalized response shape out, no provider
SDK types leak past this module. Pinned by the build contract; other builders
import ``ModelRequest``/``ModelResponse``/``ModelProvider`` by these exact
names and field shapes — do not rename or reshape without updating every
caller.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class ModelRequest:
    """One provider-agnostic model call, chat or embedding or rerank."""

    task_id: str  # "M01".."M13"
    messages: list[dict[str, Any]]  # OpenAI-compat messages (text and/or image_url parts)
    model: str | None = None  # override; None -> task default for the provider
    adapter: str | None = None  # LoRA/adapter id when serving fine-tuned
    max_tokens: int = 1024
    temperature: float = 0.0
    json_schema: dict[str, Any] | None = None  # response_format json_schema when supported
    tools: list[dict[str, Any]] | None = None  # function-calling tools when supported
    input_kind: str = "chat"  # "chat" | "embedding" | "rerank"
    embed_inputs: list[str] | None = None  # for input_kind="embedding"
    rerank_query: str | None = None  # for input_kind="rerank"
    rerank_documents: list[str] | None = None


@dataclass
class ModelResponse:
    """Normalized result of a provider call — the only shape callers see."""

    text: str | None  # assistant text (chat)
    parsed: dict[str, Any] | None  # parsed JSON if json_schema requested and parseable
    tool_calls: list[dict[str, Any]] | None
    embeddings: list[list[float]] | None
    rerank_scores: list[float] | None
    model: str  # the model that actually answered
    provider: str  # "mock" | "together" | "local_liquid"
    input_tokens: int
    output_tokens: int
    latency_ms: int
    estimated_cost_usd: float
    raw: dict[str, Any] = field(default_factory=dict)


class ProviderError(Exception):
    """Base class for provider-layer failures."""


class NetworkDisabledError(ProviderError):
    """Raised when a live call is attempted but the network gate is closed.

    The gate is BOTH a non-empty API key AND
    ``FACTORYLM_AI_ALLOW_NETWORK`` truthy — see ``.claude/rules`` spend law.
    Tests never set the gate, so this is the expected exception in CI if a
    test accidentally exercises a real provider's ``complete()``.
    """


class NotServerlessError(ProviderError):
    """Together: the requested model exists but has no serverless endpoint."""


class ModelProvider:
    """Base class (not Protocol — kept simple and pyright-friendly).

    Subclasses: ``mock.MockProvider`` (CI default, deterministic, free),
    ``together.TogetherProvider`` (hosted proving ground, network-gated,
    budget-capped), ``local_liquid.LocalLiquidProvider`` (future edge runtime
    placeholder). ``get_provider()`` in ``providers/__init__.py`` is the only
    sanctioned way callers obtain an instance.
    """

    name: str = "base"

    async def complete(self, req: ModelRequest) -> ModelResponse:
        raise NotImplementedError

    def is_configured(self) -> bool:
        return False

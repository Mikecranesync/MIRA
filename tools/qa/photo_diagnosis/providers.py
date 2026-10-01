"""Photo Diagnosis Benchmark — the one pinned LLM provider interface.

Standard library only (``urllib``), matching ``tools/qa/retrieval_acceptance.py``.
Zero-token rule: a price table is explicit and an unpriced model refuses to
run rather than spend invisibly (`.claude/rules/zero-token-architecture.md`).
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from typing import Protocol
from urllib import request as urlreq


class Provider(Protocol):
    name: str
    model: str

    def complete(
        self, messages: list[dict], images: list[str] | None = None, max_tokens: int = 500
    ) -> tuple[str, dict]: ...

    def est_cost(self, in_tokens: int, out_tokens: int) -> float: ...


class UnknownModelError(Exception):
    """An unpriced model was requested. Cost-invisible spend is banned —
    add the rate to `_PRICE_TABLE_PER_MTOK` before running it for real."""


# Illustrative rates ($ / million tokens) — verify against the live OpenAI
# price list before any real spend. The zero-token rule only requires these
# be EXPLICIT (never cost-invisible), not that they track a moving public
# price list; `providers.py`'s own tests never make a network call.
_PRICE_TABLE_PER_MTOK: dict[str, dict[str, float]] = {
    "gpt-4o": {"in": 2.50, "out": 10.00},
    "gpt-4o-mini": {"in": 0.15, "out": 0.60},
    "gpt-4.1": {"in": 2.00, "out": 8.00},
    "gpt-4.1-mini": {"in": 0.40, "out": 1.60},
}


class OpenAIProvider:
    """The one pinned judge/baseline provider. One attempt, no retries, no
    fallback — `ledger.call` (in `budget.py`) owns any retry policy."""

    def __init__(
        self,
        model: str,
        api_key: str | None = None,
        base_url: str = "https://api.openai.com/v1",
        timeout: int = 90,
    ):
        if model not in _PRICE_TABLE_PER_MTOK:
            raise UnknownModelError(
                f"no price entry for model {model!r} — add one to _PRICE_TABLE_PER_MTOK "
                "before running it (cost-invisible spend is banned)"
            )
        self.model = model
        self.name = "openai"
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is required for OpenAIProvider")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout

    def complete(
        self, messages: list[dict], images: list[str] | None = None, max_tokens: int = 500
    ) -> tuple[str, dict]:
        payload_messages = [dict(m) for m in messages]
        if images and payload_messages:
            last = dict(payload_messages[-1])
            parts: list[dict] = [{"type": "text", "text": last.get("content", "")}]
            for img_b64 in images:
                parts.append(
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}}
                )
            last["content"] = parts
            payload_messages[-1] = last
        body = json.dumps(
            {"model": self.model, "messages": payload_messages, "max_tokens": max_tokens}
        ).encode()
        req = urlreq.Request(
            f"{self.base_url}/chat/completions",
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.api_key}",
            },
        )
        with urlreq.urlopen(req, timeout=self.timeout) as r:  # noqa: S310 — fixed https scheme
            data = json.loads(r.read())
        text = data["choices"][0]["message"]["content"]
        usage = data.get("usage") or {}
        return text, {"in": usage.get("prompt_tokens", 0), "out": usage.get("completion_tokens", 0)}

    def est_cost(self, in_tokens: int, out_tokens: int) -> float:
        rates = _PRICE_TABLE_PER_MTOK[self.model]
        return in_tokens / 1_000_000 * rates["in"] + out_tokens / 1_000_000 * rates["out"]


@dataclass
class FakeProvider:
    """Hermetic test double. Records every prompt it was sent (the decoy-
    prompt lesson: tests assert on `received_messages`, never on a prompt
    builder's return value) and plays back scripted responses in order."""

    name: str = "fake"
    model: str = "fake-judge"
    responses: list[str] = field(default_factory=list)
    price_in_per_mtok: float = 1.0
    price_out_per_mtok: float = 1.0
    raise_on_call: Exception | None = None

    def __post_init__(self) -> None:
        self.calls = 0
        self.received_messages: list[list[dict]] = []
        self.received_images: list[list[str] | None] = []
        self._queue = list(self.responses)

    def complete(
        self, messages: list[dict], images: list[str] | None = None, max_tokens: int = 500
    ) -> tuple[str, dict]:
        self.calls += 1
        self.received_messages.append(messages)
        self.received_images.append(images)
        if self.raise_on_call is not None:
            raise self.raise_on_call
        text = self._queue.pop(0) if self._queue else '{"H": false}'
        in_tokens = sum(len(m.get("content", "")) for m in messages) // 4
        out_tokens = min(max_tokens, max(1, len(text) // 4))
        return text, {"in": in_tokens, "out": out_tokens}

    def est_cost(self, in_tokens: int, out_tokens: int) -> float:
        return (
            in_tokens / 1_000_000 * self.price_in_per_mtok
            + out_tokens / 1_000_000 * self.price_out_per_mtok
        )


__all__ = [
    "Provider",
    "UnknownModelError",
    "OpenAIProvider",
    "FakeProvider",
]

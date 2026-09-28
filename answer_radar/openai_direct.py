"""Direct, budget-capped calls to api.openai.com for evaluation lanes only.

Used by the exam contestant (`tests/mira_eval.py --openai`) and the independent
Answer Radar grader (`answer_radar.model_grader`). Never a product/chat provider:
the diagnostic cascade stays Groq → Cerebras → Together.

Spend law (`.claude/rules/zero-token-architecture.md`): every call is priced from
the returned usage, a model with no price refuses to run (spend is never hidden),
and the caller's budget is a hard stop checked before each call.
"""

from __future__ import annotations

import os

import httpx

API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-5.5"
PROVIDER = "openai"

#: $ per million tokens (input, output). Reasoning tokens bill as output.
#: Source: burn study 2026-07-17 (docs/research/2026-07-17-printsense-inference-burn-study.md).
PRICE_PER_MTOK: dict[str, tuple[float, float]] = {"gpt-5.5": (5.0, 30.0)}


class BudgetExceeded(RuntimeError):
    """The budget was already spent before this call."""


class OpenAIDirect:
    """One priced client. `spent_usd` is cumulative across calls."""

    def __init__(self, model: str, budget_usd: float, api_key: str | None = None) -> None:
        if model not in PRICE_PER_MTOK:
            raise ValueError(f"no price for {model}; add it to PRICE_PER_MTOK first")
        if budget_usd <= 0:
            raise ValueError("a paid lane needs a positive budget_usd")
        self.api_key = api_key if api_key is not None else os.environ.get("OPENAI_API_KEY", "")
        if not self.api_key:
            raise ValueError("OPENAI_API_KEY not set")
        self.model = model
        self.budget_usd = budget_usd
        self.tokens_in = 0
        self.tokens_out = 0

    @property
    def spent_usd(self) -> float:
        price_in, price_out = PRICE_PER_MTOK[self.model]
        return self.tokens_in / 1e6 * price_in + self.tokens_out / 1e6 * price_out

    def complete(
        self,
        client: httpx.Client,
        system: str,
        user: str,
        *,
        max_completion_tokens: int = 4000,
        reasoning_effort: str = "low",
        json_object: bool = False,
        timeout: float = 120.0,
    ) -> str:
        """One chat completion. gpt-5.x: max_completion_tokens, no temperature."""
        if self.spent_usd >= self.budget_usd:
            raise BudgetExceeded(f"${self.spent_usd:.4f} spent of ${self.budget_usd:.2f}")
        payload: dict = {
            "model": self.model,
            "max_completion_tokens": max_completion_tokens,
            "reasoning_effort": reasoning_effort,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        }
        if json_object:
            payload["response_format"] = {"type": "json_object"}
        resp = client.post(
            API_URL,
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
            json=payload,
            timeout=timeout,
        )
        resp.raise_for_status()
        body = resp.json()
        usage = body.get("usage") or {}
        self.tokens_in += int(usage.get("prompt_tokens", 0))
        self.tokens_out += int(usage.get("completion_tokens", 0))
        return body["choices"][0]["message"]["content"] or ""

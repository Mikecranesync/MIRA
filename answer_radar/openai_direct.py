"""Direct, budget-capped calls to api.openai.com for evaluation lanes only.

Used by the exam contestant (`tests/mira_eval.py --openai`) and the independent
Answer Radar grader (`answer_radar.model_grader`). Never a product/chat provider:
the diagnostic cascade stays Groq → Cerebras → Together.

Spend law (`.claude/rules/zero-token-architecture.md`): every call is priced from
the returned usage, a model with no price refuses to run (spend is never hidden),
and the caller's budget is a hard stop checked before each call.
"""

from __future__ import annotations

import math
import os

import httpx

API_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-5.5"
PROVIDER = "openai"

#: $ per million tokens (input, output). Reasoning tokens bill as output.
#: Source: burn study 2026-07-17 (docs/research/2026-07-17-printsense-inference-burn-study.md).
PRICE_PER_MTOK: dict[str, tuple[float, float]] = {"gpt-5.5": (5.0, 30.0)}


#: Per-request framing allowance: role/turn markers for two messages plus the
#: reply primer. Generous by design; it only has to be an upper bound.
FRAMING_TOKENS = 64


def input_token_upper_bound(system: str, user: str) -> int:
    """An upper bound on prompt tokens: UTF-8 bytes of both messages + framing."""
    return len(system.encode("utf-8")) + len(user.encode("utf-8")) + FRAMING_TOKENS


class BudgetExceeded(RuntimeError):
    """The budget was already spent before this call."""


class OpenAIDirect:
    """One priced client. `spent_usd` is cumulative across calls."""

    def __init__(self, model: str, budget_usd: float, api_key: str | None = None) -> None:
        if model not in PRICE_PER_MTOK:
            raise ValueError(f"no price for {model}; add it to PRICE_PER_MTOK first")
        if not math.isfinite(budget_usd) or budget_usd <= 0:
            raise ValueError("a paid lane needs a positive, finite budget_usd")
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
        # Reserve the worst case BEFORE sending, so the cap is hard. Input: every
        # BPE token covers at least one UTF-8 byte, so the byte count is an upper
        # bound on text tokens; FRAMING_TOKENS covers per-message and reply
        # framing. Output: the full completion allowance (reasoning bills as
        # output). #4092 Codex round 2 F2: a chars/2 estimate was not a bound.
        price_in, price_out = PRICE_PER_MTOK[self.model]
        worst = (
            input_token_upper_bound(system, user) / 1e6 * price_in
            + max_completion_tokens / 1e6 * price_out
        )
        if self.spent_usd + worst > self.budget_usd:
            raise BudgetExceeded(
                f"${self.spent_usd:.4f} spent; next call may cost up to ${worst:.4f}; budget ${self.budget_usd:.2f}"
            )
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
        try:
            resp = client.post(
                API_URL,
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=timeout,
            )
        except httpx.TransportError as e:
            # The request may have been processed and billed without our seeing
            # the usage (#4092 Codex round 3 F2): charge the reserved worst case
            # and stop the paid run.
            self.tokens_in += input_token_upper_bound(system, user)
            self.tokens_out += max_completion_tokens
            raise BudgetExceeded(
                f"ambiguous transport failure ({type(e).__name__}); charged the worst case"
            ) from e
        resp.raise_for_status()
        try:
            body = resp.json()
            usage = body["usage"]
            tokens_in = usage["prompt_tokens"]
            tokens_out = usage["completion_tokens"]
            # Only non-negative whole numbers are usage (#4092 post-cap r2 F2):
            # a negative or fractional count would shrink recorded spend.
            for n in (tokens_in, tokens_out):
                if isinstance(n, bool) or not isinstance(n, int) or n < 0:
                    raise TypeError(f"invalid token count {n!r}")
            content = body["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as e:
            # A 200 we cannot parse (malformed JSON, missing or non-numeric
            # usage, missing choices) may still have been billed: charge the
            # reserved worst case and stop (#4092 Codex post-cap F3; r1 F3).
            self.tokens_in += input_token_upper_bound(system, user)
            self.tokens_out += max_completion_tokens
            raise BudgetExceeded(
                f"unparseable or unpriced response ({type(e).__name__}); charged the worst case"
            ) from e
        self.tokens_in += tokens_in
        self.tokens_out += tokens_out
        return content

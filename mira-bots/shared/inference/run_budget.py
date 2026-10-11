"""Per-run OpenAI spend hard stop (owner directive 2026-10-11: "add a per run
hard stop to catch runaways").

OpenAI is the only METERED provider in the cascade. A runaway — a retry loop,
a judge harness re-driving 200 questions, a stuck client re-sending a turn —
spends real dollars at a rate no free-tier provider could. This module is the
floor under that: every OpenAI call pre-checks a worst-case estimate against a
dollar cap for the current run window, and records the actual usage after.
Once the cap is hit, OpenAI is skipped for the rest of the window and the
cascade falls through to the next provider (or to the honest
all-providers-failed path). Spend is never hidden: the skip is logged as
``OPENAI_BUDGET_EXHAUSTED`` with the numbers.

Shape mirrors ``factorylm_ai/budget.py`` (precheck BEFORE, record AFTER, hard
stop at the cap — ZTA Hard Rule 1). It is self-contained rather than imported
because the bot and pipeline runtime images do not all ship ``factorylm_ai``,
and the lab guard is per-proofpack while this one is per-process.

Window semantics: "a run" is one process. The cap applies to a rolling window
of ``OPENAI_RUN_BUDGET_WINDOW_S`` seconds (default one day) that starts on
first use and resets when it elapses, so a long-lived container is bounded per
day, a CI job is bounded for its lifetime, and a restart starts fresh.

Env (all optional; the ``or`` form is load-bearing because compose maps
``${VAR:-}`` to an EMPTY STRING in-container):
  OPENAI_RUN_BUDGET_USD          cap per window, default 10
  OPENAI_RUN_BUDGET_WINDOW_S     window length, default 86400
  OPENAI_PRICE_PER_MTOK_IN       USD per million input tokens, default 0.75
  OPENAI_PRICE_PER_MTOK_OUT      USD per million output tokens, default 4.5

The default prices are gpt-5.4-mini's list rate as declared in
``tools/review_router/prices.json``; ``tests/test_openai_run_budget.py`` pins
them equal to that file so the two cannot drift apart silently.
"""

from __future__ import annotations

import logging
import math
import os
import time
from collections.abc import Callable

logger = logging.getLogger("mira-gsd")

DEFAULT_CAP_USD = 10.0
DEFAULT_WINDOW_S = 86_400.0
DEFAULT_PRICE_PER_MTOK_IN = 0.75
DEFAULT_PRICE_PER_MTOK_OUT = 4.5

# Chars-per-token proxy for the pre-call estimate. Deliberately cheap: the
# estimate exists to stop a RUNAWAY, not to bill; the post-call record uses the
# provider's real usage block.
_CHARS_PER_TOKEN = 4
# A vision image part is billed as a fixed block of input tokens; this is a
# conservative stand-in for the pre-check only.
_IMAGE_PART_TOKENS = 1500


class BudgetExceeded(Exception):
    """Raised by :meth:`OpenAIRunBudget.precheck` when a call would cross the cap."""


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    if not math.isfinite(value) or value < minimum:
        return default
    return value


class OpenAIRunBudget:
    """Dollar cap for OpenAI spend over a rolling window in this process."""

    def __init__(
        self,
        cap_usd: float | None = None,
        window_s: float | None = None,
        price_in_per_mtok: float | None = None,
        price_out_per_mtok: float | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._cap_usd = (
            cap_usd if cap_usd is not None else _env_float("OPENAI_RUN_BUDGET_USD", DEFAULT_CAP_USD)
        )
        self._window_s = (
            window_s
            if window_s is not None
            else _env_float("OPENAI_RUN_BUDGET_WINDOW_S", DEFAULT_WINDOW_S, minimum=1.0)
        )
        self._price_in = (
            price_in_per_mtok
            if price_in_per_mtok is not None
            else _env_float("OPENAI_PRICE_PER_MTOK_IN", DEFAULT_PRICE_PER_MTOK_IN)
        )
        self._price_out = (
            price_out_per_mtok
            if price_out_per_mtok is not None
            else _env_float("OPENAI_PRICE_PER_MTOK_OUT", DEFAULT_PRICE_PER_MTOK_OUT)
        )
        self._clock = clock
        self._window_started = clock()
        self._spent_usd = 0.0
        self._calls = 0

    # ── read-only state ───────────────────────────────────────────────────────
    @property
    def cap_usd(self) -> float:
        return self._cap_usd

    @property
    def window_s(self) -> float:
        return self._window_s

    @property
    def spent_usd(self) -> float:
        self._roll()
        return self._spent_usd

    @property
    def calls(self) -> int:
        return self._calls

    # ── arithmetic ────────────────────────────────────────────────────────────
    def estimate_usd(self, input_tokens: int, output_tokens: int) -> float:
        return (max(0, input_tokens) / 1e6) * self._price_in + (
            max(0, output_tokens) / 1e6
        ) * self._price_out

    def _roll(self) -> None:
        now = self._clock()
        if now - self._window_started >= self._window_s:
            if self._spent_usd:
                logger.info(
                    "OPENAI_BUDGET_WINDOW_RESET spent_usd=%.4f cap_usd=%.2f window_s=%d",
                    self._spent_usd,
                    self._cap_usd,
                    int(self._window_s),
                )
            self._window_started = now
            self._spent_usd = 0.0
            self._calls = 0

    def precheck(self, input_tokens: int, output_tokens: int) -> None:
        """Hard stop: raise :class:`BudgetExceeded` if this call's worst case
        would take the window past the cap. Call BEFORE the request."""
        self._roll()
        worst = self.estimate_usd(input_tokens, output_tokens)
        projected = self._spent_usd + worst
        if projected > self._cap_usd:
            raise BudgetExceeded(
                f"openai run budget: spent=${self._spent_usd:.4f} + worst_case=${worst:.4f} "
                f"= ${projected:.4f} > cap=${self._cap_usd:.2f} (window {int(self._window_s)}s)"
            )

    def record(self, input_tokens: int, output_tokens: int) -> float:
        """Accumulate the ACTUAL usage after the request. Returns the call's cost."""
        self._roll()
        cost = self.estimate_usd(input_tokens, output_tokens)
        self._spent_usd += cost
        self._calls += 1
        logger.info(
            "OPENAI_BUDGET_RECORD call_usd=%.5f spent_usd=%.4f cap_usd=%.2f calls=%d",
            cost,
            self._spent_usd,
            self._cap_usd,
            self._calls,
        )
        return cost


def estimate_input_tokens(messages: list[dict]) -> int:
    """Cheap pre-call input estimate: chars/4 for text, a fixed block per image part."""
    total_chars = 0
    images = 0
    for msg in messages:
        content = msg.get("content") if isinstance(msg, dict) else None
        if isinstance(content, str):
            total_chars += len(content)
        elif isinstance(content, list):
            for part in content:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    total_chars += len(str(part.get("text", "")))
                elif part.get("type") == "image_url":
                    images += 1
    return total_chars // _CHARS_PER_TOKEN + images * _IMAGE_PART_TOKENS


_shared: OpenAIRunBudget | None = None


def get_openai_run_budget() -> OpenAIRunBudget:
    """The one budget for this process (built lazily from env on first use)."""
    global _shared
    if _shared is None:
        _shared = OpenAIRunBudget()
    return _shared


def reset_openai_run_budget() -> None:
    """Tests only: drop the shared budget so the next call rebuilds from env."""
    global _shared
    _shared = None

"""Photo Diagnosis Benchmark — the reservation ledger.

Every provider call reserves its estimated cost BEFORE the call is made,
settles after. A reservation that would exceed the cap raises
`BudgetExhausted` and the provider is never invoked for that attempt — the
whole point of reserving first.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_CHARS_PER_TOKEN = 4
_TOKENS_PER_IMAGE = 800  # conservative fixed estimate for one image attachment
DEFAULT_MANUAL_SEARCH_CAP = 40


class BudgetExhausted(Exception):
    """A reservation or the manual-search counter would exceed its cap."""


def _estimate_input_tokens(messages: list[dict], images: list[str] | None = None) -> int:
    total_chars = sum(len(str(m.get("content", ""))) for m in messages)
    tokens = total_chars // _CHARS_PER_TOKEN
    if images:
        tokens += _TOKENS_PER_IMAGE * len(images)
    return max(tokens, 1)


class Ledger:
    def __init__(self, cap_usd: float, manual_search_cap: int = DEFAULT_MANUAL_SEARCH_CAP):
        self.cap_usd = cap_usd
        self.spent_usd = 0.0
        self.manual_search_queries = 0
        self.manual_search_cap = manual_search_cap
        self.call_log: list[dict[str, Any]] = []
        self._reservations: dict[str, float] = {}
        self._next_token = 0

    @property
    def reserved_usd(self) -> float:
        return sum(self._reservations.values())

    def reserve(self, est_usd: float) -> str:
        if self.spent_usd + self.reserved_usd + est_usd > self.cap_usd:
            raise BudgetExhausted(
                f"reserving ${est_usd:.4f} would exceed cap ${self.cap_usd:.2f} "
                f"(spent=${self.spent_usd:.4f} reserved=${self.reserved_usd:.4f})"
            )
        self._next_token += 1
        token = f"res-{self._next_token}"
        self._reservations[token] = est_usd
        return token

    def settle(self, token: str, actual_usd: float) -> None:
        if token not in self._reservations:
            raise KeyError(f"unknown or already-settled reservation token {token!r}")
        del self._reservations[token]
        self.spent_usd += actual_usd

    def release(self, token: str) -> None:
        self._reservations.pop(token, None)

    def record_manual_search(self, n: int = 1) -> None:
        self.manual_search_queries += n
        if self.manual_search_queries > self.manual_search_cap:
            raise BudgetExhausted(
                f"manual-search queries {self.manual_search_queries} exceeded cap "
                f"{self.manual_search_cap}"
            )

    def record_manual_search_from_packet(self, packet: dict | None) -> None:
        """Fed from the turn packet's `retrieval.manual_acquisition` —
        tolerates missing keys (the packet shape is still settling)."""
        retrieval = (packet or {}).get("retrieval") or {}
        acquisition = retrieval.get("manual_acquisition") or {}
        n = acquisition.get("query_count") or acquisition.get("queries") or 0
        try:
            n = int(n)
        except (TypeError, ValueError):
            n = 0
        if n:
            self.record_manual_search(n)

    def call(
        self,
        provider: Any,
        messages: list[dict],
        max_tokens: int,
        images: list[str] | None = None,
        retries: int = 1,
    ) -> tuple[str, dict]:
        """Reserve BEFORE calling, settle after, count every attempt
        (including retries). On a failed attempt, settle at the estimate
        rather than releasing it — conservative spend, never free retries."""
        est = provider.est_cost(_estimate_input_tokens(messages, images), max_tokens)
        last_exc: Exception | None = None
        for attempt in range(1, max(1, retries) + 1):
            token = self.reserve(est)  # BudgetExhausted propagates; provider is never called
            self.call_log.append(
                {
                    "attempt": attempt,
                    "provider": getattr(provider, "name", "?"),
                    "model": getattr(provider, "model", "?"),
                    "estimate_usd": est,
                }
            )
            try:
                text, usage = provider.complete(messages, images=images, max_tokens=max_tokens)
            except Exception as e:  # noqa: BLE001 — recorded, never silently swallowed
                self.settle(token, est)
                last_exc = e
                continue
            actual = provider.est_cost(usage.get("in", 0), usage.get("out", 0))
            self.settle(token, actual)
            return text, usage
        assert last_exc is not None
        raise last_exc

    def summary(self) -> dict[str, Any]:
        return {
            "cap_usd": self.cap_usd,
            "spent_usd": round(self.spent_usd, 6),
            "reserved_usd": round(self.reserved_usd, 6),
            "remaining_usd": round(self.cap_usd - self.spent_usd - self.reserved_usd, 6),
            "calls": len(self.call_log),
            "manual_search_queries": self.manual_search_queries,
            "manual_search_cap": self.manual_search_cap,
        }


@dataclass
class MeteredProvider:
    """A `Provider`-shaped wrapper that routes every call through a
    `Ledger`. Pass this to the graders/classifier instead of the raw
    provider so no call site can accidentally bypass the budget."""

    inner: Any
    ledger: Ledger

    @property
    def name(self) -> str:
        return self.inner.name

    @property
    def model(self) -> str:
        return self.inner.model

    def complete(
        self, messages: list[dict], images: list[str] | None = None, max_tokens: int = 500
    ) -> tuple[str, dict]:
        return self.ledger.call(self.inner, messages, max_tokens, images=images)

    def est_cost(self, in_tokens: int, out_tokens: int) -> float:
        return self.inner.est_cost(in_tokens, out_tokens)


__all__ = [
    "BudgetExhausted",
    "Ledger",
    "MeteredProvider",
    "DEFAULT_MANUAL_SEARCH_CAP",
]

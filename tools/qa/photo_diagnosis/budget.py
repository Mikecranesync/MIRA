"""Photo Diagnosis Benchmark — the reservation ledger.

Every provider call reserves its estimated cost BEFORE the call is made,
settles after. A reservation that would exceed the cap raises
`BudgetExhausted` and the provider is never invoked for that attempt — the
whole point of reserving first.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

_CHARS_PER_TOKEN = 4
_TOKENS_PER_IMAGE = 800  # conservative fixed estimate for one image attachment
DEFAULT_MANUAL_SEARCH_CAP = 40
# Upper bound on provider queries a single search start can spend — mirrors
# mira-bots/shared/manual_search/search.py `_DEFAULT_MAX_PROVIDER_QUERIES`
# (pass 1 + up to 4 pass-2 model-variant queries + pass 3). The CLI's
# `--queries-per-search` overrides this when the real ceiling changes.
DEFAULT_QUERIES_PER_SEARCH = 4
# Independent search lanes ONE chat dispatch can start: manual acquisition and
# the photo part-number lookup (Codex r9 F1). The pre-turn gate needs headroom
# for all of them, and unknown telemetry is charged for all of them.
SEARCH_LANES_PER_TURN = 2


class BudgetExhausted(Exception):
    """A reservation or the manual-search counter would exceed its cap."""


def _estimate_input_tokens(messages: list[dict], images: list[str] | None = None) -> int:
    total_chars = sum(len(str(m.get("content", ""))) for m in messages)
    tokens = total_chars // _CHARS_PER_TOKEN
    if images:
        tokens += _TOKENS_PER_IMAGE * len(images)
    return max(tokens, 1)


class Ledger:
    def __init__(
        self,
        cap_usd: float,
        manual_search_cap: int = DEFAULT_MANUAL_SEARCH_CAP,
        queries_per_search: int = DEFAULT_QUERIES_PER_SEARCH,
    ):
        # r10 F4: NaN/inf/negative caps or a non-positive query multiplier
        # silently defeat every hard-stop comparison below.
        if not (isinstance(cap_usd, (int, float)) and math.isfinite(cap_usd) and cap_usd >= 0):
            raise ValueError(f"cap_usd must be a finite, non-negative number, got {cap_usd!r}")
        if not (
            isinstance(manual_search_cap, int)
            and not isinstance(manual_search_cap, bool)
            and manual_search_cap >= 0
        ):
            raise ValueError(f"manual_search_cap must be an int >= 0, got {manual_search_cap!r}")
        if not (
            isinstance(queries_per_search, int)
            and not isinstance(queries_per_search, bool)
            and queries_per_search >= 1
        ):
            raise ValueError(f"queries_per_search must be an int >= 1, got {queries_per_search!r}")
        self.cap_usd = cap_usd
        self.spent_usd = 0.0
        self.manual_search_queries = 0
        self.manual_search_cap = manual_search_cap
        self.queries_per_search = queries_per_search
        self.call_log: list[dict[str, Any]] = []
        self.usd_exhausted = cap_usd <= 0
        self._reservations: dict[str, float] = {}
        self._next_token = 0

    @property
    def reserved_usd(self) -> float:
        return sum(self._reservations.values())

    def reserve(self, est_usd: float) -> str:
        if self.spent_usd + self.reserved_usd + est_usd > self.cap_usd:
            # Codex r4 F15: remembered, so the runner stops dispatching Hub
            # work even when a per-case function caught the exception.
            self.usd_exhausted = True
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
        if self.spent_usd >= self.cap_usd:
            # Codex r5 F15: a settlement that reaches the cap (or overshoots its
            # estimate past it) is a dollar stop, not just a refused reservation.
            self.usd_exhausted = True

    def release(self, token: str) -> None:
        self._reservations.pop(token, None)

    def record_manual_search(self, n: int = 1) -> None:
        """Record N provider queries that have ALREADY been spent. Never
        raises — recording happens AFTER the turn ran, and a turn that
        already happened cannot be un-run by raising here. Enforcement is
        the caller's job, BEFORE the turn, via `manual_search_cap_exceeded`."""
        self.manual_search_queries += n

    def usd_stopped(self) -> bool:
        """Codex r5/r6 F15: the dollar hard stop. True once a reservation was
        refused, or settled spend plus open reservations has reached the cap.
        Checked before EVERY Hub dispatch (chat, retake look, manual upload,
        new notebook), not only between repeats."""
        return self.usd_exhausted or self.cap_usd - self.spent_usd - self.reserved_usd <= 0

    def manual_search_cap_exceeded(self, additional: int | None = None) -> bool:
        """Pre-turn check: would spending `additional` more provider
        queries (default: one worst-case search, `self.queries_per_search`)
        push the running total past the cap? The runner calls this BEFORE
        each turn and, if true, stops new work for that run (status
        `not_run_budget`) rather than running the turn and discovering only
        afterward that it can't be recorded."""
        n = self.queries_per_search * SEARCH_LANES_PER_TURN if additional is None else additional
        return self.manual_search_queries + n > self.manual_search_cap

    def record_manual_search_from_packet(
        self, packet: dict | None, *, chat_turn: bool = True
    ) -> None:
        """Fed from the turn evidence packet's `retrieval.manual_acquisition`
        and `retrieval.photo_part_manual_lookup` — the REAL packet shape is
        `{state, started_this_turn, candidate_host} | None` and
        `{action, searched, ...} | None`
        (mira-hub/src/capabilities/observability/turn-evidence-packet.ts
        lines 141-145). Counts search STARTS — `manual_acquisition.
        started_this_turn is True`, or `photo_part_manual_lookup.searched is
        True` — and charges each start at `self.queries_per_search`
        provider queries, the worst-case ceiling one `search_manual()` call
        can spend (mira-bots/shared/manual_search/search.py
        `_DEFAULT_MAX_PROVIDER_QUERIES`).

        A field present as `null` is a legitimate "no search ran" (0
        queries) — don't charge it. A field that is MISSING entirely, or a
        `packet`/`retrieval` object that isn't even a dict, is unknown
        telemetry: charged as one worst-case start rather than read as
        zero. Cost-invisible spend is banned
        (`.claude/rules/zero-token-architecture.md`).

        This is an ESTIMATE from in-flight telemetry, not a bill. Staging's
        quota_spend_view (the after-the-fact Neon cross-check of real
        provider spend, maintained outside this harness) is the
        authoritative source if the two ever disagree.

        `chat_turn` (Codex r2/r4 F4): any chat turn — a photo turn, or a
        typed manual request naming a manufacturer and model — can start a
        CANDIDATE-identity acquisition (chat route, basis="candidate") that
        neither counted field reports. So a chat turn with no explicitly
        counted start is charged one worst-case search anyway: an over-count,
        never an under-count, so the hard stop stays a hard stop. Pass
        `chat_turn=False` only for a packet that did not come from a chat
        dispatch."""
        if not isinstance(packet, dict):
            self.record_manual_search(self.queries_per_search * SEARCH_LANES_PER_TURN)
            return
        retrieval = packet.get("retrieval")
        if not isinstance(retrieval, dict):
            self.record_manual_search(self.queries_per_search * SEARCH_LANES_PER_TURN)
            return
        starts = 0
        for key, started_flag in (
            ("manual_acquisition", "started_this_turn"),
            ("photo_part_manual_lookup", "searched"),
        ):
            if key not in retrieval:
                starts += 1  # missing telemetry -> fail closed
                continue
            value = retrieval[key]
            if value is None:
                continue  # legitimate "no search"
            if not isinstance(value, dict):
                starts += 1  # malformed -> fail closed
                continue
            if value.get(started_flag) is True:
                starts += 1
        if chat_turn and starts == 0:
            starts = 1  # unattributable candidate acquisition -> worst case
        if starts:
            self.record_manual_search(starts * self.queries_per_search)

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
            "queries_per_search": self.queries_per_search,
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
    "DEFAULT_QUERIES_PER_SEARCH",
]

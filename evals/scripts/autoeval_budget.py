"""Persistent spend ledger and the one metered Claude call used by autoeval.

Ported from the promo-eval reference (`promo_eval.py`: `Ledger`, `claude_text`).
Every check that can run BEFORE a request runs before it: kill sentinel,
`paid_not_after`, empty or foreign `expect_org` in the ledger, unpriced model,
total cap, daily cap. A reservation is booked at worst case before the POST and
settled from the response `usage`; an unsettled reservation counts as spent.

Known limit: the billing org is only visible in a response header, so the first
call against a fresh ledger cannot be org-checked before the request. It is
checked immediately after the response, and the call is booked either way.

No secret is read here. The key arrives through `key_provider`, which is
invoked only after every pre-request check has passed.
"""

from __future__ import annotations

import json
import os
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any

import httpx

API = "https://api.anthropic.com/v1"
HDRS = {"anthropic-version": "2023-06-01", "content-type": "application/json"}
THRESHOLDS = (50, 80, 100)


class BudgetStop(SystemExit):
    """Hard stop. A SystemExit so `except Exception` in a harness cannot swallow it."""


@dataclass(frozen=True)
class ModelPrice:
    in_per_mtok: float
    out_per_mtok: float
    max_tokens: int
    params: dict[str, Any] = field(default_factory=dict)


# Pinned list prices (USD per million tokens). Values copied from the promo-eval reference.
DEFAULT_PRICES: dict[str, ModelPrice] = {
    "claude-sonnet-4-6": ModelPrice(3.00, 15.00, 1024, {"temperature": 0}),
    "claude-opus-5-5": ModelPrice(4.00, 20.00, 4096, {}),
}


@dataclass(frozen=True)
class BudgetConfig:
    total_cap_usd: float
    daily_cap_usd: float
    paid_not_after: str  # ISO-8601, e.g. 2026-11-17T19:00:00+00:00
    expect_org: str
    sentinel: Path
    spent_before_usd: float = 0.0
    prices: dict[str, ModelPrice] = field(default_factory=lambda: dict(DEFAULT_PRICES))


def _epoch(iso: str) -> float:
    if not iso:
        raise BudgetStop("STOP: paid_not_after is unset - no paid call is allowed")
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()


def cost(price: ModelPrice, tok_in: int, tok_out: int) -> float:
    return (tok_in * price.in_per_mtok + tok_out * price.out_per_mtok) / 1_000_000


def worst_case(price: ModelPrice, prompt: str) -> float:
    # bytes/2 over-counts tokens for English and JSON on every Claude tokenizer.
    return cost(price, len(prompt.encode()) // 2 + 64, price.max_tokens)


def threshold_crossings(before: float, after: float, cap: float) -> list[int]:
    """Percent thresholds (50/80/100) that a move from `before` to `after` reached."""
    if cap <= 0 or after <= before:
        return []
    return [pct for pct in THRESHOLDS if before < cap * pct / 100 <= after]


class Ledger:
    """Append-only, fsynced JSONL. Spend = settled actuals + open reservations."""

    def __init__(
        self, path: Path, cfg: BudgetConfig, clock: Callable[[], float] = time.time
    ) -> None:
        self.path, self.cfg, self.clock = Path(path), cfg, clock

    def today(self) -> str:
        return time.strftime("%Y-%m-%d", time.gmtime(self.clock()))

    def rows(self) -> list[dict]:
        if not self.path.exists():
            return []
        try:
            return [json.loads(ln) for ln in self.path.read_text().splitlines() if ln.strip()]
        except json.JSONDecodeError as e:
            raise BudgetStop(f"STOP: ledger unreadable ({e}) - spend is uncertain") from e

    def _amounts(self) -> dict[str, tuple[str, float]]:
        """reservation id -> (UTC day, USD actually booked): settle amount if settled."""
        reserved: dict[str, tuple[str, float]] = {}
        for r in self.rows():
            if r["t"] == "reserve":
                reserved[r["id"]] = (r["day"], float(r["usd"]))
            elif r["t"] == "settle" and r["id"] in reserved:
                reserved[r["id"]] = (reserved[r["id"]][0], float(r["usd"]))
        return reserved

    def spent_total(self) -> float:
        return self.cfg.spent_before_usd + sum(usd for _, usd in self._amounts().values())

    def spent_day(self, day: str) -> float:
        return sum(usd for d, usd in self._amounts().values() if d == day)

    def settled_orgs(self) -> set[str]:
        return {
            r.get("org", "")
            for r in self.rows()
            if r["t"] == "settle" and r.get("status") == 200 and r.get("org")
        }

    def _append(self, row: dict) -> None:
        row["ts"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self.clock()))
        with open(self.path, "a") as f:
            f.write(json.dumps(row) + "\n")
            f.flush()
            os.fsync(f.fileno())

    def reserve(self, usd: float, *, model: str, lane: str = "") -> str:
        """Book worst-case spend. Every refusal here happens before any request."""
        cfg = self.cfg
        if cfg.sentinel.exists():
            raise BudgetStop(f"STOP: kill sentinel present at {cfg.sentinel}")
        if self.clock() >= _epoch(cfg.paid_not_after):
            raise BudgetStop(f"STOP: paid_not_after {cfg.paid_not_after} has passed")
        if not cfg.expect_org:
            raise BudgetStop("STOP: expect_org is unset - the billing org is unconfirmed")
        foreign = self.settled_orgs() - {cfg.expect_org}
        if foreign:
            raise BudgetStop(f"STOP: ledger holds spend billed to other org(s) {sorted(foreign)}")
        spent, day = self.spent_total(), self.today()
        if spent + usd > cfg.total_cap_usd:
            raise BudgetStop(
                f"STOP: total cap. spent=${spent:.4f} + ${usd:.4f} > ${cfg.total_cap_usd}"
            )
        day_spent = self.spent_day(day)
        if day_spent + usd > cfg.daily_cap_usd:
            raise BudgetStop(
                f"STOP: daily cap {day}. spent=${day_spent:.4f} + ${usd:.4f} > ${cfg.daily_cap_usd}"
            )
        rid = uuid.uuid4().hex[:12]
        self._append(
            {
                "t": "reserve",
                "id": rid,
                "day": day,
                "usd": round(usd, 6),
                "model": model,
                "lane": lane,
            }
        )
        return rid

    def settle(self, rid: str, usd: float, **meta: Any) -> None:
        self._append({"t": "settle", "id": rid, "usd": round(usd, 6), **meta})


@dataclass(frozen=True)
class Reply:
    text: str
    stop_reason: str | None
    tok_in: int
    tok_out: int
    usd: float
    org: str
    request_id: str


def claude_text(
    prompt: str,
    model: str,
    *,
    cfg: BudgetConfig,
    ledger: Ledger,
    key_provider: Callable[[], str],
    client: httpx.Client,
    lane: str = "",
    sleep: Callable[[float], None] = time.sleep,
) -> Reply:
    """One metered Messages call. Raises BudgetStop on any uncertainty; never falls back."""
    price = cfg.prices.get(model)
    if price is None:
        raise BudgetStop(f"STOP: no pinned price for model {model!r} - refusing unmetered spend")
    payload = {
        "model": model,
        "max_tokens": price.max_tokens,
        "messages": [{"role": "user", "content": prompt}],
        **price.params,
    }
    for attempt in (1, 2):
        rid = ledger.reserve(worst_case(price, prompt), model=model, lane=lane)
        try:
            key = key_provider()
        except BudgetStop:
            ledger.settle(rid, 0.0, status="no_request")
            raise
        try:
            resp = client.post(f"{API}/messages", json=payload, headers={**HDRS, "x-api-key": key})
        except httpx.HTTPError as e:  # may have been billed: the reservation stays booked
            if attempt == 2:
                raise BudgetStop(f"STOP: transport error twice ({type(e).__name__})") from e
            sleep(5)
            continue
        code = resp.status_code
        if code != 200:
            if code < 500 or code == 529:  # rejected before generation: not billed
                ledger.settle(rid, 0.0, status=code)
            if code in (429, 500, 502, 503, 529) and attempt == 1:
                sleep(10)
                continue
            raise BudgetStop(f"STOP: Anthropic HTTP {code} - no fallback provider is permitted")
        body = resp.json()
        usage = body.get("usage") or {}
        if "input_tokens" not in usage or "output_tokens" not in usage:
            raise BudgetStop("STOP: 200 without usage - cost unknown, worst case stays booked")
        cached = usage.get("cache_creation_input_tokens", 0) + usage.get(
            "cache_read_input_tokens", 0
        )
        tok_in = int((usage["input_tokens"] + cached) * (1.25 if cached else 1))
        org = resp.headers.get("anthropic-organization-id", "")
        req_id = resp.headers.get("request-id", "")
        usd = cost(price, tok_in, usage["output_tokens"])
        ledger.settle(
            rid,
            usd,
            status=200,
            org=org,
            request_id=req_id,
            model=model,
            tok_in=tok_in,
            tok_out=usage["output_tokens"],
            lane=lane,
        )
        if cfg.expect_org and org != cfg.expect_org:
            raise BudgetStop(
                f"STOP: billed org {org!r} is not the confirmed org {cfg.expect_org!r}"
            )
        text = "".join(
            b.get("text", "") for b in body.get("content", []) if b.get("type") == "text"
        )
        return Reply(
            text, body.get("stop_reason"), tok_in, usage["output_tokens"], usd, org, req_id
        )
    raise BudgetStop("STOP: retry loop exhausted")

"""Per-account sliding-window rate limiter for /chat/message burst protection.

Companion to `usage.FREE_TIER_MONTHLY_CHAT_CAP` (the monthly ceiling).
The monthly cap bounds total cost; this module bounds burst rate so a
runaway client can't drain a month's allowance in seconds.

State is per-process and in-memory. The mira-scan-monday backend runs
single-replica today (n=1 marketplace), so a per-process map is correct.
When this service goes multi-replica, swap the backing store for Redis;
the API surface (`check_and_record`) stays the same.

Window/limit are env-tunable. Defaults follow CRA-159:
  MIRA_CHAT_RATE_LIMIT_PER_WINDOW = 30
  MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS = 300   # 5 minutes
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from dataclasses import dataclass

CHAT_RATE_LIMIT_PER_WINDOW = int(os.getenv("MIRA_CHAT_RATE_LIMIT_PER_WINDOW", "30"))
CHAT_RATE_LIMIT_WINDOW_SECONDS = int(os.getenv("MIRA_CHAT_RATE_LIMIT_WINDOW_SECONDS", "300"))


@dataclass
class RateLimitResult:
    allowed: bool
    retry_after: int
    used: int
    limit: int
    window_seconds: int


_buckets: dict[str, deque[float]] = {}
_lock = asyncio.Lock()


def _now() -> float:
    return time.monotonic()


async def check_and_record(account_id: str) -> RateLimitResult:
    """Sliding-window check. Records a hit when `allowed=True`.

    Empty `account_id` is allowed unconditionally (standalone / unauth
    callers — n=1 today, not a marketplace install).
    """
    limit = CHAT_RATE_LIMIT_PER_WINDOW
    window = CHAT_RATE_LIMIT_WINDOW_SECONDS

    if not account_id:
        return RateLimitResult(
            allowed=True, retry_after=0, used=0, limit=limit, window_seconds=window
        )

    async with _lock:
        bucket = _buckets.setdefault(account_id, deque())
        now = _now()
        cutoff = now - window
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            oldest = bucket[0]
            retry_after = max(1, int(round(oldest + window - now)))
            return RateLimitResult(
                allowed=False,
                retry_after=retry_after,
                used=len(bucket),
                limit=limit,
                window_seconds=window,
            )
        bucket.append(now)
        return RateLimitResult(
            allowed=True,
            retry_after=0,
            used=len(bucket),
            limit=limit,
            window_seconds=window,
        )


async def reset_for_tests() -> None:
    async with _lock:
        _buckets.clear()

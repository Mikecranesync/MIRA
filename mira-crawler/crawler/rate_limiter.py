"""Per-domain rate limiter using token bucket pattern.

Enforces minimum delay between requests to the same domain.
Thread-safe for use across multiple crawl tasks.

Usage:
    limiter = RateLimiter(min_delay_sec=3.0)
    limiter.wait("cdn.automationdirect.com")  # blocks if too soon
    # ... make request
"""

from __future__ import annotations

import logging
import threading
import time

logger = logging.getLogger("mira-crawler.rate")


class RateLimiter:
    """Per-domain token bucket rate limiter."""

    def __init__(self, min_delay_sec: float = 3.0) -> None:
        self.min_delay = min_delay_sec
        self._last_request: dict[str, float] = {}
        self._lock = threading.Lock()

    def wait(self, domain: str) -> float:
        """Block until it's safe to make a request to the given domain.

        Returns the number of seconds waited (0.0 if no wait needed).
        """
        with self._lock:
            now = time.monotonic()
            last = self._last_request.get(domain, 0.0)
            elapsed = now - last
            wait_time = max(0.0, self.min_delay - elapsed)

        if wait_time > 0:
            logger.debug("Rate limiting %s — waiting %.1fs", domain, wait_time)
            time.sleep(wait_time)

        with self._lock:
            self._last_request[domain] = time.monotonic()

        return wait_time

    def reset(self, domain: str | None = None) -> None:
        """Reset rate limit state for a domain (or all domains if None)."""
        with self._lock:
            if domain is None:
                self._last_request.clear()
            else:
                self._last_request.pop(domain, None)

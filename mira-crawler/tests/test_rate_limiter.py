"""Tests for per-domain rate limiter."""

from __future__ import annotations

import time

from crawler.rate_limiter import RateLimiter


class TestRateLimiter:
    def test_first_request_no_wait(self):
        """First request to a domain should not wait."""
        limiter = RateLimiter(min_delay_sec=1.0)
        waited = limiter.wait("example.com")
        assert waited == 0.0

    def test_second_request_waits(self):
        """Second request within window should wait."""
        limiter = RateLimiter(min_delay_sec=0.2)
        limiter.wait("example.com")
        start = time.monotonic()
        limiter.wait("example.com")
        elapsed = time.monotonic() - start
        assert elapsed >= 0.15  # allow small tolerance

    def test_different_domains_independent(self):
        """Different domains don't affect each other."""
        limiter = RateLimiter(min_delay_sec=1.0)
        limiter.wait("domain-a.com")
        waited = limiter.wait("domain-b.com")
        assert waited == 0.0

    def test_reset_single_domain(self):
        """Reset clears rate limit for one domain."""
        limiter = RateLimiter(min_delay_sec=1.0)
        limiter.wait("example.com")
        limiter.reset("example.com")
        waited = limiter.wait("example.com")
        assert waited == 0.0

    def test_reset_all(self):
        """Reset with no argument clears all domains."""
        limiter = RateLimiter(min_delay_sec=1.0)
        limiter.wait("a.com")
        limiter.wait("b.com")
        limiter.reset()
        assert limiter.wait("a.com") == 0.0
        assert limiter.wait("b.com") == 0.0

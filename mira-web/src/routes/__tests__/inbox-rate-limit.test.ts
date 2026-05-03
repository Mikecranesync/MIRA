/**
 * Inbox per-IP rate-limit unit tests (P0.4 — site-hardening 2026-04-30).
 *
 * The handler-side wiring (returns 429 + Retry-After ahead of HMAC compute)
 * is covered indirectly by inbox.test.ts; this file isolates the pure
 * sliding-window logic so a regression on the bucketing math is caught
 * without booting the full route.
 */
import { describe, test, expect, beforeEach } from "bun:test";

process.env.INBOUND_HMAC_SECRET = "test_value_for_module_load";

const { _testing } = await import("../inbox.js");
const { checkInboxRateLimit, getClientIp, reset, INBOX_LIMIT_PER_MINUTE } = _testing;

describe("inbox per-IP rate limit", () => {
  beforeEach(() => reset());

  test("first request from an IP is allowed", () => {
    const r = checkInboxRateLimit("1.1.1.1", 1_000_000);
    expect(r.allowed).toBe(true);
    expect(r.retryAfterSec).toBe(0);
  });

  test("up to the limit is allowed within a 60s window", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < INBOX_LIMIT_PER_MINUTE; i++) {
      const r = checkInboxRateLimit("1.1.1.1", t0 + i * 100);
      expect(r.allowed).toBe(true);
    }
  });

  test("the (limit+1)-th request in the window is blocked with Retry-After", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < INBOX_LIMIT_PER_MINUTE; i++) {
      checkInboxRateLimit("1.1.1.1", t0 + i * 100);
    }
    const r = checkInboxRateLimit("1.1.1.1", t0 + INBOX_LIMIT_PER_MINUTE * 100);
    expect(r.allowed).toBe(false);
    expect(r.retryAfterSec).toBeGreaterThan(0);
    expect(r.retryAfterSec).toBeLessThanOrEqual(60);
  });

  test("limit resets after the window slides past the oldest hit", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < INBOX_LIMIT_PER_MINUTE; i++) {
      checkInboxRateLimit("1.1.1.1", t0 + i * 100);
    }
    // Next request, 61s after the first hit, should be allowed again.
    const r = checkInboxRateLimit("1.1.1.1", t0 + 61_000);
    expect(r.allowed).toBe(true);
  });

  test("different IPs don't share the bucket", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < INBOX_LIMIT_PER_MINUTE; i++) {
      checkInboxRateLimit("1.1.1.1", t0 + i * 100);
    }
    // 2.2.2.2 starts fresh
    const r = checkInboxRateLimit("2.2.2.2", t0 + 100);
    expect(r.allowed).toBe(true);
  });
});

describe("getClientIp", () => {
  test("prefers X-Forwarded-For first hop", () => {
    const h = new Headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" });
    expect(getClientIp(h)).toBe("203.0.113.5");
  });

  test("falls back to X-Real-IP", () => {
    const h = new Headers({ "x-real-ip": "198.51.100.7" });
    expect(getClientIp(h)).toBe("198.51.100.7");
  });

  test("falls back to CF-Connecting-IP", () => {
    const h = new Headers({ "cf-connecting-ip": "192.0.2.42" });
    expect(getClientIp(h)).toBe("192.0.2.42");
  });

  test("returns fallback when no header is present", () => {
    expect(getClientIp(new Headers(), "fb")).toBe("fb");
  });
});

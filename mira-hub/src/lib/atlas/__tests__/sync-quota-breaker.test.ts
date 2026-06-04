import { describe, test, expect } from "vitest";

import { isQuotaError, createCooldownBreaker } from "../sync";
import { AtlasHttpError } from "../client";

const QUOTA_BODY =
  "com.grash.exception.CustomException: You need a license to add a new work order. Free Limit of 30 incomplete work orders reached";

describe("isQuotaError", () => {
  test("true for a 4xx whose body names the free-tier limit", () => {
    expect(isQuotaError(new AtlasHttpError(400, QUOTA_BODY, "/work-orders"))).toBe(true);
  });

  test("true on the 'license' / 'free limit' wording (case-insensitive)", () => {
    expect(isQuotaError(new AtlasHttpError(402, "Valid LICENSE required", "/work-orders"))).toBe(true);
    expect(isQuotaError(new AtlasHttpError(403, "FREE LIMIT reached", "/work-orders"))).toBe(true);
  });

  test("false for a 5xx even if the body matches (that path already backs off)", () => {
    expect(isQuotaError(new AtlasHttpError(500, QUOTA_BODY, "/work-orders"))).toBe(false);
  });

  test("false for an unrelated 4xx", () => {
    expect(isQuotaError(new AtlasHttpError(404, "Not Found", "/work-orders"))).toBe(false);
  });

  test("false for non-AtlasHttpError values", () => {
    expect(isQuotaError(new Error(QUOTA_BODY))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError("Free Limit reached")).toBe(false);
  });
});

describe("createCooldownBreaker", () => {
  test("starts closed", () => {
    const b = createCooldownBreaker(1000, 8000);
    expect(b.isOpen(0)).toBe(false);
    expect(b.remainingMs(0)).toBe(0);
  });

  test("trip opens the breaker for the base cooldown, then it closes again", () => {
    const b = createCooldownBreaker(1000, 8000);
    const cooldown = b.trip(0);
    expect(cooldown).toBe(1000);
    expect(b.isOpen(500)).toBe(true);
    expect(b.remainingMs(500)).toBe(500);
    expect(b.isOpen(1000)).toBe(false); // skipUntil is exclusive
    expect(b.isOpen(1001)).toBe(false);
  });

  test("successive trips back off exponentially, capped at maxMs", () => {
    const b = createCooldownBreaker(1000, 8000);
    expect(b.trip(0)).toBe(1000); // 1000 * 2^0
    expect(b.trip(0)).toBe(2000); // 1000 * 2^1
    expect(b.trip(0)).toBe(4000); // 1000 * 2^2
    expect(b.trip(0)).toBe(8000); // 1000 * 2^3
    expect(b.trip(0)).toBe(8000); // capped (would be 16000)
  });

  test("reset clears trip count and cooldown", () => {
    const b = createCooldownBreaker(1000, 8000);
    b.trip(0);
    b.trip(0); // would be 2000 next
    b.reset();
    expect(b.isOpen(0)).toBe(false);
    expect(b.trip(0)).toBe(1000); // backoff restarted from base
  });
});

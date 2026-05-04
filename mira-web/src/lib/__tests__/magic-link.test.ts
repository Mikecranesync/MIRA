import { describe, expect, test, beforeEach } from "bun:test";
import {
  MAGIC_LINK_TTL_MS,
  MAGIC_LINK_RATE_LIMIT_MS,
  generateToken,
  hashToken,
  buildMagicLinkUrl,
  createMagicLink,
  validateAndConsumeToken,
  checkMagicLinkRateLimit,
  _resetRateLimitForTest,
  inMemoryStorage,
} from "../magic-link.js";

describe("#SO-070 magic-link — pure helpers", () => {
  test("generateToken returns 64-char hex string", () => {
    const t = generateToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  test("generateToken is non-deterministic", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  test("hashToken is deterministic SHA-256 (64 hex chars)", () => {
    const t = "abc123";
    expect(hashToken(t)).toBe(hashToken(t));
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("abc123")).not.toBe(hashToken("abc124"));
  });

  test("buildMagicLinkUrl encodes token + email", () => {
    const url = buildMagicLinkUrl(
      "https://factorylm.com/",
      "abc",
      "mike@example.com"
    );
    expect(url).toBe(
      "https://factorylm.com/api/magic/login?token=abc&email=mike%40example.com"
    );
  });

  test("buildMagicLinkUrl handles publicUrl with no trailing slash", () => {
    const url = buildMagicLinkUrl(
      "https://factorylm.com",
      "abc",
      "a@b.com"
    );
    expect(url).toBe(
      "https://factorylm.com/api/magic/login?token=abc&email=a%40b.com"
    );
  });
});

describe("#SO-070 magic-link — create + validate (in-memory storage)", () => {
  test("createMagicLink inserts record with correct fields and 10-min TTL", async () => {
    const storage = inMemoryStorage();
    const now = new Date("2026-04-26T12:00:00Z");
    const result = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "mike@example.com",
      now,
    });

    expect(result.token).toMatch(/^[0-9a-f]{64}$/);
    expect(result.tokenHash).toBe(hashToken(result.token));
    expect(result.expiresAt.getTime() - now.getTime()).toBe(MAGIC_LINK_TTL_MS);

    const found = await storage.findByHash(result.tokenHash);
    expect(found).not.toBeNull();
    expect(found!.tenantId).toBe("t-1");
    expect(found!.email).toBe("mike@example.com");
    expect(found!.consumedAt).toBeNull();
  });

  test("validateAndConsumeToken: happy path returns ok + email + tenantId", async () => {
    const storage = inMemoryStorage();
    const now = new Date("2026-04-26T12:00:00Z");
    const { token } = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "mike@example.com",
      now,
    });
    const r = await validateAndConsumeToken(storage, token, now);
    expect(r).toEqual({ ok: true, tenantId: "t-1", email: "mike@example.com" });
  });

  test("validateAndConsumeToken: unknown token returns not_found", async () => {
    const storage = inMemoryStorage();
    const r = await validateAndConsumeToken(storage, "deadbeef", new Date());
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  test("validateAndConsumeToken: expired token returns expired", async () => {
    const storage = inMemoryStorage();
    const issuedAt = new Date("2026-04-26T12:00:00Z");
    const { token } = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "mike@example.com",
      now: issuedAt,
    });
    const elevenMinutesLater = new Date(
      issuedAt.getTime() + MAGIC_LINK_TTL_MS + 1
    );
    const r = await validateAndConsumeToken(storage, token, elevenMinutesLater);
    expect(r).toEqual({ ok: false, reason: "expired" });
  });

  test("validateAndConsumeToken: single-use — second consumption returns already_consumed", async () => {
    const storage = inMemoryStorage();
    const now = new Date("2026-04-26T12:00:00Z");
    const { token } = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "mike@example.com",
      now,
    });

    const first = await validateAndConsumeToken(storage, token, now);
    expect(first.ok).toBe(true);

    const second = await validateAndConsumeToken(storage, token, now);
    expect(second).toEqual({ ok: false, reason: "already_consumed" });
  });

  test("validateAndConsumeToken: tampered token (wrong hash) returns not_found", async () => {
    const storage = inMemoryStorage();
    const now = new Date();
    await createMagicLink(storage, {
      tenantId: "t-1",
      email: "a@b.com",
      now,
    });
    const r = await validateAndConsumeToken(storage, "0".repeat(64), now);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  test("validateAndConsumeToken: just-before-expiry still works", async () => {
    const storage = inMemoryStorage();
    const issuedAt = new Date("2026-04-26T12:00:00Z");
    const { token } = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "a@b.com",
      now: issuedAt,
    });
    const just = new Date(issuedAt.getTime() + MAGIC_LINK_TTL_MS - 1);
    const r = await validateAndConsumeToken(storage, token, just);
    expect(r.ok).toBe(true);
  });

  test("multiple tokens for same email are independent", async () => {
    const storage = inMemoryStorage();
    const now = new Date();
    const a = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "a@b.com",
      now,
    });
    const b = await createMagicLink(storage, {
      tenantId: "t-1",
      email: "a@b.com",
      now,
    });
    expect(a.token).not.toBe(b.token);

    const ra = await validateAndConsumeToken(storage, a.token, now);
    const rb = await validateAndConsumeToken(storage, b.token, now);
    expect(ra.ok).toBe(true);
    expect(rb.ok).toBe(true);
  });
});

describe("#SO-070 magic-link — rate limiting", () => {
  beforeEach(() => _resetRateLimitForTest());

  test("first request always allowed", () => {
    expect(checkMagicLinkRateLimit("a@b.com", 1000)).toBe(true);
  });

  test("second request within 60s blocked", () => {
    expect(checkMagicLinkRateLimit("a@b.com", 1000)).toBe(true);
    expect(checkMagicLinkRateLimit("a@b.com", 1000 + 30_000)).toBe(false);
  });

  test("third request after 60s allowed again", () => {
    expect(checkMagicLinkRateLimit("a@b.com", 1000)).toBe(true);
    expect(
      checkMagicLinkRateLimit("a@b.com", 1000 + MAGIC_LINK_RATE_LIMIT_MS + 1)
    ).toBe(true);
  });

  test("different emails are independent", () => {
    expect(checkMagicLinkRateLimit("a@b.com", 1000)).toBe(true);
    expect(checkMagicLinkRateLimit("c@d.com", 1000)).toBe(true);
  });

  test("email comparison is case-insensitive", () => {
    expect(checkMagicLinkRateLimit("Mike@example.com", 1000)).toBe(true);
    expect(checkMagicLinkRateLimit("mike@EXAMPLE.com", 1000 + 30_000)).toBe(
      false
    );
  });
});

/**
 * POST /api/pilot-request origin/content-type guard (#4881 Codex round 1, F3).
 *
 * F3 finding: unlike /api/register, the route had no Origin check before
 * consuming the rate bucket and parsing the body, so a cross-origin
 * "simple request" (e.g. Content-Type: text/plain, no CORS preflight) could
 * submit fabricated leads and/or burn through the shared rate limit.
 *
 * Fix under test: Content-Type must be application/json; the resolved
 * Origin (or Referer's origin, when Origin is absent) must be in the
 * REGISTER_ALLOWED_ORIGINS allowlist; and the route's rate bucket is
 * dedicated (not shared with /api/register) and is never touched by a
 * request this guard rejects.
 *
 * These tests exercise the real app over HTTP (`app.request`), per the
 * existing m-register.test.ts pattern, and intentionally do NOT require
 * NEON_DATABASE_URL — assertions only ever check that a request was
 * rejected (403/415) vs. that it got PAST the guard (anything else),
 * regardless of whether the DB step behind the guard succeeds in this
 * test environment.
 */
import { describe, test, expect } from "bun:test";
import { app } from "../server.js";

const VALID_BODY = JSON.stringify({
  name: "Jane Tech",
  work_email: "jane@acme-mfg.com",
  company: "Acme Manufacturing",
  equipment: "",
  consent: true,
});

describe("POST /api/pilot-request — origin/content-type guard", () => {
  test("rejects a cross-origin text/plain submission (the no-preflight simple-request pattern)", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        Origin: "https://evil.example",
      },
      body: VALID_BODY,
    });
    expect(res.status).toBe(415);
  });

  test("rejects an untrusted Origin even with the correct Content-Type", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://evil.example",
      },
      body: VALID_BODY,
    });
    expect(res.status).toBe(403);
  });

  test("rejects when neither Origin nor Referer is present", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: VALID_BODY,
    });
    expect(res.status).toBe(403);
  });

  test("rejects an unparsable Referer when Origin is absent", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "not a url",
      },
      body: VALID_BODY,
    });
    expect(res.status).toBe(403);
  });

  test("gets past the guard for an allowlisted Origin with application/json", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://factorylm.com",
      },
      body: VALID_BODY,
    });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(415);
  });

  test("gets past the guard for 'application/json; charset=utf-8'", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Origin: "https://www.factorylm.com",
      },
      body: VALID_BODY,
    });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(415);
  });

  test("an allowlisted Referer is accepted when Origin is absent", async () => {
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.factorylm.com/pilot",
      },
      body: VALID_BODY,
    });
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(415);
  });

  test("rejected cross-origin requests never consume the pilot-request rate bucket", async () => {
    const floodIp = "203.0.113.77";
    for (let i = 0; i < 10; i++) {
      const res = await app.request("/api/pilot-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.example",
          "X-Forwarded-For": floodIp,
        },
        body: VALID_BODY,
      });
      expect(res.status).toBe(403);
    }
    // Same IP, now with a trusted Origin — must not be rate-limited by the
    // 10 rejections above, which proves they never touched this bucket.
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://factorylm.com",
        "X-Forwarded-For": floodIp,
      },
      body: VALID_BODY,
    });
    expect(res.status).not.toBe(429);
  });

  test("the pilot-request rate bucket is dedicated — exhausting /api/register's bucket from an IP does not rate-limit /api/pilot-request from the same IP", async () => {
    const sharedIp = "203.0.113.88";
    // Drive /api/register's bucket well past its per-minute limit (5/min).
    for (let i = 0; i < 8; i++) {
      await app.request("/api/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Forwarded-For": sharedIp,
        },
        body: JSON.stringify({ email: `flood${i}@example.com`, company: "Flood Co" }),
      });
    }
    const res = await app.request("/api/pilot-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://factorylm.com",
        "X-Forwarded-For": sharedIp,
      },
      body: VALID_BODY,
    });
    expect(res.status).not.toBe(429);
  });
});

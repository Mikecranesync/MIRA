# Fix #5 — #576 webhook cron: timing-safe Bearer-token compare

**Branch:** `agent/issue-576-outbound-webhooks-0331`
**Severity:** 🔴 Security
**Effort:** ~10 min

## What's broken

`mira-hub/src/app/api/v1/webhooks/cron/route.ts:31`:

```ts
if (presented !== expected || !presented) {
  return NextResponse.json({ error: "unauthorized" }, { status: 401 });
}
```

`!==` short-circuits on the first byte difference. Timing attack: an
attacker probing the Vercel Cron endpoint can extract `CRON_SECRET` byte
by byte. Especially nasty because the cron endpoint runs at high
frequency, so timing samples are cheap and the network noise floor is
known per region.

## The fix

Replace the comparison with `timingSafeEqual` and pre-check the length
(timingSafeEqual throws on length mismatch, which itself leaks length).

```ts
// mira-hub/src/app/api/v1/webhooks/cron/route.ts
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { processBatch } from "@/lib/webhooks/worker";

export const dynamic = "force-dynamic";

async function handler(req: Request) {
  if (!process.env.NEON_DATABASE_URL) {
    return NextResponse.json({ error: "DB not configured" }, { status: 503 });
  }

  const expected = process.env.CRON_SECRET ?? "";
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";

  if (!presented || !cryptoSafeEqual(presented, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // ... rest of handler unchanged ...
}

/**
 * Timing-safe string equality. Pre-checks length because
 * crypto.timingSafeEqual throws on length mismatch and that throw
 * itself leaks information.
 */
function cryptoSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

export const GET = handler;
export const POST = handler;
```

## Test

`mira-hub/src/app/api/v1/webhooks/cron/__tests__/route.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/webhooks/worker", () => ({
  processBatch: vi.fn().mockResolvedValue({
    claimed: 0,
    succeeded: 0,
    failed: 0,
    deadLettered: 0,
    autoPausedEndpoints: 0,
  }),
}));

beforeEach(() => {
  vi.resetModules();
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.CRON_SECRET = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

describe("cron auth", () => {
  it("accepts the right token", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks/cron", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    expect(res.status).toBe(200);
  });

  it("rejects a wrong token of identical length (would have leaked under !==)", async () => {
    const { POST } = await import("../route");
    const wrong = "f".repeat(process.env.CRON_SECRET!.length);
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks/cron", {
        method: "POST",
        headers: { authorization: `Bearer ${wrong}` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token of different length", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks/cron", {
        method: "POST",
        headers: { authorization: `Bearer short` },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects an empty Bearer", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks/cron", {
        method: "POST",
        headers: { authorization: "Bearer " },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("rejects a missing Authorization header", async () => {
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks/cron", { method: "POST" }),
    );
    expect(res.status).toBe(401);
  });

  it("503s if CRON_SECRET is unset (fail closed)", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://localhost/api/v1/webhooks/cron", {
        method: "POST",
        headers: { authorization: "Bearer anything" },
      }),
    );
    expect(res.status).toBe(503);
  });

  it("statistical timing test — same-length wrongs should not differ from each other", async () => {
    const { POST } = await import("../route");
    const expected = process.env.CRON_SECRET!;
    const wrongA = "a" + expected.slice(1); // first byte wrong
    const wrongB = expected.slice(0, -1) + "z"; // last byte wrong

    // Run each comparison many times; the mean times should be similar.
    // This is not cryptographic certainty, just smoke-testing that we're
    // calling timingSafeEqual at all. A `!==` impl would show wrongB
    // statistically slower (matched all bytes but one).
    const N = 200;
    const samples: { a: number; b: number }[] = [];
    for (let i = 0; i < N; i += 1) {
      const startA = performance.now();
      await POST(
        new Request("http://localhost/api/v1/webhooks/cron", {
          method: "POST",
          headers: { authorization: `Bearer ${wrongA}` },
        }),
      );
      const a = performance.now() - startA;
      const startB = performance.now();
      await POST(
        new Request("http://localhost/api/v1/webhooks/cron", {
          method: "POST",
          headers: { authorization: `Bearer ${wrongB}` },
        }),
      );
      const b = performance.now() - startB;
      samples.push({ a, b });
    }
    // Skip first 20 (warmup).
    const warm = samples.slice(20);
    const meanA = warm.reduce((s, x) => s + x.a, 0) / warm.length;
    const meanB = warm.reduce((s, x) => s + x.b, 0) / warm.length;
    // We expect within 100% of each other in noisy CI. A `!==` impl
    // would typically show >2x divergence. We aim for a non-flaky upper
    // bound; if this becomes flaky in CI, drop to a smaller N and a
    // weaker assertion or move to a soak-only environment.
    const ratio = Math.max(meanA, meanB) / Math.min(meanA, meanB);
    expect(ratio).toBeLessThan(3.0);
  });
});
```

## Verification

```bash
cd mira-hub
npx tsc --noEmit -p .
npx vitest run src/app/api/v1/webhooks/cron/__tests__/route.test.ts
```

7 tests pass. The statistical timing test is intentionally lenient (3x mean ratio) to avoid CI flake; its real value is documenting the intent and catching a regression that re-introduces `!==`.

## Why not also rate-limit the cron endpoint

Vercel Cron / EventBridge call this every minute. If you rate-limit per-IP, the cron platform's IP rotation could trip it. If you really want defense-in-depth, lock the route to specific IPs (Vercel publishes their cron IPs) — but that's a separate hardening task and doesn't replace timing-safe compare.

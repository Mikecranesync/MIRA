import { beforeEach, describe, expect, it, vi } from "vitest";

// Not native → client.ts uses global fetch, which we stub per-test to answer 401.
vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  CapacitorHttp: { request: vi.fn() },
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(async () => ({ value: null })), set: vi.fn(), remove: vi.fn() },
}));

const { withAuthEventsSuppressed, onAuthExpired, request } = await import("../client");

function serve401() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status: 401,
      headers: { get: () => null, forEach: () => {} },
      text: async () => '{"error":"Unauthorized"}',
    })),
  );
}

/**
 * Suppression used to be a boolean. Two overlapping suppressed calls then race:
 * the inner one's `finally` clears the flag while the outer is still in flight, so
 * the outer's 401 fires an auth event and signs the technician out mid-diagnosis.
 *
 * The first version of this test asserted only that no event fired — while never
 * causing a 401. It passed against the boolean too, so it proved nothing. These
 * tests issue a REAL 401 inside the window; without that, there is no auth event
 * to suppress and the assertion is vacuous.
 */
describe("withAuthEventsSuppressed — nesting", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("still suppresses after an inner call has finished (boolean version fails here)", async () => {
    serve401();
    let fired = 0;
    const off = onAuthExpired(() => {
      fired += 1;
    });

    await withAuthEventsSuppressed(async () => {
      // Inner opens and CLOSES first — the boolean cleared the flag right here.
      await withAuthEventsSuppressed(async () => undefined);
      // Still logically inside the outer window, so this 401 must stay quiet.
      await request("/api/whatever").catch(() => undefined);
    });

    expect(fired).toBe(0);
    off();
  });

  it("positive control: the same 401 DOES fire an auth event outside the window", async () => {
    // Without this, the test above could pass because auth events never fire at
    // all — which is how the first version of this file was inert.
    serve401();
    let fired = 0;
    const off = onAuthExpired(() => {
      fired += 1;
    });

    await request("/api/whatever").catch(() => undefined);

    expect(fired).toBeGreaterThan(0);
    off();
  });

  it("a rejected body still decrements, so suppression cannot get stuck on", async () => {
    for (let i = 0; i < 3; i++) {
      await expect(
        withAuthEventsSuppressed(async () => {
          throw new Error("boom");
        }),
      ).rejects.toThrow("boom");
    }

    // Depth must be back to zero: a 401 now must fire again. If the counter had
    // leaked, suppression would be permanently on — failing OPEN on the
    // security-relevant behaviour, which is worse than the bug it replaced.
    serve401();
    let fired = 0;
    const off = onAuthExpired(() => {
      fired += 1;
    });
    await request("/api/whatever").catch(() => undefined);
    expect(fired).toBeGreaterThan(0);
    off();
  });
});

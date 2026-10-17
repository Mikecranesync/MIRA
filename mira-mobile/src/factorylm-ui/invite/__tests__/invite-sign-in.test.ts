import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  data: new Map<string, string>(),
  httpRequest: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: (name: string) =>
    name === "BuildConfig"
      ? {
          getApiBase: async () => ({ apiBase: "https://app.factorylm.com" }),
          getDeepLinkConfig: async () => ({ host: "app.factorylm.com", scheme: "factorylm" }),
        }
      : {},
  Capacitor: { isNativePlatform: () => true },
  CapacitorHttp: { request: state.httpRequest },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async ({ key }: { key: string }) => ({ value: state.data.get(key) ?? null })),
    set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
      state.data.set(key, value);
    }),
  },
}));

import { clearAllLocalState, request } from "../../../api/client";
import { confirmInviteSession, signInWithMagicToken } from "../invite-sign-in";

const JAR_KEY = "flm.cookiejar.v1";
const TOKEN = "11111111-2222-4333-8444-555555555555";

beforeEach(async () => {
  state.data.clear();
  state.httpRequest.mockReset();
  await clearAllLocalState();
});

describe("signInWithMagicToken", () => {
  it("signs in on a valid token via csrf -> magic-token callback -> /api/me", async () => {
    state.httpRequest.mockImplementation(
      async ({ url, data }: { url: string; data?: string }) => {
        if (url.endsWith("/api/auth/csrf/")) {
          return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
        }
        if (url.endsWith("/api/auth/callback/magic-token/")) {
          expect(data).toContain(`token=${TOKEN}`);
          return {
            status: 200,
            data: "{}",
            headers: { "Set-Cookie": "session-token=fresh; Path=/" },
          };
        }
        if (url.endsWith("/api/me/")) {
          return { status: 200, data: JSON.stringify({ id: "u1" }), headers: {} };
        }
        throw new Error(`unexpected ${url}`);
      },
    );

    await expect(signInWithMagicToken(TOKEN)).resolves.toEqual({ ok: true });
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({
      "session-token": "fresh",
    });
  });

  // The acceptance-critical case: a prior/stale session cookie must never
  // let a rejected invitation token "appear signed in".
  it("a stale prior-session cookie cannot answer for a rejected invitation token", async () => {
    // Prime the jar as if a previous session's cookie were still sitting there.
    state.httpRequest.mockResolvedValueOnce({
      status: 200,
      data: "{}",
      headers: { "Set-Cookie": "session-token=stale; Path=/" },
    });
    await request("/api/prime/");
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({
      "session-token": "stale",
    });

    // The invite callback rejects the token (authorize() returns null — no
    // Set-Cookie). Capture what /api/me actually receives to prove the stale
    // cookie was not attached.
    let meHeaders: Record<string, string> | undefined;
    state.httpRequest.mockImplementation(
      async ({ url, headers }: { url: string; headers?: Record<string, string> }) => {
        if (url.endsWith("/api/auth/csrf/")) {
          return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
        }
        if (url.endsWith("/api/auth/callback/magic-token/")) {
          return { status: 200, data: "{}", headers: {} }; // rejected: no Set-Cookie
        }
        if (url.endsWith("/api/me/")) {
          meHeaders = headers;
          return { status: 401, data: "{}", headers: {} };
        }
        throw new Error(`unexpected ${url}`);
      },
    );

    const result = await signInWithMagicToken("22222222-3333-4444-8555-666666666666");
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    expect(meHeaders?.Cookie).toBeUndefined();
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({});
  });

  // The request-contract case the browser-fallback path needs: NextAuth's
  // own rejection signal (200 + `{url: "...?error=..."}`) must win even when
  // /api/me would STILL answer success — e.g. because a real browser cookie
  // from a previous session survives `clearAllLocalState()` (which can only
  // ever clear the native Preferences-backed jar, never actual browser
  // cookies in the dev-browser `fetch(..., {credentials:"include"})` path).
  // If this function trusted /api/me alone, a definite NextAuth rejection
  // would be silently overridden by that leftover session.
  it.each([200, 401])("callback rejection HTTP %i wins over a stale successful /api/me", async (status) => {
    let meWasCalled = false;
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
      }
      if (url.endsWith("/api/auth/callback/magic-token/")) {
        // NextAuth v4 rejects with 401; also cover a 200 error-URL response.
        return {
          status,
          data: JSON.stringify({
            url: "https://app.factorylm.com/login?error=CredentialsSignin",
          }),
          headers: {},
        };
      }
      if (url.endsWith("/api/me/")) {
        meWasCalled = true;
        // Simulates a leftover session (e.g. a real browser cookie the jar
        // wipe can't reach) that would otherwise read back as "signed in".
        return { status: 200, data: JSON.stringify({ id: "someone-else" }), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    const result = await signInWithMagicToken("33333333-4444-4555-8666-777777777777");
    expect(result).toEqual({ ok: false, reason: "invalid_token" });
    expect(meWasCalled).toBe(false);
  });

  // The success path must not regress: a callback url WITHOUT an error
  // param is not a rejection, and /api/me still runs as final confirmation.
  it("a callback url with no error param is not treated as a rejection", async () => {
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
      }
      if (url.endsWith("/api/auth/callback/magic-token/")) {
        return {
          status: 200,
          data: JSON.stringify({ url: "https://app.factorylm.com/feed" }),
          headers: { "Set-Cookie": "session-token=fresh; Path=/" },
        };
      }
      if (url.endsWith("/api/me/")) {
        return { status: 200, data: JSON.stringify({ id: "u1" }), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    await expect(signInWithMagicToken(TOKEN)).resolves.toEqual({ ok: true });
  });

  // #4470 F1 — the callback can successfully consume the invitation token
  // and set a fresh cookie, then a TRANSIENT network/server error on the
  // confirming /api/me can make the whole exchange report failure. A naive
  // retry (another signInWithMagicToken call) would wipe that fresh cookie
  // and resubmit the SAME token — which validateMagicToken already marked
  // used_at, so NextAuth would reject it forever. confirmInviteSession()
  // re-checks the SAME already-established session without either.
  it("F1: a transient /api/me failure after a successful exchange is retried via confirmInviteSession, without replaying the token", async () => {
    let callbackCalls = 0;
    let meCalls = 0;
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
      }
      if (url.endsWith("/api/auth/callback/magic-token/")) {
        callbackCalls += 1;
        return {
          status: 200,
          data: JSON.stringify({ url: "https://app.factorylm.com/feed" }),
          headers: { "Set-Cookie": "session-token=fresh; Path=/" },
        };
      }
      if (url.endsWith("/api/me/")) {
        meCalls += 1;
        // /api/me is a GET — client.ts's requestWithRetries already retries
        // GETs once on transport failure, so BOTH attempts must fail here to
        // actually exhaust that and surface as a network failure; the 3rd
        // call is confirmInviteSession's own (unretried-further) success.
        if (meCalls <= 2) throw new Error("socket reset");
        return { status: 200, data: JSON.stringify({ id: "u1" }), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    const first = await signInWithMagicToken("44444444-5555-4666-8777-888888888888");
    expect(first).toEqual({ ok: false, reason: "network", sessionEstablished: true });
    expect(callbackCalls).toBe(1);
    // The fresh cookie from the successful exchange must still be present —
    // exactly what a naive clearAllLocalState()+replay retry would destroy.
    expect(JSON.parse(state.data.get(JAR_KEY) ?? "null")).toEqual({
      "session-token": "fresh",
    });

    const retry = await confirmInviteSession();
    expect(retry).toEqual({ ok: true });
    expect(callbackCalls).toBe(1); // never replayed the already-consumed token
    expect(meCalls).toBe(3);
  });

  it("confirmInviteSession reports failure (not a magic bypass) when there is no established session", async () => {
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/me/")) return { status: 401, data: "{}", headers: {} };
      throw new Error(`unexpected ${url}`);
    });
    await expect(confirmInviteSession()).resolves.toEqual({
      ok: false,
      reason: "invalid_token",
    });
  });

  it("could_not_start when csrf itself cannot be obtained", async () => {
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: "{}", headers: {} }; // no csrfToken field
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(signInWithMagicToken(TOKEN)).resolves.toEqual({
      ok: false,
      reason: "could_not_start",
    });
  });

  it("classifies a transport failure as network, distinct from an invalid token", async () => {
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) throw new Error("socket reset");
      throw new Error(`unexpected ${url}`);
    });
    await expect(signInWithMagicToken(TOKEN)).resolves.toEqual({
      ok: false,
      reason: "network",
    });
  });
});

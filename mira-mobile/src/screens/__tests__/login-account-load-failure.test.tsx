// @vitest-environment jsdom
// #4774 (#4470 F6): App's real hydration contract — getMe() fails closed to
// null rather than throwing. A null account after a successful invite exchange
// must surface recovery (not stall silently), keep the fresh cookie, and the
// retry must confirm without replaying the consumed single-use token.
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { clearAllLocalState } from "../../api/client";
import { loadSignedInAccount } from "../../factorylm-ui/session/load-signed-in-account";
import { Login } from "../Login";

const INVITE = "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555";
const ME = { id: "u1", email: "tech@plant.example", role: "technician", tenantId: "t1" };

beforeEach(async () => {
  state.data.clear();
  state.httpRequest.mockReset();
  await clearAllLocalState();
});
afterEach(() => cleanup());

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

describe("Login with the real account-load contract (#4774)", () => {
  it("a null account after a successful invite exchange shows recovery, keeps the cookie, and retry loads without replaying the token", async () => {
    let callbacks = 0;
    let meCalls = 0;
    let accountApiDown = false;
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
      }
      if (url.endsWith("/api/auth/callback/magic-token/")) {
        callbacks += 1;
        return {
          status: 200,
          data: JSON.stringify({ url: "https://app.factorylm.com/feed" }),
          headers: { "Set-Cookie": "session-token=fresh; Path=/" },
        };
      }
      if (url.endsWith("/api/me/")) {
        meCalls += 1;
        // The exchange's own confirmation (call 1) succeeds; the account load
        // right after it hits an outage that lasts until the retry tap.
        if (accountApiDown && meCalls >= 2) throw new Error("network down");
        return { status: 200, data: JSON.stringify(ME), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });
    accountApiDown = true;

    const loaded: unknown[] = [];
    const onSignedIn = async () => {
      loaded.push(await loadSignedInAccount());
    };
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    fireEvent.change(screen.getByLabelText("Invitation link"), { target: { value: INVITE } });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });

    expect(callbacks).toBe(1);
    expect(loaded).toHaveLength(0);
    expect(screen.getByText(/account didn't finish loading/)).toBeTruthy();
    expect(screen.getByText("Finish signing in")).toBeTruthy();
    expect(state.data.get("flm.cookiejar.v1") ?? "").toContain("fresh");

    accountApiDown = false;
    await act(async () => {
      fireEvent.click(screen.getByText("Finish signing in"));
      await flush();
    });

    expect(callbacks).toBe(1);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ id: "u1" });
  });

  it("control: a healthy account load signs in on the first tap with no recovery message", async () => {
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
        return { status: 200, data: JSON.stringify(ME), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });
    const loaded: unknown[] = [];
    render(<Login onSignedIn={async () => void loaded.push(await loadSignedInAccount())} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    fireEvent.change(screen.getByLabelText("Invitation link"), { target: { value: INVITE } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(loaded).toHaveLength(1);
    expect(screen.queryByText(/account didn't finish loading/)).toBeNull();
  });

  it("password path: a null account after a good password shows a retry message instead of stalling silently", async () => {
    let meCalls = 0;
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      // signIn's own /api/me confirmation (call 1) succeeds; the account
      // load after it fails.
      if (url.endsWith("/api/me/")) {
        meCalls += 1;
        if (meCalls >= 2) throw new Error("network down");
        return { status: 200, data: JSON.stringify(ME), headers: {} };
      }
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
      }
      return {
        status: 200,
        data: JSON.stringify({ url: "https://app.factorylm.com/feed" }),
        headers: { "Set-Cookie": "session-token=fresh; Path=/" },
      };
    });
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      render(<Login onSignedIn={async () => void (await loadSignedInAccount())} />);
      fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value: "a@b.c" } });
      fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
        target: { value: "pw" },
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
        await flush();
      });
      expect(screen.getByText(/account didn't finish loading/)).toBeTruthy();
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});

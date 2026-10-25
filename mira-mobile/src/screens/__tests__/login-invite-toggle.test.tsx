// @vitest-environment jsdom
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
import { Login } from "../Login";

beforeEach(async () => {
  state.data.clear();
  state.httpRequest.mockReset();
  await clearAllLocalState();
});

afterEach(() => {
  cleanup();
});

describe("Login — invitation-link path (#4364)", () => {
  it("shows the password form by default (preserved password login)", () => {
    render(<Login onSignedIn={async () => {}} />);
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect(document.querySelector('input[type="password"]')).toBeTruthy();
  });

  it("toggling to the invite path explains no password is needed, and back again", () => {
    render(<Login onSignedIn={async () => {}} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    expect(screen.getByText(/No password needed/)).toBeTruthy();
    fireEvent.click(screen.getByText(/Have a password instead/));
    expect(document.querySelector('input[type="password"]')).toBeTruthy();
  });

  it("rejects a pasted untrusted-origin link WITHOUT making any network call", async () => {
    render(<Login onSignedIn={async () => {}} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));

    const textarea = screen.getByLabelText("Invitation link");
    fireEvent.change(textarea, {
      target: { value: "https://evil.example.com/hub/magic?token=11111111-2222-4333-8444-555555555555" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/doesn't point to FactoryLM/)).toBeTruthy();
    expect(state.httpRequest).not.toHaveBeenCalled();
  });

  it("the app-ready callback fires only after a successful new authentication", async () => {
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
      }
      if (url.endsWith("/api/auth/callback/magic-token/")) {
        return { status: 200, data: "{}", headers: {} }; // rejected token
      }
      if (url.endsWith("/api/me/")) {
        return { status: 401, data: "{}", headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    const onSignedIn = vi.fn(async () => {});
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));

    const textarea = screen.getByLabelText("Invitation link");
    fireEvent.change(textarea, {
      target: { value: "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555" },
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByText(/invalid, expired, or already used/)).toBeTruthy();
  });

  // #4470 F1 — a successful exchange followed by a transient /api/me failure
  // must be retriable without replaying the (already-consumed) token.
  it("F1: retry after a transient confirmation failure finishes sign-in, without replaying the token", async () => {
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
        if (meCalls <= 2) throw new Error("socket reset"); // exhausts the GET auto-retry
        return { status: 200, data: JSON.stringify({ id: "u1" }), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    const onSignedIn = vi.fn(async () => {});
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));

    const textarea = screen.getByLabelText("Invitation link");
    fireEvent.change(textarea, {
      target: {
        value: "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByText(/Network problem/)).toBeTruthy();
    expect(callbackCalls).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByText("Finish signing in"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(callbackCalls).toBe(1); // the already-consumed token was never resubmitted
  });

  // #4470 F2 — abandoning an in-flight attempt by switching modes must not
  // be possible: the toggle is disabled for the whole busy window of EITHER
  // flow, so a later-arriving response from an abandoned attempt can never
  // overwrite a different account's session or fire onSignedIn after it.
  it("F2: the password/invite toggle is disabled for the whole busy window of an invite attempt", async () => {
    let releaseCsrf: ((value: unknown) => void) | null = null;
    state.httpRequest.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return new Promise((resolve) => {
          releaseCsrf = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    render(<Login onSignedIn={async () => {}} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link");
    fireEvent.change(textarea, {
      target: {
        value: "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await Promise.resolve();
    });

    // CSRF is still pending (deliberately held open) — the attempt is busy.
    const toggle = screen.getByText(/Have a password instead/) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    // The click on a disabled button has no effect — still on the invite form.
    expect(screen.getByLabelText("Invitation link")).toBeTruthy();

    // Release the held request so no promise is left dangling after the test.
    await act(async () => {
      releaseCsrf?.({ status: 200, data: "{}", headers: {} }); // no csrfToken -> could_not_start
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("F2: the invite/password toggle is disabled for the whole busy window of a password attempt", async () => {
    let releaseCsrf: ((value: unknown) => void) | null = null;
    state.httpRequest.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return new Promise((resolve) => {
          releaseCsrf = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    render(<Login onSignedIn={async () => {}} />);
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "tech@example.com" } });
    fireEvent.change(inputs[1], { target: { value: "pw" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await Promise.resolve();
    });

    const toggle = screen.getByText(/Have an invitation link instead/) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    fireEvent.click(toggle);
    // Still on the password form — the click had no effect.
    expect(document.querySelector('input[type="password"]')).toBeTruthy();

    await act(async () => {
      releaseCsrf?.({ status: 200, data: "{}", headers: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  it("keeps password mode busy through account hydration", async () => {
    state.httpRequest.mockImplementation(async ({ url }: { url: string }) => ({
      status: 200,
      data: JSON.stringify(url.endsWith("/csrf/") ? { csrfToken: "c" } : { id: "u1", url: "https://app.factorylm.com/feed" }),
      headers: { "Set-Cookie": "session-token=fresh; Path=/" },
    }));
    let release!: () => void;
    const onSignedIn = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    render(<Login onSignedIn={onSignedIn} />);
    const inputs = document.querySelectorAll("input");
    fireEvent.change(inputs[0], { target: { value: "tech@example.com" } });
    fireEvent.change(inputs[1], { target: { value: "pw" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
    expect(onSignedIn).toHaveBeenCalledOnce();
    const toggle = screen.getByText(/Have an invitation link instead/) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    await act(async () => { release(); });
    expect(toggle.disabled).toBe(false);
  });

  // #4470 F2 gap (parent-found) — endBusy() used to run BEFORE awaiting
  // onSignedIn, so the mode toggle (and the textarea below) re-enabled
  // while the app was still hydrating the newly-signed-in account.
  it("F2 gap: busy stays active through onSignedIn (account hydration), not just the network exchange", async () => {
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

    let releaseHydration: (() => void) | null = null;
    const onSignedIn = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseHydration = resolve;
        }),
    );

    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // The network exchange + confirmation are fully done (onSignedIn was
    // already called), but account hydration is still pending — busy must
    // still be true: the mode toggle and the pasted-link input stay disabled.
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    const toggle = screen.getByText(/Have a password instead/) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(textarea.disabled).toBe(true);

    await act(async () => {
      releaseHydration?.();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toggle.disabled).toBe(false);
    expect(textarea.disabled).toBe(false);
  });

  // #4470 F2 gap — the pasted-link textarea itself must be disabled while an
  // exchange is pending, so a late-arriving result for token A can never
  // become the confirmation for a token B edited in while A was in flight.
  it("F2 gap: the pasted-link textarea is disabled while an exchange is pending", async () => {
    let releaseCsrf: ((value: unknown) => void) | null = null;
    state.httpRequest.mockImplementation(({ url }: { url: string }) => {
      if (url.endsWith("/api/auth/csrf/")) {
        return new Promise((resolve) => {
          releaseCsrf = resolve;
        });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    render(<Login onSignedIn={async () => {}} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link") as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: {
        value: "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await Promise.resolve();
    });

    // Real browsers refuse user keystrokes on a disabled textarea — the
    // `disabled` attribute reaching the DOM node is the actual guard; jsdom's
    // fireEvent dispatches a synthetic event directly and doesn't model that
    // native gating, so this asserts the attribute itself, which is what a
    // real device enforces.
    expect(textarea.disabled).toBe(true);

    await act(async () => {
      releaseCsrf?.({ status: 200, data: "{}", headers: {} });
      await Promise.resolve();
      await Promise.resolve();
    });
  });

  // Gate-7 (#4470): the parent's account hydration (onSignedIn -> getMe) can
  // throw AFTER the single-use token was exchanged. That must not escape as an
  // unhandled rejection or strand the technician: show a retry message, and
  // the retry re-confirms the session without resubmitting the spent token.
  it("hydration failure after a successful exchange is retriable without replaying the token", async () => {
    let callbackCalls = 0;
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
        return { status: 200, data: JSON.stringify({ id: "u1" }), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    const onSignedIn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("getMe network blip"))
      .mockResolvedValue(undefined);
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    fireEvent.change(screen.getByLabelText("Invitation link"), {
      target: {
        value: "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555",
      },
    });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/account didn't finish loading/)).toBeTruthy();
    expect(callbackCalls).toBe(1);

    await act(async () => {
      fireEvent.click(screen.getByText("Finish signing in"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(onSignedIn).toHaveBeenCalledTimes(2);
    expect(callbackCalls).toBe(1); // the consumed token was never resubmitted
  });

  // LOW (#4470): after hydration fails, any textarea onChange used to clear
  // sessionEstablished. A stray space then forced signInWithMagicToken, which
  // wipes the fresh cookie and replays the spent token. Only a different
  // invite token may drop the confirmation-retry path.
  it("a stray textarea edit after hydration failure does not replay the spent token", async () => {
    let callbackCalls = 0;
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
        return { status: 200, data: JSON.stringify({ id: "u1" }), headers: {} };
      }
      throw new Error(`unexpected ${url}`);
    });

    const invite =
      "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555";
    const onSignedIn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("getMe network blip"))
      .mockResolvedValue(undefined);
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: invite } });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/account didn't finish loading/)).toBeTruthy();
    expect(screen.getByText("Finish signing in")).toBeTruthy();
    expect(callbackCalls).toBe(1);

    fireEvent.change(textarea, { target: { value: `${invite} ` } });

    expect(screen.getByText("Finish signing in")).toBeTruthy();
    expect(screen.queryByText("Use invite link")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("Finish signing in"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(onSignedIn).toHaveBeenCalledTimes(2);
    expect(callbackCalls).toBe(1);
  });

  it("a different pasted invite after hydration failure starts a new exchange", async () => {
    let callbackTokens: string[] = [];
    state.httpRequest.mockImplementation(
      async ({ url, data }: { url: string; data?: string }) => {
        if (url.endsWith("/api/auth/csrf/")) {
          return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
        }
        if (url.endsWith("/api/auth/callback/magic-token/")) {
          callbackTokens.push(String(data ?? ""));
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
      },
    );

    const first =
      "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555";
    const second =
      "https://app.factorylm.com/hub/magic?token=22222222-3333-4444-8555-666666666666";
    const onSignedIn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("getMe network blip"))
      .mockResolvedValue(undefined);
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: first } });

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(screen.getByText("Finish signing in")).toBeTruthy();
    fireEvent.change(textarea, { target: { value: second } });
    expect(screen.getByText("Use invite link")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(callbackTokens).toHaveLength(2);
    expect(callbackTokens[1]).toContain("22222222-3333-4444-8555-666666666666");
    expect(onSignedIn).toHaveBeenCalledTimes(2);
  });
});

describe("Login — invite recovery is bound to the token that established it (#4470 round 2)", () => {
  const A = "https://app.factorylm.com/hub/magic?token=11111111-2222-4333-8444-555555555555";
  const B = "https://app.factorylm.com/hub/magic?token=22222222-3333-4444-8555-666666666666";

  function mockServer(callbackTokens: string[]) {
    state.httpRequest.mockImplementation(
      async ({ url, data }: { url: string; data?: string }) => {
        if (url.endsWith("/api/auth/csrf/")) {
          return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
        }
        if (url.endsWith("/api/auth/callback/magic-token/")) {
          callbackTokens.push(String(data ?? ""));
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
      },
    );
  }

  async function flush() {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  }

  it("F4: clearing the field and pasting invite B exchanges B, never confirms A's session", async () => {
    const callbackTokens: string[] = [];
    mockServer(callbackTokens);
    const onSignedIn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("getMe network blip"))
      .mockResolvedValue(undefined);
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: A } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(screen.getByText("Finish signing in")).toBeTruthy();

    // Clear first (the previous value has no token identity), then paste B.
    fireEvent.change(textarea, { target: { value: "" } });
    fireEvent.change(textarea, { target: { value: B } });
    expect(screen.queryByText("Finish signing in")).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(callbackTokens).toHaveLength(2);
    expect(callbackTokens[1]).toContain("22222222-3333-4444-8555-666666666666");
  });

  it("F4: an invalid link after hydration failure never confirms the earlier session", async () => {
    const callbackTokens: string[] = [];
    mockServer(callbackTokens);
    const onSignedIn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("getMe network blip"))
      .mockResolvedValue(undefined);
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    const textarea = screen.getByLabelText("Invitation link") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: A } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    fireEvent.change(textarea, { target: { value: "not a link" } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
    expect(callbackTokens).toHaveLength(1);
  });

  it("F1: switching modes and back keeps the recovery state; retry does not replay the token or drop the cookie", async () => {
    const callbackTokens: string[] = [];
    mockServer(callbackTokens);
    const onSignedIn = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("getMe network blip"))
      .mockResolvedValue(undefined);
    render(<Login onSignedIn={onSignedIn} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    fireEvent.change(screen.getByLabelText("Invitation link"), { target: { value: A } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(screen.getByText("Finish signing in")).toBeTruthy();

    fireEvent.click(screen.getByText(/Have a password instead/));
    fireEvent.click(screen.getByText(/Have an invitation link instead/));

    expect((screen.getByLabelText("Invitation link") as HTMLTextAreaElement).value).toBe(A);
    await act(async () => {
      fireEvent.click(screen.getByText("Finish signing in"));
      await flush();
    });
    expect(callbackTokens).toHaveLength(1);
    expect(onSignedIn).toHaveBeenCalledTimes(2);
    expect(state.data.get("flm.cookiejar.v1") ?? "").toContain("fresh");
  });
});

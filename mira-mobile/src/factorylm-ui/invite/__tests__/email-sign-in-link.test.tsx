// @vitest-environment jsdom
// #5942: a passwordless technician gets from the sign-in screen to a session on
// their own: "Email me a sign-in link", then paste the emailed link. Mocked
// transport only; no real Hub, no real mail.
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

import { clearAllLocalState } from "../../../api/client";
import { loadSignedInAccount } from "../../session/load-signed-in-account";
import { Login } from "../../../screens/Login";
import { EmailSignInLink } from "../EmailSignInLink";
import { __resetSignInLinkForTests } from "../sign-in-link-controller";

const TOKEN = "11111111-2222-4333-8444-555555555555";
// The shape the Hub emails (magic-link-return.ts magicLinkUrl): ?next= then #token=.
const EMAILED = `https://app.factorylm.com/hub/magic/?next=%2Fv3%2Fsource%2F%3Ffile%3Dabc#token=${TOKEN}`;
const EMAIL = "stranger@plant.example";
const ME = { id: "u1", email: EMAIL, role: "technician", tenantId: "t1" };

type Call = { url: string; method?: string; data?: string };
let calls: Call[] = [];
let linkStatus = 200;
let callbacks = 0;
let accountDown = false;

beforeEach(async () => {
  state.data.clear();
  state.httpRequest.mockReset();
  await clearAllLocalState();
  __resetSignInLinkForTests();
  calls = [];
  linkStatus = 200;
  callbacks = 0;
  accountDown = false;
  state.httpRequest.mockImplementation(async (c: Call) => {
    calls.push(c);
    if (c.url.endsWith("/api/auth/magic-link/")) {
      return { status: linkStatus, data: JSON.stringify(linkStatus === 200 ? { ok: true } : { error: "x" }), headers: {} };
    }
    if (c.url.endsWith("/api/auth/csrf/")) {
      return { status: 200, data: JSON.stringify({ csrfToken: "c" }), headers: {} };
    }
    if (c.url.endsWith("/api/auth/callback/magic-token/")) {
      callbacks += 1;
      return {
        status: 200,
        data: JSON.stringify({ url: "https://app.factorylm.com/feed" }),
        headers: { "Set-Cookie": "session-token=fresh; Path=/" },
      };
    }
    if (c.url.endsWith("/api/me/")) {
      // The exchange's own confirmation always succeeds; every later account
      // load (including the client's one GET retry) fails while accountDown.
      const confirming = calls.filter((x) => x.url.endsWith("/api/me/")).length === 1;
      if (!confirming && accountDown) throw new Error("network down");
      return { status: 200, data: JSON.stringify(ME), headers: {} };
    }
    throw new Error(`unexpected ${c.url}`);
  });
});
afterEach(() => cleanup());

async function flush() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve();
}

function typeEmail(value: string) {
  fireEvent.change(screen.getAllByRole("textbox")[0], { target: { value } });
}

async function requestLink() {
  await act(async () => {
    fireEvent.click(screen.getByText("Email me a sign-in link"));
    await flush();
  });
}

const linkPosts = () => calls.filter((c) => c.url.endsWith("/api/auth/magic-link/"));

describe("Email me a sign-in link (#5942)", () => {
  it("the default screen keeps exactly one text field, so the email field stays unambiguous", () => {
    render(<Login onSignedIn={async () => {}} />);
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByText("Email")).toBeTruthy();
    expect(screen.getByText("Sign in", { selector: "button" })).toBeTruthy();
    expect(screen.getByText(/Have an invitation link instead/)).toBeTruthy();
  });

  it("is disabled until an email is typed, then posts that email once and says so neutrally", async () => {
    render(<Login onSignedIn={async () => {}} />);
    const button = screen.getByText("Email me a sign-in link") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    typeEmail(`  ${EMAIL} `);
    expect(button.disabled).toBe(false);
    await requestLink();
    expect(linkPosts()).toHaveLength(1);
    expect(linkPosts()[0].method).toBe("POST");
    expect(JSON.parse(linkPosts()[0].data ?? "{}")).toEqual({ email: EMAIL });
    expect(screen.getByText(new RegExp(`^Request received for ${EMAIL}`))).toBeTruthy();
  });

  it("a double tap sends one request", async () => {
    let release: () => void = () => {};
    state.httpRequest.mockImplementation(
      (c: Call) =>
        new Promise((resolve) => {
          calls.push(c);
          release = () => resolve({ status: 200, data: JSON.stringify({ ok: true }), headers: {} });
        }),
    );
    render(<Login onSignedIn={async () => {}} />);
    typeEmail(EMAIL);
    await act(async () => {
      fireEvent.click(screen.getByText("Email me a sign-in link"));
      await flush();
    });
    const sending = screen.getByText("Sending…") as HTMLButtonElement;
    expect(sending.disabled).toBe(true);
    fireEvent.click(sending);
    await act(async () => {
      release();
      await flush();
    });
    expect(linkPosts()).toHaveLength(1);
  });

  it("the notice acknowledges the request and promises no email (Codex r1 F2, r2 F2)", async () => {
    render(<Login onSignedIn={async () => {}} />);
    typeEmail(EMAIL);
    await requestLink();
    const notice = screen.getByText(/^Request received for /).textContent ?? "";
    expect(notice).toBe(
      `Request received for ${EMAIL}. If a sign-in link arrives, it works once, for 15 minutes: open the email, copy the link, then paste it here. No email after a few minutes? Check spam, request another link, or contact support@factorylm.com.`,
    );
    expect(notice).not.toMatch(/we'll|on its way|will (be )?(sent|emailed)/i);
    expect(screen.getByText(/^No password\?/).textContent).not.toMatch(/we'll|we will/i);
  });

  it("a stalled request leaves the paste route open, so an earlier link still works (Codex r2 F5)", async () => {
    let release: () => void = () => {};
    const base = state.httpRequest.getMockImplementation()!;
    state.httpRequest.mockImplementation((c: Call) => {
      if (!c.url.endsWith("/api/auth/magic-link/")) return base(c);
      calls.push(c);
      return new Promise((resolve) => {
        release = () => resolve({ status: 200, data: JSON.stringify({ ok: true }), headers: {} });
      });
    });
    const loaded: unknown[] = [];
    render(<Login onSignedIn={async () => void loaded.push(await loadSignedInAccount())} />);
    typeEmail(EMAIL);
    await act(async () => {
      fireEvent.click(screen.getByText("Email me a sign-in link"));
      await flush();
    });
    const toggle = screen.getByText(/Have an invitation link instead/) as HTMLButtonElement;
    expect(toggle.disabled).toBe(false);
    fireEvent.click(toggle);
    fireEvent.change(screen.getByLabelText("Invitation link"), { target: { value: EMAILED } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(loaded).toHaveLength(1);
    expect(linkPosts()).toHaveLength(1);
  });

  it("a request pending across a mode switch cannot be sent again, and its result survives (Codex r1 F1, r2 F5)", async () => {
    let release: () => void = () => {};
    const base = state.httpRequest.getMockImplementation()!;
    state.httpRequest.mockImplementation((c: Call) => {
      if (!c.url.endsWith("/api/auth/magic-link/")) return base(c);
      calls.push(c);
      return new Promise((resolve) => {
        release = () => resolve({ status: 200, data: JSON.stringify({ ok: true }), headers: {} });
      });
    });
    render(<Login onSignedIn={async () => {}} />);
    typeEmail(EMAIL);
    await act(async () => {
      fireEvent.click(screen.getByText("Email me a sign-in link"));
      await flush();
    });
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    fireEvent.click(screen.getByText(/Have a password instead/));
    typeEmail(EMAIL);
    const sending = screen.getByText("Sending…") as HTMLButtonElement;
    expect(sending.disabled).toBe(true);
    fireEvent.click(sending);
    await act(async () => {
      release();
      await flush();
    });
    expect(linkPosts()).toHaveLength(1);
    expect(screen.getByText(/^Request received for /)).toBeTruthy();
  });

  it("a late refusal for an address since corrected is not shown against the new one (Codex r2 F6)", async () => {
    let release: () => void = () => {};
    state.httpRequest.mockImplementation((c: Call) => {
      calls.push(c);
      return new Promise((resolve) => {
        release = () => resolve({ status: 400, data: JSON.stringify({ error: "Valid email required" }), headers: {} });
      });
    });
    render(<Login onSignedIn={async () => {}} />);
    typeEmail("not-an-address");
    await act(async () => {
      fireEvent.click(screen.getByText("Email me a sign-in link"));
      await flush();
    });
    typeEmail(EMAIL);
    await act(async () => {
      release();
      await flush();
    });
    expect(screen.queryByText("Enter a valid email address.")).toBeNull();
    expect((screen.getByText("Email me a sign-in link") as HTMLButtonElement).disabled).toBe(false);
    typeEmail("not-an-address");
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
  });

  it("mounted on its own, a double tap still sends one request", async () => {
    let release: () => void = () => {};
    state.httpRequest.mockImplementation(
      (c: Call) =>
        new Promise((resolve) => {
          calls.push(c);
          release = () => resolve({ status: 200, data: JSON.stringify({ ok: true }), headers: {} });
        }),
    );
    render(<EmailSignInLink email={EMAIL} disabled={false} onHaveLink={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByText("Email me a sign-in link"));
      await flush();
    });
    fireEvent.click(screen.getByText("Sending…"));
    await act(async () => {
      release();
      await flush();
    });
    expect(linkPosts()).toHaveLength(1);
  });

  it("a refused request shows its reason and no sent notice", async () => {
    linkStatus = 429;
    render(<Login onSignedIn={async () => {}} />);
    typeEmail(EMAIL);
    await requestLink();
    expect(screen.getByText(/Too many sign-in links requested/)).toBeTruthy();
    expect(screen.queryByText(/^Request received for /)).toBeNull();
    expect(screen.queryByText("Paste the link from the email")).toBeNull();
  });

  it("editing the email after sending hides the notice that names the old address", async () => {
    render(<Login onSignedIn={async () => {}} />);
    typeEmail(EMAIL);
    await requestLink();
    expect(screen.getByText(/^Request received for /)).toBeTruthy();
    typeEmail("other@plant.example");
    expect(screen.queryByText(/^Request received for /)).toBeNull();
  });

  it("the whole stranger path: request, paste the emailed fragment link, signed in", async () => {
    const loaded: unknown[] = [];
    render(<Login onSignedIn={async () => void loaded.push(await loadSignedInAccount())} />);
    typeEmail(EMAIL);
    await requestLink();
    fireEvent.click(screen.getByText("Paste the link from the email"));
    expect(screen.getByText("Use an invitation link")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Invitation link"), { target: { value: EMAILED } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    const exchange = calls.find((c) => c.url.endsWith("/api/auth/callback/magic-token/"));
    expect(exchange?.data).toContain(`token=${TOKEN}`);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toMatchObject({ email: EMAIL });
  });

  it("a failed account load after an emailed-link sign-in retries without replaying the spent token", async () => {
    accountDown = true;
    const loaded: unknown[] = [];
    render(<Login onSignedIn={async () => void loaded.push(await loadSignedInAccount())} />);
    fireEvent.click(screen.getByText(/Have an invitation link instead/));
    fireEvent.change(screen.getByLabelText("Invitation link"), { target: { value: EMAILED } });
    await act(async () => {
      fireEvent.click(screen.getByText("Use invite link"));
      await flush();
    });
    expect(callbacks).toBe(1);
    expect(loaded).toHaveLength(0);
    expect(screen.getByText("Finish signing in")).toBeTruthy();
    accountDown = false;
    await act(async () => {
      fireEvent.click(screen.getByText("Finish signing in"));
      await flush();
    });
    expect(callbacks).toBe(1);
    expect(loaded).toHaveLength(1);
  });
});

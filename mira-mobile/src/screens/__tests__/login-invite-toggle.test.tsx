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
});

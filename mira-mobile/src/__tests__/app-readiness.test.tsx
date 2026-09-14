// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, storage } = vi.hoisted(() => ({
  storage: {
    get: vi.fn(async () => ({ value: null as string | null })),
  },
  api: {
  getMe: vi.fn(),
    signIn: vi.fn(),
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    minimizeApp: vi.fn(async () => undefined),
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    convertFileSrc: (path: string) => path,
    isNativePlatform: () => true,
  },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: storage.get,
    set: vi.fn(async () => undefined),
  },
}));

vi.mock("../api/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resources")>();
  return { ...actual, getMe: api.getMe, signIn: api.signIn };
});

import App from "../App";

beforeEach(() => {
  vi.useFakeTimers();
  api.getMe.mockReset();
  api.signIn.mockReset();
  storage.get.mockReset().mockResolvedValue({ value: null });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("App OTA readiness deadline", () => {
  it("acknowledges a committed local boot shell before slow auth can exceed the native timeout", async () => {
    api.getMe.mockReturnValue(new Promise(() => {}));
    const onBundleReady = vi.fn(async () => undefined);

    render(<App onBundleReady={onBundleReady} />);
    expect(screen.getByText("FactoryLM…")).toBeTruthy();
    expect(onBundleReady).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });

    expect(onBundleReady).toHaveBeenCalledTimes(1);
    expect(screen.getByText("FactoryLM…")).toBeTruthy();
  });

  // #3799: with the Hub unreachable, getMe() takes 30 s to 3 min. The placeholder
  // must not be the whole UI for that long — boot signed-out at the deadline.
  it("boots signed-out when auth has not answered by the boot deadline", async () => {
    api.getMe.mockReturnValue(new Promise(() => {}));

    render(<App onBundleReady={vi.fn(async () => undefined)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(7_900);
    });
    expect(screen.getByText("FactoryLM…")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(screen.queryByText("FactoryLM…")).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("still signs the session in when auth answers after the boot deadline", async () => {
    let answer: (me: unknown) => void = () => {};
    api.getMe.mockReturnValue(new Promise((resolve) => (answer = resolve)));

    render(<App onBundleReady={vi.fn(async () => undefined)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();

    await act(async () => {
      answer({
        id: "u1",
        email: "tech@example.com",
        name: "Tech",
        role: "technician",
        tenantId: "t1",
        capabilities: [],
      });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  it("does not let a late boot answer undo a sign-in made after the deadline", async () => {
    const me = {
      id: "u1",
      email: "tech@example.com",
      name: "Tech",
      role: "technician",
      tenantId: "t1",
      capabilities: [],
    };
    let answerBoot: (me: unknown) => void = () => {};
    api.getMe
      .mockReturnValueOnce(new Promise((resolve) => (answerBoot = resolve)))
      .mockResolvedValueOnce(me);
    api.signIn.mockResolvedValue({ ok: true });

    render(<App onBundleReady={vi.fn(async () => undefined)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    const [email, password] = Array.from(document.querySelectorAll("input"));
    fireEvent.change(email, { target: { value: "tech@example.com" } });
    fireEvent.change(password, { target: { value: "pw" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
    expect(api.getMe).toHaveBeenCalledTimes(2);

    await act(async () => {
      answerBoot(null); // the stale pre-login answer (or a stale 401)
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole("button", { name: "Sign in" })).toBeNull();
  });

  // #3799 F1 (Codex r4): with a session persisted for tenant A, a boot getMe()
  // that answers LATE must never render tenant A while a DIFFERENT sign-in is
  // still pending — otherwise the boot answer exposes the previous account.
  it("does not render the previous account when a late boot answer lands during a pending sign-in", async () => {
    const tenantA = {
      id: "ownerA",
      email: "owner@example.com",
      name: "Owner A",
      role: "owner",
      tenantId: "tenantA",
      capabilities: [],
    };
    let answerBoot: (me: unknown) => void = () => {};
    api.getMe.mockReturnValueOnce(new Promise((resolve) => (answerBoot = resolve)));
    // Tenant B's sign-in never resolves within the test — it stays pending.
    api.signIn.mockReturnValue(new Promise(() => {}));

    render(<App onBundleReady={vi.fn(async () => undefined)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    const [email, password] = Array.from(document.querySelectorAll("input"));
    fireEvent.change(email, { target: { value: "carlos@example.com" } });
    fireEvent.change(password, { target: { value: "pw" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await Promise.resolve();
    });

    // The boot getMe() for tenant A resolves LATE while tenant B is still authenticating.
    await act(async () => {
      answerBoot(tenantA);
      await Promise.resolve();
      await Promise.resolve();
    });

    // Tenant A must NOT be rendered — the shell stays on the sign-in surface.
    expect(document.body.textContent).not.toContain("Owner A");
    expect(document.body.textContent).not.toContain("owner@example.com");
    expect(document.querySelector("input")).toBeTruthy(); // still the Login form
  });

  it("does not render the previous account when a late boot answer lands after a failed sign-in", async () => {
    const tenantA = {
      id: "ownerA",
      email: "owner@example.com",
      name: "Owner A",
      role: "owner",
      tenantId: "tenantA",
      capabilities: [],
    };
    let answerBoot: (me: unknown) => void = () => {};
    api.getMe.mockReturnValueOnce(new Promise((resolve) => (answerBoot = resolve)));
    api.signIn.mockResolvedValue({ ok: false, reason: "invalid_credentials" });

    render(<App onBundleReady={vi.fn(async () => undefined)} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_100);
    });
    const [email, password] = Array.from(document.querySelectorAll("input"));
    fireEvent.change(email, { target: { value: "carlos@example.com" } });
    fireEvent.change(password, { target: { value: "wrong" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
      await Promise.resolve();
      await Promise.resolve();
    });

    // Sign-in failed; the boot getMe() for tenant A then resolves late.
    await act(async () => {
      answerBoot(tenantA);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.body.textContent).not.toContain("Owner A");
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("does not wait for the deadline when auth answers promptly", async () => {
    api.getMe.mockResolvedValue(null);

    render(<App onBundleReady={vi.fn(async () => undefined)} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
  });

  it("acknowledges the committed Login shell once boot resolves signed-out", async () => {
    storage.get.mockResolvedValue({ value: null });
    api.getMe.mockResolvedValue(null);
    const onBundleReady = vi.fn(async () => undefined);

    render(<App onBundleReady={onBundleReady} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(onBundleReady).toHaveBeenCalledTimes(1);
  });
});

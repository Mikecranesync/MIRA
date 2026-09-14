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

// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { api, storage } = vi.hoisted(() => ({
  storage: {
    get: vi.fn(async () => ({ value: null as string | null })),
  },
  api: {
  getMe: vi.fn(),
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
  return { ...actual, getMe: api.getMe };
});

import App from "../App";

beforeEach(() => {
  vi.useFakeTimers();
  api.getMe.mockReset();
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

  it("defaults an unreadable saved tab instead of confirming an endless loading screen", async () => {
    storage.get
      .mockResolvedValueOnce({ value: null })
      .mockRejectedValueOnce(new Error("saved tab unavailable"))
      .mockResolvedValueOnce({ value: null });
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

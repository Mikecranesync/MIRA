// @vitest-environment jsdom
import { act, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const boot = vi.hoisted(() => ({
  getMe: vi.fn(),
  confirmBundleReady: vi.fn(async () => undefined),
  recoverToPackaged: vi.fn(async () => undefined),
  exitApp: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    convertFileSrc: (path: string) => path,
    getPlatform: () => "android",
    isNativePlatform: () => true,
  },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    exitApp: boot.exitApp,
    getLaunchUrl: vi.fn(async () => null),
    minimizeApp: vi.fn(async () => undefined),
  },
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    keys: vi.fn(async () => ({ keys: [] })),
    remove: vi.fn(async () => undefined),
    set: vi.fn(async () => undefined),
  },
}));

vi.mock("../api/resources", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/resources")>();
  return { ...actual, getMe: boot.getMe };
});

vi.mock("../screens/Login", () => ({
  Login: () => {
    throw new Error("selected root failed after delayed auth");
  },
}));

vi.mock("../lib/live-update", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/live-update")>();
  return {
    ...actual,
    confirmBundleReady: boot.confirmBundleReady,
    recoverToPackaged: boot.recoverToPackaged,
  };
});

describe("mobile boot recovery after the local readiness deadline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="root"></div>';
    boot.confirmBundleReady.mockClear();
    boot.recoverToPackaged.mockClear();
    boot.exitApp.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("offers packaged recovery when the selected root fails after slow auth", async () => {
    let resolveAuth!: (value: null) => void;
    boot.getMe.mockReturnValue(
      new Promise<null>((resolve) => {
        resolveAuth = resolve;
      }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    const silenceExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", silenceExpectedRenderError);

    try {
      await act(async () => {
        await import("../main");
        await Promise.resolve();
      });
      expect(screen.getByText("FactoryLM…")).toBeTruthy();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6_000);
      });
      expect(boot.confirmBundleReady).toHaveBeenCalledTimes(1);

      await act(async () => {
        resolveAuth(null);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(screen.getByRole("alert").textContent).toContain(
        "FactoryLM could not start",
      );
      expect(screen.queryByText(/will roll back automatically/i)).toBeNull();

      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Recover packaged version and restart" }),
        );
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(boot.recoverToPackaged).toHaveBeenCalledTimes(1);
      expect(boot.exitApp).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("error", silenceExpectedRenderError);
    }
  });
});

// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const bootstrap = vi.hoisted(() => ({
  confirmBundleReady: vi.fn<() => Promise<void>>(),
  recoverToPackaged: vi.fn<() => Promise<void>>(),
  readBundleRestartState: vi.fn<() => Promise<{
    currentBundleId: string;
    pendingBundleId: string | null;
  }>>(),
  exitApp: vi.fn<() => Promise<void>>(),
  readinessSawCommittedRoot: [] as boolean[],
  bootMode: "ready" as "ready" | "immediate-failure" | "delayed-failure",
  placeholderCommitted: false,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
    exitApp: bootstrap.exitApp,
    getLaunchUrl: vi.fn(async () => null),
  },
}));

vi.mock("../App", async () => {
  const React = await import("react");
  return {
    default: ({ onBundleReady }: { onBundleReady?: () => void }) => {
      const [hydrated, setHydrated] = React.useState(
        bootstrap.bootMode !== "delayed-failure",
      );
      const acknowledged = React.useRef(false);

      React.useEffect(() => {
        if (bootstrap.bootMode === "delayed-failure") {
          bootstrap.placeholderCommitted = true;
          setHydrated(true);
        }
      }, []);

      React.useEffect(() => {
        if (hydrated && bootstrap.bootMode === "ready" && !acknowledged.current) {
          acknowledged.current = true;
          onBundleReady?.();
        }
      }, [hydrated, onBundleReady]);

      if (!hydrated) return <div data-testid="boot-placeholder">FactoryLM…</div>;
      if (bootstrap.bootMode !== "ready") throw new Error("candidate render failed");
      return <main data-testid="canonical-root">FactoryLM</main>;
    },
    handleDeepLink: vi.fn(),
  };
});

vi.mock("../lib/live-update", () => ({
  confirmBundleReady: bootstrap.confirmBundleReady,
  readBundleRestartState: bootstrap.readBundleRestartState,
  recoverToPackaged: bootstrap.recoverToPackaged,
}));

vi.mock("../lib/resume-guard", () => ({
  installResumeGuard: vi.fn(),
}));

beforeEach(() => {
  vi.resetModules();
  bootstrap.bootMode = "ready";
  bootstrap.placeholderCommitted = false;
  bootstrap.readinessSawCommittedRoot.length = 0;
  bootstrap.confirmBundleReady.mockReset().mockImplementation(async () => {
    bootstrap.readinessSawCommittedRoot.push(
      document.querySelector('[data-testid="canonical-root"]') !== null,
    );
  });
  bootstrap.recoverToPackaged.mockReset().mockResolvedValue(undefined);
  bootstrap.readBundleRestartState.mockReset().mockResolvedValue({
    currentBundleId: "candidate-bundle",
    pendingBundleId: null,
  });
  bootstrap.exitApp.mockReset().mockResolvedValue(undefined);
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("mobile OTA boot readiness", () => {
  it("acknowledges the bundle only after the canonical root has committed", async () => {
    await import("../main");

    await waitFor(() => expect(bootstrap.confirmBundleReady).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId("canonical-root")).toBeTruthy();
    expect(bootstrap.readinessSawCommittedRoot).toEqual([true]);
  });

  it("keeps the candidate unacknowledged when the app throws during render", async () => {
    bootstrap.bootMode = "immediate-failure";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const silenceExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", silenceExpectedRenderError);

    try {
      await import("../main");

      expect((await screen.findByRole("alert")).textContent).toContain(
        "Recover the version packaged with the app",
      );
      expect(bootstrap.confirmBundleReady).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", silenceExpectedRenderError);
    }
  });

  it("keeps rollback armed when the hydrated root fails after the loading placeholder", async () => {
    bootstrap.bootMode = "delayed-failure";
    vi.spyOn(console, "error").mockImplementation(() => {});
    const silenceExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", silenceExpectedRenderError);

    try {
      await import("../main");

      expect((await screen.findByRole("alert")).textContent).toContain(
        "Recover the version packaged with the app",
      );
      expect(bootstrap.placeholderCommitted).toBe(true);
      expect(bootstrap.confirmBundleReady).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", silenceExpectedRenderError);
    }
  });

  it("reconciles a committed packaged reset after the bridge loses its response", async () => {
    bootstrap.bootMode = "immediate-failure";
    bootstrap.recoverToPackaged.mockRejectedValueOnce(new Error("reset response lost"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const silenceExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", silenceExpectedRenderError);

    try {
      await import("../main");
      fireEvent.click(
        await screen.findByRole("button", { name: "Recover packaged version and restart" }),
      );

      await waitFor(() => expect(bootstrap.exitApp).toHaveBeenCalledTimes(1));
      expect(bootstrap.readBundleRestartState).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(/Recovery could not be prepared/)).toBeNull();
    } finally {
      window.removeEventListener("error", silenceExpectedRenderError);
    }
  });

  it("reports a prepared recovery truthfully when native restart fails", async () => {
    bootstrap.bootMode = "immediate-failure";
    bootstrap.exitApp.mockRejectedValueOnce(new Error("exit unavailable"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const silenceExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", silenceExpectedRenderError);

    try {
      await import("../main");
      fireEvent.click(
        await screen.findByRole("button", { name: "Recover packaged version and restart" }),
      );

      expect(
        await screen.findByText(
          "Packaged recovery is ready. Close and reopen FactoryLM to finish.",
        ),
      ).toBeTruthy();
      expect(screen.queryByText(/Recovery could not be prepared/)).toBeNull();
      expect(bootstrap.recoverToPackaged).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole("button", { name: "Restart FactoryLM" }));
      await waitFor(() => expect(bootstrap.exitApp).toHaveBeenCalledTimes(2));
      expect(bootstrap.recoverToPackaged).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("error", silenceExpectedRenderError);
    }
  });

  it("does not restart when a rejected reset is proven not to have committed", async () => {
    bootstrap.bootMode = "immediate-failure";
    bootstrap.recoverToPackaged.mockRejectedValueOnce(new Error("reset rejected"));
    bootstrap.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "candidate-bundle",
      pendingBundleId: "candidate-bundle",
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const silenceExpectedRenderError = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", silenceExpectedRenderError);

    try {
      await import("../main");
      fireEvent.click(
        await screen.findByRole("button", { name: "Recover packaged version and restart" }),
      );

      expect(await screen.findByText(/Recovery could not be prepared/)).toBeTruthy();
      expect(bootstrap.exitApp).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", silenceExpectedRenderError);
    }
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ota = vi.hoisted(() => ({
  nativePlatform: { value: true },
  checkAndStage: vi.fn(async () => ({
    staged: null as string | null,
    reason: "no_update",
  })),
  currentBundleId: vi.fn(async () => "packaged"),
  pendingBundleId: vi.fn(async () => null as string | null),
  readBundleRestartState: vi.fn(async () => ({
    currentBundleId: "packaged",
    pendingBundleId: null as string | null,
  })),
  readOtaChannel: vi.fn(async () => "production"),
  recoverToPackaged: vi.fn<() => Promise<void>>(async () => undefined),
  writeOtaChannel: vi.fn(async () => undefined),
  getInfo: vi.fn(async () => ({
    id: "com.factorylm.mira",
    name: "FactoryLM",
    version: "1.1.0",
    build: "10",
  })),
  exitApp: vi.fn(async () => undefined),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    exitApp: ota.exitApp,
    getInfo: ota.getInfo,
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: () => (ota.nativePlatform.value ? "android" : "web"),
    isNativePlatform: () => ota.nativePlatform.value,
  },
}));

vi.mock("../../lib/live-update", () => ({
  NATIVE_FINGERPRINT: "0123456789abcdef",
  checkAndStage: ota.checkAndStage,
  currentBundleId: ota.currentBundleId,
  pendingBundleId: ota.pendingBundleId,
  readBundleRestartState: ota.readBundleRestartState,
  readOtaChannel: ota.readOtaChannel,
  recoverToPackaged: ota.recoverToPackaged,
  writeOtaChannel: ota.writeOtaChannel,
}));

vi.mock("../../screens/AboutUpdates", () => {
  throw new Error("the canonical updates surface must not import legacy presentation");
});

import { UnifiedAboutUpdates } from "../UnifiedAboutUpdates";

beforeEach(() => {
  vi.clearAllMocks();
  ota.nativePlatform.value = true;
  ota.checkAndStage.mockReset().mockResolvedValue({ staged: null, reason: "no_update" });
  ota.currentBundleId.mockReset().mockResolvedValue("packaged");
  ota.pendingBundleId.mockReset().mockResolvedValue(null);
  ota.readBundleRestartState.mockReset().mockResolvedValue({
    currentBundleId: "packaged",
    pendingBundleId: null,
  });
  ota.readOtaChannel.mockReset().mockResolvedValue("production");
  ota.recoverToPackaged.mockReset().mockResolvedValue(undefined);
  ota.writeOtaChannel.mockReset().mockResolvedValue(undefined);
  ota.getInfo.mockReset().mockResolvedValue({
    id: "com.factorylm.mira",
    name: "FactoryLM",
    version: "1.1.0",
    build: "10",
  });
  ota.exitApp.mockReset().mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("Unified About & Updates channel enrollment", () => {
  it("renders the canonical update surface without loading the legacy screen", async () => {
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    expect(await screen.findByRole("heading", { name: "About & updates" })).toBeTruthy();
    expect(screen.getByText("App version", { exact: false })).toBeTruthy();
    expect(screen.getByText("Active bundle", { exact: false })).toBeTruthy();
  });

  it("requires confirmation before persisting explicit canary enrollment", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);
    const enroll = await screen.findByRole("button", { name: "Enroll in canary updates" });

    fireEvent.click(enroll);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(ota.writeOtaChannel).not.toHaveBeenCalled();

    fireEvent.click(enroll);
    await waitFor(() => expect(ota.writeOtaChannel).toHaveBeenCalledWith("canary"));
    expect(await screen.findByText("canary")).toBeTruthy();
  });

  it("accepts a channel write that committed before the native bridge rejected", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ota.writeOtaChannel.mockRejectedValueOnce(new Error("bridge response lost"));
    ota.readOtaChannel
      .mockResolvedValueOnce("production")
      .mockResolvedValueOnce("canary");
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enroll in canary updates" }));

    expect(await screen.findByText("canary")).toBeTruthy();
    expect(screen.getByText("This device is enrolled in canary updates.")).toBeTruthy();
    expect(ota.readOtaChannel).toHaveBeenCalledTimes(2);
  });

  it("reports a rejected channel write as unchanged only after rereading the old value", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ota.writeOtaChannel.mockRejectedValueOnce(new Error("write rejected"));
    ota.readOtaChannel
      .mockResolvedValueOnce("production")
      .mockResolvedValueOnce("production");
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enroll in canary updates" }));

    expect(
      await screen.findByText("Could not save canary enrollment. This device remains on production."),
    ).toBeTruthy();
    expect(ota.readOtaChannel).toHaveBeenCalledTimes(2);
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("locks update controls when a rejected channel write cannot be reconciled", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ota.writeOtaChannel.mockRejectedValueOnce(new Error("write outcome unknown"));
    ota.readOtaChannel
      .mockResolvedValueOnce("production")
      .mockRejectedValueOnce(new Error("channel state unavailable"));
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Enroll in canary updates" }));

    expect(
      await screen.findByText(
        "Could not verify this device's update channel. Restart the app before checking for updates.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.queryByRole("button", { name: "Enroll in canary updates" })).toBeNull();
  });

  it("locks the channel after staging so Restart cannot apply a differently labelled bundle", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    ota.checkAndStage.mockResolvedValueOnce({
      staged: "1.1.9-canary-deadbeef",
      reason: "staged",
    });
    ota.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "packaged",
      pendingBundleId: "1.1.9-canary-deadbeef",
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
    expect(await screen.findByText("Update ready")).toBeTruthy();

    const enroll = screen.getByRole("button", { name: "Enroll in canary updates" });
    expect((enroll as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText("Restart or recover the staged update before changing channels."),
    ).toBeTruthy();
    fireEvent.click(enroll);
    expect(ota.writeOtaChannel).not.toHaveBeenCalled();
  });

  it("keeps Restart disabled while packaged recovery is still changing the restart target", async () => {
    let finishRecovery!: () => void;
    ota.recoverToPackaged.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishRecovery = resolve; }),
    );
    ota.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "packaged",
      pendingBundleId: "1.1.9-canary-deadbeef",
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    const restart = await screen.findByRole("button", { name: "Restart to finish updating" });
    fireEvent.click(screen.getByRole("button", { name: "Recover packaged version" }));

    await waitFor(() => expect((restart as HTMLButtonElement).disabled).toBe(true));
    fireEvent.click(restart);
    expect(ota.exitApp).not.toHaveBeenCalled();

    finishRecovery();
  });

  it("re-probes pending work before exiting to apply a staged bundle", async () => {
    ota.readBundleRestartState.mockResolvedValue({
      currentBundleId: "packaged",
      pendingBundleId: "1.1.9-canary-deadbeef",
    });
    const pendingOfflineWork = vi.fn(async () => true);
    render(<UnifiedAboutUpdates pendingOfflineWork={pendingOfflineWork} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Restart to finish updating" }));

    await waitFor(() => expect(pendingOfflineWork).toHaveBeenCalledTimes(1));
    expect(ota.exitApp).not.toHaveBeenCalled();
    expect(await screen.findByText("Skipped — you have work that has not finished syncing.")).toBeTruthy();
  });

  it("restores the native staged bundle lock after the About route remounts", async () => {
    ota.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "packaged",
      pendingBundleId: "1.1.9-canary-deadbeef",
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    expect(await screen.findByText("Update ready")).toBeTruthy();
    const enroll = screen.getByRole("button", { name: "Enroll in canary updates" });
    expect((enroll as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/bundle 1\.1\.9-canary-deadbeef/)).toBeTruthy();
  });

  it("does not call the already-active native bundle a staged update", async () => {
    ota.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "1.1.8-active",
      pendingBundleId: "1.1.8-active",
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    const enroll = await screen.findByRole("button", { name: "Enroll in canary updates" });
    await waitFor(() => expect((enroll as HTMLButtonElement).disabled).toBe(false));
    expect(screen.queryByText("Update ready")).toBeNull();
  });

  it("restores a packaged restart target when the active bundle is OTA-delivered", async () => {
    ota.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "1.1.8-active",
      pendingBundleId: null,
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    expect(await screen.findByText("Update ready")).toBeTruthy();
    expect(screen.getByText("Restart to return to the packaged version.")).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("fails closed when the current native bundle cannot be read at mount", async () => {
    ota.readBundleRestartState.mockRejectedValueOnce(new Error("current bundle unavailable"));
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    expect(
      await screen.findByText(
        "Could not verify the pending update state. Restart the app before changing channels.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("reports unavailable native facts instead of inventing packaged or web-preview state", async () => {
    ota.getInfo.mockRejectedValueOnce(new Error("app metadata unavailable"));
    ota.readBundleRestartState.mockRejectedValueOnce(new Error("bundle state unavailable"));
    ota.readOtaChannel.mockRejectedValueOnce(new Error("channel state unavailable"));

    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    await waitFor(() => expect(screen.getAllByText("unavailable")).toHaveLength(3));
    expect(screen.queryByText("web preview")).toBeNull();
    expect(screen.queryByText("packaged")).toBeNull();
    expect(screen.queryByText("loading…")).toBeNull();
  });

  it("does not invent a packaged restart target in a browser preview", async () => {
    ota.nativePlatform.value = false;
    ota.currentBundleId.mockResolvedValueOnce("web");
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    await screen.findByText("web");
    expect(screen.queryByText("Update ready")).toBeNull();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("keeps packaged recovery staged and exposes Restart immediately", async () => {
    ota.readBundleRestartState
      .mockResolvedValueOnce({
        currentBundleId: "1.1.8-active",
        pendingBundleId: "1.1.8-active",
      })
      .mockResolvedValueOnce({
        currentBundleId: "1.1.8-active",
        pendingBundleId: null,
      });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Recover packaged version" }));

    expect(await screen.findByText("Update ready")).toBeTruthy();
    expect(screen.getByText("Restart to return to the packaged version.")).toBeTruthy();
    expect(
      await screen.findByText("Recovered to the packaged version. Restart to apply."),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);
  });

  it("treats recovery as a no-op when packaged is already current and next", async () => {
    ota.readBundleRestartState
      .mockResolvedValueOnce({ currentBundleId: "packaged", pendingBundleId: null })
      .mockResolvedValueOnce({ currentBundleId: "packaged", pendingBundleId: null });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Recover packaged version" }));

    expect(await screen.findByText("This app is already using the packaged version.")).toBeTruthy();
    expect(screen.queryByText("Update ready")).toBeNull();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(false);
  });

  it("preserves the known packaged restart target when the post-reset reread fails", async () => {
    ota.readBundleRestartState
      .mockResolvedValueOnce({
        currentBundleId: "1.1.8-active",
        pendingBundleId: "1.1.8-active",
      })
      .mockRejectedValueOnce(new Error("native state unavailable"))
      .mockResolvedValueOnce({
        currentBundleId: "1.1.8-active",
        pendingBundleId: null,
      });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Recover packaged version" }));

    expect(await screen.findByText("Update ready")).toBeTruthy();
    expect(screen.getByText("Restart to return to the packaged version.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Restart to finish updating" }));
    await waitFor(() => expect(ota.exitApp).toHaveBeenCalledTimes(1));
  });

  it("fails closed when persisted channel enrollment cannot be read", async () => {
    ota.readOtaChannel.mockRejectedValueOnce(new Error("preferences unavailable"));
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    expect(
      await screen.findByText(
        "Could not verify this device's update channel. Restart the app before checking for updates.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(screen.queryByRole("button", { name: "Enroll in canary updates" })).toBeNull();
    expect(ota.checkAndStage).not.toHaveBeenCalled();
    expect(ota.writeOtaChannel).not.toHaveBeenCalled();
  });

  it("keeps channel controls locked when an update check cannot read native bundle state", async () => {
    ota.checkAndStage.mockResolvedValueOnce({
      staged: null,
      reason: "bundle_state_unavailable",
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));

    expect(
      await screen.findByText("Could not safely inspect downloaded updates. Nothing changed."),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("locks check and channel controls when the replay floor cannot be made durable", async () => {
    ota.checkAndStage.mockResolvedValueOnce({
      staged: null,
      reason: "pointer_state_unavailable",
    });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));

    expect(
      await screen.findByText(
        "Could not safely save update history. Restart the app before checking again.",
      ),
    ).toBeTruthy();
    expect((screen.getByRole("button", { name: "Check now" }) as HTMLButtonElement).disabled)
      .toBe(true);
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("reconciles the native restart target after an ambiguous staging response", async () => {
    ota.readBundleRestartState.mockResolvedValueOnce({
      currentBundleId: "packaged",
      pendingBundleId: "1.1.9-canary-deadbeef",
    });
    ota.checkAndStage.mockResolvedValueOnce({ staged: null, reason: "verify_failed" });
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));

    expect(await screen.findByText("Update ready")).toBeTruthy();
    expect(screen.getByText(/bundle 1\.1\.9-canary-deadbeef/)).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("keeps channel controls locked when post-check native state cannot be read", async () => {
    ota.readBundleRestartState.mockRejectedValueOnce(new Error("native state unavailable"));
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));

    expect(
      await screen.findByText(
        "Could not verify the pending update state. Restart the app before changing channels.",
      ),
    ).toBeTruthy();
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("announces an unreadable pending state once and keeps channel controls locked", async () => {
    ota.readBundleRestartState.mockRejectedValueOnce(new Error("native state unavailable"));
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    const copy = "Could not verify the pending update state. Restart the app before changing channels.";
    await waitFor(() => expect(screen.getAllByText(copy)).toHaveLength(1));
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(
      (screen.getByRole("button", { name: "Enroll in canary updates" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("surfaces check and recovery failures without an unhandled click rejection", async () => {
    ota.checkAndStage.mockRejectedValueOnce(new Error("native check failed"));
    ota.recoverToPackaged.mockRejectedValueOnce(new Error("native reset failed"));
    render(<UnifiedAboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole("button", { name: "Check now" }));
    expect(
      await screen.findByText("Could not check for updates. The app is unaffected."),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Recover packaged version" }));
    expect(
      await screen.findByText("Could not recover the packaged version. Nothing changed."),
    ).toBeTruthy();
  });
});

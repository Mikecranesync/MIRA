// @vitest-environment jsdom
// Ordinary devices stay on production. Canary is a deliberate, persisted
// device enrollment made from the same About & Updates surface in both shells.
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ota = vi.hoisted(() => ({
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
  recoverToPackaged: vi.fn(async () => undefined),
  writeOtaChannel: vi.fn(async () => undefined),
  getInfo: vi.fn(async () => ({
    id: "com.factorylm.mira",
    name: "FactoryLM",
    version: "1.1.0",
    build: "10",
  })),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    exitApp: vi.fn(async () => undefined),
    getInfo: ota.getInfo,
  },
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => "android", isNativePlatform: () => true },
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

import { AboutUpdates } from "../AboutUpdates";

beforeEach(() => {
  vi.clearAllMocks();
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
});

afterEach(() => cleanup());

describe("About & Updates channel enrollment", () => {
  it("checks production by default on an ordinary device", async () => {
    render(<AboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    await screen.findByText("production");
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    await waitFor(() =>
      expect(ota.checkAndStage).toHaveBeenCalledWith(
        expect.objectContaining({ channel: "production" }),
      ),
    );
  });

  it("keeps canary enrollment controls out of the frozen classic screen", async () => {
    render(<AboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);
    await screen.findByText("production");
    expect(screen.queryByRole("button", { name: "Enroll in canary updates" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return to production updates" })).toBeNull();
  });

  it("reports unavailable native facts instead of inventing packaged or web-preview state", async () => {
    ota.getInfo.mockRejectedValueOnce(new Error("app metadata unavailable"));
    ota.readBundleRestartState.mockRejectedValueOnce(new Error("bundle state unavailable"));
    ota.readOtaChannel.mockRejectedValueOnce(new Error("channel state unavailable"));

    render(<AboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    await waitFor(() => expect(screen.getAllByText("unavailable", { exact: false })).toHaveLength(3));
    expect(screen.queryByText("web preview")).toBeNull();
    expect(screen.queryByText("loading…", { exact: false })).toBeNull();
  });

  it.each([
    ["invalid_manifest_origin", "Refused — update source is not FactoryLM."],
    ["channel_mismatch", "Refused — update channel does not match this device."],
    ["invalid_pointer_timestamp", "Refused — update authorization could not be verified."],
    ["invalid_pointer_signature", "Refused — update authorization could not be verified."],
    ["invalid_packaged_minimum", "This app cannot verify update age. Install a newer app."],
    ["stale_pointer", "Refused — update is older than this app."],
    ["replayed_pointer", "Refused — update is older than this device's trusted history."],
    [
      "pointer_state_unavailable",
      "Could not safely save update history. Restart the app before checking again.",
    ],
    ["pointer_state_invalid", "Update history is invalid. Install a fresh app before updating."],
    ["pending_bundle_state_unavailable", "Could not verify the pending update state. Restart the app before changing channels."],
    ["channel_state_unavailable", "Could not verify this device's update channel. Restart the app before checking for updates."],
    ["check_failed", "Could not check for updates. The app is unaffected."],
    ["recovery_failed", "Could not recover the packaged version. Nothing changed."],
    ["bundle_state_unavailable", "Could not safely inspect downloaded updates. Nothing changed."],
    ["bundle_cleanup_failed", "Could not safely prepare the update. Restart the app and try again."],
  ])("renders actionable copy for OTA refusal %s", async (reason, expected) => {
    ota.checkAndStage.mockResolvedValueOnce({ staged: null, reason });
    render(<AboutUpdates pendingOfflineWork={async () => false} onBack={() => {}} />);

    await screen.findByText("production");
    fireEvent.click(screen.getByRole("button", { name: "Check now" }));

    expect(await screen.findByText(`Result: ${expected}`)).toBeTruthy();
    expect(screen.queryByText(reason)).toBeNull();
  });
});

// @vitest-environment jsdom
// Sensor v0 S1 — the shell (contract §5 S1):
//   • the Add-sources sheet has ONE "Sensor" row; the header has a compact
//     door; both open the same Sheet
//   • exactly three working modes LOOK / READ / REPLAY — LISTEN / VIBRATION
//     are absent, nothing is disabled
//   • hardware BACK closes it through the transient-layer stack
//   • opens with zero sources and no bound asset (no identity gate)
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/sensor-shell

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    // These suites pin the CLASSIC chat surface, which still ships behind
    // More → "Chat style". ChatV2 is the default, so the preference is
    // returned explicitly here rather than relied upon — the ChatV2 contracts
    // are pinned separately in src/screens/__tests__/chat-v2.test.tsx and
    // src/chat-adapter/__tests__/.
    get: vi.fn(async ({ key }: { key: string }) =>
      key === "flm.chatui.v1" ? { value: "legacy" } : { value: null },
    ),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));

const { askNotebook, getNotebookDetail } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
}));

vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail };
});

import { NotebookScreen } from "../NotebookScreen";
import { closeTopTransientLayer, _resetTransientLayersForTest } from "../../lib/transient-layer";

const detail = () => ({
  // No asset binding, no sources: the L0 case. Sensor must still open.
  notebook: { id: "nb1", displayName: "Bench notes", manufacturer: null, model: null, asset: null },
  sources: [],
  turns: [],
});

function mount(openAddSources = false) {
  const backRef = { current: null as (() => boolean) | null };
  return render(
    <NotebookScreen id="nb1" openAddSources={openAddSources} backRef={backRef} onExit={() => {}} />,
  );
}

beforeEach(() => {
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  getNotebookDetail.mockResolvedValue(detail());
  Element.prototype.scrollTo = vi.fn();
  _resetTransientLayersForTest();
});
afterEach(cleanup);

describe("Sensor shell (S1)", () => {
  it("opens from the Add-sources sheet with exactly LOOK / READ / REPLAY", async () => {
    mount(true);
    const row = await screen.findByRole("button", { name: /Sensor — look, read, or replay/ });
    fireEvent.click(row);
    const dialog = await screen.findByRole("dialog", { name: "Sensor" });
    expect(dialog).toBeTruthy();
    for (const label of ["LOOK", "READ", "REPLAY"]) {
      const b = screen.getByRole("button", { name: label }) as HTMLButtonElement;
      expect(b.disabled).toBe(false);
    }
    // Contract §6: not in v0, so not on screen — not even greyed out.
    expect(screen.queryByText(/LISTEN/)).toBeNull();
    expect(screen.queryByText(/VIBRATION/)).toBeNull();
    // The Add-sources sheet handed off: one sheet at a time.
    expect(screen.queryByRole("dialog", { name: "Add sources" })).toBeNull();
  });

  it("opens from the compact header door with no sources and no machine", async () => {
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
    await screen.findByRole("dialog", { name: "Sensor" });
    // Never a setup gate (§2.6).
    expect(screen.queryByText(/select an asset/i)).toBeNull();
  });

  it("hardware BACK closes the Sensor sheet through the transient-layer stack", async () => {
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
    await screen.findByRole("dialog", { name: "Sensor" });
    await act(async () => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();
    // Nothing left on the stack: the next BACK falls through to navigation.
    expect(closeTopTransientLayer()).toBe(false);
  });

  // BACK used to close the ENTIRE sheet from inside a mode, taking the LOOK
  // card / scan result with it. The mode is a transient layer of its own now,
  // so the stack unwinds one rung per press.
  it("hardware BACK inside a mode returns to the mode picker before closing the sheet", async () => {
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
    fireEvent.click(await screen.findByRole("button", { name: "REPLAY" }));
    expect(screen.getByRole("heading", { name: "REPLAY" })).toBeTruthy();
    await act(async () => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(screen.getByRole("dialog", { name: "Sensor" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "LOOK" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "REPLAY" })).toBeNull();
    await act(async () => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();
    expect(closeTopTransientLayer()).toBe(false);
  });

  it("a mode opens and ← Modes returns to the picker", async () => {
    mount(false);
    fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
    fireEvent.click(await screen.findByRole("button", { name: "READ" }));
    expect(screen.getByRole("heading", { name: "READ" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "← Modes" }));
    expect(screen.getByRole("button", { name: "LOOK" })).toBeTruthy();
  });
});

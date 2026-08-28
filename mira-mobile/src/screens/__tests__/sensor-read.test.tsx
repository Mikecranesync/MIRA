// @vitest-environment jsdom
// Sensor v0 S3 — READ in the notebook (contract §4.2):
//   • identity chip reflects the notebook's binding (unbound → amber after a
//     typed/QR selection; never "confirmed" from a scan)
//   • "Scan FactoryLM QR" mounts the EXISTING ScanView with a Sensor cancel
//     label; a typed tag binds this notebook in place (manual_entry)
//   • BACK unwinds viewfinder → Sensor sheet → notebook
//   • "Photograph a nameplate" invokes the EXISTING ComponentNameplateFlow
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/sensor-read

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false, convertFileSrc: (p: string) => p },
  CapacitorHttp: { request: vi.fn() },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: vi.fn(async () => ({ value: null })),
    set: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  },
}));
// The camera never starts in jsdom; manual entry is the door under test.
vi.mock("qr-scanner", () => ({
  default: class {
    static hasCamera = async () => false;
    start = async () => {};
    stop() {}
    destroy() {}
  },
}));

const { askNotebook, getNotebookDetail, getAssetByTag, bindNotebookAsset, openAssetNotebook, recognizeComponentNameplate } =
  vi.hoisted(() => ({
    askNotebook: vi.fn(),
    getNotebookDetail: vi.fn(),
    getAssetByTag: vi.fn(),
    bindNotebookAsset: vi.fn(),
    openAssetNotebook: vi.fn(),
    recognizeComponentNameplate: vi.fn(),
  }));

vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail, getAssetByTag, bindNotebookAsset, openAssetNotebook, recognizeComponentNameplate };
});

import { NotebookScreen } from "../NotebookScreen";
import { closeTopTransientLayer, _resetTransientLayersForTest } from "../../lib/transient-layer";

const unbound = () => ({
  notebook: { id: "nb1", displayName: "Bench notes", manufacturer: null, model: null, asset: null },
  sources: [],
  turns: [],
});
const boundByTyping = () => ({
  notebook: {
    id: "nb1",
    displayName: "Discharge Conveyor",
    manufacturer: null,
    model: null,
    asset: { entityId: "asset-1", selectedVia: "manual_entry", confirmedBy: null, confirmedAt: null },
  },
  sources: [],
  turns: [],
});

function mount(onOpenNotebook = vi.fn()) {
  const backRef = { current: null as (() => boolean) | null };
  render(<NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} onOpenNotebook={onOpenNotebook} />);
  return onOpenNotebook;
}

async function openRead() {
  fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
  fireEvent.click(await screen.findByRole("button", { name: "READ" }));
}

beforeEach(() => {
  for (const m of [askNotebook, getNotebookDetail, getAssetByTag, bindNotebookAsset, openAssetNotebook, recognizeComponentNameplate]) m.mockReset();
  getNotebookDetail.mockResolvedValue(unbound());
  Element.prototype.scrollTo = vi.fn();
  _resetTransientLayersForTest();
});
afterEach(cleanup);

describe("Sensor READ (S3)", () => {
  it("a typed tag upgrades THIS notebook (L1→L2) and the chip turns amber, not green", async () => {
    getAssetByTag.mockResolvedValue({ id: "asset-1", tag: "CV-101", name: "Discharge Conveyor" });
    bindNotebookAsset.mockResolvedValue(boundByTyping().notebook);
    mount();
    await openRead();
    expect(screen.getByTestId("asset-chip").getAttribute("data-tone")).toBe("unbound");

    fireEvent.click(screen.getByRole("button", { name: /Scan FactoryLM QR/ }));
    const scan = await screen.findByRole("dialog", { name: "Scan FactoryLM QR" });
    // The existing ScanView, re-labelled for where Cancel really goes.
    expect(scan.textContent).toContain("← Sensor");
    getNotebookDetail.mockResolvedValue(boundByTyping());
    fireEvent.change(screen.getByPlaceholderText("e.g. ALLE-MMDHMQV0"), { target: { value: "CV-101" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));

    await waitFor(() => expect(bindNotebookAsset).toHaveBeenCalledWith("nb1", "asset-1", "manual_entry"));
    // Stayed in this notebook: no navigation to another machine's notebook.
    expect(openAssetNotebook).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId("asset-chip").getAttribute("data-tone")).toBe("unconfirmed"));
    expect(screen.getByTestId("asset-chip").textContent).toMatch(/typed in — not yet confirmed/);
    expect((await screen.findByRole("status")).textContent).toMatch(/now this notebook's machine/);
  });

  it("scanning a DIFFERENT machine from a bound notebook opens that notebook", async () => {
    getNotebookDetail.mockResolvedValue(boundByTyping());
    getAssetByTag.mockResolvedValue({ id: "asset-2", tag: "CV-102", name: "Infeed" });
    openAssetNotebook.mockResolvedValue({ id: "nb-2", displayName: "Infeed" });
    const onOpen = mount();
    await openRead();
    fireEvent.click(screen.getByRole("button", { name: /Scan FactoryLM QR/ }));
    fireEvent.change(await screen.findByPlaceholderText("e.g. ALLE-MMDHMQV0"), { target: { value: "CV-102" } });
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("nb-2"));
    expect(bindNotebookAsset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();
  });

  it("BACK unwinds viewfinder → Sensor sheet → notebook, one layer per press", async () => {
    mount();
    await openRead();
    fireEvent.click(screen.getByRole("button", { name: /Scan FactoryLM QR/ }));
    await screen.findByRole("dialog", { name: "Scan FactoryLM QR" });
    await act(async () => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: "Scan FactoryLM QR" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "Sensor" })).toBeTruthy();
    await act(async () => {
      expect(closeTopTransientLayer()).toBe(true);
    });
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();
    expect(closeTopTransientLayer()).toBe(false);
  });

  it("Photograph a nameplate invokes the existing ComponentNameplateFlow for this notebook", async () => {
    recognizeComponentNameplate.mockResolvedValue({
      fileId: "f-np",
      candidate: { manufacturer: "Harrington", model: "UMS3-0335" },
      rawObservation: null,
      confidence: 0.8,
      attachment: null,
    });
    mount();
    await openRead();
    const input = screen.getByLabelText("Nameplate photo") as HTMLInputElement;
    const file = new File([new Uint8Array([0xff, 0xd8])], "plate.jpg", { type: "image/jpeg" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByRole("heading", { name: "Component nameplate" });
    await waitFor(() => expect(recognizeComponentNameplate).toHaveBeenCalledWith("nb1", file));
    // The flow's own identity form appears — nothing re-implemented here.
    await screen.findByRole("button", { name: "Find the manual for this component" });
  });
});

// @vitest-environment jsdom
// Sensor v0 S4 — REPLAY in the notebook (contract §4.3–4.5):
//   • no bound machine → honest sentence + READ offer (not a setup gate:
//     LOOK stays reachable)
//   • a recorded window renders chronological rows with relative time, the
//     ingest clock when it diverges, quality, and the freshness label
//   • stale is never live: the banner shows
//   • no fault window → honest empty, no rows
//   • "Ask MIRA what happened" closes the sheet and sends the window as
//     body.machineEvidence through askNotebook
//   • a persisted turn renders the Machine Replay card + muted basis caption
//
// Run: cd mira-mobile && bunx vitest run src/screens/__tests__/sensor-replay

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const { askNotebook, getNotebookDetail, getAssetHistory } = vi.hoisted(() => ({
  askNotebook: vi.fn(),
  getNotebookDetail: vi.fn(),
  getAssetHistory: vi.fn(),
}));

vi.mock("../../api/resources", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/resources")>();
  return { ...real, askNotebook, getNotebookDetail, getAssetHistory };
});

import { NotebookScreen } from "../NotebookScreen";
import { ApiError } from "../../api/client";
import { hhmmss } from "../../lib/sensor";

const ANCHOR = "2026-08-28T23:16:31.000Z";
const bound = (turns: unknown[] = []) => ({
  notebook: {
    id: "nb1",
    displayName: "CV-101",
    manufacturer: null,
    model: null,
    asset: { entityId: "asset-1", selectedVia: "qr", confirmedBy: null, confirmedAt: null },
  },
  sources: [],
  turns,
});
const unbound = () => ({
  notebook: { id: "nb1", displayName: "Bench notes", manufacturer: null, model: null, asset: null },
  sources: [],
  turns: [],
});
const history = (overall: "live" | "stale") => ({
  ok: true,
  history: {
    anchor: { at: ANCHOR, source: "state_window", windowId: "w-1", runId: null },
    rows: [
      { event_timestamp: "2026-08-28T23:16:28.860Z", ingested_at: "2026-08-28T23:16:29.000Z", uns_path: "u", tag: "cv101/photo_eye", value: true, prev_value: null, quality: "good", kind: "event" },
      { event_timestamp: "2026-08-28T23:16:30.270Z", ingested_at: "2026-08-28T23:16:30.400Z", uns_path: "u", tag: "cv101/speed_feedback", value: 12.5, prev_value: 48.2, quality: "uncertain", kind: "diff" },
      { event_timestamp: "2026-08-28T23:16:31.160Z", ingested_at: "2026-08-28T23:16:45.000Z", uns_path: "u", tag: "cv101/state", value: "faulted", prev_value: "running", quality: "good", kind: "diff" },
    ],
    freshness: { overall, live: overall === "live" ? 3 : 0, stale: overall === "stale" ? 3 : 0, simulated: 0, unknown: 0 },
    summary: { summary: "CV-101 faulted after drive inhibit." },
    provenance: "machine_memory",
    reason: null,
    pre: 5,
    post: 2,
  },
});

function mount() {
  const backRef = { current: null as (() => boolean) | null };
  return render(<NotebookScreen id="nb1" backRef={backRef} onExit={() => {}} />);
}
async function openReplay() {
  fireEvent.click(await screen.findByRole("button", { name: "Open Sensor" }));
  fireEvent.click(await screen.findByRole("button", { name: "REPLAY" }));
}

beforeEach(() => {
  askNotebook.mockReset();
  getNotebookDetail.mockReset();
  getAssetHistory.mockReset();
  Element.prototype.scrollTo = vi.fn();
});
afterEach(cleanup);

describe("Sensor REPLAY (S4)", () => {
  it("with no bound machine: explains, offers READ, and LOOK still works", async () => {
    getNotebookDetail.mockResolvedValue(unbound());
    mount();
    await openReplay();
    expect((await screen.findByRole("status")).textContent).toBe(
      "No connected machine on this notebook — identify one with READ.",
    );
    expect(getAssetHistory).not.toHaveBeenCalled();
    expect(screen.queryByText(/select an asset/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Identify the machine with READ/ }));
    expect(screen.getByRole("heading", { name: "READ" })).toBeTruthy();
    // Not a gate: LOOK is one tap away and has its action.
    fireEvent.click(screen.getByRole("button", { name: "← Modes" }));
    fireEvent.click(screen.getByRole("button", { name: "LOOK" }));
    expect(screen.getByRole("button", { name: /Photograph or pick an image/ })).toBeTruthy();
  });

  it("renders the recorded window: relative time, prev→, quality, divergence, stale banner", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    getAssetHistory.mockResolvedValue(history("stale"));
    mount();
    await openReplay();
    const tl = await screen.findByTestId("replay-timeline");
    expect(getAssetHistory).toHaveBeenCalledWith("asset-1");
    expect(tl.getAttribute("data-freshness")).toBe("stale");
    expect(screen.getByTestId("freshness-label").textContent).toBe("Stale");
    expect(screen.getByText("Live unavailable — showing recorded history")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0].textContent).toContain("-2.14 s");
    expect(rows[0].textContent).toContain("photo_eye");
    expect(rows[0].textContent).toContain("ON");
    expect(rows[1].textContent).toContain("-0.73 s");
    expect(rows[1].textContent).toContain("12.50 (48.20 →)");
    expect(rows[1].textContent).toContain("uncertain");
    expect(rows[2].textContent).toContain("+0.16 s");
    // D2: only the row whose ingest clock diverges shows it.
    expect(rows[0].getAttribute("data-diverges")).toBe("false");
    expect(rows[2].getAttribute("data-diverges")).toBe("true");
    expect(rows[2].textContent).toContain(`ingested ${hhmmss("2026-08-28T23:16:45.000Z")}`);
  });

  it("a live window shows no banner", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    getAssetHistory.mockResolvedValue(history("live"));
    mount();
    await openReplay();
    await screen.findByTestId("replay-timeline");
    expect(screen.queryByText(/Live unavailable/)).toBeNull();
    expect(screen.getByTestId("freshness-label").textContent).toBe("Live");
  });

  it("no fault window → honest empty with the latest recorded state; no rows drawn", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    getAssetHistory.mockResolvedValue({ ok: false, reason: "no_fault_window", windowsAvailable: true, latest: { state: "running", at: "2026-08-28T22:00:00Z" } });
    mount();
    await openReplay();
    const s = await screen.findByRole("status");
    expect(s.textContent).toMatch(/No fault window recorded/);
    expect(s.textContent).toContain(`running at ${hhmmss("2026-08-28T22:00:00Z")}`);
    expect(screen.queryByRole("listitem")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ask MIRA what happened" })).toBeNull();
  });

  it("no_fault_window with windowsAvailable=false says the windows are absent, not that none was recorded", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    getAssetHistory.mockResolvedValue({ ok: false, reason: "no_fault_window", windowsAvailable: false, latest: null });
    mount();
    await openReplay();
    const s = await screen.findByRole("status");
    expect(s.textContent).toMatch(/state windows aren't available/);
    expect(s.textContent).not.toMatch(/No fault window recorded/);
  });

  it("no_uns_path is its own sentence — no machine memory, not 'no fault window'", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    getAssetHistory.mockResolvedValue({ ok: false, reason: "no_uns_path" });
    mount();
    await openReplay();
    const s = await screen.findByRole("status");
    expect(s.textContent).toMatch(/no Machine Memory yet \(no UNS path\)/);
    expect(s.textContent).not.toMatch(/No fault window recorded/);
  });

  it("a route failure (bare 404 → thrown) renders the error state, never a statement about the machine", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    const err = new ApiError("not_found", 404, "HTTP 404");
    getAssetHistory.mockRejectedValue(err);
    const { container } = mount();
    await openReplay();
    await waitFor(() => expect(screen.queryByText(/Reading Machine Memory/)).toBeNull());
    expect(screen.queryByText(/No fault window recorded/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    // The existing ErrorState (common.tsx): `.error` carrying the typed message.
    expect(container.querySelector(".error")?.textContent).toBe(err.userMessage);
  });

  it("tables unavailable → says so; no fabricated timeline", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    const h = history("stale");
    getAssetHistory.mockResolvedValue({ ok: true, history: { ...h.history, rows: [], reason: "unavailable" } });
    mount();
    await openReplay();
    await screen.findByTestId("replay-timeline");
    expect(screen.getByText(/isn't available for this workspace yet/)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("Ask MIRA what happened closes the sheet and sends body.machineEvidence via askNotebook", async () => {
    getNotebookDetail.mockResolvedValue(bound());
    getAssetHistory.mockResolvedValue(history("stale"));
    askNotebook.mockResolvedValue({ answer: "Drive inhibit preceded the fault.", citations: [], status: "answered", evidenceBasis: "machine_history", evidenceLabel: "x", machineEvidence: [{ kind: "machine_evidence", assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2, rowCount: 3, freshness: "stale" }] });
    mount();
    await openReplay();
    fireEvent.click(await screen.findByRole("button", { name: "Ask MIRA what happened" }));
    await waitFor(() => expect(askNotebook).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog", { name: "Sensor" })).toBeNull();
    const [nbId, question, scope, opts] = askNotebook.mock.calls[0];
    expect(nbId).toBe("nb1");
    expect(question).toContain(`fault at ${hhmmss(ANCHOR)}`);
    expect(scope).toEqual([]);
    expect(opts.machineEvidence).toEqual({ assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2 });
    // The live turn renders its card + muted caption from the server's frame.
    await screen.findByText("Drive inhibit preceded the fault.");
    expect(screen.getByTestId("machine-replay-card").textContent).toContain("3 observed changes");
    expect(screen.getByText(/recorded machine history — not live/)).toBeTruthy();
    expect(screen.queryByText(/General guidance/)).toBeNull();
  });

  it("a persisted turn renders the Machine Replay card from evidence[] and no chip for it", async () => {
    getNotebookDetail.mockResolvedValue(
      bound([
        {
          id: "t1",
          question: "What happened?",
          answerStatus: "answered",
          answerText: "Observed: photo eye ON, then drive inhibit.",
          basis: "live_machine_evidence",
          evidence: [
            { citationId: "1", sourceTitle: "gs10.pdf", page: 12, docId: "d1" },
            { kind: "machine_evidence", assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2, rowCount: 7, freshness: { overall: "live", live: 7, stale: 0, simulated: 0, unknown: 0 }, windowId: "w-1" },
          ],
        },
      ]),
    );
    mount();
    const card = await screen.findByTestId("machine-replay-card");
    expect(card.textContent).toContain(`Machine Replay · 7 observed changes around ${hhmmss(ANCHOR)} · Live`);
    expect(screen.getByText("Grounded in live machine evidence")).toBeTruthy();
    // Exactly one citation chip — the document one; the machine entry is not a chip.
    const chips = screen.getAllByRole("button", { name: /gs10\.pdf/ });
    expect(chips).toHaveLength(1);
  });
});

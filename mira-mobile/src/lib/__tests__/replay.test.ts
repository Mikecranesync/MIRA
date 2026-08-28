// Sensor v0 S4 — REPLAY, pure half (contract §4.3 / §4.4 / §4.5, D2, D5):
//   • relative-time formatting against the anchor
//   • the two-clock divergence flag (the replay signature) is never hidden
//   • "Live unavailable" for anything that is not live
//   • the history request/response mapping incl. the two honest empties
//   • askNotebook sends body.machineEvidence — and nothing else changes
//   • the persisted machine-evidence card title + muted basis caption
//   • machine-evidence entries never become citation chips
//
// Run: cd mira-mobile && bunx vitest run src/lib/__tests__/replay

import { describe, it, expect, vi, beforeEach } from "vitest";

const { request, requestStream } = vi.hoisted(() => ({ request: vi.fn(), requestStream: vi.fn() }));
vi.mock("../../api/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../api/client")>();
  return { ...real, request, requestStream };
});

import { askNotebook, getAssetHistory } from "../../api/resources";
import { normalizeCitations, parseChatSse } from "../sse";
import {
  FRESHNESS_LABEL,
  LIVE_UNAVAILABLE_BANNER,
  basisCaption,
  clocksDiverge,
  formatRelativeSeconds,
  liveUnavailable,
  machineEvidenceEntries,
  replayCardTitle,
  replayQuestion,
} from "../replay";
import { hhmmss } from "../sensor";

const ANCHOR = "2026-08-28T23:16:31.000Z";

beforeEach(() => {
  request.mockReset();
  requestStream.mockReset();
});

describe("formatRelativeSeconds", () => {
  it("renders seconds before/after the anchor with an explicit sign", () => {
    expect(formatRelativeSeconds("2026-08-28T23:16:28.860Z", ANCHOR)).toBe("-2.14 s");
    expect(formatRelativeSeconds("2026-08-28T23:16:31.160Z", ANCHOR)).toBe("+0.16 s");
    expect(formatRelativeSeconds(ANCHOR, ANCHOR)).toBe("0.00 s");
    expect(formatRelativeSeconds("2026-08-28T23:16:30.999Z", ANCHOR)).toBe("0.00 s");
  });
  it("never invents a number for an unparseable timestamp", () => {
    expect(formatRelativeSeconds("garbage", ANCHOR)).toBe("—");
  });
});

describe("clocksDiverge (D2)", () => {
  it("flags ingest lagging the machine clock beyond the threshold", () => {
    expect(clocksDiverge("2026-08-28T23:16:31Z", "2026-08-28T23:16:31.400Z")).toBe(false);
    expect(clocksDiverge("2026-08-28T23:16:31Z", "2026-08-28T23:16:45Z")).toBe(true);
    // Frozen event_timestamp + advancing ingested_at: the report-by-exception
    // signature — this MUST render, never be hidden.
    expect(clocksDiverge("2026-08-28T23:00:00Z", "2026-08-28T23:16:45Z")).toBe(true);
  });
  it("does not flag when either clock is unreadable", () => {
    expect(clocksDiverge("x", "2026-08-28T23:16:45Z")).toBe(false);
  });
});

describe("freshness honesty", () => {
  it("only live is live; stale / simulated / unknown all show the banner", () => {
    expect(liveUnavailable({ overall: "live" })).toBe(false);
    for (const overall of ["stale", "simulated", "unknown"] as const)
      expect(liveUnavailable({ overall })).toBe(true);
    expect(liveUnavailable(null)).toBe(true);
    expect(LIVE_UNAVAILABLE_BANNER).toBe("Live unavailable — showing recorded history");
  });
  it("label vocabulary is the Hub's (command-center FRESHNESS_LABEL)", () => {
    expect(FRESHNESS_LABEL).toEqual({ live: "Live", stale: "Stale", simulated: "Simulated", unknown: "No tags" });
  });
});

describe("getAssetHistory", () => {
  it("GETs /api/assets/{id}/history/ with at/pre/post and maps rows verbatim, in server order", async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        anchor: { at: ANCHOR, source: "state_window", windowId: "w-1", runId: null },
        rows: [
          { event_timestamp: "2026-08-28T23:16:28.860Z", ingested_at: "2026-08-28T23:16:29.100Z", uns_path: "e.s.a.l.cv101", tag: "cv101/photo_eye", value: true, quality: "good", kind: "event" },
          { event_timestamp: "2026-08-28T23:16:31.160Z", ingested_at: "2026-08-28T23:16:45.000Z", uns_path: "e.s.a.l.cv101", tag: "cv101/state", value: "faulted", prev_value: "running", quality: "good", kind: "diff" },
        ],
        freshness: { overall: "stale", live: 0, stale: 4, simulated: 0, unknown: 0 },
        summary: { summary: "CV-101 faulted after drive inhibit." },
        provenance: "machine_memory",
        pre: 5,
        post: 2,
      },
    });
    const r = await getAssetHistory("asset-1", { at: ANCHOR, pre: 5, post: 2 });
    expect(request).toHaveBeenCalledWith(
      `/api/assets/asset-1/history/?at=${encodeURIComponent(ANCHOR)}&pre=5&post=2`,
      { acceptStatuses: [404] },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.history.rows.map((x) => x.tag)).toEqual(["cv101/photo_eye", "cv101/state"]);
    expect(r.history.rows[1]).toMatchObject({ prev_value: "running", kind: "diff", quality: "good" });
    expect(r.history.freshness.overall).toBe("stale");
    expect(r.history.anchor).toEqual({ at: ANCHOR, source: "state_window", windowId: "w-1", runId: null });
    expect(r.history.reason).toBeNull();
  });

  it("404 no_fault_window is an answer, with the Hub's latestWindow {state, started_at} + windowsAvailable", async () => {
    request.mockResolvedValue({
      status: 404,
      data: {
        error: "no_fault_window",
        message: "No recorded fault or e-stop window for this asset.",
        latestWindow: { state: "idle", started_at: "2026-08-27T22:00:00.000Z", ended_at: null },
        windowsAvailable: true,
      },
    });
    const r = await getAssetHistory("asset-1");
    expect(r).toEqual({ ok: false, reason: "no_fault_window", windowsAvailable: true, latest: { state: "idle", at: "2026-08-27T22:00:00.000Z" } });
  });

  it("404 no_fault_window with windowsAvailable=false and no latest window is the 'tables absent' answer", async () => {
    request.mockResolvedValue({ status: 404, data: { error: "no_fault_window", latestWindow: null, windowsAvailable: false } });
    const r = await getAssetHistory("asset-1");
    expect(r).toEqual({ ok: false, reason: "no_fault_window", windowsAvailable: false, latest: null });
  });

  it("404 no_uns_path is its OWN answer — never 'no fault window'", async () => {
    request.mockResolvedValue({ status: 404, data: { error: "no_uns_path", message: "This asset has no machine memory (no UNS path)." } });
    expect(await getAssetHistory("asset-1")).toEqual({ ok: false, reason: "no_uns_path" });
  });

  it("a bare 404 (missing route / asset not in tenant) THROWS — a route failure is never a statement about the machine", async () => {
    request.mockResolvedValue({ status: 404, data: null });
    await expect(getAssetHistory("asset-1")).rejects.toMatchObject({ kind: "not_found", status: 404 });
    request.mockResolvedValue({ status: 404, data: { error: "asset_not_found" } });
    await expect(getAssetHistory("asset-1")).rejects.toMatchObject({ kind: "not_found", status: 404, detail: "asset_not_found" });
  });

  it("200 with reason unavailable is distinct from 'no rows' — never a fake timeline", async () => {
    request.mockResolvedValue({
      status: 200,
      data: { anchor: { at: ANCHOR, source: "explicit" }, rows: [], reason: "unavailable", freshness: { overall: "unknown" }, summary: {} },
    });
    const r = await getAssetHistory("asset-1", { at: ANCHOR });
    expect(r.ok && r.history.reason).toBe("unavailable");
    expect(r.ok && r.history.rows).toEqual([]);
  });
});

describe("askNotebook body.machineEvidence (§4.4) — additive only", () => {
  const sse = 'data: {"kind":"content","content":"ok"}\n\ndata: {"kind":"status","status":"answered"}\n\n';
  it("sends the window when given, and nothing extra when not", async () => {
    requestStream.mockImplementation(async (_p: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(sse);
      return { status: 200, data: null, text: sse };
    });
    const win = { assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2 };
    await askNotebook("nb-1", "what happened?", [], { machineEvidence: win });
    expect(requestStream.mock.calls[0][1].json).toEqual({ message: "what happened?", sourceDocIds: [], machineEvidence: win });

    await askNotebook("nb-1", "plain", ["d1"]);
    expect(requestStream.mock.calls[1][1].json).toEqual({ message: "plain", sourceDocIds: ["d1"] });
  });
});

describe("persisted turns (D5): the machine_evidence entry", () => {
  const entry = { kind: "machine_evidence", assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2, rowCount: 7, freshness: { overall: "stale", live: 0, stale: 4, simulated: 0, unknown: 0 }, windowId: "w-1" };
  const citation = { citationId: "1", sourceTitle: "gs10.pdf", page: 12, docId: "d1" };

  it("is read by machineEvidenceEntries and skipped by normalizeCitations", () => {
    const evidence = [citation, entry, "junk", null];
    expect(machineEvidenceEntries(evidence)).toEqual([
      { kind: "machine_evidence", assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2, rowCount: 7, freshness: entry.freshness, runId: null, windowId: "w-1" },
    ]);
    const chips = normalizeCitations(evidence);
    expect(chips).toHaveLength(1);
    expect(chips[0].citationId).toBe("1");
  });

  it("card title: Machine Replay · N observed changes around <time> · <freshness>", () => {
    const e = machineEvidenceEntries([entry])[0];
    expect(replayCardTitle(e)).toBe(`Machine Replay · 7 observed changes around ${hhmmss(ANCHOR)} · Stale`);
    expect(replayCardTitle({ rowCount: 1, anchorAt: ANCHOR, freshness: "live" })).toBe(`Machine Replay · 1 observed change around ${hhmmss(ANCHOR)} · Live`);
    // Unknown freshness is omitted, never guessed.
    expect(replayCardTitle({ rowCount: 0, anchorAt: ANCHOR, freshness: null })).toBe(`Machine Replay · 0 observed changes around ${hhmmss(ANCHOR)}`);
  });

  it("basis captions exist for the two machine bases only; history says 'not live'", () => {
    expect(basisCaption("live_machine_evidence")).toMatch(/live machine evidence/);
    expect(basisCaption("machine_history")).toMatch(/not live/);
    expect(basisCaption("general_reasoning")).toBeNull();
    expect(basisCaption("oem_documentation")).toBeNull();
    expect(basisCaption(null)).toBeNull();
  });

  it("the live evidence frame tolerates an echoed evidence[] with the discriminator", () => {
    const body =
      'data: {"kind":"content","content":"A"}\n\n' +
      `data: {"kind":"sources","citations":[${JSON.stringify(citation)}]}\n\n` +
      `data: {"kind":"evidence","basis":"machine_history","label":"x","evidence":[${JSON.stringify(citation)},${JSON.stringify(entry)}]}\n\n` +
      'data: {"kind":"status","status":"answered"}\n\n';
    const t = parseChatSse(body);
    expect(t.citations).toHaveLength(1);
    expect(t.evidenceBasis).toBe("machine_history");
    expect(t.machineEvidence?.[0].rowCount).toBe(7);
    // A frame without entries leaves the field absent — never an empty claim.
    const plain = parseChatSse('data: {"kind":"evidence","basis":"oem_documentation","label":"y"}\n\n');
    expect("machineEvidence" in plain).toBe(false);
  });

  it("the live evidence frame reads the Hub's SINGLE-object `machineEvidence` (chat/route.ts evidenceFrame)", () => {
    const body =
      'data: {"kind":"content","content":"A"}\n\n' +
      `data: {"kind":"evidence","basis":"live_machine_evidence","label":"x","machineEvidence":${JSON.stringify({ ...entry, freshness: "live" })}}\n\n` +
      'data: {"kind":"status","status":"answered"}\n\n';
    const t = parseChatSse(body);
    expect(t.evidenceBasis).toBe("live_machine_evidence");
    expect(t.machineEvidence).toHaveLength(1);
    expect(t.machineEvidence?.[0]).toMatchObject({ assetId: "asset-1", rowCount: 7, freshness: "live", windowId: "w-1" });
    // An object without the discriminator is not machine evidence.
    const none = parseChatSse('data: {"kind":"evidence","basis":"machine_history","label":"x","machineEvidence":{"assetId":"a"}}\n\n');
    expect("machineEvidence" in none).toBe(false);
  });

  it("replayQuestion names the fault time", () => {
    expect(replayQuestion(ANCHOR)).toContain(`fault at ${hhmmss(ANCHOR)}`);
  });
});

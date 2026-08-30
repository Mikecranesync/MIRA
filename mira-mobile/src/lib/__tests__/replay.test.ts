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
  REPLAY_DEFAULT_WINDOW,
  REPLAY_WINDOW_CAP,
  REPLAY_WINDOW_PRESETS,
  basisCaption,
  clocksDiverge,
  formatRelativeSeconds,
  liveUnavailable,
  machineEvidenceEntries,
  recordedObservations,
  replayCardTitle,
  replayQuestion,
  replayWindowHeader,
  sameWindow,
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
        // The Hub nests the FETCHED window (machine-history.ts
        // `historyResponseBody`) — there are no top-level pre/post.
        window: { from: "2026-08-28T23:16:26.160Z", to: "2026-08-28T23:16:33.160Z", pre: 5, post: 2 },
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
    expect({ pre: r.history.pre, post: r.history.post }).toEqual({ pre: 5, post: 2 });
    expect({ from: r.history.from, to: r.history.to }).toEqual({
      from: "2026-08-28T23:16:26.160Z",
      to: "2026-08-28T23:16:33.160Z",
    });
  });

  it("reads the window the SERVER fetched, not the one we asked for (clamped pre=120 → 60)", async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        anchor: { at: ANCHOR, source: "state_window", windowId: "w-1", runId: null },
        rows: [],
        freshness: { overall: "stale", live: 0, stale: 1, simulated: 0, unknown: 0 },
        summary: {},
        provenance: "machine_memory",
        // Asked for 120 s before; the server clamped to 60 s and said so.
        window: { from: "2026-08-28T23:15:31.160Z", to: "2026-08-28T23:16:41.160Z", pre: 60, post: 10 },
      },
    });
    const r = await getAssetHistory("asset-1", { at: ANCHOR, pre: 120, post: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The timeline header names the fetched window …
    expect(r.history.pre).toBe(60);
    expect(replayWindowHeader(r.history.rows.length, { pre: r.history.pre, post: r.history.post })).toBe(
      "0 recorded observations in −60 s … +10 s",
    );
    // … and so does the window Ask MIRA is handed (SensorSheet builds
    // machineEvidence from history.pre/post), so the two can never disagree.
    const machineEvidence = {
      assetId: "asset-1",
      anchorAt: r.history.anchor.at,
      pre: r.history.pre,
      post: r.history.post,
    };
    const sse = 'data: {"kind":"status","status":"answered"}\n\n';
    requestStream.mockImplementation(async (_p: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(sse);
      return { status: 200, data: null, text: sse };
    });
    await askNotebook("nb-1", "what happened?", [], { machineEvidence });
    expect(requestStream.mock.calls[0][1].json.machineEvidence).toEqual({
      assetId: "asset-1",
      anchorAt: ANCHOR,
      pre: 60,
      post: 10,
    });
  });

  it("derives the window from the server's absolute bounds when only from/to are named", async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        anchor: { at: ANCHOR, source: "state_window" },
        rows: [],
        freshness: { overall: "stale", live: 0, stale: 1, simulated: 0, unknown: 0 },
        summary: {},
        provenance: "machine_memory",
        window: { from: "2026-08-28T23:15:31.160Z", to: "2026-08-28T23:16:41.160Z" },
      },
    });
    const r = await getAssetHistory("asset-1", { at: ANCHOR, pre: 120, post: 10 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect({ pre: r.history.pre, post: r.history.post }).toEqual({ pre: 60, post: 10 });
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

  it("S5 D3: sends body.visualEvidence {fileId, capturedAt} — identifiers only, never rows", async () => {
    requestStream.mockImplementation(async (_p: string, o: { onChunk: (c: string) => void }) => {
      o.onChunk(sse);
      return { status: 200, data: null, text: sse };
    });
    const visual = { fileId: "f-park", capturedAt: "2026-08-28T02:14:21.000Z" };
    await askNotebook("nb-1", "what is lit?", [], { visualEvidence: visual });
    expect(requestStream.mock.calls[0][1].json).toEqual({ message: "what is lit?", sourceDocIds: [], visualEvidence: visual });
  });
});

describe("the window the technician is looking at (S5 D2)", () => {
  it("client default is 60 s before / 10 s after — the server's 5 s / 2 s cannot reach a cause at −7.02 s", () => {
    expect(REPLAY_DEFAULT_WINDOW).toEqual({ pre: 60, post: 10 });
    expect(REPLAY_DEFAULT_WINDOW.pre).toBeGreaterThan(7.02);
  });

  it("presets are ±5 s / 60 s / 120 s and never exceed the server cap", () => {
    expect(REPLAY_WINDOW_PRESETS.map((p) => p.label)).toEqual(["±5 s", "60 s", "120 s"]);
    expect(REPLAY_WINDOW_PRESETS.some((p) => sameWindow(p, REPLAY_DEFAULT_WINDOW))).toBe(true);
    for (const p of REPLAY_WINDOW_PRESETS) {
      expect(p.pre).toBeLessThanOrEqual(REPLAY_WINDOW_CAP);
      expect(p.post).toBeLessThanOrEqual(REPLAY_WINDOW_CAP);
    }
    expect(REPLAY_WINDOW_PRESETS[2].pre).toBe(REPLAY_WINDOW_CAP);
  });

  it("header names the fetched window: 'N recorded observations in −60 s … +10 s'", () => {
    expect(replayWindowHeader(7, { pre: 60, post: 10 })).toBe("7 recorded observations in −60 s … +10 s");
    expect(replayWindowHeader(1, { pre: 120, post: 10 })).toBe("1 recorded observation in −120 s … +10 s");
    expect(replayWindowHeader(0, { pre: 5, post: 5 })).toBe("0 recorded observations in −5 s … +5 s");
    // The rows are periodic samples as well as diffs, so the header must not
    // call them changes — a repeated value is an observation, not a change.
    expect(replayWindowHeader(7, { pre: 60, post: 10 })).not.toMatch(/observed change/);
  });
});

describe("persisted turns (D5): the machine_evidence entry", () => {
  const entry = { kind: "machine_evidence", assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2, rowCount: 7, freshness: { overall: "stale", live: 0, stale: 4, simulated: 0, unknown: 0 }, windowId: "w-1" };
  const citation = { citationId: "1", sourceTitle: "gs10.pdf", page: 12, docId: "d1" };

  it("is read by machineEvidenceEntries and skipped by normalizeCitations", () => {
    const evidence = [citation, entry, "junk", null];
    expect(machineEvidenceEntries(evidence)).toEqual([
      { kind: "machine_evidence", assetId: "asset-1", anchorAt: ANCHOR, pre: 5, post: 2, rowCount: 7, freshness: entry.freshness, reason: null, runId: null, windowId: "w-1" },
    ]);
    const chips = normalizeCitations(evidence);
    expect(chips).toHaveLength(1);
    expect(chips[0].citationId).toBe("1");
  });

  it("card title: Machine Replay · N recorded observations around <time> · <freshness>", () => {
    const e = machineEvidenceEntries([entry])[0];
    expect(replayCardTitle(e)).toBe(`Machine Replay · 7 recorded observations around ${hhmmss(ANCHOR)} · Stale`);
    expect(replayCardTitle({ rowCount: 1, anchorAt: ANCHOR, freshness: "live" })).toBe(`Machine Replay · 1 recorded observation around ${hhmmss(ANCHOR)} · Live`);
    // Unknown freshness is omitted, never guessed.
    expect(replayCardTitle({ rowCount: 3, anchorAt: ANCHOR, freshness: null })).toBe(`Machine Replay · 3 recorded observations around ${hhmmss(ANCHOR)}`);
    // Never "observed changes": /history rows include periodic tag_events
    // samples, so a row is an observation, not necessarily a change.
    expect(replayCardTitle(e)).not.toMatch(/observed change/);
  });

  it("recordedObservations is the ONE phrase both the header and the card use", () => {
    expect(recordedObservations(0)).toBe("0 recorded observations");
    expect(recordedObservations(1)).toBe("1 recorded observation");
    expect(recordedObservations(7)).toBe("7 recorded observations");
    expect(replayWindowHeader(7, { pre: 60, post: 10 })).toContain(recordedObservations(7));
    expect(replayCardTitle({ rowCount: 7, anchorAt: ANCHOR, freshness: "live" })).toContain(
      recordedObservations(7),
    );
  });

  it("reason:'unavailable' → 'Machine history unavailable': no count, no freshness label", () => {
    const [e] = machineEvidenceEntries([{ ...entry, rowCount: 0, reason: "unavailable" }]);
    expect(e.reason).toBe("unavailable");
    expect(replayCardTitle(e)).toBe("Machine history unavailable");
    // Even a non-zero rowCount cannot outvote the server saying it had no
    // tables to read, and the freshness label is never appended.
    expect(replayCardTitle({ rowCount: 7, anchorAt: ANCHOR, freshness: "stale", reason: "unavailable" })).toBe(
      "Machine history unavailable",
    );
    expect(replayCardTitle(e)).not.toMatch(/recorded observation|Stale|Live/);
  });

  it("rowCount 0 with no reason → 'No machine changes recorded in this window'", () => {
    const [e] = machineEvidenceEntries([{ ...entry, rowCount: 0 }]);
    expect(e.reason).toBeNull();
    expect(replayCardTitle(e)).toBe("No machine changes recorded in this window");
    // Distinct from the unavailable sentence — an answered "nothing changed"
    // is a finding; a missing table is not.
    expect(replayCardTitle(e)).not.toBe("Machine history unavailable");
  });

  it("basis captions exist for the two machine bases only; history says 'not live'", () => {
    // Byte-identical to the hub lane's captions (#3461), trailing period
    // included — one answer must not read differently on two surfaces.
    expect(basisCaption("live_machine_evidence")).toBe("Grounded in live machine evidence.");
    expect(basisCaption("machine_history")).toBe("Grounded in recorded machine history — not live.");
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

// ── Workstream C (PRD §9.2) — coverage vs current connection ────────────────
import {
  CURRENT_CONNECTION_LABEL,
  EMPTY_WINDOW_MESSAGE,
  HISTORY_UNAVAILABLE_MESSAGE,
  canAskWhatHappened,
  coverageHeader,
  currentConnectionLabel,
  ingestLagNote,
} from "../replay";

describe("Workstream C — two clocks, two questions (§9.2)", () => {
  const base = {
    anchor: { at: "2026-08-28T23:16:31.000Z", source: "state_window" as const },
    rows: [],
    freshness: { overall: "live" as const, live: 3, stale: 0, simulated: 0, unknown: 0 },
    summary: {},
    provenance: "machine_memory" as const,
    reason: null,
    pre: 60,
    post: 10,
  };

  it("the CTA is allowed ONLY on the server's admissible coverage", () => {
    expect(canAskWhatHappened({ ...base, coverage: { recorded: 3, admissible: true, historyAvailable: true } })).toBe(true);
    expect(canAskWhatHappened({ ...base, coverage: { recorded: 0, admissible: false, historyAvailable: true } })).toBe(false);
    expect(canAskWhatHappened({ ...base, reason: "unavailable", coverage: { recorded: 0, admissible: false, historyAvailable: false } })).toBe(false);
    // a server that names rows but not `admissible` (older Hub) → derived from rows + reason, never from freshness
    expect(canAskWhatHappened({ ...base, rows: [{} as never], coverage: null })).toBe(true);
    expect(canAskWhatHappened({ ...base, rows: [], coverage: null })).toBe(false);
    expect(canAskWhatHappened({ ...base, rows: [{} as never], reason: "unavailable", coverage: null })).toBe(false);
  });

  it("current-connection freshness is its own labelled fact and never reads as window coverage", () => {
    expect(currentConnectionLabel({ overall: "live" })).toBe(`${CURRENT_CONNECTION_LABEL}: Live`);
    expect(currentConnectionLabel({ overall: "stale" })).toBe(`${CURRENT_CONNECTION_LABEL}: Stale`);
    expect(currentConnectionLabel({ overall: "simulated" })).toBe(`${CURRENT_CONNECTION_LABEL}: Simulated`);
    expect(currentConnectionLabel({ overall: "unknown" })).toBe(`${CURRENT_CONNECTION_LABEL}: No tags`);
  });

  it("coverage header is written from the WINDOW: count, bounds, availability", () => {
    expect(coverageHeader({ ...base, coverage: { recorded: 7, admissible: true, historyAvailable: true } })).toBe(
      "7 recorded observations in −60 s … +10 s",
    );
    expect(coverageHeader({ ...base, coverage: { recorded: 0, admissible: false, historyAvailable: true } })).toBe(
      "0 recorded observations in −60 s … +10 s",
    );
    expect(coverageHeader({ ...base, reason: "unavailable", coverage: { recorded: 0, admissible: false, historyAvailable: false } })).toBe(
      "History source unavailable · −60 s … +10 s",
    );
  });

  it("the empty-window sentence is the PRD's, and unavailable is a different sentence", () => {
    expect(EMPTY_WINDOW_MESSAGE).toBe("Nothing was recorded in this window. Widen the window or check the gateway.");
    expect(HISTORY_UNAVAILABLE_MESSAGE).not.toBe(EMPTY_WINDOW_MESSAGE);
    expect(HISTORY_UNAVAILABLE_MESSAGE).toMatch(/isn.t available/i);
  });

  it("both clocks: a material ingest lag is named; a negligible one is not", () => {
    expect(ingestLagNote({ ingestLagMaxMs: 2040 })).toBe("Ingest lagged the machine clock by up to 2.0 s");
    expect(ingestLagNote({ ingestLagMaxMs: 400 })).toBeNull();
    expect(ingestLagNote({ ingestLagMaxMs: null })).toBeNull();
    expect(ingestLagNote(null)).toBeNull();
  });
});

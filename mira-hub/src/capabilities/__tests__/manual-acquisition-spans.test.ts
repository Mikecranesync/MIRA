/**
 * R15 acquisition span tree (#4160 gate NO-GO row, PRD v1.7.1 R15) —
 * manual_acquisition.search / .download / .ingest / .applicability children
 * produced by acquireManualForIdentity, asserted against the REAL tracer
 * (tracing.ts's in-memory exporter — see chat-flight-recorder.test.ts for
 * the established pattern of driving real spans rather than mocking them).
 *
 * Every dependency of manual-acquisition.ts is mocked via an importOriginal
 * spread (never an explicit export list) — see acquisition-spans.ts's own
 * header comment for why: several sibling test files replace
 * @/capabilities/manual-acquisition and @/capabilities/notebook-manual-acquisition
 * with explicit, non-spread mocks, so any new export on either of THOSE two
 * files would come back undefined there. This file mocks ONLY the leaf
 * dependencies manual-acquisition.ts itself calls, which no other suite
 * touches, so a spread here is just defensive hygiene, not a requirement.
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-acquisition-spans.test.ts
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { __testing__installInMemoryExporter } from "@/capabilities/observability/tracing";

const discoveryMock = vi.hoisted(() => ({ discoverManual: vi.fn() }));
vi.mock("@/lib/manual-discovery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-discovery")>()),
  discoverManual: discoveryMock.discoverManual,
}));

const downloadMock = vi.hoisted(() => ({ safeDownloadPdf: vi.fn() }));
vi.mock("@/lib/safe-download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/safe-download")>()),
  safeDownloadPdf: downloadMock.safeDownloadPdf,
}));

const ingestMock = vi.hoisted(() => ({
  ingestPdfToNode: vi.fn(),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));
vi.mock("@/lib/node-knowledge-ingest", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/node-knowledge-ingest")>()),
  ingestPdfToNode: ingestMock.ingestPdfToNode,
  deleteOrphanNodeIngest: ingestMock.deleteOrphanNodeIngest,
}));

const filesMock = vi.hoisted(() => ({
  parkOrReuseFile: vi.fn(),
  linkFileToUpload: vi.fn(async () => true),
  attachFileToTargets: vi.fn(async () => ({ ok: true as const, links: [] })),
  claimIngest: vi.fn(async () => ({ claimed: true as const, claimToken: "tok-1" })),
  releaseIngestClaim: vi.fn(async () => undefined),
}));
vi.mock("@/lib/workspace-files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/workspace-files")>()),
  ...filesMock,
}));

const applicabilityMock = vi.hoisted(() => ({ assessApplicability: vi.fn() }));
vi.mock("@/lib/manual-applicability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/manual-applicability")>()),
  assessApplicability: applicabilityMock.assessApplicability,
}));

const equipmentNotebooksMock = vi.hoisted(() => ({
  setSourceState: vi.fn(async () => ({ match_state: "verified", enabled_by_default: true })),
}));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/equipment-notebooks")>()),
  setSourceState: equipmentNotebooksMock.setSourceState,
}));

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({ query: vi.fn(async () => ({ rows: [] })) })),
}));

import { acquireManualForIdentity } from "@/capabilities/manual-acquisition";

// Deliberately unreal — any of these appearing in an exported span attribute
// value is a leak, never a coincidence.
const MFR = "ZzyxOemCorp-TESTMFR";
const MODEL = "ZZYX-9000-TESTMODEL";
const PART = "ZZYX-PART-TESTPART";
const IDENTITY = { manufacturer: MFR, model: MODEL, catalogNumber: PART };
const BASE_INPUT = { tenantId: "t1", userId: "u1", notebookId: "test-notebook-nb1", nodeId: "node1", identity: IDENTITY };

const CANDIDATE = {
  url: "https://example-oem.test/manual.pdf",
  title: "Manual",
  host: "example-oem.test",
  score: 10,
  docType: null,
  isDirectPdf: true,
  validated: true,
};

const FOUND_DISCOVERY = {
  serviceAvailable: true,
  found: true,
  candidate: CANDIDATE,
  validated: true,
  isDirectPdf: true,
  oemHost: true,
  trustedDistributorHost: false,
  reason: "ok",
  oemRequestUrl: null,
  quotaExceeded: false,
  searchStats: { providerQueries: 4, refusedQueries: 0, quotaDenied: null, candidates: 3 },
};

const VERIFIED_VERDICT = {
  state: "verified" as const,
  method: "exact_match",
  matchedTokens: [],
  evidencePages: [],
  confidence: 1,
  reason: "identity confirmed in the document text",
};

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
beforeAll(() => {
  handle = __testing__installInMemoryExporter();
});

beforeEach(() => {
  vi.clearAllMocks();
  handle.reset();
  delete process.env.MANUAL_SEARCH_COST_PER_QUERY_USD;
  discoveryMock.discoverManual.mockResolvedValue(FOUND_DISCOVERY);
  downloadMock.safeDownloadPdf.mockResolvedValue({
    ok: true as const,
    buffer: Buffer.from("PDFBYTES"),
    finalUrl: CANDIDATE.url,
    contentType: "application/pdf",
  });
  filesMock.parkOrReuseFile.mockResolvedValue({ fileId: "test-file-file1", reused: false, uploadId: null });
  ingestMock.ingestPdfToNode.mockResolvedValue({ uploadId: "test-doc-doc1", chunkCount: 7 });
  applicabilityMock.assessApplicability.mockReturnValue(VERIFIED_VERDICT);
});

function allAttrValues(spans: ReturnType<typeof handle.finished>): string[] {
  return spans.flatMap((s) => Object.values(s.attributes).map((v) => String(v)));
}

describe("acquireManualForIdentity — R15 span tree", () => {
  it("a successful acquisition produces manual_acquisition.search/.download/.ingest/.applicability; provider_queries=4 and cost_usd=0.004 are on the search span", async () => {
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("complete");

    const spans = handle.finished();
    const names = spans.map((s) => s.name);
    for (const expected of [
      "manual_acquisition.search",
      "manual_acquisition.download",
      "manual_acquisition.ingest",
      "manual_acquisition.applicability",
    ]) {
      expect(names).toContain(expected);
    }

    const search = spans.find((s) => s.name === "manual_acquisition.search")!;
    expect(search.attributes["mira.acquisition.provider_queries"]).toBe(4);
    expect(search.attributes["mira.acquisition.candidates"]).toBe(3);
    expect(search.attributes["mira.acquisition.cap_hit"]).toBe(false);
    expect(search.attributes["mira.acquisition.cost_usd"]).toBeCloseTo(0.004, 6);

    const download = spans.find((s) => s.name === "manual_acquisition.download")!;
    expect(download.attributes["mira.acquisition.download_bytes"]).toBe(Buffer.from("PDFBYTES").length);
    expect(typeof download.attributes["mira.acquisition.download_ms"]).toBe("number");

    const ingest = spans.find((s) => s.name === "manual_acquisition.ingest")!;
    expect(ingest.attributes["mira.acquisition.ingest_chunks"]).toBe(7);
    // The pipeline has no page count — never invented (R15).
    expect(ingest.attributes["mira.acquisition.ingest_pages"]).toBeUndefined();
    expect(typeof ingest.attributes["mira.acquisition.ingest_ms"]).toBe("number");

    const applicability = spans.find((s) => s.name === "manual_acquisition.applicability")!;
    expect(applicability.attributes["mira.acquisition.match_state"]).toBe("verified");

    const recall = spans.find((s) => s.name === "manual_acquisition.recall")!;
    expect(recall.attributes["mira.acquisition.recall_hit"]).toBe(false);
  });

  it("a quota-denied run has a search span with cap_hit=true, cap_scope set, and no download/ingest spans", async () => {
    discoveryMock.discoverManual.mockResolvedValue({
      ...FOUND_DISCOVERY,
      found: false,
      candidate: null,
      quotaExceeded: true,
      reason: "manual-search limit reached",
      searchStats: { providerQueries: 1, refusedQueries: 1, quotaDenied: "user_cap", candidates: 0 },
    });

    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("search_limit_reached");

    const spans = handle.finished();
    const search = spans.find((s) => s.name === "manual_acquisition.search")!;
    expect(search).toBeTruthy();
    expect(search.attributes["mira.acquisition.cap_hit"]).toBe(true);
    expect(search.attributes["mira.acquisition.cap_scope"]).toBe("user_cap");
    expect(search.attributes["mira.acquisition.provider_queries"]).toBe(1);

    expect(spans.find((s) => s.name === "manual_acquisition.download")).toBeUndefined();
    expect(spans.find((s) => s.name === "manual_acquisition.ingest")).toBeUndefined();
    expect(downloadMock.safeDownloadPdf).not.toHaveBeenCalled();
    expect(ingestMock.ingestPdfToNode).not.toHaveBeenCalled();
  });

  it("no exported attribute value contains the test manufacturer, model or part string", async () => {
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("complete");

    const spans = handle.finished();
    expect(spans.length).toBeGreaterThan(0);
    const haystack = allAttrValues(spans);
    for (const leak of [MFR, MODEL, PART, CANDIDATE.url, CANDIDATE.host, "test-file-file1", "test-doc-doc1", "test-notebook-nb1"]) {
      for (const value of haystack) {
        expect(value.includes(leak)).toBe(false);
      }
    }
  });

  it("a discovery response WITHOUT search_stats still completes, and provider_queries is absent or null (never a fabricated 0)", async () => {
    discoveryMock.discoverManual.mockResolvedValue({ ...FOUND_DISCOVERY, searchStats: null });

    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("complete");

    const search = handle.finished().find((s) => s.name === "manual_acquisition.search")!;
    expect(search.attributes["mira.acquisition.provider_queries"]).toBeUndefined();
    expect(search.attributes["mira.acquisition.candidates"]).toBeUndefined();
    expect(search.attributes["mira.acquisition.cost_usd"]).toBeUndefined();
    // cap_hit is always known (quotaExceeded is a plain boolean, never absent).
    expect(search.attributes["mira.acquisition.cap_hit"]).toBe(false);
  });

  // Codex #4194 F3: discovery returns a usable candidate that survived a later
  // cap denial (found, quotaExceeded=false, quota_denied set) — still a cap hit.
  it("a candidate that survives a later cap denial still reports cap_hit=true with its scope", async () => {
    discoveryMock.discoverManual.mockResolvedValue({
      ...FOUND_DISCOVERY,
      searchStats: { providerQueries: 2, refusedQueries: 1, quotaDenied: "user_cap", candidates: 1 },
    });
    expect((await acquireManualForIdentity({ ...BASE_INPUT })).status).toBe("complete");
    const search = handle.finished().find((s) => s.name === "manual_acquisition.search")!;
    expect(search.attributes["mira.acquisition.cap_hit"]).toBe(true);
    expect(search.attributes["mira.acquisition.cap_scope"]).toBe("user_cap");
  });

  it("control: an infrastructure denial (quota_unavailable) is NOT a cap hit, though its scope is kept", async () => {
    discoveryMock.discoverManual.mockResolvedValue({
      ...FOUND_DISCOVERY,
      searchStats: { providerQueries: 2, refusedQueries: 1, quotaDenied: "quota_unavailable", candidates: 1 },
    });
    await acquireManualForIdentity({ ...BASE_INPUT });
    const search = handle.finished().find((s) => s.name === "manual_acquisition.search")!;
    expect(search.attributes["mira.acquisition.cap_hit"]).toBe(false);
    expect(search.attributes["mira.acquisition.cap_scope"]).toBe("quota_unavailable");
  });

  // Codex #4194 F2: a failing stage must not export its raw message — the
  // scanned-PDF error names the file, and the file is named after the model.
  it("a stage that throws exports only an error category — never the message, stack or filename", async () => {
    const { NoExtractableTextError } = await import("@/lib/node-knowledge-ingest");
    ingestMock.ingestPdfToNode.mockRejectedValue(new NoExtractableTextError(`${MODEL}-manual.pdf`));
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("no_extractable_text");

    const spans = handle.finished();
    const errored = spans.filter((s) => s.attributes["mira.acquisition.error"] !== undefined);
    expect(errored.length).toBeGreaterThan(0);
    expect(errored.every((s) => s.attributes["mira.acquisition.error"] === "NoExtractableTextError")).toBe(true);
    const exported = JSON.stringify(
      spans.map((s) => ({ attributes: s.attributes, events: s.events, status: s.status, name: s.name })),
    );
    for (const leak of [MFR, MODEL, PART, "no extractable text in"]) {
      expect(exported.includes(leak)).toBe(false);
    }
  });
});


// ── Candidate trail (Golden Walk 2026-10-05) ─────────────────────────────────
// One span event per candidate so a single trace explains why a document won —
// and the R15 leak rule extends to events: no identity, URL, host or title.
describe("candidate trail on the search span", () => {
  const TRAIL = {
    version: 1,
    queries: [{ pass: "q1", query: `"${MODEL}" manual`, result: "sent", hits: 2 }],
    stop: "ideal_match",
    candidateCount: 2,
    candidates: [
      {
        rank: 0, url: CANDIDATE.url, host: CANDIDATE.host, title: `${MODEL} firmware manual`, score: 185,
        pass: "q1", read: "judged", readReason: null, notQueued: null, isManual: true, docType: "user_manual",
        scope: "complete", listsFaultCodes: true, language: "en", textLanguage: "en", confidence: 0.97,
        provider: "groq", selected: true,
      },
      {
        rank: 1, url: "https://example-oem.test/PTBR_manual.pdf", host: CANDIDATE.host, title: `${MODEL} PTBR`,
        score: 175, pass: "q1", read: "unfetched", readReason: "fetch_timeout", notQueued: null, isManual: null,
        docType: null, scope: null, listsFaultCodes: null, language: null, textLanguage: null, confidence: null,
        provider: null, selected: false,
      },
    ],
  };

  function candidateEvents() {
    const search = handle.finished().find((s) => s.name === "manual_acquisition.search");
    return (search?.events ?? []).filter((e) => e.name === "manual_acquisition.candidate");
  }

  it("records one identity-free event per candidate, with the read reason and the winner", async () => {
    discoveryMock.discoverManual.mockResolvedValue({ ...FOUND_DISCOVERY, candidateTrail: TRAIL });
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });

    const events = candidateEvents();
    expect(events).toHaveLength(2);
    expect(events[0].attributes?.["mira.candidate.selected"]).toBe(true);
    expect(events[0].attributes?.["mira.candidate.lists_fault_codes"]).toBe(true);
    expect(events[1].attributes?.["mira.candidate.read"]).toBe("unfetched");
    expect(events[1].attributes?.["mira.candidate.read_reason"]).toBe("fetch_timeout");
    const search = handle.finished().find((s) => s.name === "manual_acquisition.search");
    expect(search?.attributes["mira.acquisition.trail.stop"]).toBe("ideal_match");

    const values = [
      ...events.flatMap((e) => Object.values(e.attributes ?? {}).map(String)),
      ...allAttrValues(handle.finished()),
    ];
    for (const leak of [MFR, MODEL, PART, CANDIDATE.url, CANDIDATE.host, "PTBR_manual"]) {
      for (const v of values) expect(v.includes(leak)).toBe(false);
    }
    // The full trail rides on the outcome for the acquisition record — never on
    // the payload, which routes return to clients.
    expect(outcome.candidateTrail).toEqual(TRAIL);
    expect("candidateTrail" in outcome.payload).toBe(false);
  });

  it("an old mira-ask (no trail) emits no candidate events and no outcome trail", async () => {
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(candidateEvents()).toHaveLength(0);
    expect(outcome.candidateTrail).toBeUndefined();
  });

  it("a no-manual outcome still carries the trail", async () => {
    discoveryMock.discoverManual.mockResolvedValue({
      ...FOUND_DISCOVERY, found: false, candidate: null, validated: false, isDirectPdf: false, oemHost: false,
      reason: "no official manual found", candidateTrail: TRAIL,
    });
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("no_manual_found");
    expect(outcome.candidateTrail).toEqual(TRAIL);
    expect(candidateEvents()).toHaveLength(2);
  });
});

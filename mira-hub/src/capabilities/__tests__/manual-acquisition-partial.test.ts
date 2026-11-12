/**
 * Garage pilot L2 (plan row 5-A/C, M5) — an auto-acquired candidate whose text
 * is ONE CHAPTER (ch1.pdf: page 1 is the chapter heading + its own table of
 * contents) or whose numbers carry an unmapped glyph ("5�1" for 5.1 A) is
 * marked partial: it is never promoted to verified+enabled, it never stamps
 * candidateApplicability='verified' (the only stamp migration 104 / the fenced
 * writer promote on identity confirmation), and the outcome says "add the full
 * manual". A whole manual with the same verdict promotes exactly as today.
 *
 * Same harness as manual-acquisition-spans.test.ts: every leaf dependency of
 * manual-acquisition.ts is mocked via an importOriginal spread; the chunk read
 * (`SELECT content, source_page …`) is answered from a per-test fixture, every
 * other query returns no rows; setSourceState echoes the patch it was given so
 * the outcome reports what would actually have been stored.
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-acquisition-partial.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

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

type Patch = { matchState?: string; enabledByDefault?: boolean; matchEvidence?: unknown };
const equipmentNotebooksMock = vi.hoisted(() => ({
  setSourceState: vi.fn(async (_t: string, _n: string, _d: string, _p: Patch) => true),
}));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/equipment-notebooks")>()),
  setSourceState: equipmentNotebooksMock.setSourceState,
}));

/** The acquired document's stored chunks, answered to the chunk read only. The document-wide
 *  glyph-count query (Codex #5429 r1 F3) is answered from the SAME fixture — computed over
 *  ALL of `stored.rows`, unbounded, mirroring the real query scanning the whole document
 *  rather than the APPLICABILITY_CHUNK_LIMIT-bounded sample `chunksForDoc` reads. Set
 *  `stored.documentWideError = true` to make that query throw (the retry-later path). */
const stored = vi.hoisted(() => ({
  rows: [] as Array<{ content: string; source_page: number | null }>,
  documentWideError: false,
}));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      // `params` is honored for the chunk read so the mock actually simulates the real
      // query's `LIMIT $3` (APPLICABILITY_CHUNK_LIMIT) — otherwise a fixture with >80 rows
      // could never exercise "the bounded sample misses it" (Codex #5429 r1 F3).
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (/SELECT content, source_page/.test(sql)) {
          const limit = (params?.[2] as number | undefined) ?? stored.rows.length;
          return { rows: stored.rows.slice(0, limit) };
        }
        if (/count\(DISTINCT/.test(sql)) {
          if (stored.documentWideError) throw new Error("document-wide glyph scan: connection reset");
          // Emulates Postgres NULL semantics from the query's own shape (Gate 7 cheap-lane r5 HIGH on
          // #5429): `count(DISTINCT source_page)` DROPS a NULL page, so a glyph-bearing chunk with no
          // page number is invisible to it, while `assessCompleteness`'s own `glyphPages` Set counts
          // that chunk as one unreadable "page". `count(DISTINCT coalesce(source_page, -1))` keeps
          // NULL as one bucket, matching the Set. A mock that always used Set semantics could never
          // go red on the SQL — this one answers the way the database would.
          const nullAsBucket = /coalesce\(\s*source_page/i.test(sql);
          const pages = new Set(
            stored.rows
              .filter((r) => /\d�\d/.test(r.content))
              .map((r) => r.source_page)
              .filter((p) => nullAsBucket || p !== null)
              .map((p) => (nullAsBucket ? (p ?? -1) : p)),
          );
          return { rows: [{ n: pages.size }] };
        }
        return { rows: [] };
      }),
    }),
  ),
}));

import { acquireManualForIdentity } from "@/capabilities/manual-acquisition";

const IDENTITY = { manufacturer: "AutomationDirect", model: "GS11N", catalogNumber: "GS11N-20P2" };
const BASE_INPUT = { tenantId: "t1", userId: "u1", notebookId: "test-notebook-nb1", nodeId: "node1", identity: IDENTITY };

const CANDIDATE = {
  url: "https://cdn.automationdirect.com/static/manuals/gs10m/ch1.pdf",
  title: "GS10 Drive User Manual - Chapter 1",
  host: "cdn.automationdirect.com",
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
  matchedTokens: ["GS11N-20P2"],
  evidencePages: [12],
  confidence: 1,
  reason: "identity confirmed in the document text",
};

// ch1.pdf as stored (typed from the extracted pages; see manual-completeness.test.ts).
const CH1_ROWS = [
  { content: "Getting Started\n111\nChapterChapterChapterPage 1–1DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nTable of Contents\nChapter 1: Getting Started\nUser Manual Overview � � � 1–2", source_page: 1 },
  { content: "Chapter 1: Getting Started\nPage 1–2 DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nUser Manual Overview", source_page: 2 },
  { content: "Model Name: GS11N-2xPx GS11N-20P2 GS11N-20P5\nInput Rating2 CT Rated Input Current A 5�1 7�3", source_page: 12 },
];
// The full manual as stored: cover, blank page, warnings, a chapter start much later.
const FULL_ROWS = [
  { content: "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions", source_page: 1 },
  { content: "BLANK PAGE", source_page: 2 },
  { content: "Page W–1DURApulse GS10 Drive User Manual – 1st Ed., Rev C\nWarnings and Trademarks", source_page: 3 },
  { content: "Chapter 1: Getting Started\nModel Name: GS11N-2xPx GS11N-20P2 GS11N-20P5\nInput Rating2 CT Rated Input Current A 5.1 7.3", source_page: 26 },
];

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MANUAL_SEARCH_COST_PER_QUERY_USD;
  discoveryMock.discoverManual.mockResolvedValue(FOUND_DISCOVERY);
  downloadMock.safeDownloadPdf.mockResolvedValue({
    ok: true as const,
    buffer: Buffer.from("PDFBYTES"),
    finalUrl: CANDIDATE.url,
    contentType: "application/pdf",
  });
  filesMock.parkOrReuseFile.mockResolvedValue({ fileId: "test-file-file1", reused: false, uploadId: null });
  ingestMock.ingestPdfToNode.mockResolvedValue({ uploadId: "test-doc-doc1", chunkCount: 3 });
  applicabilityMock.assessApplicability.mockReturnValue(VERIFIED_VERDICT);
  stored.rows = CH1_ROWS;
  stored.documentWideError = false;
});

function storedPatch(): Patch {
  const calls = equipmentNotebooksMock.setSourceState.mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]![3];
}

describe("a one-chapter candidate with a VERIFIED applicability verdict", () => {
  it("is saved as a disabled candidate marked partial, never 'complete'", async () => {
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("candidate_review");
    const patch = storedPatch();
    expect(patch.matchState).toBe("candidate");
    expect(patch.enabledByDefault).toBe(false);
    const evidence = patch.matchEvidence as { completeness?: { complete: boolean; reasons: string[]; unreadablePages: number } };
    expect(evidence.completeness).toEqual({ complete: false, reasons: ["chapter_start", "unmapped_glyphs"], firstPage: 1, unreadablePages: 1 });
    const manual = out.payload.manual as { matchState: string; enabledByDefault: boolean; completeness?: unknown };
    expect(manual.matchState).toBe("candidate");
    expect(manual.enabledByDefault).toBe(false);
    expect(manual.completeness).toEqual(evidence.completeness);
    expect(String(out.payload.message)).toMatch(/full manual/i);
  });

  it("photo basis: never stamps candidateApplicability='verified', so identity confirmation cannot promote it either", async () => {
    const out = await acquireManualForIdentity({ ...BASE_INPUT, basis: "candidate" });
    expect(out.status).toBe("candidate_review");
    const evidence = storedPatch().matchEvidence as { candidateApplicability?: string };
    expect(evidence.candidateApplicability).toBe("candidate");
    const manual = out.payload.manual as { candidateApplicability?: string };
    expect(manual.candidateApplicability).toBe("candidate");
  });

  it("a chapter file with clean numbers is still partial (chapter_start alone)", async () => {
    stored.rows = CH1_ROWS.map((r) => ({ ...r, content: r.content.replace(/�/g, ".") }));
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("candidate_review");
    const evidence = storedPatch().matchEvidence as { completeness?: { reasons: string[] } };
    expect(evidence.completeness?.reasons).toEqual(["chapter_start"]);
  });
});

describe("controls", () => {
  it("the whole manual with the same verdict promotes exactly as today: verified, enabled, complete", async () => {
    stored.rows = FULL_ROWS;
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("complete");
    const patch = storedPatch();
    expect(patch.matchState).toBe("verified");
    expect(patch.enabledByDefault).toBe(true);
    const evidence = patch.matchEvidence as { completeness?: { complete: boolean; reasons: string[] } };
    expect(evidence.completeness).toEqual({ complete: true, reasons: [], firstPage: 1, unreadablePages: 0 });
    expect(String(out.payload.message)).not.toMatch(/full manual/i);
  });

  it("photo basis, whole manual: candidateApplicability stays 'verified' (unchanged)", async () => {
    stored.rows = FULL_ROWS;
    await acquireManualForIdentity({ ...BASE_INPUT, basis: "candidate" });
    const evidence = storedPatch().matchEvidence as { candidateApplicability?: string };
    expect(evidence.candidateApplicability).toBe("verified");
  });

  it("a chapter file whose text does NOT verify the model stays a candidate and still says 'full manual'", async () => {
    applicabilityMock.assessApplicability.mockReturnValue({ ...VERIFIED_VERDICT, state: "candidate" as const, reason: "model not named" });
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("candidate_review");
    expect(storedPatch().matchState).toBe("candidate");
    expect(String(out.payload.message)).toMatch(/full manual/i);
  });
});

// A long manual whose first 80 pages (the APPLICABILITY_CHUNK_LIMIT-bounded identity-evidence
// sample `chunksForDoc` reads) are entirely clean; page 81 — past that sample — carries the
// unmapped glyph. Before Codex #5429 r1 F3 this was invisible: assessCompleteness only ever
// saw the bounded sample, so a long table's unreadable numbers past chunk 80 never marked the
// manual partial.
const LONG_CLEAN_ROWS = Array.from({ length: 80 }, (_, i) => ({
  content: i === 0 ? "DURApulse GS10 Drive User Manual\nGS10_UMW\nOriginal Instructions" : `Section ${i} filler text, nothing special.`,
  source_page: i + 1,
}));
const ROW_81_GLYPH = { content: "Appendix table continued\nInput Rating2 CT Rated Input Current A 5�1 7�3", source_page: 81 };
const LONG_DOC_WITH_LATE_GLYPH = [...LONG_CLEAN_ROWS, ROW_81_GLYPH];

describe("the document-wide unreadable-glyph scan sees past the bounded sample (Codex #5429 r1 F3)", () => {
  it("a glyph on page 81 — past the 80-chunk identity-evidence sample — still marks the manual partial", async () => {
    stored.rows = LONG_DOC_WITH_LATE_GLYPH;
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("candidate_review");
    const evidence = storedPatch().matchEvidence as {
      completeness?: { complete: boolean; reasons: string[]; unreadablePages: number };
    };
    expect(evidence.completeness?.complete).toBe(false);
    expect(evidence.completeness?.reasons).toEqual(["unmapped_glyphs"]);
    expect(evidence.completeness?.unreadablePages).toBe(1);
    expect(String(out.payload.message)).toMatch(/full manual/i);
  });

  it("control — the same long document with no glyph anywhere stays complete", async () => {
    stored.rows = LONG_CLEAN_ROWS;
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("complete");
    const evidence = storedPatch().matchEvidence as { completeness?: { complete: boolean } };
    expect(evidence.completeness?.complete).toBe(true);
  });

  // Gate 7 cheap-lane r5 HIGH (#5429 at 43f61dca8): a glyph-bearing chunk stored with NO page
  // number (source_page NULL). The chunk-level assessor counts it (`glyphPages` holds null as one
  // entry), but the document-wide SQL `count(DISTINCT source_page)` drops NULL, returned 0, and
  // — because the document-wide count OVERRIDES the chunk-level one — the manual was marked
  // complete with the unreadable chunk sitting inside the first 80 chunks the assessor had read.
  const NULL_PAGE_GLYPH = { content: "Input Rating2 CT Rated Input Current A 5�1 7�3", source_page: null };
  const COVER = LONG_CLEAN_ROWS[0];

  it("a glyph in a chunk with no page number still marks the manual partial: the document-wide count keeps NULL as one page, like the chunk-level assessor", async () => {
    stored.rows = [COVER, NULL_PAGE_GLYPH, ...LONG_CLEAN_ROWS.slice(1, 10)];
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("candidate_review");
    const evidence = storedPatch().matchEvidence as {
      completeness?: { complete: boolean; reasons: string[]; unreadablePages: number };
    };
    expect(evidence.completeness?.complete).toBe(false);
    expect(evidence.completeness?.reasons).toEqual(["unmapped_glyphs"]);
    expect(evidence.completeness?.unreadablePages).toBe(1);
  });

  it("control — a clean chunk with no page number does not count as unreadable", async () => {
    stored.rows = [COVER, { content: "Input Rating2 CT Rated Input Current A 5.1 7.3", source_page: null }, ...LONG_CLEAN_ROWS.slice(1, 10)];
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("complete");
    const evidence = storedPatch().matchEvidence as { completeness?: { complete: boolean; unreadablePages: number } };
    expect(evidence.completeness?.complete).toBe(true);
    expect(evidence.completeness?.unreadablePages).toBe(0);
  });

  it("a failed document-wide scan retries later rather than treating the document as clean", async () => {
    stored.rows = LONG_CLEAN_ROWS;
    stored.documentWideError = true;
    const out = await acquireManualForIdentity(BASE_INPUT);
    expect(out.status).toBe("candidate_review");
    expect(out.payload.retryable).toBe(true);
    expect(String(out.payload.message)).toMatch(/try again/i);
    expect(equipmentNotebooksMock.setSourceState).not.toHaveBeenCalled();
  });
});

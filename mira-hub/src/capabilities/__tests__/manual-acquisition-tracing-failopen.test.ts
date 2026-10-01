/**
 * R15 acquisition span tree — fail-open guarantee (#4160 gate NO-GO row,
 * PRD v1.7.1 R15: "Tracing must never change behaviour: every span call is
 * fail-open; an exporter or tracing error must not fail or alter the
 * acquisition.").
 *
 * tracing.ts is mocked here (ONLY in this file) so getTracer()/setSpanAttrs
 * throw on every call, simulating a broken tracer/exporter. The real
 * acquisition pipeline (same mocks as manual-acquisition-spans.test.ts for
 * its other dependencies) must still run to completion with the SAME
 * outcome it produces when tracing works.
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-acquisition-tracing-failopen.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/capabilities/observability/tracing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/capabilities/observability/tracing")>();
  return {
    ...actual,
    getTracer: () => {
      throw new Error("tracer is broken");
    },
    setSpanAttrs: () => {
      throw new Error("exporter is broken");
    },
    addSpanLink: () => {
      throw new Error("exporter is broken");
    },
  };
});

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
  // startManualAcquisition's fencedAttach, exercised by the second test.
  attachFileToTargetsTx: vi.fn(async () => ({ ok: true as const, links: [] })),
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

const db = vi.hoisted(() => ({ claimRows: 1 }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: vi.fn(async (sql: string) => {
        // startManualAcquisition's claim() — only exercised by the second test.
        if (/RETURNING manual_acquisition->>'gen'/.test(sql)) {
          return { rowCount: db.claimRows, rows: db.claimRows ? [{ gen: "g1" }] : [] };
        }
        return { rows: [] };
      }),
    }),
  ),
}));

import { acquireManualForIdentity } from "@/capabilities/manual-acquisition";
import { startManualAcquisition } from "@/capabilities/notebook-manual-acquisition";

const IDENTITY = { manufacturer: "M", model: "123", catalogNumber: "P1" };
const BASE_INPUT = { tenantId: "t1", userId: "u1", notebookId: "nb1", nodeId: "node1", identity: IDENTITY };

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

beforeEach(() => {
  vi.clearAllMocks();
  db.claimRows = 1;
  discoveryMock.discoverManual.mockResolvedValue(FOUND_DISCOVERY);
  downloadMock.safeDownloadPdf.mockResolvedValue({
    ok: true as const,
    buffer: Buffer.from("PDFBYTES"),
    finalUrl: CANDIDATE.url,
    contentType: "application/pdf",
  });
  filesMock.parkOrReuseFile.mockResolvedValue({ fileId: "file-1", reused: false, uploadId: null });
  ingestMock.ingestPdfToNode.mockResolvedValue({ uploadId: "doc-1", chunkCount: 7 });
  applicabilityMock.assessApplicability.mockReturnValue(VERIFIED_VERDICT);
});

describe("a throwing tracer/exporter does not change the acquisition outcome", () => {
  it("acquireManualForIdentity still completes normally", async () => {
    const outcome = await acquireManualForIdentity({ ...BASE_INPUT });
    expect(outcome.status).toBe("complete");
    expect((outcome.payload as { manual?: { docId?: string } }).manual?.docId).toBe("doc-1");
    // The real network/db calls still ran exactly once each — tracing failing
    // did not cause a retry or a double-run of any side-effecting call.
    expect(downloadMock.safeDownloadPdf).toHaveBeenCalledTimes(1);
    expect(ingestMock.ingestPdfToNode).toHaveBeenCalledTimes(1);
  });

  it("startManualAcquisition's background run still records the real outcome", async () => {
    const acquire = vi.fn(async () => ({ status: "no_manual_found" as const, payload: {} }));
    const confirmedIdentity = { identityStatus: "user_confirmed", manufacturer: "M", model: "123", catalogNumber: null };
    const startInput = { tenantId: "t1", userId: "u1", notebookId: "nb1", nodeId: "node1", identity: confirmedIdentity };
    expect(await startManualAcquisition(startInput, { acquire, env: { MIRA_NOTEBOOK_MANUAL_ACQUISITION: "1" } })).toBe(true);
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
  });
});

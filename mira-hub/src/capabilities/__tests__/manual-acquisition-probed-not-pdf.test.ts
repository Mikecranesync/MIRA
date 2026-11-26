/**
 * #5873: an OEM `.pdf` link that mira-ask's probe found to be a web page
 * (`probed_not_pdf`) is offered for review, never sent to the PDF downloader.
 * An unmarked OEM candidate whose probe could not tell keeps the #3400 retry.
 *
 * Harness copied from manual-acquisition-spans.test.ts (leaf mocks only).
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-acquisition-probed-not-pdf.test.ts
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

vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) => fn({
    query: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes("UPDATE equipment_notebook_sources")) {
        return { rows: [{ match_state: params[3], enabled_by_default: params[4] }] };
      }
      return { rows: [] };
    }),
  })),
}));

import { acquireManualForIdentity } from "@/capabilities/manual-acquisition";

const IDENTITY = { manufacturer: "Siemens", model: "KTP700 Basic", catalogNumber: null };
const BASE_INPUT = { tenantId: "t1", userId: "u1", notebookId: "test-notebook-nb1", nodeId: "node1", identity: IDENTITY };
const PAGE_URL = "https://support.industry.siemens.com/cs/document/12345/ktp700.pdf";

/** The mira-ask body for an OEM `.pdf` link it could not validate; `marked` adds PR 5871's key. */
function askBody(marked: boolean) {
  return {
    found: true,
    candidate: {
      url: PAGE_URL,
      title: "KTP700 Basic operating instructions",
      host: "support.industry.siemens.com",
      score: 0.8,
      doc_type: "user_manual",
      is_direct_pdf: true,
      validated: false,
      ...(marked ? { probed_not_pdf: true } : {}),
    },
    validated: false,
    is_direct_pdf: true,
    oem_host: true,
    reason: "OEM link, probe could not confirm a PDF",
  };
}

/** Decode the body with the REAL decoder, so the test covers the decoder and the gate together. */
async function decoded(marked: boolean) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(askBody(marked)), { status: 200 })));
  // The module mock above replaces discoverManual; the real decoder is the point here.
  const actual = await vi.importActual<typeof import("@/lib/manual-discovery")>("@/lib/manual-discovery");
  const d = await actual.discoverManual(
    { manufacturer: IDENTITY.manufacturer, model: IDENTITY.model },
    { tenantId: "t1", userId: "u1" },
  );
  vi.unstubAllGlobals();
  return d;
}

let handle: ReturnType<typeof __testing__installInMemoryExporter>;
beforeAll(() => {
  handle = __testing__installInMemoryExporter();
});

beforeEach(() => {
  vi.clearAllMocks();
  handle.reset();
  downloadMock.safeDownloadPdf.mockResolvedValue({ ok: false, reason: "wrong_content_type", status: 200 });
  filesMock.parkOrReuseFile.mockResolvedValue({ fileId: "test-file-file1", reused: false, uploadId: null });
  ingestMock.ingestPdfToNode.mockResolvedValue({ uploadId: "test-doc-doc1", chunkCount: 7 });
});

describe("#5873: a probed-not-PDF OEM link is offered for review, never downloaded", () => {
  it("preconditions: the real decoder carries the mark only when the service sets it", async () => {
    const marked = await decoded(true);
    const unmarked = await decoded(false);
    expect(marked.candidate?.probedNotPdf).toBe(true);
    expect(unmarked.candidate && "probedNotPdf" in unmarked.candidate).toBe(false);
    for (const d of [marked, unmarked]) {
      expect(d.validated).toBe(false);
      expect(d.isDirectPdf).toBe(true);
      expect(d.oemHost).toBe(true);
    }
  });

  it("marked: candidate_review with the link, and the downloader is never called", async () => {
    discoveryMock.discoverManual.mockResolvedValue(await decoded(true));
    const out = await acquireManualForIdentity(BASE_INPUT as never);
    expect(downloadMock.safeDownloadPdf).not.toHaveBeenCalled();
    expect(out.status).toBe("candidate_review");
    expect((out.payload.candidate as { url?: string } | undefined)?.url).toBe(PAGE_URL);
  });

  it("control: unmarked (the probe could not tell) still reaches the downloader, as #3400 requires", async () => {
    discoveryMock.discoverManual.mockResolvedValue(await decoded(false));
    const out = await acquireManualForIdentity(BASE_INPUT as never);
    expect(downloadMock.safeDownloadPdf).toHaveBeenCalledTimes(1);
    expect(downloadMock.safeDownloadPdf.mock.calls[0]?.[0]).toBe(PAGE_URL);
    expect(out.status).toBe("download_rejected");
  });
});

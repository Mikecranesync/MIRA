/**
 * POST /api/files tells the text writer that a document is a photo's OCR text
 * only when THIS request ran OCR on an uploaded photo. A typed file that opens
 * with the OCR line, and a PDF, are never passed the mark (review round 1 on
 * #5389). The harness mirrors app/api/files/__tests__/upload-photo-ocr.test.ts.
 *
 * Run: npx vitest run src/capabilities/__tests__/photo-ocr-origin-mark.route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/node-knowledge-ingest", () => ({
  ingestPdfToNode: vi.fn(),
  ingestTextToNode: vi.fn(),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));
vi.mock("@/lib/photo-ocr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photo-ocr")>();
  return { ...actual, isPhotoOcrEnabled: vi.fn(), ocrPhotoText: vi.fn() };
});
vi.mock("@/lib/workspace-files", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace-files")>();
  return {
    ...actual,
    listFiles: vi.fn(),
    parkOrReuseFile: vi.fn(),
    linkFileToUpload: vi.fn(),
    attachFileToTargets: vi.fn(),
    claimIngest: vi.fn(),
    releaseIngestClaim: vi.fn(),
    syncNotebookSourcesForFile: vi.fn(async () => 0),
  };
});

import { POST } from "@/app/api/files/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { isPhotoOcrEnabled, ocrPhotoText, ocrSourceText } from "@/lib/photo-ocr";
import { attachFileToTargets, claimIngest, linkFileToUpload, parkOrReuseFile, releaseIngestClaim } from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const NODE_ID = "77777777-7777-7777-7777-777777777777";
const AT_NODE = [{ targetType: "namespace_node", targetId: NODE_ID }];
const READ = { text: "Schneider Electric\nCA3KN22BD\n24 V DC coil", meanConfidence: 84.2, wordCount: 7, engine: "tesseract", ms: 1800 };

function upload(body: BlobPart, name: string, type: string) {
  const fd = new FormData();
  fd.append("file", new File([body], name, { type }));
  fd.append("targets", JSON.stringify(AT_NODE));
  return new Request("http://x/api/files", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue({ tenantId: TENANT, userId: "99999999-9999-9999-9999-999999999999" } as never);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: "22222222-2222-2222-2222-222222222222", reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({ ok: true, links: [] } as never);
  vi.mocked(linkFileToUpload).mockResolvedValue(true);
  vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" });
  vi.mocked(releaseIngestClaim).mockResolvedValue(undefined);
  vi.mocked(withTenantContext).mockResolvedValue("enterprise.site.line" as never);
  vi.mocked(isPhotoOcrEnabled).mockReturnValue(true);
  vi.mocked(ocrPhotoText).mockResolvedValue(READ);
  vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: "55555555-5555-5555-5555-555555555555", chunkCount: 1 });
  vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: "55555555-5555-5555-5555-555555555555", chunkCount: 1 });
});

describe("POST /api/files — who is told a document is a photo's OCR text", () => {
  it("a photo this request ran OCR on: the writer is told", async () => {
    const res = await POST(upload("\xff\xd8\xff jpeg-ish", "relay.jpg", "image/jpeg"));
    expect(res.status).toBe(201);
    expect(ocrPhotoText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(ingestTextToNode).mock.calls[0][0]).toMatchObject({ filename: "relay.jpg", derivedFrom: "photo_ocr" });
  });

  it("a typed file that opens with the product's OCR line: the writer is NOT told", async () => {
    const typed = `${ocrSourceText("relay.jpg", READ)}\nNorthfield RX410 Logic Controller\nHardware User Guide`;
    const res = await POST(upload(typed, "notes.txt", "text/plain"));
    expect(res.status).toBe(201);
    expect(ocrPhotoText).not.toHaveBeenCalled();
    const call = vi.mocked(ingestTextToNode).mock.calls[0][0];
    expect(call.filename).toBe("notes.txt");
    expect(call).not.toHaveProperty("derivedFrom");
  });

  it("a PDF: the PDF writer is used and is never told", async () => {
    const res = await POST(upload("%PDF-1.4 not really", "guide.pdf", "application/pdf"));
    expect(res.status).toBe(201);
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(vi.mocked(ingestPdfToNode).mock.calls[0][0]).not.toHaveProperty("derivedFrom");
  });
});

// POST /api/files — EVID-4: a photo filed at a node/notebook becomes searchable
// evidence via OCR, honestly labelled; every OCR failure leaves the photo
// exactly as before (parked, viewable, stated as unsearchable).
//
// Run: cd mira-hub && npx vitest run src/app/api/files/__tests__/upload-photo-ocr

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/node-knowledge-ingest", () => ({
  ingestPdfToNode: vi.fn(),
  ingestTextToNode: vi.fn(),
  deleteOrphanNodeIngest: vi.fn(async () => undefined),
}));
vi.mock("@/lib/photo-ocr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/photo-ocr")>();
  return {
    ...actual, // ocrQuality + ocrSourceText stay real — the thresholds are the contract
    isPhotoOcrEnabled: vi.fn(),
    ocrPhotoText: vi.fn(),
  };
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

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { ingestPdfToNode, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { isPhotoOcrEnabled, ocrPhotoText } from "@/lib/photo-ocr";
import { parkOrReuseFile, linkFileToUpload, attachFileToTargets, claimIngest, releaseIngestClaim, syncNotebookSourcesForFile } from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const USER = "99999999-9999-9999-9999-999999999999";
const FILE_ID = "22222222-2222-2222-2222-222222222222";
const NODE_ID = "77777777-7777-7777-7777-777777777777";
const UPLOAD_ID = "55555555-5555-5555-5555-555555555555";

function photo(targets?: unknown, name = "spec_table.jpg") {
  const fd = new FormData();
  fd.append("file", new File(["\xff\xd8\xff jpeg-ish"], name, { type: "image/jpeg" }));
  if (targets !== undefined) fd.append("targets", JSON.stringify(targets));
  return new Request("http://x/api/files", { method: "POST", body: fd });
}

const AT_NODE = [{ targetType: "namespace_node", targetId: NODE_ID }];

const GOOD_READ = {
  text: "Motor GS10\nRated current 1.27 A\nSerial 49849",
  meanConfidence: 84.2,
  wordCount: 8,
  engine: "tesseract",
  ms: 1800,
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue({ tenantId: TENANT, userId: USER } as never);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({ ok: true, links: [] } as never);
  vi.mocked(linkFileToUpload).mockResolvedValue(true);
  vi.mocked(claimIngest).mockResolvedValue({ claimed: true, claimToken: "tok-1" });
  vi.mocked(releaseIngestClaim).mockResolvedValue(undefined);
  vi.mocked(withTenantContext).mockResolvedValue("enterprise.site.line" as never);
  vi.mocked(isPhotoOcrEnabled).mockReturnValue(true);
  vi.mocked(ingestTextToNode).mockResolvedValue({ uploadId: UPLOAD_ID, chunkCount: 1 });
});

describe("POST /api/files — photo OCR (EVID-4)", () => {
  it("indexes a readable photo through the TEXT writer against the same file, and reports quality", async () => {
    vi.mocked(ocrPhotoText).mockResolvedValue(GOOD_READ);
    const res = await POST(photo(AT_NODE));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({
      indexed: true,
      uploadId: UPLOAD_ID,
      chunkCount: 1,
      file: { capability: "viewable" },
      ocr: { quality: "usable", meanConfidence: 84.2, wordCount: 8, engine: "tesseract" },
    });
    expect(body.warning).toBeUndefined();

    // One-pipeline: the ordinary text writer, never the PDF path, never a new door.
    expect(ingestPdfToNode).not.toHaveBeenCalled();
    const call = vi.mocked(ingestTextToNode).mock.calls[0][0];
    expect(call).toMatchObject({ nodeId: NODE_ID, filename: "spec_table.jpg", mimeType: "image/jpeg" });
    const written = Buffer.from(call.buffer).toString("utf-8");
    expect(written.startsWith('Text read from photo "spec_table.jpg" (OCR, 84% confidence):')).toBe(true);
    expect(written).toContain("Serial 49849");
    // The document is linked to THE PHOTO's file row — a citation opens the photograph.
    expect(linkFileToUpload).toHaveBeenCalledWith(TENANT, FILE_ID, UPLOAD_ID, "tok-1");
    expect(syncNotebookSourcesForFile).toHaveBeenCalled();
  });

  it("a low-confidence read is still indexed but labelled weak with a caution", async () => {
    vi.mocked(ocrPhotoText).mockResolvedValue({ ...GOOD_READ, meanConfidence: 41 });
    const body = await (await POST(photo(AT_NODE))).json();
    expect(body.indexed).toBe(true);
    expect(body.ocr.quality).toBe("weak");
    expect(body.warning).toMatch(/low confidence/);
  });

  it("no readable text → kept, viewable, NOT indexed, and says so", async () => {
    vi.mocked(ocrPhotoText).mockResolvedValue({ ...GOOD_READ, text: "GS", wordCount: 1 });
    const res = await POST(photo(AT_NODE));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.indexed).toBe(false);
    expect(body.warning).toMatch(/No readable text/);
    expect(ingestTextToNode).not.toHaveBeenCalled();
    expect(claimIngest).not.toHaveBeenCalled();
  });

  it("OCR unavailable (service down / busy / timeout) → kept, viewable, honest warning", async () => {
    vi.mocked(ocrPhotoText).mockResolvedValue(null);
    const body = await (await POST(photo(AT_NODE))).json();
    expect(body.indexed).toBe(false);
    expect(body.warning).toMatch(/isn't available right now/);
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("flag off → today's behaviour exactly: no round-trip, no warning, viewable-only", async () => {
    vi.mocked(isPhotoOcrEnabled).mockReturnValue(false);
    const body = await (await POST(photo(AT_NODE))).json();
    expect(body).toMatchObject({ indexed: false, file: { capability: "viewable" } });
    expect(body.warning).toBeUndefined();
    expect(ocrPhotoText).not.toHaveBeenCalled();
  });

  it("a photo with no node destination is never OCR'd (chunks need a node to stamp)", async () => {
    const body = await (await POST(photo())).json();
    expect(body.indexed).toBe(false);
    expect(ocrPhotoText).not.toHaveBeenCalled();
  });

  it("a PDF is untouched by the photo path", async () => {
    vi.mocked(ingestPdfToNode).mockResolvedValue({ uploadId: UPLOAD_ID, chunkCount: 12 });
    const fd = new FormData();
    fd.append("file", new File(["%PDF-1.7"], "manual.pdf", { type: "application/pdf" }));
    fd.append("targets", JSON.stringify(AT_NODE));
    const body = await (await POST(new Request("http://x/api/files", { method: "POST", body: fd }))).json();
    expect(body).toMatchObject({ indexed: true, chunkCount: 12 });
    expect(ocrPhotoText).not.toHaveBeenCalled();
    expect(ingestTextToNode).not.toHaveBeenCalled();
  });

  it("a stored-only type (SVG) is never OCR'd", async () => {
    const fd = new FormData();
    fd.append("file", new File(["<svg/>"], "logo.svg", { type: "image/svg+xml" }));
    fd.append("targets", JSON.stringify(AT_NODE));
    const body = await (await POST(new Request("http://x/api/files", { method: "POST", body: fd }))).json();
    expect(body).toMatchObject({ indexed: false, file: { capability: "stored" } });
    expect(ocrPhotoText).not.toHaveBeenCalled();
  });
});

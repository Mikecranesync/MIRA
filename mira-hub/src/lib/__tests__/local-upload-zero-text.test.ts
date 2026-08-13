import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ARPK Phase 1c — blind-door honesty for scanned/image-only PDFs.
 *
 * The v2 inbox path used to catch ANY writePdfChunksForNode error and fall
 * through to the legacy Open WebUI forwarder — which is sunset (7b537b0cb), so
 * a scanned PDF ended as either a bogus `parsed` (0 chunks) or a confusing
 * network error. A NoExtractableTextError is a property of the FILE, not the
 * pipeline: retrying another door cannot fix it. The door must mark the upload
 * `failed` with the real cause and must NOT invoke the legacy forwarder.
 */

vi.mock("@/lib/uploads", () => ({
  createUpload: vi.fn(async () => ({ id: "up-1", tenantId: "t-1" })),
  updateUploadStatus: vi.fn(async () => undefined),
  findDuplicateUpload: vi.fn(async () => null),
}));

vi.mock("@/lib/upload-buffer", () => ({
  saveUploadBuffer: vi.fn(async () => undefined),
  readUploadBuffer: vi.fn(async () => null),
  deleteUploadBuffer: vi.fn(async () => undefined),
}));

vi.mock("@/lib/inbox-node", () => ({
  resolveOrCreateInboxNode: vi.fn(async () => ({ nodeId: "inbox-1", unsPath: "inbox" })),
}));

vi.mock("@/lib/node-knowledge-ingest", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../node-knowledge-ingest")>();
  return {
    ...orig,
    writePdfChunksForNode: vi.fn(async () => {
      throw new orig.NoExtractableTextError("scanned.pdf");
    }),
  };
});

vi.mock("@/lib/mira-ingest-client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../mira-ingest-client")>();
  return {
    ...orig,
    forwardToIngest: vi.fn(async () => ({ fileId: "ow-1", chunkCount: 0 })),
    forwardToPhotoIngest: vi.fn(async () => ({ photoId: 1 })),
  };
});

import { handleLocalUpload } from "../local-upload";
import { updateUploadStatus } from "@/lib/uploads";
import { forwardToIngest } from "@/lib/mira-ingest-client";

function pdfUploadReq(): Request {
  const fd = new FormData();
  // Real magic bytes so sniffMime accepts it as a PDF.
  fd.append("file", new File(["%PDF-1.4 image-only stub"], "scanned.pdf", { type: "application/pdf" }));
  return new Request("https://hub.test/api/uploads/local", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("blind door: zero extractable text", () => {
  it("marks the upload failed with the real cause and skips the legacy fallback", async () => {
    const res = await handleLocalUpload(pdfUploadReq() as never, { tenantId: "t-1" });
    expect(res.status).toBe(201); // upload accepted; ingest is async

    await vi.waitFor(() => {
      expect(updateUploadStatus).toHaveBeenCalledWith(
        "up-1",
        "t-1",
        "failed",
        expect.stringMatching(/no extractable text/i),
      );
    });
    expect(forwardToIngest).not.toHaveBeenCalled();
  });
});

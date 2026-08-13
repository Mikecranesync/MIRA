import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * ARPK Phase 1b — blind-door dedup. Re-dropping the same PDF into the Inbox
 * (browser blind door / MiraDrop) must not chunk it again: the door hashes the
 * bytes, finds the existing parsed v2 upload on the Inbox node, marks the new
 * upload row parsed-as-duplicate, and never calls the chunk writer.
 */

vi.mock("@/lib/uploads", () => ({
  createUpload: vi.fn(async () => ({ id: "up-new", tenantId: "t-1" })),
  updateUploadStatus: vi.fn(async () => undefined),
  findDuplicateUpload: vi.fn(async () => ({
    id: "up-original",
    kbChunkCount: 42,
    kgEntityId: "inbox-1",
  })),
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
    writePdfChunksForNode: vi.fn(async () => 99),
    writeTextChunksForNode: vi.fn(async () => 99),
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
import { createUpload, updateUploadStatus, findDuplicateUpload } from "@/lib/uploads";
import { writePdfChunksForNode } from "@/lib/node-knowledge-ingest";

function pdfUploadReq(): Request {
  const fd = new FormData();
  fd.append("file", new File(["%PDF-1.4 same bytes"], "manual.pdf", { type: "application/pdf" }));
  return new Request("https://hub.test/api/uploads/local", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("blind door: content dedup", () => {
  it("hashes the bytes into createUpload and skips chunking on a duplicate", async () => {
    const res = await handleLocalUpload(pdfUploadReq() as never, { tenantId: "t-1" });
    expect(res.status).toBe(201);

    // The door computed and persisted the content hash.
    const createArg = vi.mocked(createUpload).mock.calls[0][0] as unknown as Record<string, unknown>;
    expect(String(createArg.contentSha256)).toMatch(/^[0-9a-f]{64}$/);

    await vi.waitFor(() => {
      expect(updateUploadStatus).toHaveBeenCalledWith(
        "up-new",
        "t-1",
        "parsed",
        expect.stringMatching(/duplicate of up-original/i),
        expect.objectContaining({ kbChunkCount: 42, ingestRoute: "v2" }),
      );
    });
    expect(findDuplicateUpload).toHaveBeenCalledWith(
      "t-1",
      expect.stringMatching(/^[0-9a-f]{64}$/),
      "inbox-1",
    );
    expect(writePdfChunksForNode).not.toHaveBeenCalled();
  });
});

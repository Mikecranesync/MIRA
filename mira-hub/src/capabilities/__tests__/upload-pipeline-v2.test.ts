import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * #1806 — a Drive/Dropbox document must become CITABLE: it goes through the
 * same v2 Inbox writer as a local upload (knowledge_entries, is_private=true),
 * not only to the Open WebUI KB that chat never reads and prod no longer runs.
 * Review round 1 (#4088): no uncitable fallback, MIME check, hash persisted.
 */

vi.mock("@/lib/workflow", () => ({
  runWorkflow: vi.fn(async (_meta: unknown, body: (run: unknown) => Promise<unknown>) =>
    body({
      step: async (_name: string, fn: () => Promise<unknown>) => fn(),
      setOutput: () => undefined,
    }),
  ),
}));
vi.mock("@/lib/token-refresh", () => ({ ensureFreshAccessToken: vi.fn(async () => ({ accessToken: "t" })) }));
vi.mock("@/lib/fetch-adapters", () => ({
  streamFromGoogleDrive: vi.fn(),
  streamFromSignedUrl: vi.fn(),
}));
vi.mock("@/lib/uploads", () => ({
  createUpload: vi.fn(),
  updateUploadStatus: vi.fn(async () => undefined),
  updateUploadStatusForAttempt: vi.fn(async () => undefined),
  UploadAttemptRevokedError: class UploadAttemptRevokedError extends Error {},
  setUploadContentSha256: vi.fn(async () => undefined),
  findDuplicateUpload: vi.fn(async () => null),
}));
vi.mock("@/lib/inbox-node", () => ({
  resolveOrCreateInboxNode: vi.fn(async () => ({ nodeId: "inbox-1", unsPath: "inbox" })),
}));
vi.mock("@/lib/node-knowledge-ingest", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/node-knowledge-ingest")>();
  return { ...orig, writePdfChunksForNode: vi.fn(async () => 7), writeTextChunksForNode: vi.fn(async () => 3) };
});
vi.mock("@/lib/mira-ingest-client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/mira-ingest-client")>();
  return {
    ...orig,
    forwardToIngest: vi.fn(async () => ({ fileId: "ow-1", chunkCount: 0 })),
    forwardToPhotoIngest: vi.fn(async () => ({ photoId: 1 })),
  };
});

import { runIngestPipeline, readAllCapped, type PipelineInput } from "@/lib/upload-pipeline";
import { streamFromSignedUrl } from "@/lib/fetch-adapters";
import {
  findDuplicateUpload,
  setUploadContentSha256,
  updateUploadStatusForAttempt,
  UploadAttemptRevokedError,
} from "@/lib/uploads";
import { createHash } from "node:crypto";
import { NoExtractableTextError, writePdfChunksForNode } from "@/lib/node-knowledge-ingest";
import { forwardToIngest, forwardToPhotoIngest } from "@/lib/mira-ingest-client";

const body = (bytes: string) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(bytes));
      c.close();
    },
  });

const input = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  uploadId: "up-1",
  tenantId: "22222222-2222-4222-8222-222222222222",
  requestId: "req-1",
  provider: "dropbox",
  externalFileId: "dbx-1",
  externalDownloadUrl: "https://dl.dropbox.test/m.pdf",
  filename: "manual.pdf",
  mimeType: "application/pdf",
  kind: "document",
  assetTag: null,
  attemptId: "att-1",
  ...over,
});

const statuses = () => vi.mocked(updateUploadStatusForAttempt).mock.calls.map((c) => [c[3], c[5]]);

beforeEach(() => {
  vi.mocked(updateUploadStatusForAttempt).mockReset().mockResolvedValue(undefined);
  vi.mocked(setUploadContentSha256).mockClear();
  vi.mocked(findDuplicateUpload).mockClear().mockResolvedValue(null);
  vi.mocked(forwardToIngest).mockClear();
  vi.mocked(forwardToPhotoIngest).mockClear();
  vi.mocked(writePdfChunksForNode).mockReset().mockResolvedValue(7);
  vi.mocked(streamFromSignedUrl).mockImplementation(async () => ({
    stream: body("%PDF-1.4 cloud manual"),
    contentType: "application/pdf",
    sizeBytes: null,
  }));
});

describe("runIngestPipeline — cloud documents land citable (#1806)", () => {
  it("writes a Dropbox PDF through the v2 Inbox writer, not the Open WebUI forwarder", async () => {
    await runIngestPipeline(input());
    expect(writePdfChunksForNode).toHaveBeenCalledOnce();
    expect(vi.mocked(writePdfChunksForNode).mock.calls[0][0]).toMatchObject({ uploadId: "up-1", nodeId: "inbox-1" });
    expect(forwardToIngest).not.toHaveBeenCalled();
    expect(statuses()).toContainEqual(["parsed", { kbChunkCount: 7, kgEntityId: "inbox-1", ingestRoute: "v2" }]);
  });

  it("a file with no extractable text fails honestly and is not forwarded elsewhere", async () => {
    vi.mocked(writePdfChunksForNode).mockRejectedValue(new NoExtractableTextError("manual.pdf"));
    await runIngestPipeline(input());
    expect(forwardToIngest).not.toHaveBeenCalled();
    expect(statuses().some(([s]) => s === "failed")).toBe(true);
  });

  it("F2: any other writer failure FAILS the upload — no uncitable 'parsed' via the legacy store", async () => {
    vi.mocked(writePdfChunksForNode).mockRejectedValue(new Error("db down"));
    await runIngestPipeline(input());
    expect(forwardToIngest).not.toHaveBeenCalled();
    expect(statuses().some(([s]) => s === "failed")).toBe(true);
    expect(statuses().some(([s]) => s === "parsed")).toBe(false);
  });

  it("F3: declared text but PDF bytes is rejected before any chunk is written", async () => {
    await runIngestPipeline(input({ mimeType: "text/plain", filename: "notes.txt" }));
    expect(writePdfChunksForNode).not.toHaveBeenCalled();
    const failed = vi.mocked(updateUploadStatusForAttempt).mock.calls.find((c) => c[3] === "failed");
    expect(String(failed?.[4])).toMatch(/does not match its declared type/);
  });

  it("F4: the fetched content hash is saved on the row and used for the duplicate lookup", async () => {
    const sha = createHash("sha256").update("%PDF-1.4 cloud manual").digest("hex");
    await runIngestPipeline(input());
    expect(setUploadContentSha256).toHaveBeenCalledWith("up-1", input().tenantId, sha, "att-1");
    expect(findDuplicateUpload).toHaveBeenCalledWith(input().tenantId, sha, "inbox-1");
  });

  it("099: every status write carries the pipeline's attempt", async () => {
    await runIngestPipeline(input());
    const attempts = vi.mocked(updateUploadStatusForAttempt).mock.calls.map((c) => c[2]);
    expect(attempts.length).toBeGreaterThan(0);
    expect(new Set(attempts)).toEqual(new Set(["att-1"]));
  });

  it("099: a revoked attempt (cancel/delete/requeue) stops the pipeline — no forward, no chunks, no 'failed'", async () => {
    vi.mocked(updateUploadStatusForAttempt).mockImplementation(async (_id, _t, _a, status) => {
      if (status === "parsing") throw new UploadAttemptRevokedError("up-1");
    });
    await runIngestPipeline(input());
    expect(writePdfChunksForNode).not.toHaveBeenCalled();
    expect(forwardToIngest).not.toHaveBeenCalled();
    expect(statuses().some(([s]) => s === "failed")).toBe(false);
  });

  it("photos keep the photo door", async () => {
    await runIngestPipeline(input({ kind: "photo", mimeType: "image/jpeg", filename: "p.jpg" }));
    expect(forwardToPhotoIngest).toHaveBeenCalledOnce();
    expect(writePdfChunksForNode).not.toHaveBeenCalled();
  });
});

describe("readAllCapped", () => {
  it("refuses a body over the cap", async () => {
    await expect(readAllCapped(body("0123456789"), 5)).rejects.toThrow(/upload limit/);
  });
});

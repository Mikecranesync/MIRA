import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Codex review of #4091 at 2dfe80b81, F2: the synchronous node-attach doors
 * (ingestTextToNode / ingestPdfToNode) wrote chunks with no attempt and finished
 * with an UNGUARDED status write. A cancel through DELETE /api/uploads/:id (the
 * row is 'parsing', so it is cancellable) removed the chunks, and the resumed
 * ingest then overwrote 'cancelled' with 'parsed' and returned success — so the
 * caller linked an indexed file that had no citable chunks.
 *
 * Now both doors carry the created upload's attempt into the chunk writer (row
 * held FOR SHARE for its attempt) and into BOTH status writes, and a revoked
 * attempt propagates as a failure without overwriting the cancel.
 */

const { state } = vi.hoisted(() => ({
  state: {
    held: true,
    rowLocks: [] as Array<{ uploadId: string; attemptId: unknown }>,
    inserts: 0,
    unguardedInserts: 0,
  },
}));

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({ text: ["Fault F004 means DC bus undervoltage."] })),
}));

vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [], rowCount: 0 })) } }));

vi.mock("@/lib/tenant-context", () => {
  const c = {
    query: vi.fn(async (sql: string) => {
      if (/INSERT INTO/.test(sql)) state.inserts += 1;
      return { rows: [], rowCount: 1 };
    }),
  };
  return {
    // The embed pass reads through this; an INSERT here would be an attempt-less chunk write.
    withTenantContext: vi.fn(async (_t: string, fn: (client: { query: (sql: string) => unknown }) => unknown) =>
      fn({
        query: async (sql: string) => {
          if (/INSERT INTO/.test(sql)) state.unguardedInserts += 1;
          return { rows: [], rowCount: 0 };
        },
      }),
    ),
    withUploadRowTenantContext: vi.fn(
      async (_t: string, uploadId: string, attemptId: unknown, fn: (client: typeof c) => Promise<unknown>) => {
        state.rowLocks.push({ uploadId, attemptId });
        if (!state.held) return { held: false };
        return { held: true, result: await fn(c) };
      },
    ),
  };
});

vi.mock("@/lib/uploads", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/uploads")>();
  return {
    ...orig,
    createUpload: vi.fn(async () => ({ id: "up-sync", tenantId: "t-1", attemptId: "att-sync" })),
    updateUploadStatus: vi.fn(async () => {
      throw new Error("an unguarded status write: it would overwrite a cancel");
    }),
    updateUploadStatusForAttempt: vi.fn(async () => "ok"),
  };
});

vi.mock("@/lib/node-document-proposals", () => ({ proposeDocumentEdgesForNode: vi.fn(async () => undefined) }));

import { ingestPdfToNode, ingestTextToNode } from "@/lib/node-knowledge-ingest";
import { updateUploadStatus, updateUploadStatusForAttempt, UploadAttemptRevokedError } from "@/lib/uploads";

const doors = [
  ["ingestTextToNode", ingestTextToNode, "notes.txt", "text/plain", "Fault F004 means DC bus undervoltage."],
  ["ingestPdfToNode", ingestPdfToNode, "manual.pdf", "application/pdf", "%PDF-1.4 bytes"],
] as const;

const run = (door: (typeof doors)[number]) =>
  door[1]({
    tenantId: "t-1",
    nodeId: "node-1",
    unsPath: null,
    filename: door[2],
    mimeType: door[3],
    sizeBytes: 64,
    buffer: Buffer.from(door[4]),
  });

const statusWrites = () => vi.mocked(updateUploadStatusForAttempt).mock.calls.map((c) => [c[0], c[2], c[3]]);

beforeEach(() => {
  state.held = true;
  state.rowLocks.length = 0;
  state.inserts = 0;
  state.unguardedInserts = 0;
  vi.mocked(updateUploadStatusForAttempt).mockReset().mockResolvedValue("ok");
  vi.mocked(updateUploadStatus).mockClear();
});

describe.each(doors)("%s carries the upload's attempt end to end", (name) => {
  const door = doors.find((d) => d[0] === name)!;

  it("writes chunks under the row lock for its attempt and finishes with the attempt-guarded write", async () => {
    await expect(run(door)).resolves.toMatchObject({ uploadId: "up-sync" });
    expect(state.rowLocks).toEqual([{ uploadId: "up-sync", attemptId: "att-sync" }]);
    expect(state.inserts).toBeGreaterThan(0);
    expect(state.unguardedInserts).toBe(0);
    expect(statusWrites()).toEqual([["up-sync", "att-sync", "parsed"]]);
    expect(updateUploadStatus).not.toHaveBeenCalled();
  });

  it("a cancel before the chunk write: no chunks, the revocation propagates, the cancel is not overwritten", async () => {
    state.held = false;
    await expect(run(door)).rejects.toBeInstanceOf(UploadAttemptRevokedError);
    expect(state.inserts).toBe(0);
    expect(statusWrites()).toEqual([]);
    expect(updateUploadStatus).not.toHaveBeenCalled();
  });

  it("a cancel after the chunks committed: the final write is refused and the ingest reports failure", async () => {
    vi.mocked(updateUploadStatusForAttempt).mockImplementation(async (id, _t, _a, status) => {
      if (status === "parsed") throw new UploadAttemptRevokedError(id);
      return "ok";
    });
    await expect(run(door)).rejects.toBeInstanceOf(UploadAttemptRevokedError);
    expect(statusWrites().some(([, , s]) => s === "failed")).toBe(false);
    expect(updateUploadStatus).not.toHaveBeenCalled();
  });

  it("any other failure marks the upload failed — still only for its own attempt", async () => {
    state.held = true;
    vi.mocked(updateUploadStatusForAttempt).mockImplementation(async (_id, _t, _a, status) => {
      if (status === "parsed") throw new Error("db down");
      return "ok";
    });
    await expect(run(door)).rejects.toThrow("db down");
    expect(statusWrites()).toContainEqual(["up-sync", "att-sync", "failed"]);
    expect(updateUploadStatus).not.toHaveBeenCalled();
  });
});

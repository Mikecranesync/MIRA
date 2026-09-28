import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Migration 099 — one identity per import attempt. A pipeline's status and
 * chunk writes succeed only while the upload row still carries ITS attempt and
 * is not cancelled; cancel and requeue mint a new attempt (revoking the old),
 * delete removes the row. These tests pin each guard at the SQL it runs.
 */

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as Array<{ sql: string; params: unknown[] }>,
    rowCount: 1,
    heldRows: 1,
  },
}));

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    state.calls.push({ sql, params });
    if (/FOR SHARE/.test(sql)) return { rowCount: state.heldRows, rows: [] };
    if (/^\s*UPDATE hub_uploads/.test(sql)) return { rowCount: state.rowCount, rows: [] };
    return { rowCount: 1, rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  default: {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params });
      if (/^\s*(UPDATE|DELETE)/.test(sql)) return { rowCount: state.rowCount, rows: [] };
      return { rowCount: 1, rows: [{}] };
    }),
  },
}));

import {
  cancelUpload,
  claimUploadForRequeue,
  setUploadContentSha256,
  updateUploadStatusForAttempt,
  UploadAttemptRevokedError,
} from "@/lib/uploads";
import { writeTextChunksForNode } from "@/lib/node-knowledge-ingest";

const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();
const sqls = () => state.calls.map((c) => flat(c.sql));

beforeEach(() => {
  state.calls.length = 0;
  state.rowCount = 1;
  state.heldRows = 1;
  client.query.mockClear();
  client.release.mockClear();
});

describe("updateUploadStatusForAttempt", () => {
  it("writes only for the same attempt on a row that is not cancelled", async () => {
    await updateUploadStatusForAttempt("u-1", "t-1", "att-1", "parsed", null, { kbChunkCount: 3 });
    const { sql, params } = state.calls[0];
    expect(flat(sql)).toMatch(/AND attempt_id IS NOT DISTINCT FROM \$9::uuid AND status <> 'cancelled'/);
    expect(params[8]).toBe("att-1");
  });

  it("throws UploadAttemptRevokedError when the row no longer carries the attempt", async () => {
    state.rowCount = 0;
    await expect(updateUploadStatusForAttempt("u-1", "t-1", "att-old", "parsed")).rejects.toBeInstanceOf(
      UploadAttemptRevokedError,
    );
  });

  it("the content hash write is attempt-guarded too", async () => {
    state.rowCount = 0;
    await expect(setUploadContentSha256("u-1", "t-1", "abc", "att-old")).rejects.toBeInstanceOf(
      UploadAttemptRevokedError,
    );
    expect(sqls()[0]).toMatch(/attempt_id IS NOT DISTINCT FROM \$4::uuid AND status <> 'cancelled'/);
  });
});

describe("claimUploadForRequeue / cancelUpload revoke the running attempt", () => {
  it("a requeue claim mints a new attempt", async () => {
    await claimUploadForRequeue("u-1", "t-1", ["failed"], "user retry");
    expect(sqls()[0]).toMatch(/attempt_id = gen_random_uuid\(\)/);
  });

  it("cancel rotates the attempt and removes that attempt's chunks in one transaction", async () => {
    await expect(cancelUpload("u-1", "t-1", "user cancelled")).resolves.toBe(true);
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    expect(s[1]).toMatch(/SET status = 'cancelled'.*attempt_id = gen_random_uuid\(\).*status IN \('queued', 'fetching', 'parsing'\)/);
    expect(s[2]).toMatch(new RegExp(`^DELETE FROM ${["knowledge", "entries"].join("_")} .*is_private = true`));
    expect(s.at(-1)).toBe("COMMIT");
  });

  it("cancel of an upload that already finished changes nothing", async () => {
    state.rowCount = 0;
    await expect(cancelUpload("u-1", "t-1", "user cancelled")).resolves.toBe(false);
    expect(sqls().some((x) => x.startsWith("DELETE"))).toBe(false);
    expect(sqls()).toContain("ROLLBACK");
  });
});

describe("chunk writer holds the upload row for its attempt", () => {
  const opts = { tenantId: "t-1", uploadId: "u-1", nodeId: "n-1", unsPath: null, filename: "m.txt" };

  it("locks the row FOR SHARE with the attempt BEFORE switching to the tenant role and inserting", async () => {
    await writeTextChunksForNode({ ...opts, buffer: new TextEncoder().encode("torque 4.7 Nm"), attemptId: "att-1" });
    const s = sqls();
    const lock = s.findIndex((x) => /FROM hub_uploads .*attempt_id IS NOT DISTINCT FROM \$3::uuid .*FOR SHARE/.test(x));
    const role = s.indexOf("SET LOCAL ROLE factorylm_app");
    const insert = s.findIndex((x) => x.startsWith(`INSERT INTO ${["knowledge", "entries"].join("_")}`));
    expect(lock).toBeGreaterThan(0);
    expect(role).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(role);
  });

  it("a revoked attempt inserts nothing", async () => {
    state.heldRows = 0;
    await expect(
      writeTextChunksForNode({ ...opts, buffer: new TextEncoder().encode("torque"), attemptId: "att-old" }),
    ).rejects.toBeInstanceOf(UploadAttemptRevokedError);
    expect(sqls().some((x) => x.startsWith("INSERT"))).toBe(false);
    expect(sqls()).toContain("ROLLBACK");
  });
});

describe("notebook attach serializes with upload delete (review of #4084, F2)", () => {
  it("both attach paths read the file's upload_id FOR SHARE", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "../../lib/workspace-files.ts"), "utf8");
    const reads = src.match(/SELECT id::text AS id, upload_id::text AS upload_id[\s\S]*?`/g) ?? [];
    const attachReads = reads.filter((q) => /AND id = \$2::uuid/.test(q));
    expect(attachReads.length).toBeGreaterThanOrEqual(2);
    for (const q of attachReads) expect(q).toMatch(/FOR SHARE/);
  });
});

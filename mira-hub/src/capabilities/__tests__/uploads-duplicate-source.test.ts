import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Codex review of #4091 at 2dfe80b81, F1: marking an upload "duplicate of A"
 * was a separate statement from finding A, so A could be deleted in between.
 * The delete's dependent sweep only sees already-parsed duplicates, so the new
 * row became a parsed duplicate of nothing — no chunks, never citable.
 *
 * Now the duplicate write holds A FOR SHARE in the same transaction as the
 * attempt-guarded update. Lock order matches deleteUploadAndKnowledge (A first,
 * then its dependents): either the delete runs first and the write reports the
 * source gone (the caller ingests the bytes itself), or the write commits first
 * and the delete's dependent sweep finds it and hands it A's chunks.
 */

const { state } = vi.hoisted(() => ({
  state: {
    calls: [] as Array<{ sql: string; params: unknown[] }>,
    sourceHeld: 1,
    updated: 1,
  },
}));

const client = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    state.calls.push({ sql, params });
    if (/FOR SHARE/.test(sql)) return { rowCount: state.sourceHeld, rows: [] };
    if (/^\s*UPDATE hub_uploads/.test(sql)) return { rowCount: state.updated, rows: [] };
    return { rowCount: 1, rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({
  default: {
    connect: vi.fn(async () => client),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      state.calls.push({ sql, params });
      return { rowCount: state.updated, rows: [] };
    }),
  },
}));

import { updateUploadStatusForAttempt, UploadAttemptRevokedError } from "@/lib/uploads";

const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();
const sqls = () => state.calls.map((c) => flat(c.sql));
const markDup = () =>
  updateUploadStatusForAttempt("u-new", "t-1", "att-1", "parsed", "duplicate of u-orig", {
    kbChunkCount: 42,
    kgEntityId: "inbox-1",
    ingestRoute: "v2",
    duplicateOf: "u-orig",
  });

beforeEach(() => {
  state.calls.length = 0;
  state.sourceHeld = 1;
  state.updated = 1;
  client.query.mockClear();
  client.release.mockClear();
});

describe("a duplicate is recorded only while its original still owns chunks", () => {
  it("holds the original FOR SHARE, then writes the attempt-guarded status, in one transaction", async () => {
    await expect(markDup()).resolves.toBe("ok");
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    const lock = s.findIndex((x) => /FROM hub_uploads .*FOR SHARE/.test(x));
    const update = s.findIndex((x) => x.startsWith("UPDATE hub_uploads"));
    expect(lock).toBeGreaterThan(0);
    expect(update).toBeGreaterThan(lock);
    // The source must still be a parsed v2 original that owns its chunks.
    expect(s[lock]).toMatch(/WHERE id = \$1 AND tenant_id = \$2 AND status = 'parsed' AND ingest_route = 'v2'/);
    expect(s[lock]).toMatch(/status_detail IS NULL OR status_detail NOT LIKE 'duplicate of %'/);
    expect(state.calls[lock].params).toEqual(["u-orig", "t-1"]);
    // The destination write keeps the attempt guard.
    expect(s[update]).toMatch(/attempt_id IS NOT DISTINCT FROM \$9::uuid AND status <> 'cancelled'/);
    expect(state.calls[update].params[0]).toBe("u-new");
    expect(state.calls[update].params[8]).toBe("att-1");
    expect(s.at(-1)).toBe("COMMIT");
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("reports the source gone — and writes nothing — when the original was deleted first", async () => {
    state.sourceHeld = 0;
    await expect(markDup()).resolves.toBe("duplicate_source_gone");
    expect(sqls().some((x) => x.startsWith("UPDATE"))).toBe(false);
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
  });

  it("still throws UploadAttemptRevokedError when this upload's own attempt was revoked", async () => {
    state.updated = 0;
    await expect(markDup()).rejects.toBeInstanceOf(UploadAttemptRevokedError);
    expect(sqls()).toContain("ROLLBACK");
  });

  it("a plain status write (no duplicateOf) stays a single guarded statement", async () => {
    await expect(updateUploadStatusForAttempt("u-1", "t-1", "att-1", "parsed", null, { kbChunkCount: 3 })).resolves.toBe(
      "ok",
    );
    expect(client.query).not.toHaveBeenCalled();
    expect(sqls()[0]).toMatch(/^UPDATE hub_uploads .*attempt_id IS NOT DISTINCT FROM \$9::uuid/);
  });
});

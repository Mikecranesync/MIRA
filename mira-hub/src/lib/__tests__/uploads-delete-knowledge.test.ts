import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ sql: string; params: unknown[] }> = [];
let retainedRows = 0;
let deletedRows = 1;
let failOn: RegExp | null = null;

const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (failOn && failOn.test(sql)) throw new Error("boom");
    if (/FROM namespace_direct_uploads/.test(sql)) return { rowCount: retainedRows, rows: [] };
    if (/DELETE FROM hub_uploads/.test(sql)) return { rowCount: deletedRows, rows: [] };
    return { rowCount: 0, rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({ default: { connect: vi.fn(async () => fakeClient), query: vi.fn() } }));

import { deleteUploadAndKnowledge } from "../uploads";

const ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

const sqls = () => calls.map((c) => c.sql.replace(/\s+/g, " ").trim());

describe("deleteUploadAndKnowledge", () => {
  beforeEach(() => {
    calls.length = 0;
    retainedRows = 0;
    deletedRows = 1;
    failOn = null;
    fakeClient.release.mockClear();
  });

  it("removes the upload's own private chunks with the row, in one transaction", async () => {
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("deleted");
    const s = sqls();
    expect(s[0]).toBe("BEGIN");
    const ke = calls.find((c) => /DELETE FROM knowledge_entries/.test(c.sql));
    expect(ke).toBeDefined();
    // Scoped to this tenant's private rows only — never the shared OEM corpus.
    expect(ke!.sql).toMatch(/is_private = true/);
    expect(ke!.sql).toMatch(/doc_id = \$1::uuid/);
    expect(ke!.params).toEqual([ID, TENANT]);
    const keIdx = s.findIndex((x) => x.startsWith("DELETE FROM knowledge_entries"));
    const huIdx = s.findIndex((x) => x.startsWith("DELETE FROM hub_uploads"));
    expect(keIdx).toBeGreaterThan(0);
    expect(huIdx).toBeGreaterThan(keIdx);
    expect(s[s.length - 1]).toBe("COMMIT");
    expect(fakeClient.release).toHaveBeenCalledOnce();
  });

  it("refuses a filing-cabinet-verified document and deletes nothing", async () => {
    retainedRows = 1;
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("retained");
    expect(sqls().some((x) => x.startsWith("DELETE"))).toBe(false);
    expect(sqls()).toContain("ROLLBACK");
  });

  it("reports not_found when the row is already gone", async () => {
    deletedRows = 0;
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("not_found");
  });

  it("rolls back and rethrows when a delete fails, so chunks and row stay consistent", async () => {
    failOn = /DELETE FROM hub_uploads/;
    await expect(deleteUploadAndKnowledge(ID, TENANT)).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    expect(fakeClient.release).toHaveBeenCalledOnce();
  });
});

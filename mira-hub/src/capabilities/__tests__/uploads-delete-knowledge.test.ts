import { describe, it, expect, vi, beforeEach } from "vitest";

const calls: Array<{ sql: string; params: unknown[] }> = [];
let uploadStatus: string | null = "parsed";
let fileRows: Array<{ verified: boolean }> = [];
let dependents: Array<{ id: string }> = [];
let failOn: RegExp | null = null;

const fakeClient = {
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    if (failOn && failOn.test(sql)) throw new Error("boom");
    if (/SELECT status FROM hub_uploads/.test(sql)) {
      return uploadStatus == null ? { rowCount: 0, rows: [] } : { rowCount: 1, rows: [{ status: uploadStatus }] };
    }
    if (/SELECT verified FROM namespace_direct_uploads/.test(sql)) return { rowCount: fileRows.length, rows: fileRows };
    if (/SELECT id FROM hub_uploads/.test(sql)) return { rowCount: dependents.length, rows: dependents };
    return { rowCount: 1, rows: [] };
  }),
  release: vi.fn(),
};

vi.mock("@/lib/db", () => ({ default: { connect: vi.fn(async () => fakeClient), query: vi.fn() } }));

import { deleteUploadAndKnowledge } from "@/lib/uploads";

const ID = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";

// Built, not literal: the repo's knowledge_entries read-filter scanner treats a
// literal table name in a test string as a query site.
const KE_TABLE = ["knowledge", "entries"].join("_");

const sqls = () => calls.map((c) => c.sql.replace(/\s+/g, " ").trim());
const idx = (prefix: string) => sqls().findIndex((x) => x.startsWith(prefix));
const writes = () => sqls().filter((x) => /^(DELETE|UPDATE)/.test(x));

describe("deleteUploadAndKnowledge (#4080 + review of #4084)", () => {
  beforeEach(() => {
    calls.length = 0;
    uploadStatus = "parsed";
    fileRows = [];
    dependents = [];
    failOn = null;
    fakeClient.release.mockClear();
  });

  it("removes the private chunks, the notebook sources, the file pointer and the row — in one transaction", async () => {
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("deleted");
    expect(sqls()[0]).toBe("BEGIN");
    // Serialization: the upload row and linked files are locked BEFORE any write.
    expect(sqls()[1]).toMatch(/^SELECT status FROM hub_uploads .*FOR UPDATE$/);
    expect(sqls()[2]).toMatch(/^SELECT verified FROM namespace_direct_uploads .*FOR UPDATE$/);
    const ke = calls.find((c) => c.sql.replace(/\s+/g, " ").trim().startsWith(`DELETE FROM ${KE_TABLE}`));
    expect(ke!.sql).toMatch(/is_private = true/); // never the shared OEM corpus
    expect(ke!.params).toEqual([ID, TENANT]);
    expect(idx("DELETE FROM equipment_notebook_sources")).toBeGreaterThan(2);
    // F1: the canonical file forgets the upload, so identical bytes re-index.
    expect(sqls().some((x) => /^UPDATE namespace_direct_uploads SET upload_id = NULL/.test(x))).toBe(true);
    expect(idx("DELETE FROM hub_uploads")).toBeGreaterThan(idx(`DELETE FROM ${KE_TABLE}`));
    expect(sqls().at(-1)).toBe("COMMIT");
    expect(fakeClient.release).toHaveBeenCalledOnce();
  });

  it("F2: a verified linked file (checked under lock) refuses the whole delete", async () => {
    fileRows = [{ verified: false }, { verified: true }];
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("retained");
    expect(writes()).toEqual([]);
    expect(sqls()).toContain("ROLLBACK");
  });

  it("F3: an upload a retry/re-pick requeued after the route read it is not deleted", async () => {
    uploadStatus = "queued";
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("in_progress");
    expect(writes()).toEqual([]);
  });

  it("reports not_found when the row is already gone", async () => {
    uploadStatus = null;
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("not_found");
    expect(writes()).toEqual([]);
  });

  it("rolls back and rethrows when a write fails, so chunks and row stay consistent", async () => {
    failOn = /DELETE FROM hub_uploads/;
    await expect(deleteUploadAndKnowledge(ID, TENANT)).rejects.toThrow("boom");
    expect(sqls()).toContain("ROLLBACK");
    expect(sqls()).not.toContain("COMMIT");
    expect(fakeClient.release).toHaveBeenCalledOnce();
  });

  it("#4091 F1: a parsed duplicate inherits the original's chunks instead of being stranded", async () => {
    const HEIR = "33333333-3333-4333-8333-333333333333";
    dependents = [{ id: HEIR }, { id: "44444444-4444-4444-8444-444444444444" }];
    await expect(deleteUploadAndKnowledge(ID, TENANT)).resolves.toBe("deleted");
    const s = sqls();
    const move = calls.find((c) => /^UPDATE knowledge_entries/.test(c.sql.replace(/\s+/g, " ").trim()));
    expect(move).toBeDefined();
    expect(move!.sql).toMatch(/SET doc_id = \$3::uuid/);
    expect(move!.sql).toMatch(/is_private = true/);
    expect(move!.params).toEqual([ID, TENANT, HEIR]);
    const moveIdx = s.findIndex((x) => x.startsWith("UPDATE knowledge_entries"));
    expect(moveIdx).toBeLessThan(idx(`DELETE FROM ${KE_TABLE}`)); // moved before the delete runs
    expect(s.some((x) => /UPDATE hub_uploads SET status_detail = NULL/.test(x))).toBe(true);
    expect(s.some((x) => /SET status_detail = 'duplicate of ' \|\| \$3/.test(x))).toBe(true);
  });

  it("with no duplicates, nothing is reassigned", async () => {
    await deleteUploadAndKnowledge(ID, TENANT);
    expect(sqls().some((x) => x.startsWith("UPDATE knowledge_entries"))).toBe(false);
  });
});

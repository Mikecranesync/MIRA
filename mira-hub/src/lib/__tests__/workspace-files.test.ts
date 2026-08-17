/**
 * workspace-files domain service — canonical file + many-to-many links.
 *
 * SQL-routing fake client: each test scripts responses keyed on SQL shape, so
 * we assert the SEMANTICS (what got inserted/deleted, in one transaction) and
 * not the exact text of every query.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

const poolQuery = vi.fn();
vi.mock("@/lib/db", () => ({ default: { query: (...a: unknown[]) => poolQuery(...a) } }));

const upsertNotebookSourceTx = vi.fn(async () => {});
vi.mock("@/lib/equipment-notebooks", () => ({
  upsertNotebookSourceTx: (...a: unknown[]) => (upsertNotebookSourceTx as (...args: unknown[]) => unknown)(...a),
}));

// withTenantContext: run the callback against the scripted client. Tracks call
// count so tests can assert single-transaction behavior.
const tenantCtxCalls: string[] = [];
let scriptedClient: PoolClient;
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: async (tenantId: string, fn: (c: PoolClient) => Promise<unknown>) => {
    tenantCtxCalls.push(tenantId);
    return fn(scriptedClient);
  },
}));

import {
  sha256Hex,
  fileCapability,
  inlineRenderAllowed,
  normalizeMime,
  isLinkTargetType,
  parkOrReuseFile,
  attachFileToTargets,
  detachLink,
  relocateFile,
  deleteFile,
  linkedDocIdsForNode,
  syncNotebookSourcesForFile,
  listFiles,
} from "@/lib/workspace-files";

const TENANT = "11111111-1111-1111-1111-111111111111";
const FILE_ID = "22222222-2222-2222-2222-222222222222";
const NOTEBOOK_ID = "33333333-3333-3333-3333-333333333333";
const NOTEBOOK_ID_2 = "44444444-4444-4444-4444-444444444444";
const UPLOAD_ID = "55555555-5555-5555-5555-555555555555";
const LINK_ID = "66666666-6666-6666-6666-666666666666";
const NODE_ID = "77777777-7777-7777-7777-777777777777";

type Route = { match: RegExp; rows: Record<string, unknown>[] | (() => Record<string, unknown>[]) };

function clientFromRoutes(routes: Route[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    calls.push({ sql, params: params ?? [] });
    for (const r of routes) {
      if (r.match.test(sql)) {
        const rows = typeof r.rows === "function" ? r.rows() : r.rows;
        return { rows, rowCount: rows.length };
      }
    }
    return { rows: [], rowCount: 0 };
  });
  scriptedClient = { query } as unknown as PoolClient;
  return { query, calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  tenantCtxCalls.length = 0;
});

describe("pure helpers", () => {
  it("sha256Hex is deterministic and hex", () => {
    const a = sha256Hex(Buffer.from("hello"));
    expect(a).toBe(sha256Hex(Buffer.from("hello")));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(Buffer.from("other"))).not.toBe(a);
  });

  it("normalizeMime lowercases, strips params, defaults to octet-stream", () => {
    expect(normalizeMime("Application/PDF")).toBe("application/pdf");
    expect(normalizeMime("text/plain; charset=utf-8")).toBe("text/plain");
    expect(normalizeMime("")).toBe("application/octet-stream");
    expect(normalizeMime(null)).toBe("application/octet-stream");
  });

  it("classifies indexable formats (PDF/text/markdown/CSV/log)", () => {
    expect(fileCapability("application/pdf", "m.pdf")).toBe("indexable");
    expect(fileCapability("text/plain", "note.txt")).toBe("indexable");
    expect(fileCapability("text/markdown", "readme.md")).toBe("indexable");
    expect(fileCapability("text/csv", "tags.csv")).toBe("indexable");
    expect(fileCapability("application/octet-stream", "drive.log")).toBe("indexable");
    expect(fileCapability(null, "manual.PDF")).toBe("indexable");
  });

  it("classifies safe rasters as viewable, never SVG", () => {
    expect(fileCapability("image/jpeg", "nameplate.jpg")).toBe("viewable");
    expect(fileCapability("image/png", "p.png")).toBe("viewable");
    expect(fileCapability("image/gif", "g.gif")).toBe("viewable");
    expect(fileCapability("image/webp", "w.webp")).toBe("viewable");
    expect(fileCapability("image/svg+xml", "vector.svg")).toBe("stored");
  });

  it("classifies everything else as stored (PLC backups, archives, unknown)", () => {
    expect(fileCapability("application/octet-stream", "program.ccwsln")).toBe("stored");
    expect(fileCapability("application/zip", "backup.zip")).toBe("stored");
    expect(fileCapability("application/vnd.ms-excel", "sheet.xls")).toBe("stored");
    expect(fileCapability(null, null)).toBe("stored");
  });

  it("inline-render safelist: pdf/rasters/plain text only", () => {
    expect(inlineRenderAllowed("application/pdf")).toBe(true);
    expect(inlineRenderAllowed("image/png")).toBe(true);
    expect(inlineRenderAllowed("text/plain")).toBe(true);
    expect(inlineRenderAllowed("image/svg+xml")).toBe(false);
    expect(inlineRenderAllowed("text/html")).toBe(false);
    expect(inlineRenderAllowed("application/zip")).toBe(false);
    expect(inlineRenderAllowed(null)).toBe(false);
  });

  it("isLinkTargetType allowlists exactly the four types", () => {
    expect(isLinkTargetType("equipment_notebook")).toBe(true);
    expect(isLinkTargetType("cmms_asset")).toBe(true);
    expect(isLinkTargetType("namespace_node")).toBe(true);
    expect(isLinkTargetType("work_order")).toBe(true);
    expect(isLinkTargetType("kg_entity")).toBe(false);
    expect(isLinkTargetType("")).toBe(false);
    expect(isLinkTargetType(null)).toBe(false);
  });
});

describe("parkOrReuseFile", () => {
  const base = {
    tenantId: TENANT,
    filename: "manual.pdf",
    mimeType: "application/pdf",
    sizeBytes: 3,
    buffer: Buffer.from("abc"),
  };

  it("reuses the existing canonical row on identical bytes (no re-park)", async () => {
    const { calls } = clientFromRoutes([
      { match: /SELECT id::text AS id, upload_id/, rows: [{ id: FILE_ID, upload_id: UPLOAD_ID }] },
    ]);
    const r = await parkOrReuseFile(base);
    expect(r).toEqual({ fileId: FILE_ID, reused: true, uploadId: UPLOAD_ID });
    expect(calls.some((c) => /INSERT INTO namespace_direct_uploads/.test(c.sql))).toBe(false);
  });

  it("inserts a new canonical row with sha when bytes are new", async () => {
    const { calls } = clientFromRoutes([
      { match: /INSERT INTO namespace_direct_uploads/, rows: [{ id: FILE_ID }] },
    ]);
    const r = await parkOrReuseFile(base);
    expect(r).toEqual({ fileId: FILE_ID, reused: false, uploadId: null });
    const ins = calls.find((c) => /INSERT INTO namespace_direct_uploads/.test(c.sql))!;
    expect(ins.sql).toContain("ON CONFLICT (tenant_id, content_sha256)");
    expect(ins.params).toContain(sha256Hex(Buffer.from("abc")));
  });

  it("resolves a lost concurrent race to the winner's row", async () => {
    let selectCount = 0;
    clientFromRoutes([
      {
        match: /SELECT id::text AS id, upload_id/,
        rows: () => (++selectCount === 1 ? [] : [{ id: FILE_ID, upload_id: null }]),
      },
      { match: /INSERT INTO namespace_direct_uploads/, rows: [] }, // conflict → no row
    ]);
    const r = await parkOrReuseFile(base);
    expect(r).toEqual({ fileId: FILE_ID, reused: true, uploadId: null });
  });
});

describe("attachFileToTargets", () => {
  it("returns file_not_found for a missing or cross-tenant file", async () => {
    clientFromRoutes([]);
    const r = await attachFileToTargets(TENANT, FILE_ID, [
      { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
    ]);
    expect(r).toEqual({ ok: false, error: "file_not_found" });
  });

  it("rejects a non-UUID fileId without touching the DB", async () => {
    const { query } = clientFromRoutes([]);
    const r = await attachFileToTargets(TENANT, "not-a-uuid", [
      { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
    ]);
    expect(r).toEqual({ ok: false, error: "file_not_found" });
    expect(query).not.toHaveBeenCalled();
  });

  it("all-or-nothing: an invalid target aborts the whole batch", async () => {
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: null }] },
      { match: /FROM equipment_notebooks/, rows: [] }, // target not found
    ]);
    const r = await attachFileToTargets(TENANT, FILE_ID, [
      { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
    ]);
    expect(r).toEqual({
      ok: false,
      error: "target_not_found",
      targetType: "equipment_notebook",
      targetId: NOTEBOOK_ID,
    });
  });

  it("notebook link + indexed doc → source membership in the SAME transaction", async () => {
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: UPLOAD_ID }] },
      { match: /FROM equipment_notebooks/, rows: [{ node_id: NODE_ID }] },
      { match: /INSERT INTO workspace_file_links/, rows: [{ id: LINK_ID }] },
    ]);
    const r = await attachFileToTargets(
      TENANT,
      FILE_ID,
      [{ targetType: "equipment_notebook", targetId: NOTEBOOK_ID, role: "manual", matchState: "candidate" }],
      { createdBy: "tech@x" },
    );
    expect(r).toEqual({
      ok: true,
      links: [{ linkId: LINK_ID, targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
    });
    expect(upsertNotebookSourceTx).toHaveBeenCalledTimes(1);
    const args = upsertNotebookSourceTx.mock.calls[0] as unknown[];
    expect(args[1]).toMatchObject({
      tenantId: TENANT,
      notebookId: NOTEBOOK_ID,
      docId: UPLOAD_ID,
      matchState: "candidate",
      sourceRole: "manual",
    });
    // One withTenantContext call = one transaction for link + source.
    expect(tenantCtxCalls).toEqual([TENANT]);
  });

  it("stored-only file (no uploadId) gets the link but never a chat-scope source", async () => {
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: null }] },
      { match: /FROM equipment_notebooks/, rows: [{ node_id: NODE_ID }] },
      { match: /INSERT INTO workspace_file_links/, rows: [{ id: LINK_ID }] },
    ]);
    const r = await attachFileToTargets(TENANT, FILE_ID, [
      { targetType: "equipment_notebook", targetId: NOTEBOOK_ID },
    ]);
    expect(r).toMatchObject({ ok: true });
    expect(upsertNotebookSourceTx).not.toHaveBeenCalled();
  });

  it("validates cmms_asset and work_order on the raw pool with explicit tenant predicate", async () => {
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: null }] },
      { match: /INSERT INTO workspace_file_links/, rows: [{ id: LINK_ID }] },
    ]);
    poolQuery.mockResolvedValue({ rows: [{ id: NODE_ID }], rowCount: 1 });
    const r = await attachFileToTargets(TENANT, FILE_ID, [
      { targetType: "cmms_asset", targetId: NODE_ID },
      { targetType: "work_order", targetId: NODE_ID },
    ]);
    expect(r).toMatchObject({ ok: true });
    const sqls = poolQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => /cmms_equipment/.test(s) && /tenant_id = \$1/.test(s))).toBe(true);
    expect(sqls.some((s) => /work_orders/.test(s) && /tenant_id = \$1/.test(s))).toBe(true);
  });

  it("idempotent replay: ON CONFLICT upsert returns the existing link id", async () => {
    const { calls } = clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: null }] },
      { match: /FROM kg_entities/, rows: [{ id: NODE_ID }] },
      { match: /INSERT INTO workspace_file_links/, rows: [{ id: LINK_ID }] },
    ]);
    const r = await attachFileToTargets(TENANT, FILE_ID, [
      { targetType: "namespace_node", targetId: NODE_ID },
    ]);
    expect(r).toMatchObject({ ok: true, links: [{ linkId: LINK_ID }] });
    const ins = calls.find((c) => /INSERT INTO workspace_file_links/.test(c.sql))!;
    expect(ins.sql).toContain("ON CONFLICT ON CONSTRAINT uq_workspace_file_links_relationship");
    expect(ins.sql).toContain("DO UPDATE");
  });

  it("isPrimary clears other primaries before setting the new one", async () => {
    const { calls } = clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: null }] },
      { match: /FROM kg_entities/, rows: [{ id: NODE_ID }] },
      { match: /INSERT INTO workspace_file_links/, rows: [{ id: LINK_ID }] },
    ]);
    await attachFileToTargets(TENANT, FILE_ID, [
      { targetType: "namespace_node", targetId: NODE_ID, isPrimary: true },
    ]);
    const clearIdx = calls.findIndex((c) => /SET is_primary = false/.test(c.sql));
    const insIdx = calls.findIndex((c) => /INSERT INTO workspace_file_links/.test(c.sql));
    expect(clearIdx).toBeGreaterThanOrEqual(0);
    expect(clearIdx).toBeLessThan(insIdx);
  });
});

describe("detachLink", () => {
  it("removes the link AND that notebook's source membership, nothing else", async () => {
    const { calls } = clientFromRoutes([
      {
        match: /DELETE FROM workspace_file_links/,
        rows: [{ target_type: "equipment_notebook", target_id: NOTEBOOK_ID }],
      },
      { match: /FROM namespace_direct_uploads/, rows: [{ upload_id: UPLOAD_ID }] },
      { match: /DELETE FROM equipment_notebook_sources/, rows: [{}] },
    ]);
    const ok = await detachLink(TENANT, FILE_ID, LINK_ID);
    expect(ok).toBe(true);
    const srcDel = calls.find((c) => /DELETE FROM equipment_notebook_sources/.test(c.sql))!;
    expect(srcDel.params).toEqual([TENANT, NOTEBOOK_ID, UPLOAD_ID]);
    // Bytes/chunks untouched: no namespace_direct_uploads DELETE, no
    // knowledge_entries statement of any kind.
    expect(calls.some((c) => /DELETE FROM namespace_direct_uploads/.test(c.sql))).toBe(false);
    expect(calls.some((c) => /knowledge_entries/.test(c.sql))).toBe(false);
  });

  it("non-notebook detach never touches source membership", async () => {
    const { calls } = clientFromRoutes([
      {
        match: /DELETE FROM workspace_file_links/,
        rows: [{ target_type: "namespace_node", target_id: NODE_ID }],
      },
    ]);
    expect(await detachLink(TENANT, FILE_ID, LINK_ID)).toBe(true);
    expect(calls.some((c) => /equipment_notebook_sources/.test(c.sql))).toBe(false);
  });

  it("returns false when the link doesn't exist (or belongs to another file/tenant)", async () => {
    clientFromRoutes([]);
    expect(await detachLink(TENANT, FILE_ID, LINK_ID)).toBe(false);
  });
});

describe("relocateFile", () => {
  it("adds the new target and removes only the named old link, atomically", async () => {
    const { calls } = clientFromRoutes([
      { match: /SELECT id::text AS id, upload_id[\s\S]*FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: UPLOAD_ID }] },
      { match: /FROM equipment_notebooks/, rows: [{ node_id: NODE_ID }] },
      { match: /INSERT INTO workspace_file_links/, rows: [{ id: LINK_ID }] },
      {
        match: /DELETE FROM workspace_file_links/,
        rows: [{ target_type: "equipment_notebook", target_id: NOTEBOOK_ID }],
      },
      { match: /DELETE FROM equipment_notebook_sources/, rows: [{}] },
    ]);
    const r = await relocateFile(TENANT, FILE_ID, {
      add: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_ID_2 }],
      removeLinkIds: [LINK_ID],
    });
    expect(r).toMatchObject({ ok: true, removed: 1 });
    // Single transaction: adds + removals share one withTenantContext call.
    expect(tenantCtxCalls).toEqual([TENANT]);
    // The removed notebook's source membership went with it.
    const srcDel = calls.find((c) => /DELETE FROM equipment_notebook_sources/.test(c.sql))!;
    expect(srcDel.params).toEqual([TENANT, NOTEBOOK_ID, UPLOAD_ID]);
  });

  it("aborts entirely when a new destination is invalid", async () => {
    const { calls } = clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ id: FILE_ID, upload_id: null }] },
      { match: /FROM equipment_notebooks/, rows: [] },
    ]);
    const r = await relocateFile(TENANT, FILE_ID, {
      add: [{ targetType: "equipment_notebook", targetId: NOTEBOOK_ID_2 }],
      removeLinkIds: [LINK_ID],
    });
    expect(r).toMatchObject({ ok: false, error: "target_not_found" });
    expect(calls.some((c) => /DELETE FROM workspace_file_links/.test(c.sql))).toBe(false);
  });
});

describe("deleteFile", () => {
  it("refuses while relationships remain", async () => {
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ verified: false, links: "2" }] },
    ]);
    expect(await deleteFile(TENANT, FILE_ID)).toEqual({ ok: false, error: "has_links" });
  });

  it("respects verified-file retention", async () => {
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: [{ verified: true, links: "0" }] },
    ]);
    expect(await deleteFile(TENANT, FILE_ID)).toEqual({ ok: false, error: "verified_retained" });
  });

  it("deletes an unfiled, unverified file", async () => {
    const { calls } = clientFromRoutes([
      { match: /SELECT f\.verified/, rows: [{ verified: false, links: "0" }] },
      { match: /DELETE FROM namespace_direct_uploads/, rows: [{}] },
    ]);
    expect(await deleteFile(TENANT, FILE_ID)).toEqual({ ok: true });
    expect(calls.some((c) => /DELETE FROM namespace_direct_uploads/.test(c.sql))).toBe(true);
  });

  it("not_found for missing or non-UUID ids", async () => {
    clientFromRoutes([]);
    expect(await deleteFile(TENANT, FILE_ID)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteFile(TENANT, "junk")).toEqual({ ok: false, error: "not_found" });
  });
});

describe("linkedDocIdsForNode", () => {
  it("returns distinct uploadIds of indexed files linked to the node", async () => {
    clientFromRoutes([
      { match: /FROM workspace_file_links/, rows: [{ upload_id: UPLOAD_ID }] },
    ]);
    expect(await linkedDocIdsForNode(TENANT, NODE_ID)).toEqual([UPLOAD_ID]);
  });

  it("returns [] for a non-UUID node id without querying", async () => {
    const { query } = clientFromRoutes([]);
    expect(await linkedDocIdsForNode(TENANT, "junk")).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("syncNotebookSourcesForFile (PR #3245 review F1)", () => {
  it("creates a user_confirmed source row for EVERY notebook link of the file", async () => {
    clientFromRoutes([
      {
        match: /FROM workspace_file_links/,
        rows: [
          { target_id: NOTEBOOK_ID, role: "manual" },
          { target_id: NOTEBOOK_ID_2, role: null },
        ],
      },
    ]);
    const n = await syncNotebookSourcesForFile(TENANT, FILE_ID, UPLOAD_ID, "u_1");
    expect(n).toBe(2);
    expect(upsertNotebookSourceTx).toHaveBeenCalledTimes(2);
    expect(upsertNotebookSourceTx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        notebookId: NOTEBOOK_ID,
        docId: UPLOAD_ID,
        matchState: "user_confirmed",
        sourceRole: "manual",
      }),
    );
  });

  it("is a no-op for a file with no notebook links", async () => {
    clientFromRoutes([{ match: /FROM workspace_file_links/, rows: [] }]);
    expect(await syncNotebookSourcesForFile(TENANT, FILE_ID, UPLOAD_ID)).toBe(0);
    expect(upsertNotebookSourceTx).not.toHaveBeenCalled();
  });
});

describe("listFiles capability paging (PR #3245 review F2)", () => {
  const fileRow = (i: number, mime: string, name: string) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    filename: name,
    mime_type: mime,
    size_bytes: "10",
    content_sha256: "x",
    upload_id: null,
    verified: false,
    created_at: "2026-08-16T00:00:00Z",
    link_count: "0",
  });

  it("finds a match beyond the first DB page (filter applies BEFORE pagination)", async () => {
    // First batch (200 rows): all stored-only. The matching PDF is on the
    // SECOND batch — the old post-LIMIT filter returned an empty page here.
    const batch1 = Array.from({ length: 200 }, (_, i) => fileRow(i, "application/zip", `a${i}.zip`));
    const batch2 = [fileRow(900, "application/pdf", "manual.pdf")];
    let call = 0;
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: () => (call++ === 0 ? batch1 : batch2) },
    ]);
    const out = await listFiles(TENANT, { capability: "indexable", limit: 50 });
    expect(out.map((f) => f.filename)).toEqual(["manual.pdf"]);
  });

  it("applies offset to the FILTERED sequence, not raw rows", async () => {
    const rows = [
      fileRow(1, "application/pdf", "one.pdf"),
      fileRow(2, "application/zip", "skip.zip"),
      fileRow(3, "application/pdf", "two.pdf"),
      fileRow(4, "application/pdf", "three.pdf"),
    ];
    let call = 0;
    clientFromRoutes([
      { match: /FROM namespace_direct_uploads/, rows: () => (call++ === 0 ? rows : []) },
    ]);
    const out = await listFiles(TENANT, { capability: "indexable", limit: 2, offset: 1 });
    expect(out.map((f) => f.filename)).toEqual(["two.pdf", "three.pdf"]);
  });
});

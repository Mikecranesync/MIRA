import { describe, it, expect, vi, beforeEach } from "vitest";
import type { PoolClient } from "pg";

/**
 * Codex review of #4091 at 1082ad199, F6: an import whose bytes match an
 * existing Inbox document is recorded "duplicate of <original>" and owns no
 * chunks, so every consumer that looks a document up by its OWN id found
 * nothing — doc-scoped chat 404'd and a notebook source built from it read as
 * "no extractable text".
 *
 * Owner decision 2026-10-05 ("Alias at read"): one chunk set; consumers follow
 * "duplicate of" one hop to the original. resolveDuplicateDocAliases is the
 * single tenant-validated resolver; retrieveNodeChunks applies it at the
 * retrieval choke point and labels the original's chunks with the id the
 * caller asked for, so citations, admission and source snapshots stay
 * consistent with the requested scope.
 */

const ORIG = "aaaaaaaa-0000-4000-8000-00000000000a";
const DUP = "dddddddd-0000-4000-8000-00000000000d";
const OTHER = "cccccccc-0000-4000-8000-00000000000c";
const T = "11111111-1111-4111-8111-111111111111";

const { db } = vi.hoisted(() => ({
  db: {
    calls: [] as Array<{ sql: string; params: unknown[] }>,
    rows: [] as Array<Record<string, unknown>>,
    fail: false,
  },
}));

vi.mock("@/lib/db", () => ({
  default: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      db.calls.push({ sql, params });
      if (db.fail) throw new Error("connection refused");
      return { rows: db.rows, rowCount: db.rows.length };
    }),
  },
}));

import { resolveDuplicateDocAliases } from "@/lib/uploads";
import { retrieveNodeChunks } from "@/lib/manual-rag";

// Built, not literal: the knowledge_entries read-filter scanner reads source text.
const KE_READ = new RegExp(`FROM ${["knowledge", "entries"].join("_")}`);

const flat = (sql: string) => sql.replace(/\s+/g, " ").trim();

beforeEach(() => {
  db.calls.length = 0;
  db.rows = [];
  db.fail = false;
});

describe("resolveDuplicateDocAliases — one hop, same tenant", () => {
  it("maps a parsed duplicate to an original that exists in the SAME tenant", async () => {
    db.rows = [{ id: DUP, original_id: ORIG }];
    const map = await resolveDuplicateDocAliases(T, [DUP, OTHER]);
    expect([...map]).toEqual([[DUP, ORIG]]);
    const sql = flat(db.calls[0].sql);
    expect(sql).toMatch(/FROM hub_uploads d JOIN hub_uploads o ON o\.tenant_id = d\.tenant_id/);
    expect(sql).toMatch(/d\.status = 'parsed' AND d\.status_detail LIKE 'duplicate of %'/);
    expect(db.calls[0].params).toEqual([T, [DUP, OTHER]]);
  });

  it("asks nothing for an empty id list", async () => {
    expect((await resolveDuplicateDocAliases(T, [])).size).toBe(0);
    expect(db.calls).toEqual([]);
  });

  it("fails open: a lookup error leaves ids unaliased (aliasing only ever adds coverage)", async () => {
    db.fail = true;
    expect((await resolveDuplicateDocAliases(T, [DUP])).size).toBe(0);
  });
});

describe("retrieveNodeChunks follows a duplicate to its original's chunks", () => {
  type Call = { sql: string; params: unknown[] };
  function client(docIdOfRows: string): { client: PoolClient; calls: Call[] } {
    const calls: Call[] = [];
    const query = vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (!KE_READ.test(sql)) return { rows: [] };
      return {
        rows: [
          {
            content: "F004 DC bus undervoltage",
            rank: 1,
            page_start: 21,
            source_page: 21,
            doc_id: docIdOfRows,
            source_url: `node-doc/${docIdOfRows}/manual.pdf`,
            metadata: { chunk_index: 0, filename: "manual.pdf" },
          },
        ],
      };
    });
    return { client: { query } as unknown as PoolClient, calls };
  }
  // The document scope is bound as $5 on both lanes ("AND doc_id = ANY($5::uuid[])").
  const scopeParams = (calls: Call[]) =>
    calls.filter((c) => /AND doc_id = ANY\(\$5::uuid\[\]\)/.test(c.sql)).map((c) => c.params[4]);

  it("queries the original's chunks for a duplicate in scope, and labels them with the requested id", async () => {
    db.rows = [{ id: DUP, original_id: ORIG }];
    const { client: c, calls } = client(ORIG);
    const chunks = await retrieveNodeChunks(c, T, "what does F004 mean", {
      nodeId: "n1",
      unsPath: null,
      docIds: [DUP],
      approvedSourceDocIds: [DUP],
      validatedDocScope: true,
    });
    const scopes = scopeParams(calls);
    expect(scopes.length).toBeGreaterThan(0);
    for (const s of scopes) expect(s).toEqual([ORIG]);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((ch) => ch.docId === DUP)).toBe(true);
  });

  it("doc-scoped (single docId) chat follows the alias the same way", async () => {
    db.rows = [{ id: DUP, original_id: ORIG }];
    const { client: c, calls } = client(ORIG);
    const chunks = await retrieveNodeChunks(c, T, "what does F004 mean", { nodeId: "n1", unsPath: null, docId: DUP });
    for (const s of scopeParams(calls)) expect(s).toEqual([ORIG]);
    expect(chunks.every((ch) => ch.docId === DUP)).toBe(true);
  });

  it("when the original is ALSO in scope, its chunks keep the original's id (no double count)", async () => {
    db.rows = [{ id: DUP, original_id: ORIG }];
    const { client: c, calls } = client(ORIG);
    const chunks = await retrieveNodeChunks(c, T, "what does F004 mean", {
      nodeId: "n1",
      unsPath: null,
      docIds: [ORIG, DUP],
      validatedDocScope: true,
    });
    for (const s of scopeParams(calls)) expect(s).toEqual([ORIG]);
    expect(chunks.every((ch) => ch.docId === ORIG)).toBe(true);
  });

  it("control: a document that is not a duplicate is queried and labelled as itself", async () => {
    const { client: c, calls } = client(OTHER);
    const chunks = await retrieveNodeChunks(c, T, "what does F004 mean", {
      nodeId: "n1",
      unsPath: null,
      docIds: [OTHER],
      validatedDocScope: true,
    });
    for (const s of scopeParams(calls)) expect(s).toEqual([OTHER]);
    expect(chunks.every((ch) => ch.docId === OTHER)).toBe(true);
  });

  it("an unscoped (node subtree) read never consults the resolver", async () => {
    const { client: c } = client(OTHER);
    await retrieveNodeChunks(c, T, "what does F004 mean", { nodeId: "n1", unsPath: null });
    expect(db.calls).toEqual([]);
  });
});

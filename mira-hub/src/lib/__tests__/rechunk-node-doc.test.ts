import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi } from "vitest";
import {
  chunkKeepsF005Decel,
  loadDocSource,
  planRechunk,
  resolveRechunkMode,
  runRechunk,
  type QueryFn,
  type RechunkDeps,
  type RechunkTxClient,
} from "../rechunk-node-doc";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DOC = "b28a0960-476c-4485-8482-ca7a35cab80b";
const NODE = "e57c47cd-49a6-49f8-95a2-1f8cc519bafc";

const F005_PAGE =
  "F004 UnderVoltage Monitor the AC line for low voltage.\n" +
  "F005 OverVoltage Monitor the AC line for high line voltage or transient conditions. Motor\n" +
  "regeneration can also cause bus overvoltage. Extend the decel time or install\n" +
  "dynamic brake resistor.\n" +
  "F006 Motor Stalled Increase the accel time or reduce the load.";

function logsOf() {
  const lines: string[] = [];
  return {
    lines,
    log: (msg: string) => lines.push(msg),
    error: (msg: string) => lines.push(`ERR ${msg}`),
  };
}

function mockDeps(opts: {
  pages?: string[];
  oldChunkCount?: number;
  deleteRowCount?: number;
  content?: unknown;
  writeImpl?: RechunkDeps["writeChunkRows"];
  embedImpl?: RechunkDeps["embedPending"];
  extraQueries?: Array<{ match: RegExp; rows: unknown[]; rowCount?: number }>;
}): {
  deps: RechunkDeps;
  sql: string[];
  txSql: string[];
  txParams: unknown[][];
  events: string[];
  writeCalls: Array<{ deferEmbed?: boolean; hasClient: boolean }>;
  embedCalls: Array<{ tenantId: string; sourceUrl: string }>;
  logs: ReturnType<typeof logsOf>;
} {
  const sql: string[] = [];
  const txSql: string[] = [];
  const txParams: unknown[][] = [];
  const events: string[] = [];
  const writeCalls: Array<{ deferEmbed?: boolean; hasClient: boolean }> = [];
  const embedCalls: Array<{ tenantId: string; sourceUrl: string }> = [];
  const logs = logsOf();

  const query = (async (text: string, params?: unknown[]) => {
    sql.push(text);
    const extra = opts.extraQueries?.find((q) => q.match.test(text));
    if (extra) return { rows: extra.rows as never, rowCount: extra.rowCount ?? extra.rows.length };
    if (/FROM hub_uploads/i.test(text)) {
      expect(params?.[0]).toBe(TENANT);
      expect(params?.[1]).toBe(DOC);
      return {
        rows: [
          {
            doc_id: DOC,
            filename: "pf525.pdf",
            node_id: NODE,
            uns_path: "enterprise.site.line.vfd",
            entity_uns_path: "enterprise.site.line.vfd",
            content: opts.content !== undefined ? opts.content : Buffer.from("%PDF-1.4 fixture"),
          },
        ],
      };
    }
    if (/COUNT\(\*\)/.test(text) && /knowledge_entries/.test(text)) {
      expect(params?.[0]).toBe(TENANT);
      expect(params?.[1]).toBe(DOC);
      return { rows: [{ n: opts.oldChunkCount ?? 12 }] };
    }
    return { rows: [] };
  }) as QueryFn;

  const client: RechunkTxClient = {
    query: (async (text: string, params?: unknown[]) => {
      txSql.push(text);
      txParams.push(params ?? []);
      if (text === "BEGIN") events.push("BEGIN");
      else if (/DELETE FROM knowledge_entries/.test(text)) events.push("DELETE");
      else if (/INSERT INTO knowledge_entries/.test(text)) events.push("INSERT");
      else if (text === "COMMIT") events.push("COMMIT");
      else if (text === "ROLLBACK") events.push("ROLLBACK");
      if (/DELETE FROM knowledge_entries/.test(text)) {
        return { rows: [], rowCount: opts.deleteRowCount ?? opts.oldChunkCount ?? 12 };
      }
      return { rows: [], rowCount: 0 };
    }) as QueryFn,
    release: vi.fn(),
  };

  const deps: RechunkDeps = {
    query,
    connect: async () => client,
    extractPdfPages: async () => ({
      pages: opts.pages ?? [F005_PAGE],
      repairs: [null],
    }),
    writeChunkRows:
      opts.writeImpl ??
      (async (_pages, _o, _r, runtime) => {
        writeCalls.push({ deferEmbed: runtime?.deferEmbed, hasClient: !!runtime?.client });
        await runtime?.client?.query("INSERT INTO knowledge_entries", []);
        return (opts.pages ?? [F005_PAGE]).length;
      }),
    embedPending:
      opts.embedImpl ??
      (async (tenantId, sourceUrl) => {
        events.push("EMBED");
        embedCalls.push({ tenantId, sourceUrl });
        return { embedded: 1, state: "complete", permanent: false };
      }),
    log: logs.log,
    error: logs.error,
  };

  return { deps, sql, txSql, txParams, events, writeCalls, embedCalls, logs };
}

describe("resolveRechunkMode — write only behind env + --apply + --doc-id", () => {
  const argv = ["bun", "scripts/rechunk-node-doc.ts", "--tenant-id", TENANT, "--doc-id", DOC];

  it("defaults to dry-run", () => {
    const mode = resolveRechunkMode(argv, {});
    expect(mode.apply).toBe(false);
    expect(mode.applyRequested).toBe(false);
    expect(mode.envOn).toBe(false);
  });

  it("--apply without NOTEBOOK_RECHUNK_APPLY=1 stays dry-run", () => {
    const mode = resolveRechunkMode([...argv, "--apply"], {});
    expect(mode.applyRequested).toBe(true);
    expect(mode.apply).toBe(false);
  });

  it("NOTEBOOK_RECHUNK_APPLY=1 without --apply stays dry-run", () => {
    const mode = resolveRechunkMode(argv, { NOTEBOOK_RECHUNK_APPLY: "1" });
    expect(mode.apply).toBe(false);
  });

  it("--apply without --doc-id stays dry-run", () => {
    const mode = resolveRechunkMode(
      ["bun", "x", "--tenant-id", TENANT, "--apply"],
      { NOTEBOOK_RECHUNK_APPLY: "1" },
    );
    expect(mode.apply).toBe(false);
    expect(mode.docId).toBeNull();
  });

  it("writes only when env, --apply, and --doc-id are all set", () => {
    const mode = resolveRechunkMode([...argv, "--apply"], { NOTEBOOK_RECHUNK_APPLY: "1" });
    expect(mode.apply).toBe(true);
  });
});

describe("F005 + Extend the decel check", () => {
  it("passes only when both phrases share one chunk", () => {
    expect(chunkKeepsF005Decel(F005_PAGE)).toBe(true);
    expect(chunkKeepsF005Decel("F005 OverVoltage only")).toBe(false);
    expect(chunkKeepsF005Decel("Extend the decel time only")).toBe(false);
  });

  it("planRechunk reports PASS when A2 keeps the phrases together", async () => {
    const { deps } = mockDeps({ pages: [F005_PAGE], oldChunkCount: 9 });
    const plan = await planRechunk(deps, TENANT, {
      docId: DOC,
      filename: "pf525.pdf",
      nodeId: NODE,
      unsPath: null,
      buffer: Buffer.from("x"),
      oldChunkCount: 9,
    });
    expect(plan.oldChunkCount).toBe(9);
    expect(plan.newChunkCount).toBeGreaterThan(0);
    expect(plan.f005DecelOk).toBe(true);
    expect(plan.newChunks.some(chunkKeepsF005Decel)).toBe(true);
  });

  it("planRechunk reports FAIL when no chunk has both phrases", async () => {
    const { deps } = mockDeps({ pages: ["F004 only. No fault table here."] });
    const plan = await planRechunk(deps, TENANT, {
      docId: DOC,
      filename: "pf525.pdf",
      nodeId: NODE,
      unsPath: null,
      buffer: Buffer.from("x"),
      oldChunkCount: 9,
    });
    expect(plan.f005DecelOk).toBe(false);
  });
});

describe("runRechunk dry-run / apply", () => {
  const argv = ["bun", "scripts/rechunk-node-doc.ts", "--tenant-id", TENANT, "--doc-id", DOC];

  it("dry-run prints old/new counts and the F005 check, and writes nothing", async () => {
    const { deps, txSql, writeCalls, embedCalls, logs } = mockDeps({
      pages: [F005_PAGE],
      oldChunkCount: 14,
    });
    const out = await runRechunk(argv, {}, deps);
    expect(out).toEqual({
      mode: "dry-run",
      oldChunkCount: 14,
      newChunkCount: 1,
      f005DecelOk: true,
      written: false,
    });
    expect(logs.lines.some((l) => l.includes("old_chunks=14") && l.includes("new_chunks=1"))).toBe(true);
    expect(logs.lines.some((l) => l.includes("f005_decel_check=PASS"))).toBe(true);
    expect(logs.lines.some((l) => l.includes("dry run — nothing written"))).toBe(true);
    expect(txSql).toEqual([]);
    expect(writeCalls).toEqual([]);
    expect(embedCalls).toEqual([]);
  });

  it("--apply without the env flag is still a dry-run", async () => {
    const { deps, txSql, logs } = mockDeps({ pages: [F005_PAGE] });
    const out = await runRechunk([...argv, "--apply"], {}, deps);
    expect(out.written).toBe(false);
    expect(out.mode).toBe("dry-run");
    expect(logs.lines.some((l) => l.includes("NOTEBOOK_RECHUNK_APPLY=1"))).toBe(true);
    expect(txSql).toEqual([]);
  });

  it("apply runs delete + insert on ONE client, then embeds after COMMIT", async () => {
    const { deps, txSql, txParams, events, writeCalls, embedCalls } = mockDeps({
      pages: [F005_PAGE],
      oldChunkCount: 14,
    });
    const out = await runRechunk([...argv, "--apply"], { NOTEBOOK_RECHUNK_APPLY: "1" }, deps);
    expect(out.written).toBe(true);
    expect(out.mode).toBe("APPLY");
    expect(out.deleted).toBe(14);
    expect(events).toEqual(["BEGIN", "DELETE", "INSERT", "COMMIT", "EMBED"]);
    const del = txSql.find((s) => /DELETE FROM knowledge_entries/.test(s))!;
    expect(del).toMatch(/tenant_id = \$1::uuid/);
    expect(del).toMatch(/source_type = 'node_attachment'/);
    expect(del).toMatch(/doc_id = \$2::uuid OR source_url = \$3/);
    expect(txParams[txSql.findIndex((s) => /DELETE FROM knowledge_entries/.test(s))]).toEqual([
      TENANT,
      DOC,
      `node-doc/${DOC}/pf525.pdf`,
    ]);
    expect(txSql.some((s) => /hub_uploads/.test(s))).toBe(false);
    expect(txSql.some((s) => /workspace_file_links/.test(s))).toBe(false);
    expect(txSql.some((s) => /namespace_direct_uploads/.test(s))).toBe(false);
    expect(writeCalls).toEqual([{ deferEmbed: true, hasClient: true }]);
    expect(embedCalls).toEqual([{ tenantId: TENANT, sourceUrl: `node-doc/${DOC}/pf525.pdf` }]);
  });

  it("apply rolls back when the writer throws and never embeds", async () => {
    const { deps, txSql, embedCalls } = mockDeps({
      pages: [F005_PAGE],
      writeImpl: async () => {
        throw new Error("insert failed");
      },
    });
    await expect(
      runRechunk([...argv, "--apply"], { NOTEBOOK_RECHUNK_APPLY: "1" }, deps),
    ).rejects.toThrow(/insert failed/);
    expect(txSql[0]).toBe("BEGIN");
    expect(txSql.some((s) => s === "ROLLBACK")).toBe(true);
    expect(txSql.some((s) => s === "COMMIT")).toBe(false);
    expect(embedCalls).toEqual([]);
  });

  it("refuses apply when the F005 check fails — no DELETE", async () => {
    const { deps, txSql, writeCalls } = mockDeps({
      pages: ["no fault codes on this page"],
    });
    await expect(
      runRechunk([...argv, "--apply"], { NOTEBOOK_RECHUNK_APPLY: "1" }, deps),
    ).rejects.toThrow(/F005/);
    expect(txSql).toEqual([]);
    expect(writeCalls).toEqual([]);
  });

  it("loads bytes from the canonical file (namespace_direct_uploads.content) scoped to tenant+doc", async () => {
    const { deps, sql } = mockDeps({ pages: [F005_PAGE] });
    await runRechunk(argv, {}, deps);
    const load = sql.find((s) => /FROM hub_uploads/.test(s))!;
    expect(load).toMatch(/JOIN namespace_direct_uploads/);
    expect(load).toMatch(/f\.content/);
    expect(load).toMatch(/u\.tenant_id = \$1::uuid AND u\.id = \$2::uuid/);
    expect(load).not.toMatch(/DELETE /);
  });

  it("refuses a string/null canonical payload instead of guessing an encoding", async () => {
    const { deps } = mockDeps({ content: "JVBERi0x" });
    await expect(loadDocSource(deps, TENANT, DOC)).rejects.toThrow(/no readable bytes/);
    const empty = mockDeps({ content: null });
    await expect(loadDocSource(empty.deps, TENANT, DOC)).rejects.toThrow(/no readable bytes/);
  });

  it("refuses apply when DELETE removes nothing but chunks were counted", async () => {
    const { deps, events } = mockDeps({
      pages: [F005_PAGE],
      oldChunkCount: 14,
      deleteRowCount: 0,
    });
    await expect(
      runRechunk([...argv, "--apply"], { NOTEBOOK_RECHUNK_APPLY: "1" }, deps),
    ).rejects.toThrow(/DELETE removed 0/);
    expect(events).toEqual(["BEGIN", "DELETE", "ROLLBACK"]);
  });
});

describe("one-off script invariants (source)", () => {
  const cli = readFileSync(join(__dirname, "../../../scripts/rechunk-node-doc.ts"), "utf8");
  const lib = readFileSync(join(__dirname, "../rechunk-node-doc.ts"), "utf8");
  const src = `${cli}\n${lib}`;

  it("never calls deleteOrphanNodeIngest (that drops hub_uploads)", () => {
    expect(src).not.toMatch(/deleteOrphanNodeIngest\s*[\(<]/);
    expect(cli).not.toContain("deleteOrphanNodeIngest");
    expect(lib).not.toMatch(/import\s*\{[^}]*deleteOrphanNodeIngest/);
  });

  it("never touches the mira-core remediator, a durable rechunk API, or phrase patches", () => {
    expect(src).not.toMatch(/remediate_knowledge_base/);
    expect(src).not.toMatch(/chunker_version\s*=/);
    expect(src).not.toMatch(/packages\/factorylm-/);
    expect(src).not.toMatch(/\/api\/.*rechunk/);
  });

  it("requires the dual write lock and scopes DELETE to tenant_id + doc_id", () => {
    expect(src).toMatch(/NOTEBOOK_RECHUNK_APPLY/);
    expect(lib).toMatch(/DELETE FROM knowledge_entries/);
    expect(lib).toMatch(/source_type = 'node_attachment'/);
    expect(lib).toMatch(/doc_id = \$2::uuid OR source_url = \$3/);
    expect(lib).toMatch(/deferEmbed: true/);
  });
});

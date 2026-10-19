import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadManualProposals,
  rankManualProposals,
  type HarvestNotebook,
  type QueryDb,
} from "../manual-harvester";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function nb(over: Partial<HarvestNotebook>): HarvestNotebook {
  return {
    notebookId: "n1",
    manufacturer: "Siemens",
    model: "3RV20",
    catalogNumber: null,
    identityStatus: "user_confirmed",
    lastSeenMs: Date.parse("2026-10-01T00:00:00Z"),
    hasManual: false,
    refusedTurns: 0,
    ...over,
  };
}

describe("rankManualProposals", () => {
  it("proposes a confirmed identity (control)", () => {
    const out = rankManualProposals([nb({})]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ manufacturer: "Siemens", model: "3RV20", notebookIds: ["n1"] });
  });

  it.each(["candidate", "unknown"])("never proposes from an unconfirmed %s identity", (s) => {
    expect(rankManualProposals([nb({ identityStatus: s })])).toEqual([]);
  });

  it("requires both manufacturer and model", () => {
    expect(rankManualProposals([nb({ model: "  " })])).toEqual([]);
    expect(rankManualProposals([nb({ manufacturer: "" })])).toEqual([]);
  });

  it("drops a notebook that already has a manual", () => {
    expect(rankManualProposals([nb({ hasManual: true })])).toEqual([]);
  });

  it("groups case/whitespace variants but never fuzzy-merges different models", () => {
    const out = rankManualProposals([
      nb({ notebookId: "n2", manufacturer: "SIEMENS ", model: "3rv20" }),
      nb({ notebookId: "n1" }),
      nb({ notebookId: "n3", model: "3RV2" }),
    ]);
    expect(out).toHaveLength(2);
    const byModel = Object.fromEntries(out.map((p) => [p.model.toLowerCase(), p.notebookIds]));
    expect(byModel).toEqual({ "3rv20": ["n1", "n2"], "3rv2": ["n3"] });
  });

  it("ranks by refused turns, then recency, then name; equal input gives equal output", () => {
    const rows = [
      nb({ notebookId: "a", manufacturer: "Bihl", model: "BWU", lastSeenMs: 3 }),
      nb({ notebookId: "b", manufacturer: "SMC", model: "SS5Y3", refusedTurns: 4, lastSeenMs: 1 }),
      nb({ notebookId: "c", manufacturer: "ABB", model: "X1", lastSeenMs: 3 }),
      nb({ notebookId: "d", manufacturer: "Turck", model: "NI8U", lastSeenMs: 9 }),
    ];
    const order = rankManualProposals(rows).map((p) => p.manufacturer);
    expect(order).toEqual(["SMC", "Turck", "ABB", "Bihl"]);
    expect(rankManualProposals([...rows].reverse())).toEqual(rankManualProposals(rows));
  });

  it("flags but keeps a model the shared library already has", () => {
    const out = rankManualProposals([nb({})], new Set(["siemens\u00003rv20"]));
    expect(out[0].alreadyInLibrary).toBe(true);
  });
});

type Call = { sql: string; params: unknown[] };
function fakeDb(handler: (sql: string, params: unknown[]) => Record<string, unknown>[]) {
  const calls: Call[] = [];
  const db: QueryDb = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: handler(sql, params) };
    },
  };
  return { db, calls };
}

// One fake database holding two tenants' rows; the handler honours only the
// tenant the SQL actually binds, so a query that forgot to bind it leaks.
const ROWS = {
  notebooks: [
    { tenant: A, notebook_id: "na", manufacturer: "Siemens", model: "3RV20", catalog_number: null,
      identity_status: "user_confirmed", last_seen: "2026-10-01T00:00:00Z", has_manual: false },
    { tenant: B, notebook_id: "nb", manufacturer: "SMC", model: "SS5Y3", catalog_number: null,
      identity_status: "verified", last_seen: "2026-10-02T00:00:00Z", has_manual: false },
  ],
  refusals: [
    { tenant: A, notebook_id: "na", refused: 2, last_refused: "2026-10-05T00:00:00Z" },
    { tenant: B, notebook_id: "nb", refused: 9, last_refused: "2026-10-06T00:00:00Z" },
  ],
};

function tenantScoped(sql: string, params: unknown[]) {
  const bound = /tenant_id = \$1::(uuid|text)/.test(sql) ? params[0] : undefined;
  const pick = <T extends { tenant: string }>(rows: T[]) => rows.filter((r) => r.tenant === bound);
  if (sql.includes("FROM equipment_notebooks")) return pick(ROWS.notebooks);
  if (sql.includes("FROM decision_traces")) return pick(ROWS.refusals);
  return [];
}

describe("loadManualProposals", () => {
  it("returns only the caller's machines (cross-tenant negative)", async () => {
    const t = fakeDb(tenantScoped);
    const s = fakeDb(() => []);
    const out = await loadManualProposals({ tenantDb: t.db, sharedDb: s.db }, A);
    expect(out.map((p) => p.manufacturer)).toEqual(["Siemens"]);
    expect(out[0].refusedTurns).toBe(2);
    const outB = await loadManualProposals({ tenantDb: t.db, sharedDb: s.db }, B);
    expect(outB.map((p) => p.manufacturer)).toEqual(["SMC"]);
  });

  it("binds the caller tenant on every query and uses the hybrid predicate for the library", async () => {
    const t = fakeDb(tenantScoped);
    const s = fakeDb(() => [{ manufacturer: "siemens", model: "3rv20" }]);
    const out = await loadManualProposals({ tenantDb: t.db, sharedDb: s.db }, A);
    for (const c of [...t.calls, ...s.calls]) {
      expect(c.sql).toMatch(/tenant_id = \$1::(uuid|text)/);
      expect(c.params[0]).toBe(A);
    }
    // decision_traces.tenant_id is TEXT since migration 070; a ::uuid compare errors live.
    const traces = t.calls.find((c) => c.sql.includes("FROM decision_traces"));
    expect(traces?.sql).toMatch(/tenant_id = \$1::text/);
    expect(s.calls).toHaveLength(1);
    expect(s.calls[0].sql).toMatch(/\(is_private = false OR tenant_id = \$1::uuid\)/);
    expect(out[0].alreadyInLibrary).toBe(true);
  });

  it("skips the trace and library reads when nothing needs a manual", async () => {
    const t = fakeDb((sql) =>
      sql.includes("FROM equipment_notebooks") ? [{ ...ROWS.notebooks[0], has_manual: true }] : [],
    );
    const s = fakeDb(() => []);
    expect(await loadManualProposals({ tenantDb: t.db, sharedDb: s.db }, A)).toEqual([]);
    expect(t.calls).toHaveLength(1);
    expect(s.calls).toHaveLength(0);
  });

  it("module source contains no write statements", () => {
    const src = readFileSync(path.join(__dirname, "..", "manual-harvester.ts"), "utf8");
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|TRUNCATE)\b/);
  });
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadHarvestNotebooks,
  loadLibraryKeys,
  rankManualProposals,
  type HarvestNotebook,
  type QueryDb,
} from "../manual-harvester";
import { acquisitionKey } from "../notebook-manual-acquisition";

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
    lastSearch: null,
    ...over,
  };
}

describe("rankManualProposals", () => {
  it("proposes a confirmed identity (control)", () => {
    const { proposals } = rankManualProposals([nb({})]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ manufacturer: "Siemens", model: "3RV20", notebookIds: ["n1"] });
  });

  it.each(["candidate", "unknown", "verified"])("never proposes what approval could not start (%s)", (s) => {
    expect(rankManualProposals([nb({ identityStatus: s })])).toEqual({ proposals: [], searched: [] });
  });

  it("requires a manufacturer plus a model or catalog number (the acquisition key)", () => {
    expect(rankManualProposals([nb({ model: "  " })]).proposals).toEqual([]);
    expect(rankManualProposals([nb({ manufacturer: "" })]).proposals).toEqual([]);
    expect(rankManualProposals([nb({ model: "", catalogNumber: "6AV2124-0GC01-0AX0" })]).proposals).toHaveLength(1);
  });

  it("drops a notebook that already has an applicable manual", () => {
    expect(rankManualProposals([nb({ hasManual: true })]).proposals).toEqual([]);
  });

  it("an identity already searched is shown under `searched`, never as an approvable proposal (Codex F3)", () => {
    const out = rankManualProposals([nb({ lastSearch: "no_manual_found" })]);
    expect(out.proposals).toEqual([]);
    expect(out.searched).toHaveLength(1);
    expect(out.searched[0].lastSearch).toBe("no_manual_found");
  });

  it("one notebook's search never hides an unsearched notebook of the same identity (Codex F6)", () => {
    const out = rankManualProposals([
      nb({ notebookId: "a", lastSearch: "candidate_review" }),
      nb({ notebookId: "b" }),
    ]);
    expect(out.proposals.map((p) => p.notebookIds)).toEqual([["b"]]);
    expect(out.searched.map((p) => p.notebookIds)).toEqual([["a"]]);
  });

  it("groups by acquisition key: case/punctuation variants merge, different models do not", () => {
    const { proposals } = rankManualProposals([
      nb({ notebookId: "n2", manufacturer: "SIEMENS ", model: "3rv-20" }),
      nb({ notebookId: "n1" }),
      nb({ notebookId: "n3", model: "3RV2" }),
    ]);
    expect(proposals).toHaveLength(2);
    const byKey = Object.fromEntries(proposals.map((p) => [p.model.toLowerCase(), p.notebookIds]));
    expect(byKey["3rv2"]).toEqual(["n3"]);
    expect(Object.values(byKey)).toContainEqual(["n1", "n2"]);
  });

  it("ranks by refused turns, then recency, then name; equal input gives equal output", () => {
    const rows = [
      nb({ notebookId: "a", manufacturer: "Bihl", model: "BWU", lastSeenMs: 3 }),
      nb({ notebookId: "b", manufacturer: "SMC", model: "SS5Y3", refusedTurns: 4, lastSeenMs: 1 }),
      nb({ notebookId: "c", manufacturer: "ABB", model: "X1", lastSeenMs: 3 }),
      nb({ notebookId: "d", manufacturer: "Turck", model: "NI8U", lastSeenMs: 9 }),
    ];
    expect(rankManualProposals(rows).proposals.map((p) => p.manufacturer)).toEqual(["SMC", "Turck", "ABB", "Bihl"]);
    expect(rankManualProposals([...rows].reverse())).toEqual(rankManualProposals(rows));
  });

  it("flags but keeps a model the shared library already has", () => {
    const out = rankManualProposals([nb({})], new Set(["siemens\u00003rv20"]));
    expect(out.proposals[0].alreadyInLibrary).toBe(true);
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

const SIEMENS_KEY = acquisitionKey({ identityStatus: "user_confirmed", manufacturer: "Siemens", model: "3RV20", catalogNumber: null })!;

// One fake database holding two tenants' rows; the handler honours only the
// tenant the SQL actually binds, so a query that forgot to bind it leaks.
let sources: Record<string, unknown>[] = [];
const ROWS = {
  notebooks: [
    { tenant: A, notebook_id: "na", manufacturer: "Siemens", model: "3RV20", catalog_number: null,
      identity_status: "user_confirmed", last_seen: "2026-10-01T00:00:00Z", search_state: null, search_key: null },
    { tenant: B, notebook_id: "nb", manufacturer: "SMC", model: "SS5Y3", catalog_number: null,
      identity_status: "user_confirmed", last_seen: "2026-10-02T00:00:00Z", search_state: null, search_key: null },
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
  if (sql.includes("FROM equipment_notebook_sources")) return pick(sources as never);
  if (sql.includes("FROM decision_traces")) return pick(ROWS.refusals);
  return [];
}

describe("loadHarvestNotebooks / loadLibraryKeys", () => {
  it("returns only the caller's machines (cross-tenant negative)", async () => {
    sources = [];
    const t = fakeDb(tenantScoped);
    const a = await loadHarvestNotebooks(t.db, A);
    expect(a.map((n) => n.manufacturer)).toEqual(["Siemens"]);
    expect(a[0].refusedTurns).toBe(2);
    expect((await loadHarvestNotebooks(t.db, B)).map((n) => n.manufacturer)).toEqual(["SMC"]);
  });

  it("binds the caller tenant on every query; the library read uses the hybrid predicate", async () => {
    sources = [];
    const t = fakeDb(tenantScoped);
    const s = fakeDb(() => [{ manufacturer: "siemens", model: "3rv20" }]);
    const notebooks = await loadHarvestNotebooks(t.db, A);
    const lib = await loadLibraryKeys(s.db, A, notebooks);
    for (const c of [...t.calls, ...s.calls]) {
      expect(c.sql).toMatch(/tenant_id = \$1::(uuid|text)/);
      expect(c.params[0]).toBe(A);
    }
    // decision_traces.tenant_id is TEXT since migration 070; a ::uuid compare errors live.
    expect(t.calls.find((c) => c.sql.includes("FROM decision_traces"))?.sql).toMatch(/tenant_id = \$1::text/);
    expect(s.calls[0].sql).toMatch(/\(is_private = false OR tenant_id = \$1::uuid\)/);
    expect(rankManualProposals(notebooks, lib).proposals[0].alreadyInLibrary).toBe(true);
  });

  it("an enabled manual stamped for the CURRENT identity counts as having a manual", async () => {
    sources = [{ tenant: A, notebook_id: "na", source_role: "manual", enabled_by_default: true,
                 match_state: "verified", match_evidence: { autoAcquisitionKey: SIEMENS_KEY } }];
    const n = await loadHarvestNotebooks(fakeDb(tenantScoped).db, A);
    expect(n[0].hasManual).toBe(true);
  });

  it("a disabled leftover from a prior identity does NOT suppress the proposal (Codex F2)", async () => {
    sources = [
      { tenant: A, notebook_id: "na", source_role: "manual", enabled_by_default: false,
        match_state: "candidate", match_evidence: { autoAcquisitionKey: "SIEMENS|3RV10|" } },
      { tenant: A, notebook_id: "na", source_role: "manual", enabled_by_default: true,
        match_state: "verified", match_evidence: { autoAcquisitionKey: "SIEMENS|3RV10|" } },
    ];
    const n = await loadHarvestNotebooks(fakeDb(tenantScoped).db, A);
    expect(n[0].hasManual).toBe(false);
  });

  it("a recorded search for the current key marks it searched; a stale key does not", async () => {
    sources = [];
    const t = fakeDb((sql, params) =>
      sql.includes("FROM equipment_notebooks")
        ? [{ ...ROWS.notebooks[0], search_state: "no_manual_found", search_key: SIEMENS_KEY }]
        : tenantScoped(sql, params),
    );
    expect((await loadHarvestNotebooks(t.db, A))[0].lastSearch).toBe("no_manual_found");
    const stale = fakeDb((sql, params) =>
      sql.includes("FROM equipment_notebooks")
        ? [{ ...ROWS.notebooks[0], search_state: "no_manual_found", search_key: "SIEMENS|OLD|" }]
        : tenantScoped(sql, params),
    );
    expect((await loadHarvestNotebooks(stale.db, A))[0].lastSearch).toBeNull();
  });

  it("skips the follow-up reads when nothing qualifies", async () => {
    const t = fakeDb((sql) => (sql.includes("FROM equipment_notebooks") ? [] : []));
    expect(await loadHarvestNotebooks(t.db, A)).toEqual([]);
    expect(t.calls).toHaveLength(1);
    const s = fakeDb(() => []);
    expect(await loadLibraryKeys(s.db, A, [])).toEqual(new Set());
    expect(s.calls).toHaveLength(0);
  });

  it("module source contains no write statements", () => {
    const src = readFileSync(path.join(__dirname, "..", "manual-harvester.ts"), "utf8");
    expect(src).not.toMatch(/\b(INSERT|UPDATE|DELETE|UPSERT|TRUNCATE)\b/);
  });
});

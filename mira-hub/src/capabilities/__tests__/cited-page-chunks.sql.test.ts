/**
 * #4509 Codex F1: `retrieveCitedPageChunks` reads the rest of each cited page.
 * Pins the read's boundary: same tenant, v2 rows only, the exact (document,
 * file, page) tuples, and the same approval predicate retrieval uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CANDIDATE_PATTERN, retrieveCitedPageChunks } from "@/lib/manual-rag";
import { extractManualSafetyStatement } from "@/capabilities/manual-safety-statement";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const page = { docId: DOC, sourceUrl: "pf40.pdf", page: 73 };

function fakeClient(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows }));
  return { client: { query } as never, query };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("retrieveCitedPageChunks (#4509 Codex F1)", () => {
  it("no pages → no query", async () => {
    const { client, query } = fakeClient();
    expect(await retrieveCitedPageChunks(client, TENANT, [])).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("scopes to the tenant, v2 rows and the exact (document, file, page) tuples", async () => {
    const { client, query } = fakeClient([{ content: "WARNING: x.", source_url: "pf40.pdf", page: 73 }]);
    const out = await retrieveCitedPageChunks(client, TENANT, [page]);
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    expect(sql).toMatch(/ingest_route = 'v2'/);
    expect(sql).toMatch(/\(doc_id::text, source_url, COALESCE\(page_start, source_page\)\) IN/);
    expect(params).toEqual([TENANT, [DOC], ["pf40.pdf"], [73], CANDIDATE_PATTERN]);
    expect(out).toEqual([{ content: "WARNING: x.", sourceUrl: "pf40.pdf", sourcePage: 73 }]);
  });

  it("is bounded without dropping a warning (#4509 Codex r3 F1)", async () => {
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page]);
    const sqls = query.mock.calls.map(([q]) => q);
    // A statement timeout scoped to this transaction runs before the read.
    expect(sqls[0]).toMatch(/SET LOCAL statement_timeout/);
    const read = sqls[sqls.length - 1];
    // Only chunks that could hold a statement, by a case-insensitive superset of every extractor
    // trigger, and a fixed row bound.
    expect(read).toMatch(/content ~\* /);
    expect(read).toMatch(/\bLIMIT \d+/);
    expect(query.mock.calls[query.mock.calls.length - 1][1]).toContain(CANDIDATE_PATTERN);
  });

  it("the candidate pattern keeps every chunk the extractor can hit, and drops plain text", () => {
    const re = new RegExp(CANDIDATE_PATTERN, "i");
    for (const hit of [
      "WARNING: Hazardous voltage.",
      "DANGER: Arc flash.",
      "CAUTION: Hot.",
      "ATTENTION: Equipment damage.",
      "SHOCK HAZARD: x.",
      "BURN HAZARD: x.",
      "When isolation is not used, hazardous voltages are present at all times.",
      "Make sure the capacitors have been discharged.",
      "Turn off power. Wait at least 5 minutes.",
    ]) {
      expect(extractManualSafetyStatement(hit), hit).not.toBeNull();
      expect(re.test(hit), hit).toBe(true);
    }
    expect(re.test("Parameter P01 sets the acceleration time in seconds.")).toBe(false);
  });

  it("approval gate on: applies retrieval's predicate with the approved source set bound", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page], { approvedSourceDocIds: [DOC] });
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    expect(sql).toMatch(/AND \(verified = true OR \(is_private = true AND doc_id = ANY\(\$6::uuid\[\]\)\)\)/);
    expect(params).toHaveLength(6);
    expect(params[5]).toEqual([DOC]);
  });

  it("approval gate on, no approved set: only verified rows", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page]);
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    expect(sql).toMatch(/AND verified = true/);
    expect(params).toHaveLength(5);
  });

  it("control: approval gate off binds no extra parameter and adds no predicate", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "false");
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page], { approvedSourceDocIds: [DOC] });
    const [sql, params] = query.mock.calls[query.mock.calls.length - 1];
    expect(sql).not.toMatch(/verified/);
    expect(params).toHaveLength(5);
  });
});

/** A one-page upload with `n` candidate chunks in id order; `table` is what keyset batches read. */
function pagedClient(n: number, contentAt: (i: number) => string) {
  const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const table = Array.from({ length: n }, (_, i) => ({ id: id(i), content: contentAt(i), source_url: "manual.txt", page: 1 }));
  let peak = 0;
  const query = vi.fn(async (sql: string, params: unknown[]) => {
    if (/SET LOCAL/.test(sql)) return { rows: [] };
    const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1]);
    const after = /AND id > \$(\d+)::uuid/.exec(sql);
    const cursor = after ? String(params[Number(after[1]) - 1]) : null;
    const rows = table.filter((r) => cursor === null || r.id > cursor).slice(0, limit);
    peak = Math.max(peak, rows.length);
    return { rows };
  });
  return { client: { query } as never, query, peak: () => peak };
}
const keep = (t: string) => extractManualSafetyStatement(t) !== null;
const onePage = { docId: DOC, sourceUrl: "manual.txt", page: 1 };

describe("cited-page read: keyset batches, no total-row cap (#4509 Codex r4 F1)", () => {
  it("finds the only WARNING in the final batch of a 59,000-chunk one-page upload", async () => {
    const N = 59_000;
    const { client, query, peak } = pagedClient(N, (i) => (i === N - 1 ? "WARNING: Hazardous voltage. Disconnect power before servicing." : `Please wait while the parameter saves (${i}).`));
    const out = await retrieveCitedPageChunks(client, TENANT, [onePage], { keep });
    expect(out.map((r) => r.content)).toEqual(["WARNING: Hazardous voltage. Disconnect power before servicing."]);
    const reads = query.mock.calls.filter(([q]) => !/SET LOCAL/.test(q));
    expect(reads.length).toBe(Math.ceil(N / 200));
    for (const [q] of reads) expect(q).toMatch(/ORDER BY id\s+LIMIT 200\b/);
    expect(reads.slice(1).every(([q]) => /AND id > \$\d+::uuid/.test(q))).toBe(true);
    expect(peak()).toBeLessThanOrEqual(200);
  });

  it("stops as soon as every cited page has a statement", async () => {
    const { client, query } = pagedClient(5_000, (i) => (i === 10 ? "WARNING: Hot surface. Allow to cool." : `Please wait (${i}).`));
    const out = await retrieveCitedPageChunks(client, TENANT, [onePage], { keep });
    expect(out).toHaveLength(1);
    expect(query.mock.calls.filter(([q]) => !/SET LOCAL/.test(q))).toHaveLength(1);
  });

  it("stops at the wall-clock deadline and returns what it found (fail open)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    let t = 0;
    const { client, query } = pagedClient(10_000, (i) => `Please wait (${i}).`);
    const out = await retrieveCitedPageChunks(client, TENANT, [onePage], { keep, now: () => (t += 1_000) });
    expect(out).toEqual([]);
    expect(query.mock.calls.filter(([q]) => !/SET LOCAL/.test(q)).length).toBeLessThan(10);
  });
});

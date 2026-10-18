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

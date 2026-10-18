/**
 * #4509 Codex F1: `retrieveCitedPageChunks` reads the rest of each cited page.
 * Pins the read's boundary: same tenant, v2 rows only, the exact (document,
 * file, page) tuples, and the same approval predicate retrieval uses.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { retrieveCitedPageChunks } from "@/lib/manual-rag";

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
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    expect(sql).toMatch(/ingest_route = 'v2'/);
    expect(sql).toMatch(/\(doc_id::text, source_url, COALESCE\(page_start, source_page\)\) IN/);
    expect(params).toEqual([TENANT, [DOC], ["pf40.pdf"], [73]]);
    // #4509 Codex r2 F1: never truncated; the cited tuples already bound the read.
    expect(sql).not.toMatch(/\bLIMIT\b/);
    expect(out).toEqual([{ content: "WARNING: x.", sourceUrl: "pf40.pdf", sourcePage: 73 }]);
  });

  it("approval gate on: applies retrieval's predicate with the approved source set bound", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page], { approvedSourceDocIds: [DOC] });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/AND \(verified = true OR \(is_private = true AND doc_id = ANY\(\$5::uuid\[\]\)\)\)/);
    expect(params).toHaveLength(5);
    expect(params[4]).toEqual([DOC]);
  });

  it("approval gate on, no approved set: only verified rows", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page]);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/AND verified = true/);
    expect(params).toHaveLength(4);
  });

  it("control: approval gate off binds no extra parameter and adds no predicate", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "false");
    const { client, query } = fakeClient();
    await retrieveCitedPageChunks(client, TENANT, [page], { approvedSourceDocIds: [DOC] });
    const [sql, params] = query.mock.calls[0];
    expect(sql).not.toMatch(/verified/);
    expect(params).toHaveLength(4);
  });
});

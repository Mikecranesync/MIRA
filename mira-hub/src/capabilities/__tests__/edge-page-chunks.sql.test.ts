/**
 * #5265 edge profile: `retrievePageChunksInOrder` reads ONE cited page whole for
 * the definition's cautions. Pins its boundary — same tenant, v2 rows, the exact
 * (document, file, page), the approval predicate retrieval uses, a row bound —
 * and that it has no content filter and returns the page in chunk order.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDGE_PAGE_CHUNK_LIMIT, retrievePageChunksInOrder } from "@/lib/manual-rag";

const TENANT = "11111111-1111-4111-8111-111111111111";
const DOC = "22222222-2222-4222-8222-222222222222";
const page = { docId: DOC, sourceUrl: "gs10.pdf", page: 139 };

function fakeClient(rows: Record<string, unknown>[] = []) {
  const query = vi.fn(async (_sql: string, _params: unknown[]) => ({ rows }));
  return { client: { query } as never, query };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("retrievePageChunksInOrder (#5265)", () => {
  it("scopes to the tenant, v2 rows and the exact page, bounded, with no content filter", async () => {
    const { client, query } = fakeClient();
    await retrievePageChunksInOrder(client, TENANT, page);
    expect(query.mock.calls[0][0]).toMatch(/SET LOCAL statement_timeout = '3s'/);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/WHERE tenant_id = \$1/);
    expect(sql).toMatch(/ingest_route = 'v2'/);
    expect(sql).toMatch(/doc_id::text = \$2/);
    expect(sql).toMatch(/source_url = \$3/);
    expect(sql).toMatch(/COALESCE\(page_start, source_page\) = \$4/);
    expect(sql).toContain(`LIMIT ${EDGE_PAGE_CHUNK_LIMIT}`);
    expect(sql).not.toMatch(/content ~\*/);
    expect(params).toEqual([TENANT, DOC, "gs10.pdf", 139]);
  });

  it("returns the page in numeric chunk order (text order would put 10 before 9)", async () => {
    const { client } = fakeClient([
      { content: "ten", chunk_index: "10" },
      { content: "none", chunk_index: null },
      { content: "nine", chunk_index: "9" },
      { content: "eleven", chunk_index: "11" },
    ]);
    expect(await retrievePageChunksInOrder(client, TENANT, page)).toEqual(["nine", "ten", "eleven", "none"]);
  });

  it("approval gate on: applies retrieval's predicate with the approved source set bound", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    const { client, query } = fakeClient();
    await retrievePageChunksInOrder(client, TENANT, page, { approvedSourceDocIds: [DOC] });
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/AND \(verified = true OR \(is_private = true AND doc_id = ANY\(\$5::uuid\[\]\)\)\)/);
    expect(params).toEqual([TENANT, DOC, "gs10.pdf", 139, [DOC]]);
  });

  it("approval gate on, no approved set: only verified rows", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "true");
    const { client, query } = fakeClient();
    await retrievePageChunksInOrder(client, TENANT, page);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/verified = true/);
    expect(sql).not.toMatch(/\$5/);
    expect(params).toHaveLength(4);
  });

  it("control: approval gate off binds no extra parameter and adds no predicate", async () => {
    vi.stubEnv("MIRA_ENFORCE_APPROVED_RETRIEVAL", "false");
    const { client, query } = fakeClient();
    await retrievePageChunksInOrder(client, TENANT, page, { approvedSourceDocIds: [DOC] });
    const [sql, params] = query.mock.calls[1];
    expect(sql).not.toMatch(/verified/);
    expect(params).toHaveLength(4);
  });
});

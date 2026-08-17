// ARPK Phase 1a — document-scoped NodeChat.
// PRD: docs/plans/2026-08-10-prd-agent-readable-product-knowledge-t2108.md
// § "Document-scoped chat": retrieval must scope by doc_id; gate F: a
// doc-scoped ask cannot ground in sibling documents on the same node.
//
// Follows the review-queue route-test pattern: mock session + tenant-context,
// script the pg client, call the real handler. No LLM call happens — providers
// have no keys in the test env, so the cascade is skipped after retrieval.

import { beforeEach, describe, it, expect, vi } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
// Canonical-files derivation (075) — mocked at the module boundary so the
// scripted client only ever sees the chat route's own queries.
vi.mock("@/lib/workspace-files", () => ({ linkedDocIdsForNode: vi.fn(async () => []) }));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { linkedDocIdsForNode } from "@/lib/workspace-files";

const TENANT = "11111111-2222-3333-4444-555555555555";
const NODE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DOC_ID = "5f9b2c1a-0000-4000-8000-000000000001";

const NODE_ROW = { name: "Inbox", uns_path: "inbox" };
const CHUNK_ROW = {
  content: "Turn the unit over and remove the rolling brush guard.",
  source_url: `node-doc/${DOC_ID}/T2108_Manual_EN.pdf`,
  source_page: 9,
  page_start: 9,
  section_path: null,
  filename: "T2108_Manual_EN.pdf",
  verified: false,
  rank: 0.5,
};

type Scripted = Array<Record<string, unknown>[]>;

function scriptClient(scriptedRows: Scripted) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      return { rows: scriptedRows.shift() ?? [] };
    }),
  };
  vi.mocked(withTenantContext).mockImplementation(
    ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
  );
  return calls;
}

function chatReq(body: Record<string, unknown>): Request {
  return new Request("http://test/api/namespace/node/x/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: NODE_ID }) };
const MESSAGES = [{ role: "user", content: "How do I clean the rolling brush?" }];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  vi.mocked(sessionOr401).mockResolvedValue({
    userId: "u1",
    tenantId: TENANT,
  } as never);
  vi.mocked(linkedDocIdsForNode).mockResolvedValue([]);
});

describe("NodeChat docId scope", () => {
  it("400s on a malformed docId before touching the DB", async () => {
    const calls = scriptClient([]);
    const res = await POST(chatReq({ messages: MESSAGES, docId: "not-a-uuid" }), params);
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it("404s when the docId has no chunks in this tenant (document not found)", async () => {
    // node lookup → found; doc lookup → empty.
    const calls = scriptClient([[NODE_ROW], []]);
    const res = await POST(chatReq({ messages: MESSAGES, docId: DOC_ID }), params);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("document not found");
    expect(calls).toHaveLength(2);
  });

  it("scopes retrieval to the document and streams (gate F wiring)", async () => {
    // node lookup → found; doc lookup → filename; subtree ids skipped (uns_path
    // 'inbox' → id query) — script generously: node, doc, subtree, AND-retrieval.
    const calls = scriptClient([
      [NODE_ROW],
      [{ filename: "T2108_Manual_EN.pdf" }],
      [{ id: NODE_ID }],
      [CHUNK_ROW],
    ]);
    const res = await POST(chatReq({ messages: MESSAGES, docId: DOC_ID }), params);
    expect(res.status).toBe(200);
    const retrieval = calls.find((c) => c.sql.includes("content_tsv @@"));
    expect(retrieval).toBeDefined();
    expect(retrieval!.sql).toContain("doc_id = ANY($5::uuid[])");
    expect(retrieval!.params).toContainEqual([DOC_ID]);
  });

  it("without docId, no doc lookup runs and retrieval is node-scoped (unchanged)", async () => {
    const calls = scriptClient([[NODE_ROW], [{ id: NODE_ID }], [CHUNK_ROW]]);
    const res = await POST(chatReq({ messages: MESSAGES }), params);
    expect(res.status).toBe(200);
    const retrieval = calls.find((c) => c.sql.includes("content_tsv @@"));
    expect(retrieval).toBeDefined();
    expect(retrieval!.sql).not.toContain("doc_id = ANY"); // projection keeps doc_id::text; only the PREDICATE is omitted
  });

  it("an explicit docId keeps today's behavior — no file-link widening", async () => {
    scriptClient([[NODE_ROW], [{ filename: "T2108_Manual_EN.pdf" }], [{ id: NODE_ID }], [CHUNK_ROW]]);
    const res = await POST(chatReq({ messages: MESSAGES, docId: DOC_ID }), params);
    expect(res.status).toBe(200);
    expect(linkedDocIdsForNode).not.toHaveBeenCalled();
  });
});

describe("NodeChat file-link widening (workspace_file_links)", () => {
  const LINKED_DOC = "8a8a8a8a-0000-4000-8000-00000000000a";

  it("adds a validated-doc-scope pass for link-derived docs, keeping the node pass", async () => {
    vi.mocked(linkedDocIdsForNode).mockResolvedValue([LINKED_DOC]);
    const calls = scriptClient([[NODE_ROW], [{ id: NODE_ID }], [CHUNK_ROW]]);

    const res = await POST(chatReq({ messages: MESSAGES }), params);
    expect(res.status).toBe(200);
    expect(linkedDocIdsForNode).toHaveBeenCalledWith(TENANT, NODE_ID);

    const retrievals = calls.filter((c) => c.sql.includes("content_tsv @@"));
    // Pass 1 keeps the node filter (legacy node-stamped docs still work)…
    expect(retrievals.some((c) => c.sql.includes("(metadata->>'node_id') = ANY"))).toBe(true);
    // …pass 2 swaps it for the validated doc set.
    const linkedPass = retrievals.find((c) => c.sql.includes("doc_id = ANY($5::uuid[])"));
    expect(linkedPass).toBeDefined();
    expect(linkedPass!.params).toContainEqual([LINKED_DOC]);
    expect(linkedPass!.sql).not.toContain("(metadata->>'node_id') = ANY");
  });

  it("dedupes a passage reached by both passes so it is cited once", async () => {
    vi.mocked(linkedDocIdsForNode).mockResolvedValue([LINKED_DOC]);
    // Every retrieval query returns the SAME chunk row (both passes hit it).
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = {
      query: vi.fn(async (sql: string, params: unknown[]) => {
        calls.push({ sql, params });
        if (sql.includes("FROM kg_entities") && sql.includes("name")) return { rows: [NODE_ROW] };
        if (sql.includes("content_tsv @@")) return { rows: [CHUNK_ROW] };
        return { rows: [{ id: NODE_ID }] };
      }),
    };
    vi.mocked(withTenantContext).mockImplementation(
      ((_t: string, fn: (c: unknown) => unknown) => fn(client)) as never,
    );

    const res = await POST(chatReq({ messages: MESSAGES }), params);
    expect(res.status).toBe(200);
    const raw = await new Response(res.body).text();
    const sourcesFrame = raw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).trim())
      .find((d) => d.includes("\"sources\""));
    expect(sourcesFrame).toBeDefined();
    const parsed = JSON.parse(sourcesFrame!) as { sources: unknown[] };
    expect(parsed.sources).toHaveLength(1);
  });
});

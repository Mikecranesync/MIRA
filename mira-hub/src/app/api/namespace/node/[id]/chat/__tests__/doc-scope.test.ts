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

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

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
    expect(retrieval!.sql).toContain("doc_id = $5");
    expect(retrieval!.params).toContain(DOC_ID);
  });

  it("without docId, no doc lookup runs and retrieval is node-scoped (unchanged)", async () => {
    const calls = scriptClient([[NODE_ROW], [{ id: NODE_ID }], [CHUNK_ROW]]);
    const res = await POST(chatReq({ messages: MESSAGES }), params);
    expect(res.status).toBe(200);
    const retrieval = calls.find((c) => c.sql.includes("content_tsv @@"));
    expect(retrieval).toBeDefined();
    expect(retrieval!.sql).not.toContain("doc_id");
  });
});

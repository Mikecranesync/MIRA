// Vitest coverage for POST /api/namespace/node/[id]/chat (folder=brain node chat).
//
// Run: cd mira-hub && npx vitest run src/app/api/namespace/node/[id]/chat
//
// Covers the pure, no-live-LLM branches that gate the spec acceptance criteria:
//   - safety keyword → X-Safety-Stop header set AND no provider fetch fired
//     (the hard-stop is the one branch this evidence culture won't forgive shipping
//      on a clone with zero execution);
//   - node-not-found → 404; auth/validation guards.
// The cited-answer streaming path needs a live cascade — verified at the staging gate.
//
// Spec: docs/specs/uns-node-centric-knowledge-spec.md (Slice — node chat acceptance)

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/manual-rag", () => ({
  retrieveNodeChunks: vi.fn(),
  appendManualContext: vi.fn((prompt: string) => prompt),
  buildManualUserContent: vi.fn((content: string) => content),
  chunksToSources: vi.fn((chunks: Array<{ title?: string; sourceUrl?: string; sourcePage?: number | null; verified?: boolean }>) =>
    chunks.map((chunk, index) => ({
      index: index + 1,
      title: chunk.title ?? "manual",
      url: chunk.sourceUrl ?? null,
      page: chunk.sourcePage ?? null,
      verified: chunk.verified === true,
    })),
  ),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { appendManualContext, retrieveNodeChunks } from "@/lib/manual-rag";

const VALID_UUID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-aaaa-bbbb";

const goodSession = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const makeReq = (body: unknown) =>
  new Request(`https://hub.test/api/namespace/node/${VALID_UUID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const userMsg = (content: string) => ({ messages: [{ role: "user", content }] });

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  process.env.GROQ_API_KEY = "test-key"; // so a non-safety path WOULD try to fetch
  vi.mocked(retrieveNodeChunks).mockResolvedValue([]);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
});

// Drain an SSE ReadableStream Response, returning both the raw text and the
// reconstructed content (the deltas the client concatenates into the answer —
// the safety stop streams word-by-word, so contiguous phrases only exist here).
async function drain(res: Response): Promise<{ raw: string; content: string }> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let raw = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    raw += dec.decode(value, { stream: true });
  }
  let content = "";
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const data = t.slice(5).trim();
    if (data === "[DONE]") continue;
    try {
      const parsed = JSON.parse(data) as { content?: string };
      if (parsed.content) content += parsed.content;
    } catch {
      /* skip */
    }
  }
  return { raw, content };
}

describe("POST /api/namespace/node/[id]/chat", () => {
  it("returns 503 when NEON_DATABASE_URL is unset", async () => {
    delete process.env.NEON_DATABASE_URL;
    const res = await POST(makeReq(userMsg("hi")), makeParams(VALID_UUID));
    expect(res.status).toBe(503);
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(userMsg("hi")), makeParams(VALID_UUID));
    expect(res.status).toBe(401);
  });

  it("returns 400 on a malformed node id", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq(userMsg("hi")), makeParams("not-a-uuid"));
    expect(res.status).toBe(400);
  });

  it("returns 400 when messages array is missing/empty", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(makeReq({ messages: [] }), makeParams(VALID_UUID));
    expect(res.status).toBe(400);
  });

  it("hard-stops on a safety keyword WITHOUT calling any provider", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const res = await POST(
      makeReq(userMsg("can I reset this fault on a live panel with arc flash risk?")),
      makeParams(VALID_UUID),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBeTruthy();
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    const { raw, content } = await drain(res);
    expect(content).toContain("SAFETY STOP");
    expect(raw).toContain("[DONE]");

    // The safety gate must short-circuit before ANY LLM provider call or DB read.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(vi.mocked(withTenantContext)).not.toHaveBeenCalled();
  });

  it("returns 404 when the node is not found in the tenant", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tid, fn) => {
      const client = {
        query: vi.fn(async () => ({ rows: [] })), // kg_entities lookup → no row
      };
      return await fn(client as never);
    });

    const res = await POST(makeReq(userMsg("what faults does this have?")), makeParams(VALID_UUID));
    expect(res.status).toBe(404);
    // No provider should be hit when there's no node context.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns approved_context without calling providers when enforced and no verified node docs exist", async () => {
    process.env.NEON_DATABASE_URL = "postgres://test";
    process.env.MIRA_ENFORCE_APPROVED_ASK = "true";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM kg_entities")) return { rows: [{ name: "Motor", uns_path: "Plant.Line.Motor" }] };
          return { rows: [] };
        }),
      }),
    );

    const res = await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));
    const body = await res.json();

    expect(res.status).toBe(412);
    expect(body.gate).toBe("approved_context");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires the selected KG node itself to be verified", async () => {
    process.env.NEON_DATABASE_URL = "postgres://test";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    const calls: string[] = [];
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          calls.push(sql);
          return { rows: [] };
        }),
      }),
    );

    const res = await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));

    expect(res.status).toBe(404);
    const nodeSql = calls.find((sql) => sql.includes("FROM kg_entities")) ?? "";
    expect(nodeSql).toMatch(/approval_state\s*=\s*'verified'/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("filters unverified node chunks before building the provider prompt", async () => {
    process.env.NEON_DATABASE_URL = "postgres://test";
    process.env.MIRA_ENFORCE_APPROVED_ASK = "true";
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(retrieveNodeChunks).mockResolvedValue([
      {
        content: "Approved node context",
        manufacturer: "FactoryLM",
        modelNumber: "N100",
        sourceUrl: "https://docs.test/approved-node",
        sourcePage: 4,
        title: "Approved Node Manual",
        rank: 0.9,
        verified: true,
      },
      {
        content: "Draft node context",
        manufacturer: "FactoryLM",
        modelNumber: "N100",
        sourceUrl: "https://docs.test/draft-node",
        sourcePage: 5,
        title: "Draft Node Manual",
        rank: 0.8,
        verified: false,
      },
    ]);
    vi.mocked(withTenantContext).mockImplementation(async (_tenantId, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("FROM kg_entities")) return { rows: [{ name: "Motor", uns_path: "Plant.Line.Motor" }] };
          return { rows: [] };
        }),
      }),
    );

    await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));

    expect(appendManualContext).toHaveBeenCalled();
    const chunks = vi.mocked(appendManualContext).mock.calls[0]?.[1] ?? [];
    expect(chunks.map((chunk) => chunk.content)).toEqual(["Approved node context"]);
  });
});

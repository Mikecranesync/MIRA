import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/llm/cascade", () => ({ cascadeComplete: vi.fn() }));
vi.mock("@/lib/ip-rate-limit", () => ({
  clientIpHash: vi.fn(() => "ip-hash"),
  rateLimited: vi.fn(() => false),
}));
vi.mock("@/lib/signal-recorder", () => ({ countTransitions: vi.fn() }));

import { cascadeComplete } from "@/lib/llm/cascade";
import { sessionOrDemo } from "@/lib/demo-auth";
import { withTenantContext } from "@/lib/tenant-context";
import { POST } from "../route";

const tenantId = "tenant-1";
const sessionId = "11111111-1111-1111-1111-111111111111";
const assetId = "22222222-2222-2222-2222-222222222222";

function req(question = "What fails when this conveyor stops?") {
  return new Request("http://localhost/api/mira/ask", {
    method: "POST",
    body: JSON.stringify({ session_id: sessionId, question }),
  });
}

function mockClient(rowsBySql: Array<{ match: string; rows: Array<Record<string, unknown>> }>, calls: string[]) {
  return {
    query: vi.fn(async (sql: string) => {
      calls.push(sql);
      const hit = rowsBySql.find((entry) => sql.includes(entry.match));
      return { rows: hit?.rows ?? [] };
    }),
  };
}

describe("POST /api/mira/ask approved-context gate", () => {
  const oldEnv = process.env;

  beforeEach(() => {
    process.env = { ...oldEnv, NEON_DATABASE_URL: "postgres://test", MIRA_ENFORCE_APPROVED_ASK: "true" };
    vi.mocked(sessionOrDemo).mockResolvedValue({ tenantId, userId: "user-1" });
    vi.mocked(cascadeComplete).mockResolvedValue({ content: "answer", provider: "mock", latencyMs: 1 });
  });

  afterEach(() => {
    process.env = oldEnv;
    vi.clearAllMocks();
  });

  it("requires verified KG state in the relationship grounding query", async () => {
    const calls: string[] = [];
    const client = mockClient(
      [
        {
          match: "FROM troubleshooting_sessions",
          rows: [{
            id: sessionId,
            status: "confirmed",
            asset_id: assetId,
            component_id: null,
            transcript: [],
            asset_name: "Conveyor",
            asset_tag: "Plant.Line.Conveyor",
          }],
        },
        { match: "FROM kg_relationships r", rows: [{ relationship_type: "feeds", confidence: 1, s_type: "asset", s_name: "A", t_type: "asset", t_name: "B" }] },
        { match: "FROM live_signal_events e", rows: [] },
        { match: "FROM live_signal_cache cache", rows: [] },
      ],
      calls,
    );
    vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => fn(client));

    const res = await POST(req());

    expect(res.status).toBe(200);
    const relationshipSql = calls.find((sql) => sql.includes("FROM kg_relationships r")) ?? "";
    expect(relationshipSql).toMatch(/r\.approval_state\s*=\s*'verified'/i);
    expect(relationshipSql).toMatch(/src\.approval_state\s*=\s*'verified'/i);
    expect(relationshipSql).toMatch(/tgt\.approval_state\s*=\s*'verified'/i);
  });

  it("requires approved_tags for recent and current live grounding", async () => {
    const calls: string[] = [];
    const client = mockClient(
      [
        {
          match: "FROM troubleshooting_sessions",
          rows: [{
            id: sessionId,
            status: "confirmed",
            asset_id: assetId,
            component_id: null,
            transcript: [],
            asset_name: "Conveyor",
            asset_tag: "Plant.Line.Conveyor",
          }],
        },
        { match: "FROM kg_relationships r", rows: [{ relationship_type: "feeds", confidence: 1, s_type: "asset", s_name: "A", t_type: "asset", t_name: "B" }] },
        { match: "FROM live_signal_events e", rows: [] },
        { match: "FROM live_signal_cache cache", rows: [] },
      ],
      calls,
    );
    vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => fn(client));

    await POST(req());

    const recentSql = calls.find((sql) => sql.includes("FROM live_signal_events e")) ?? "";
    const currentSql = calls.find((sql) => sql.includes("FROM live_signal_cache cache")) ?? "";
    expect(recentSql).toMatch(/JOIN approved_tags/i);
    expect(recentSql).toMatch(/approved_tags[\s\S]+enabled\s*=\s*true/i);
    expect(currentSql).toMatch(/JOIN approved_tags/i);
    expect(currentSql).toMatch(/approved_tags[\s\S]+enabled\s*=\s*true/i);
  });

  it("returns approved_context without calling cascade when no approved context exists", async () => {
    const calls: string[] = [];
    const client = mockClient(
      [
        {
          match: "FROM troubleshooting_sessions",
          rows: [{
            id: sessionId,
            status: "confirmed",
            asset_id: assetId,
            component_id: null,
            transcript: [],
            asset_name: "Conveyor",
            asset_tag: "Plant.Line.Conveyor",
          }],
        },
      ],
      calls,
    );
    vi.mocked(withTenantContext).mockImplementation(async (_tenant, fn) => fn(client));

    const res = await POST(req());
    const body = await res.json();

    expect(res.status).toBe(412);
    expect(body.gate).toBe("approved_context");
    expect(body.missingContext).toEqual(expect.any(Array));
    expect(cascadeComplete).not.toHaveBeenCalled();
  });
});

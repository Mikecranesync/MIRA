import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { connect: vi.fn() } }));
vi.mock("@/lib/knowledge-graph/extractor", () => ({ extractAndStore: vi.fn() }));
vi.mock("@/lib/knowledge-graph/context-builder", () => ({ buildGraphContext: vi.fn() }));
vi.mock("@/lib/manual-rag", () => ({
  retrieveManualChunks: vi.fn(),
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
import pool from "@/lib/db";
import { buildGraphContext } from "@/lib/knowledge-graph/context-builder";
import { appendManualContext, retrieveManualChunks } from "@/lib/manual-rag";

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
  new Request(`https://hub.test/api/assets/${VALID_UUID}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

const userMsg = (content: string) => ({ messages: [{ role: "user", content }] });

let fetchSpy: ReturnType<typeof vi.fn>;

async function drain(res: Response): Promise<void> {
  const reader = res.body?.getReader();
  if (!reader) return;
  for (;;) {
    const { done } = await reader.read();
    if (done) return;
  }
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  process.env.GROQ_API_KEY = "test-key";
  process.env.MIRA_ENFORCE_APPROVED_ASK = "true";
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
});

describe("POST /api/assets/[id]/chat", () => {
  it("returns approved_context without calling providers when enforced and no approved asset context exists", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);

    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM cmms_equipment")) {
        return {
          rows: [
            {
              equipment_number: "MTR-101",
              manufacturer: "FactoryLM",
              model_number: "M100",
              serial_number: "S100",
              equipment_type: "Motor",
              location: "Plant.Line",
              criticality: "high",
              description: "Line Motor",
              installation_date: null,
              last_maintenance_date: null,
              last_reported_fault: null,
              work_order_count: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockResolvedValue({ query, release } as never);

    const res = await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));
    const body = await res.json();

    expect(res.status).toBe(412);
    expect(body.gate).toBe("approved_context");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("filters unverified manual chunks before building the provider prompt", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(buildGraphContext).mockResolvedValue("");
    vi.mocked(retrieveManualChunks).mockResolvedValue([
      {
        content: "Approved bearing reset steps",
        manufacturer: "FactoryLM",
        modelNumber: "M100",
        sourceUrl: "https://docs.test/approved",
        sourcePage: 2,
        title: "Approved Manual",
        rank: 0.9,
        verified: true,
      },
      {
        content: "Draft-only bypass procedure",
        manufacturer: "FactoryLM",
        modelNumber: "M100",
        sourceUrl: "https://docs.test/draft",
        sourcePage: 3,
        title: "Draft Manual",
        rank: 0.8,
        verified: false,
      },
    ]);

    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM cmms_equipment")) {
        return {
          rows: [
            {
              equipment_number: "MTR-101",
              manufacturer: "FactoryLM",
              model_number: "M100",
              serial_number: "S100",
              equipment_type: "Motor",
              location: "Plant.Line",
              criticality: "high",
              description: "Line Motor",
              installation_date: null,
              last_maintenance_date: null,
              last_reported_fault: null,
              work_order_count: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockResolvedValue({ query, release } as never);

    await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));

    expect(appendManualContext).toHaveBeenCalled();
    const chunks = vi.mocked(appendManualContext).mock.calls[0]?.[1] ?? [];
    expect(chunks.map((chunk) => chunk.content)).toEqual(["Approved bearing reset steps"]);
  });

  it("allows verified KG relationship context without requiring manual chunks", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);
    vi.mocked(buildGraphContext).mockResolvedValue("[KG] verified relationship context");
    vi.mocked(retrieveManualChunks).mockResolvedValue([]);
    fetchSpy.mockResolvedValue(
      new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', {
        status: 200,
      }),
    );

    const release = vi.fn();
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("FROM cmms_equipment")) {
        return {
          rows: [
            {
              equipment_number: "MTR-101",
              manufacturer: "FactoryLM",
              model_number: "M100",
              serial_number: "S100",
              equipment_type: "Motor",
              location: "Plant.Line",
              criticality: "high",
              description: "Line Motor",
              installation_date: null,
              last_maintenance_date: null,
              last_reported_fault: null,
              work_order_count: 0,
            },
          ],
        };
      }
      if (sql.includes("FROM kg_relationships r")) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    vi.mocked(pool.connect).mockResolvedValue({ query, release } as never);

    const res = await POST(makeReq(userMsg("what does this fault mean?")), makeParams(VALID_UUID));

    expect(res.status).toBe(200);
    await drain(res);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeReq(userMsg("hi")), makeParams(VALID_UUID));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // T3 / duplicate-systems-audit.md finding #1 regression guard: the physical-
  // hazard category ("melted insulation" and siblings) was previously ABSENT
  // from this route's hand-copied safety list — a technician reporting it got
  // normal LLM troubleshooting here while Slack/Telegram would hard-stop. The
  // route now imports the shared, guardrails.py-parity-tested SAFETY_PHRASES.
  it("hard-stops on a physical-hazard phrase not present in the old local list WITHOUT calling any provider or DB", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(goodSession);

    const res = await POST(
      makeReq(userMsg("I see melted insulation on this panel, what should I do?")),
      makeParams(VALID_UUID),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("X-Safety-Stop")).toBe("melted insulation");
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    let raw = "";
    const reader = res.body?.getReader();
    const dec = new TextDecoder();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        raw += dec.decode(value, { stream: true });
      }
    }
    // The safety stop streams word-by-word (one JSON object per SSE event),
    // so reconstruct the concatenated content before asserting on the phrase.
    let content = "";
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as { content?: string };
        if (parsed.content) content += parsed.content;
      } catch {
        /* skip */
      }
    }
    expect(content).toContain("SAFETY STOP");
    expect(raw).toContain("[DONE]");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });
});

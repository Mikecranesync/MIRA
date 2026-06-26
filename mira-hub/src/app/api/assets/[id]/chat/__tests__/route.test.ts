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
  chunksToSources: vi.fn(() => []),
}));

import { POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";
import { buildGraphContext } from "@/lib/knowledge-graph/context-builder";
import { retrieveManualChunks } from "@/lib/manual-rag";

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

  it("propagates a 401 from the session helper", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );

    const res = await POST(makeReq(userMsg("hi")), makeParams(VALID_UUID));

    expect(res.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

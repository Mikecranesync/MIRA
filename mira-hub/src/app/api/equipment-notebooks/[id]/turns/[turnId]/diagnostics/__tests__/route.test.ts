// GET /api/equipment-notebooks/[id]/turns/[turnId]/diagnostics
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/turns/[turnId]/diagnostics/__tests__/route.test.ts"
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/capabilities/observability/diagnostics-read", () => ({
  loadTurnDiagnostics: vi.fn(),
}));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { loadTurnDiagnostics } from "@/capabilities/observability/diagnostics-read";

const NB = "93d8c68e-d252-451d-8b52-e0a830543437";
const TURN = "8345ea5e-ad86-4d7f-a686-313b7b170adc";
const TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe";
const req = {} as unknown as NextRequest;
const params = { params: Promise.resolve({ id: NB, turnId: TURN }) };

const goodSession = { userId: "u1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
});

describe("GET .../turns/[turnId]/diagnostics", () => {
  it("401s when there is no session, without querying diagnostics", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(req, params);
    expect(res.status).toBe(401);
    expect(loadTurnDiagnostics).not.toHaveBeenCalled();
  });

  it("404s on a malformed notebook or turn id, without querying diagnostics", async () => {
    const res = await GET(req, { params: Promise.resolve({ id: "not-a-uuid", turnId: TURN }) });
    expect(res.status).toBe(404);
    expect(loadTurnDiagnostics).not.toHaveBeenCalled();
  });

  it("404s when no packet was ever recorded for this turn", async () => {
    vi.mocked(loadTurnDiagnostics).mockResolvedValue(null);
    const res = await GET(req, params);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: "not_found" });
  });

  it("200s with the packet, anomalies, traceId and a null viewerUrl", async () => {
    const packet = { v: "1", kind: "chat", answer_gate: { decision: "answered" } };
    vi.mocked(loadTurnDiagnostics).mockResolvedValue({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      turnId: TURN,
      notebookId: NB,
      packet: packet as never,
      anomalies: [{ code: "VISUAL_EVIDENCE_DROPPED", stage: "context", detail: {} }],
      ts: "2026-09-22T00:17:02.000Z",
    });
    const res = await GET(req, params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      turnId: TURN,
      notebookId: NB,
      packet,
      anomalies: [{ code: "VISUAL_EVIDENCE_DROPPED", stage: "context", detail: {} }],
      viewerUrl: null,
      ts: "2026-09-22T00:17:02.000Z",
    });
    expect(loadTurnDiagnostics).toHaveBeenCalledWith(TENANT, NB, TURN);
  });

  it("viewerUrl is the trace-viewer link when MIRA_TRACE_VIEWER_URL_TEMPLATE is set", async () => {
    const prev = process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE;
    process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE = "https://viewer.example/p/x/traces/{traceId}";
    try {
      vi.mocked(loadTurnDiagnostics).mockResolvedValue({
        traceId: "0af7651916cd43dd8448eb211c80319c",
        turnId: TURN,
        notebookId: NB,
        packet: { v: "1", kind: "chat" } as never,
        anomalies: [],
        ts: "2026-09-22T00:17:02.000Z",
      });
      const body = await (await GET(req, params)).json();
      expect(body.viewerUrl).toBe("https://viewer.example/p/x/traces/0af7651916cd43dd8448eb211c80319c");

      // A turn with no OTel trace (SDK off) gets no link, template or not.
      vi.mocked(loadTurnDiagnostics).mockResolvedValue({
        traceId: null,
        turnId: TURN,
        notebookId: NB,
        packet: { v: "1", kind: "chat" } as never,
        anomalies: [],
        ts: "2026-09-22T00:17:02.000Z",
      });
      expect((await (await GET(req, params)).json()).viewerUrl).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE;
      else process.env.MIRA_TRACE_VIEWER_URL_TEMPLATE = prev;
    }
  });

  it("never leaks the technician's question or MIRA's answer text", async () => {
    const packet = {
      v: "1",
      kind: "chat",
      answer_gate: { decision: "answered", reason: "served" },
    };
    vi.mocked(loadTurnDiagnostics).mockResolvedValue({
      traceId: null,
      turnId: TURN,
      notebookId: NB,
      packet: packet as never,
      anomalies: [],
      ts: "2026-09-22T00:17:02.000Z",
    });
    const res = await GET(req, params);
    const body = await res.json();
    const json = JSON.stringify(body).toLowerCase();
    for (const key of ["user_question", "recommendation", "answertext", "\"question\":", "\"prompt\":"]) {
      expect(json).not.toContain(key);
    }
  });
});

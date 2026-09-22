// GET /api/equipment-notebooks/[id]/turns/diagnostics?limit=
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/turns/diagnostics/__tests__/route.test.ts"
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/capabilities/observability/diagnostics-read", () => ({
  listTurnDiagnostics: vi.fn(),
}));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import { listTurnDiagnostics } from "@/capabilities/observability/diagnostics-read";

const NB = "93d8c68e-d252-451d-8b52-e0a830543437";
const TENANT = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe";
const goodSession = { userId: "u1", tenantId: TENANT, email: "x@y", status: "trial", trialExpiresAt: null, role: "owner" };

function reqWithUrl(url: string): NextRequest {
  return { nextUrl: new URL(url) } as unknown as NextRequest;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
  vi.mocked(listTurnDiagnostics).mockResolvedValue([]);
});

describe("GET .../turns/diagnostics", () => {
  it("401s when there is no session, without querying diagnostics", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    const res = await GET(reqWithUrl(`http://x/api/equipment-notebooks/${NB}/turns/diagnostics`), {
      params: Promise.resolve({ id: NB }),
    });
    expect(res.status).toBe(401);
    expect(listTurnDiagnostics).not.toHaveBeenCalled();
  });

  it("404s on a malformed notebook id", async () => {
    const res = await GET(reqWithUrl("http://x/api/equipment-notebooks/not-a-uuid/turns/diagnostics"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(res.status).toBe(404);
    expect(listTurnDiagnostics).not.toHaveBeenCalled();
  });

  it("200s with an empty list when no turn has been recorded", async () => {
    const res = await GET(reqWithUrl(`http://x/api/equipment-notebooks/${NB}/turns/diagnostics`), {
      params: Promise.resolve({ id: NB }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ turns: [] });
  });

  it("defaults limit to 20 when omitted", async () => {
    await GET(reqWithUrl(`http://x/api/equipment-notebooks/${NB}/turns/diagnostics`), {
      params: Promise.resolve({ id: NB }),
    });
    expect(listTurnDiagnostics).toHaveBeenCalledWith(TENANT, NB, 20);
  });

  it("passes an explicit ?limit= through", async () => {
    await GET(reqWithUrl(`http://x/api/equipment-notebooks/${NB}/turns/diagnostics?limit=5`), {
      params: Promise.resolve({ id: NB }),
    });
    expect(listTurnDiagnostics).toHaveBeenCalledWith(TENANT, NB, 5);
  });

  it("falls back to the default limit on a garbage ?limit= value", async () => {
    await GET(reqWithUrl(`http://x/api/equipment-notebooks/${NB}/turns/diagnostics?limit=not-a-number`), {
      params: Promise.resolve({ id: NB }),
    });
    expect(listTurnDiagnostics).toHaveBeenCalledWith(TENANT, NB, 20);
  });

  it("returns ids + decision + anomalyCodes only — never a packet body", async () => {
    vi.mocked(listTurnDiagnostics).mockResolvedValue([
      {
        turnId: "8345ea5e-ad86-4d7f-a686-313b7b170adc",
        traceId: null,
        ts: "2026-09-22T00:17:02.000Z",
        decision: "answered",
        anomalyCodes: ["VISUAL_EVIDENCE_DROPPED", "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE"],
      },
    ]);
    const res = await GET(reqWithUrl(`http://x/api/equipment-notebooks/${NB}/turns/diagnostics`), {
      params: Promise.resolve({ id: NB }),
    });
    const body = await res.json();
    expect(body).toEqual({
      turns: [
        {
          turnId: "8345ea5e-ad86-4d7f-a686-313b7b170adc",
          traceId: null,
          ts: "2026-09-22T00:17:02.000Z",
          decision: "answered",
          anomalyCodes: ["VISUAL_EVIDENCE_DROPPED", "EQUIPMENT_ANSWER_WITH_NO_EVIDENCE"],
        },
      ],
    });
    const json = JSON.stringify(body).toLowerCase();
    expect(json).not.toContain("packet");
    expect(json).not.toContain("\"question\":");
  });
});

// CIT-07 phase 2 — passage endpoint contract: session-gated, notebook/tenant
// IDOR 404, hybrid-law read (raw pool, never withTenantContext), page filter
// validation, ordered passages.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import { GET } from "../route";
import { sessionOr401 } from "@/lib/session";
import pool from "@/lib/db";

const NB = "11111111-2222-3333-4444-555555555555";
const DOC = "99999999-8888-7777-6666-555555555555";
const TENANT = "00000000-0000-0000-0000-0000000000d1";

const goodSession = {
  userId: "u_1", tenantId: TENANT, email: "x@y",
  status: "trial", trialExpiresAt: null, role: "owner",
};

const makeReq = (page?: string) =>
  ({
    nextUrl: new URL(
      `https://hub.test/api/equipment-notebooks/${NB}/sources/${DOC}/passage${page !== undefined ? `?page=${page}` : ""}`,
    ),
  }) as unknown as NextRequest;

const makeParams = () => ({ params: Promise.resolve({ id: NB, docId: DOC }) });

beforeEach(() => {
  vi.resetAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test-only-not-used";
  vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
});

describe("GET .../sources/[docId]/passage", () => {
  it("returns ordered passages for an attached source (hybrid-law SQL)", async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] } as never) // attachment check
      .mockResolvedValueOnce({
        rows: [
          { content: "Fault F004 …", source_page: 1, chunk_index: 0 },
          { content: "Torque 0.71 N-m …", source_page: 1, chunk_index: 1 },
        ],
      } as never);
    const res = await GET(makeReq("1"), makeParams());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.passages).toHaveLength(2);
    expect(body.passages[1].text).toContain("0.71");
    // Hybrid law present in the knowledge_entries SQL; tenant filter on the join.
    const sql2 = vi.mocked(pool.query).mock.calls[1][0] as string;
    expect(sql2).toContain("is_private = false OR tenant_id");
    const sql1 = vi.mocked(pool.query).mock.calls[0][0] as string;
    expect(sql1).toContain("equipment_notebook_sources");
    expect(vi.mocked(pool.query).mock.calls[0][1]).toEqual([NB, DOC, TENANT]);
  });

  it("404s when the source is not attached to this tenant's notebook (no leak)", async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    const res = await GET(makeReq("1"), makeParams());
    expect(res.status).toBe(404);
    expect(vi.mocked(pool.query)).toHaveBeenCalledTimes(1);
  });

  it("401 unauthenticated; 400 invalid page; 400 invalid ids", async () => {
    vi.mocked(sessionOr401).mockResolvedValueOnce(
      NextResponse.json({ error: "unauthorized" }, { status: 401 }) as never,
    );
    expect((await GET(makeReq("1"), makeParams())).status).toBe(401);

    vi.mocked(sessionOr401).mockResolvedValue(goodSession as never);
    expect((await GET(makeReq("nope"), makeParams())).status).toBe(400);
    expect((await GET(makeReq("-1"), makeParams())).status).toBe(400);
    const bad = { params: Promise.resolve({ id: "not-a-uuid", docId: DOC }) };
    expect((await GET(makeReq("1"), bad)).status).toBe(400);
  });

  it("omitting page returns the whole document's passages (page=null bind)", async () => {
    vi.mocked(pool.query)
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] } as never)
      .mockResolvedValueOnce({ rows: [] } as never);
    const res = await GET(makeReq(), makeParams());
    expect(res.status).toBe(200);
    expect(vi.mocked(pool.query).mock.calls[1][1]).toEqual([DOC, TENANT, null]);
  });
});

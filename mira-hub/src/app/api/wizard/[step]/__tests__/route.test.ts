// Vitest coverage for /api/wizard/[step].
//
// Run: cd mira-hub && npx vitest run src/app/api/wizard
//
// Mocks session + tenant-context so each test drives one code path.
// Spec: docs/specs/maintenance-namespace-builder-spec.md §"Onboarding wizard"
// Plan: docs/plans/2026-05-15-maintenance-namespace-builder.md (Phase 3 slice 0)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));

import { GET, POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";

const TENANT_ID = "tenant-aaaa-bbbb";
const goodSession = {
  userId: "user_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEON_DATABASE_URL = "postgres://test";
  (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(goodSession);
});

function makeReq(body: unknown): Request {
  return new Request("http://test/api/wizard/site", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function paramsFor(step: string) {
  return { params: Promise.resolve({ step }) };
}

describe("GET /api/wizard/:step", () => {
  it("returns not_started when no row exists", async () => {
    (withTenantContext as ReturnType<typeof vi.fn>).mockImplementation(async (_t, fn) =>
      fn({ query: vi.fn().mockResolvedValue({ rows: [] }) }),
    );
    const res = await GET(new Request("http://test"), paramsFor("company"));
    expect(res.status).toBe(200);
    const body = await (res as NextResponse).json();
    expect(body.status).toBe("not_started");
    expect(body.currentStep).toBe("company");
    expect(body.stepPayloads).toEqual({});
  });

  it("returns 400 for unknown step", async () => {
    const res = await GET(new Request("http://test"), paramsFor("not-a-step"));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/wizard/:step", () => {
  it("400s when step payload is invalid", async () => {
    const res = await POST(makeReq({ name: "" }), paramsFor("site"));
    expect(res.status).toBe(400);
    const body = await (res as NextResponse).json();
    expect(body.error).toMatch(/site name required/);
  });

  it("400s when company name exceeds 200 chars", async () => {
    const res = await POST(makeReq({ name: "x".repeat(201) }), paramsFor("company"));
    expect(res.status).toBe(400);
  });

  it("upserts wizard_progress and advances to next step", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ current_step: "line", status: "in_progress", step_payloads: { site: { name: "Lake Wales" } } }],
    });
    (withTenantContext as ReturnType<typeof vi.fn>).mockImplementation(async (_t, fn) => fn({ query }));

    const res = await POST(makeReq({ name: "Lake Wales", location: "FL" }), paramsFor("site"));
    expect(res.status).toBe(200);
    const body = await (res as NextResponse).json();
    expect(body.ok).toBe(true);
    expect(body.currentStep).toBe("line");
    expect(query).toHaveBeenCalledTimes(1);

    const [sql, args] = query.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO wizard_progress/);
    expect(args[1]).toBe("line");
    expect(args[2]).toBe("site");
    expect(JSON.parse(args[3])).toEqual({ name: "Lake Wales", location: "FL" });
  });

  it("finish inserts site + line kg_entities, writes audit rows, marks completed", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ step_payloads: { site: { name: "Lake Wales" }, line: { name: "Sorting Line" } } }] })
      .mockResolvedValueOnce({ rows: [{ id: "site-uuid-1" }] })
      .mockResolvedValueOnce({ rows: [{ id: "line-uuid-2" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    (withTenantContext as ReturnType<typeof vi.fn>).mockImplementation(async (_t, fn) => fn({ query }));

    const res = await POST(makeReq({}), paramsFor("finish"));
    expect(res.status).toBe(200);
    const body = await (res as NextResponse).json();
    expect(body.ok).toBe(true);
    expect(body.sitePath).toBe("enterprise.lake_wales");
    expect(body.linePath).toBe("enterprise.lake_wales.sorting_line");

    const sqls = query.mock.calls.map(([s]) => s as string);
    expect(sqls[0]).toMatch(/FROM wizard_progress[\s\S]+FOR UPDATE/);
    expect(sqls[1]).toMatch(/INSERT INTO kg_entities/);
    expect(sqls[2]).toMatch(/INSERT INTO kg_entities/);
    expect(sqls[3]).toMatch(/INSERT INTO namespace_versions/);
    expect(sqls[4]).toMatch(/INSERT INTO namespace_versions/);
    expect(sqls[5]).toMatch(/UPDATE wizard_progress[\s\S]+'completed'/);
  });

  it("finish 400s when site or line payload is missing", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ step_payloads: { site: { name: "Only Site" } } }] });
    (withTenantContext as ReturnType<typeof vi.fn>).mockImplementation(async (_t, fn) => fn({ query }));

    const res = await POST(makeReq({}), paramsFor("finish"));
    expect(res.status).toBe(400);
    const body = await (res as NextResponse).json();
    expect(body.error).toMatch(/missing payload: line/);
  });
});

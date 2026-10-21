// #4574: GET /api/workflows must never return another tenant's workflow_runs to any session —
// any role, demo included. The pool is a fake that honours ONLY the tenant predicate the SQL actually
// contains, so a query that drops it returns every tenant's rows here too.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/demo-auth", () => ({ sessionOrDemo: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));

import { GET } from "@/app/api/workflows/route";
import { sessionOrDemo } from "@/lib/demo-auth";
import pool from "@/lib/db";

const A = "11111111-1111-4111-8111-111111111111";
const B = "99999999-9999-4999-8999-999999999999";
const ROWS = [
  { run_id: "r-a", workflow_name: "document_ingest", tenant_id: A, status: "ok", step_artifacts: [{ a: 1 }], output: { kbFileId: "fa" } },
  { run_id: "r-b", workflow_name: "document_ingest", tenant_id: B, status: "failed", step_artifacts: [{ b: 1 }], output: { kbFileId: "fb" } },
  { run_id: "r-infra", workflow_name: "cmms_sync", tenant_id: null, status: "ok", step_artifacts: [], output: null },
];

function fakeQuery(sql: string, params: unknown[] = []) {
  const scoped = /tenant_id = \$\d/.test(sql);
  const want = scoped ? params[params.length - 1] : undefined;
  const hits = ROWS.filter((r) => !scoped || r.tenant_id === want);
  if (sql.includes("GROUP BY")) {
    return Promise.resolve({ rows: hits.map((r) => ({ workflow_name: r.workflow_name, status: r.status, n: 1 })) });
  }
  return Promise.resolve({ rows: hits });
}

const session = (over: Record<string, unknown>) =>
  vi.mocked(sessionOrDemo).mockResolvedValue({
    userId: "u", tenantId: A, email: "tech@customer.test", status: "active", trialExpiresAt: null, role: "admin", isDemo: false, ...over,
  } as never);

const get = async (qs = "") => (await GET(new Request(`http://hub.test/api/workflows?${qs}`))).json();

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://fake";
  vi.mocked(pool.query).mockImplementation(fakeQuery as never);
});

describe("GET /api/workflows tenant scope (#4574)", () => {
  it("an ordinary session sees only its own tenant's runs and summary", async () => {
    session({});
    const body = await get();
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual(["r-a"]);
    expect(body.summary).toEqual([{ workflowName: "document_ingest", status: "ok", count: 1 }]);
  });

  it("a caller-supplied tenant_id is ignored for an ordinary session", async () => {
    session({});
    const body = await get(`tenant_id=${B}`);
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual(["r-a"]);
  });

  it("a tenant-admin role is not a platform admin", async () => {
    session({ role: "owner" });
    const body = await get();
    expect(body.runs.every((r: { tenantId: string }) => r.tenantId === A)).toBe(true);
  });

  it("a demo session is scoped to the demo tenant", async () => {
    session({ isDemo: true, tenantId: B });
    const body = await get(`tenant_id=${A}`);
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual(["r-b"]);
  });

  it("an email on the review-admin allowlist gets no cross-tenant view", async () => {
    session({ email: "harperhousebuyers@gmail.com" });
    const body = await get();
    expect(body.runs.map((r: { runId: string }) => r.runId)).toEqual(["r-a"]);
    expect(body.runs.some((r: { tenantId: string | null }) => r.tenantId === null)).toBe(false);
  });
});

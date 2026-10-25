// #4574: GET /api/workflows must never return another tenant's workflow_runs to any session —
// any role, demo included — in EITHER the `runs` list or the 24h `summary`. The pool is a fake that
// honours ONLY the tenant predicate the SQL actually contains, bound to the parameter that predicate
// names, so a query that drops (or mis-binds) the predicate returns every tenant's rows here too.
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
  { run_id: "r-a2", workflow_name: "cmms_sync", tenant_id: A, status: "failed", step_artifacts: [], output: null },
  { run_id: "r-b", workflow_name: "document_ingest", tenant_id: B, status: "failed", step_artifacts: [{ b: 1 }], output: { kbFileId: "fb" } },
  { run_id: "r-b2", workflow_name: "cmms_sync", tenant_id: B, status: "ok", step_artifacts: [], output: null },
  { run_id: "r-infra", workflow_name: "cmms_sync", tenant_id: null, status: "ok", step_artifacts: [], output: null },
];

// Apply every `col = $n` predicate the SQL really contains, each bound to ITS OWN parameter.
function fakeQuery(sql: string, params: unknown[] = []) {
  const preds = [...sql.matchAll(/\b(tenant_id|workflow_name|status)\s*=\s*\$(\d+)/g)].map((m) => ({
    col: m[1] as "tenant_id" | "workflow_name" | "status",
    val: params[Number(m[2]) - 1],
  }));
  const hits = ROWS.filter((r) => preds.every((p) => r[p.col] === p.val));
  if (sql.includes("GROUP BY")) {
    const n = new Map<string, number>();
    for (const r of hits) n.set(`${r.workflow_name}|${r.status}`, (n.get(`${r.workflow_name}|${r.status}`) ?? 0) + 1);
    return Promise.resolve({ rows: [...n].map(([k, c]) => ({ workflow_name: k.split("|")[0], status: k.split("|")[1], n: c })) });
  }
  return Promise.resolve({ rows: hits });
}

const session = (over: Record<string, unknown>) =>
  vi.mocked(sessionOrDemo).mockResolvedValue({
    userId: "u", tenantId: A, email: "tech@customer.test", status: "active", trialExpiresAt: null, role: "admin", isDemo: false, ...over,
  } as never);

type Body = { runs: { runId: string; tenantId: string | null }[]; summary: { workflowName: string; status: string; count: number }[] };
const get = async (qs = ""): Promise<Body> => (await GET(new Request(`http://hub.test/api/workflows?${qs}`))).json();

const ownSummaryA = [
  { workflowName: "cmms_sync", status: "failed", count: 1 },
  { workflowName: "document_ingest", status: "ok", count: 1 },
];
const sortSummary = (s: Body["summary"]) => [...s].sort((x, y) => `${x.workflowName}${x.status}`.localeCompare(`${y.workflowName}${y.status}`));
const expectOnlyA = (body: Body) => {
  expect(body.runs.map((r) => r.runId).sort()).toEqual(["r-a", "r-a2"]);
  expect(sortSummary(body.summary)).toEqual(ownSummaryA);
};

beforeEach(() => {
  process.env.NEON_DATABASE_URL = "postgres://fake";
  vi.mocked(pool.query).mockReset();
  vi.mocked(pool.query).mockImplementation(fakeQuery as never);
});

describe("GET /api/workflows tenant scope (#4574)", () => {
  it("an ordinary session sees only its own tenant's runs and summary", async () => {
    session({});
    expectOnlyA(await get());
  });

  it.each([
    ["tenant_id forged to another tenant", `tenant_id=${B}`],
    ["tenant_id repeated (other tenant first)", `tenant_id=${B}&tenant_id=${A}`],
    ["tenant_id repeated (other tenant last)", `tenant_id=${A}&tenant_id=${B}`],
    ["camelCase tenantId", `tenantId=${B}`],
    ["array-style tenant_id[]", `tenant_id[]=${B}`],
    ["empty tenant_id (the old 'no filter' path)", "tenant_id="],
    ["SQL in tenant_id", `tenant_id=${encodeURIComponent(`${B}' OR '1'='1`)}`],
  ])("ignores a caller-supplied tenant: %s — runs AND summary", async (_label, qs) => {
    session({});
    expectOnlyA(await get(qs));
  });

  it.each(["owner", "admin", "manager", "scheduler", "technician", "operator", "", undefined])(
    "role %j gets no cross-tenant view in runs or summary",
    async (role) => {
      session({ role, tenantId: A });
      expectOnlyA(await get(`tenant_id=${B}`));
    },
  );

  it("a platform-status session (status=admin) is still scoped to its own tenant", async () => {
    session({ status: "admin" });
    expectOnlyA(await get(`tenant_id=${B}`));
  });

  it("a demo session is scoped to the demo tenant in runs AND summary, even with a forged tenant_id", async () => {
    session({ isDemo: true, tenantId: B, role: "" });
    const body = await get(`tenant_id=${A}`);
    expect(body.runs.map((r) => r.runId).sort()).toEqual(["r-b", "r-b2"]);
    expect(sortSummary(body.summary)).toEqual([
      { workflowName: "cmms_sync", status: "ok", count: 1 },
      { workflowName: "document_ingest", status: "failed", count: 1 },
    ]);
  });

  it("workflow_name and status filters narrow WITHIN the tenant, never replace its predicate", async () => {
    session({});
    const body = await get(`workflow_name=document_ingest&status=failed&tenant_id=${B}`);
    // Tenant B has a failed document_ingest run; A does not. Only A's (empty) slice may come back.
    expect(body.runs).toEqual([]);
    expect(sortSummary(body.summary)).toEqual(ownSummaryA);
  });

  it("infra runs with no tenant (NULL tenant_id) appear in neither runs nor summary", async () => {
    session({});
    const body = await get();
    expect(body.runs.some((r) => r.tenantId === null)).toBe(false);
    expect(body.summary.some((s) => s.workflowName === "cmms_sync" && s.status === "ok")).toBe(false);
  });

  it("an email on the review-admin allowlist gets no cross-tenant view", async () => {
    session({ email: "harperhousebuyers@gmail.com", status: "admin", role: "owner" });
    expectOnlyA(await get(`tenant_id=${B}`));
  });

  it("every query the route issues carries the session tenant as a bound tenant_id parameter", async () => {
    session({ tenantId: A });
    await get(`tenant_id=${B}&workflow_name=x&status=ok`);
    const calls = vi.mocked(pool.query).mock.calls as unknown as [string, unknown[]][];
    expect(calls.length).toBe(2);
    for (const [sql, params] of calls) {
      const m = sql.match(/tenant_id\s*=\s*\$(\d+)/);
      expect(m, sql).not.toBeNull();
      expect(params[Number(m![1]) - 1]).toBe(A);
      expect(params).not.toContain(B);
    }
  });
});

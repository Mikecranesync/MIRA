// WP-1: GET/POST /api/equipment-notebooks/[id]/procedure. Session, tenant context and sources are
// mocked; workflow_runs is an in-memory fake that honours ONLY the tenant and count the SQL binds,
// so a query that forgets either leaks or double-appends here too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn() } }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ listSources: vi.fn() }));

import { GET, POST } from "@/app/api/equipment-notebooks/[id]/procedure/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { listSources } from "@/lib/equipment-notebooks";
import pool from "@/lib/db";
import { SMC_FLEX_TROUBLESHOOTING as T } from "@/capabilities/diagnostic-plan/manufacturer/smc-flex";

const A = "11111111-1111-4111-8111-111111111111";
const B = "99999999-9999-4999-8999-999999999999";
const NB = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
let tenant = A;
let notebook: Record<string, unknown> | undefined;
let fileSha: string | null;
type Row = { run_id: string; tenant_id: string; workflow_name: string; status: string; input: Record<string, string>; step_artifacts: unknown[]; started_at: string };
let runs: Row[];
const sqls: { sql: string; params: unknown[] }[] = [];

function fakeRuns(sql: string, params: unknown[]) {
  sqls.push({ sql, params });
  if (sql.includes("INSERT INTO workflow_runs")) {
    const row: Row = { run_id: `r${runs.length + 1}`, tenant_id: String(params[1]), workflow_name: "guided_procedure", status: "running",
      input: JSON.parse(String(params[2])), step_artifacts: [], started_at: `2026-10-21T00:00:0${runs.length}Z` };
    runs.push(row);
    return { rows: [row] };
  }
  if (sql.includes("SELECT run_id")) {
    const byTenant = sql.includes("tenant_id = $1::text");
    const hits = runs.filter((r) => (!byTenant || r.tenant_id === params[0]) && r.input.notebookId === params[1] && r.input.templateId === params[2]);
    return { rows: hits.sort((x, y) => y.started_at.localeCompare(x.started_at)).slice(0, 1) };
  }
  if (sql.includes("UPDATE workflow_runs")) {
    const byTenant = sql.includes("tenant_id = $2::text");
    const byCount = sql.includes("jsonb_array_length(step_artifacts) = $3");
    const r = runs.find((x) => x.run_id === params[0] && (!byTenant || x.tenant_id === params[1]) && x.status === "running" && (!byCount || x.step_artifacts.length === params[2]));
    if (!r) return { rows: [] };
    r.step_artifacts = [...r.step_artifacts, JSON.parse(String(params[3]))];
    r.status = String(params[4]);
    return { rows: [r] };
  }
  return { rows: [] };
}

const get = () => GET(new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/procedure`), { params: Promise.resolve({ id: NB }) });
const post = (body: unknown) =>
  POST(new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/procedure`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: NB }),
  });
const answer = (input: Record<string, unknown>) => post({ templateId: T.id, op: "answer", input });

beforeEach(() => {
  vi.resetAllMocks();
  runs = [];
  sqls.length = 0;
  tenant = A;
  process.env.NOTEBOOK_GUIDED_PROCEDURE = "1";
  notebook = { manufacturer: "Allen-Bradley", model: "SMC Flex", catalog_number: "150-F135NBD", identity_status: "user_confirmed" };
  fileSha = T.source!.fileSha256;
  vi.mocked(sessionOr401).mockImplementation(async () => ({ tenantId: tenant, userId: "u1" }) as never);
  vi.mocked(withTenantContext).mockImplementation((async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string) => {
        if (sql.includes("FROM equipment_notebooks")) return { rows: notebook ? [notebook] : [] };
        if (sql.includes("FROM namespace_direct_uploads")) return { rows: fileSha ? [{ id: FILE, content_sha256: fileSha }] : [] };
        return { rows: [] };
      },
    })) as never);
  vi.mocked(listSources).mockResolvedValue([{ filename: "150-um008_-en-p.pdf", fileId: FILE } as never]);
  vi.mocked(pool.query).mockImplementation((async (sql: string, params: unknown[]) => fakeRuns(sql, params)) as never);
});
afterEach(() => {
  delete process.env.NOTEBOOK_GUIDED_PROCEDURE;
});

describe("gating", () => {
  it("404 when the switch is off, and nothing is read", async () => {
    process.env.NOTEBOOK_GUIDED_PROCEDURE = "0";
    expect((await get()).status).toBe(404);
    expect((await post({ templateId: T.id, op: "start" })).status).toBe(404);
    expect(listSources).not.toHaveBeenCalled();
  });
  it("an unconfirmed machine is offered nothing and cannot start", async () => {
    notebook = { ...notebook, identity_status: "candidate" };
    expect(await (await get()).json()).toEqual({ procedures: [], reason: "identity_not_confirmed" });
    expect((await post({ templateId: T.id, op: "start" })).status).toBe(409);
  });
  it("a PowerFlex notebook is not offered the SMC Flex procedure", async () => {
    notebook = { ...notebook, model: "PowerFlex 525", catalog_number: "25B-D010N104" };
    expect((await (await get()).json()).procedures).toEqual([]);
  });
  it("a different manual revision is shown as refused and cannot start", async () => {
    fileSha = "0".repeat(64);
    vi.mocked(listSources).mockResolvedValue([{ filename: "150-um008h-en-p.pdf", fileId: FILE } as never]);
    const body = await (await get()).json();
    expect(body.procedures[0].applicability).toMatchObject({ applies: false, reason: "different_revision" });
    const res = await post({ templateId: T.id, op: "start" });
    expect(res.status).toBe(409);
    expect(runs).toHaveLength(0);
  });
});

describe("a session", () => {
  it("starts at the p.103 safety notices, and start is idempotent while running", async () => {
    const r1 = await post({ templateId: T.id, op: "start" });
    expect(r1.status).toBe(201);
    const s = (await r1.json()).session;
    expect(s.view.step).toMatchObject({ id: "hazards", kind: "safety" });
    expect(s.revision).toBe("exact");
    await post({ templateId: T.id, op: "start" });
    expect(runs).toHaveLength(1);
  });
  it("records answers in order and resumes from GET (as after an interruption)", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    await answer({ kind: "choice", stepId: "fault_displayed", choice: "no" });
    const resumed = (await (await get()).json()).procedures[0].session;
    expect(resumed.view.step.id).toBe("nature");
    expect(resumed.view.history.map((h: { stepId: string }) => h.stepId)).toEqual(["hazards", "fault_displayed"]);
  });
  it("the outcome is derived server-side: a client-sent outcome is ignored", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: false, outcome: "PASS" });
    expect(runs[0].status).toBe("failed");
    expect((runs[0].step_artifacts[0] as { outcome: string }).outcome).toBe("UNSAFE");
  });
  it("a measurement is judged by the manual's criterion, and escalation carries the question for MIRA", async () => {
    await post({ templateId: T.id, op: "start" });
    for (const input of [
      { kind: "acknowledge", stepId: "hazards", acknowledged: true },
      { kind: "choice", stepId: "fault_displayed", choice: "yes" },
      { kind: "choice", stepId: "t44", choice: "shorted_scr" },
      { kind: "isolation", stepId: "scr_isolate", confirmed: true, reportedBy: "M. Harper" },
    ]) expect((await answer(input)).status).toBe(200);
    const res = await answer({ kind: "measurement", stepId: "scr_test", readings: [
      { point: "L1-T1", value: 12000, unit: "ohm" }, { point: "L2-T2", value: 9000, unit: "ohm" }, { point: "L3-T3", value: 8000, unit: "ohm" }] });
    const s = (await res.json()).session;
    expect(s.view.status).toBe("escalate");
    expect(s.askMira).toContain("L2-T2 9000 ohm");
    expect(runs[0].status).toBe("degraded");
  });
  it("an answer for the wrong step is 422 and nothing is stored", async () => {
    await post({ templateId: T.id, op: "start" });
    const res = await answer({ kind: "choice", stepId: "t44", choice: "jam" });
    expect(res.status).toBe(422);
    expect(runs[0].step_artifacts).toHaveLength(0);
  });
  it("a double tap loses the compare-and-set: one record, then 409 stale_step", async () => {
    await post({ templateId: T.id, op: "start" });
    const ack = { kind: "acknowledge", stepId: "hazards", acknowledged: true };
    const [r1, r2] = await Promise.all([answer(ack), answer(ack)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409].sort());
    expect(runs[0].step_artifacts).toHaveLength(1);
  });
  it("restart opens a new session; the old one is kept", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    expect((await post({ templateId: T.id, op: "restart" })).status).toBe(201);
    expect(runs).toHaveLength(2);
    expect((await (await get()).json()).procedures[0].session.view.step.id).toBe("hazards");
  });
});

describe("tenant isolation (workflow_runs is TEXT tenant_id, no RLS)", () => {
  it("every workflow_runs query binds the caller's tenant", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    await get();
    for (const q of sqls) expect(q.params).toContain(A);
    expect(sqls.every((q) => /tenant_id = \$\d::text|\$2::text/.test(q.sql))).toBe(true);
  });
  it("tenant B never sees or continues tenant A's session on the same notebook id", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    tenant = B;
    expect((await (await get()).json()).procedures[0].session).toBeNull();
    expect((await answer({ kind: "choice", stepId: "fault_displayed", choice: "no" })).status).toBe(409);
    expect(runs[0].step_artifacts).toHaveLength(1);
  });
});

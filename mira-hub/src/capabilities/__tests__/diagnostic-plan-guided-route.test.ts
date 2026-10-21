// WP-1: GET/POST /api/equipment-notebooks/[id]/procedure. Session, tenant context and sources are
// mocked; guided_procedure_sessions is an in-memory fake that honours ONLY the tenant, session and
// count predicates the SQL actually contains, so a query that forgets one leaks or double-appends here too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/tenant-context", () => ({ withTenantContext: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ listSources: vi.fn() }));

import { GET, POST } from "@/app/api/equipment-notebooks/[id]/procedure/route";
import { sessionOr401 } from "@/lib/session";
import { withTenantContext } from "@/lib/tenant-context";
import { listSources } from "@/lib/equipment-notebooks";
import { SMC_FLEX_TROUBLESHOOTING as T } from "@/capabilities/diagnostic-plan/manufacturer/smc-flex";

const A = "11111111-1111-4111-8111-111111111111";
const B = "99999999-9999-4999-8999-999999999999";
const NB = "22222222-2222-4222-8222-222222222222";
const FILE = "33333333-3333-4333-8333-333333333333";
let tenant = A;
let notebook: Record<string, unknown> | undefined;
let fileSha: string | null;
type Row = { id: string; tenant_id: string; notebook_id: string; template_id: string; template_version: string; revision: string; status: string; records: unknown[]; started_at: string };
let runs: Row[];
const sqls: { sql: string; params: unknown[] }[] = [];
let seq = 0;

function fakeSessions(sql: string, params: unknown[]) {
  sqls.push({ sql, params });
  if (sql.includes("INSERT INTO guided_procedure_sessions")) {
    // Partial unique index (migration 106): one running session per tenant/notebook/template.
    const clash = runs.some((r) => r.status === "running" && r.tenant_id === String(params[0]) && r.notebook_id === String(params[1]) && r.template_id === String(params[2]));
    if (clash && sql.includes("ON CONFLICT")) return { rows: [] };
    if (clash) throw new Error("duplicate key value violates unique constraint uq_guided_procedure_sessions_one_running");
    seq += 1;
    const row: Row = { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, tenant_id: String(params[0]), notebook_id: String(params[1]),
      template_id: String(params[2]), template_version: String(params[3]), revision: String(params[5]), status: "running", records: [],
      started_at: `2026-10-21T00:00:${String(seq).padStart(2, "0")}Z` };
    runs.push(row);
    return { rows: [row] };
  }
  if (sql.includes("FROM guided_procedure_sessions")) {
    const byTenant = sql.includes("tenant_id = $1::uuid");
    const hits = runs.filter((r) => (!byTenant || r.tenant_id === params[0]) && r.notebook_id === params[1] && r.template_id === params[2]);
    return { rows: hits.sort((x, y) => y.started_at.localeCompare(x.started_at)).slice(0, 1) };
  }
  if (sql.includes("SET status = 'restarted'")) {
    for (const r of runs) if (r.status === "running" && r.tenant_id === params[0] && r.notebook_id === params[1] && r.template_id === params[2]) r.status = "restarted";
    return { rows: [] };
  }
  if (sql.includes("UPDATE guided_procedure_sessions")) {
    const byTenant = sql.includes("tenant_id = $2::uuid");
    const byCount = sql.includes("jsonb_array_length(records) = $3");
    const r = runs.find((x) => x.id === params[0] && (!byTenant || x.tenant_id === params[1]) && x.status === "running" && (!byCount || x.records.length === params[2]));
    if (!r) return { rows: [] };
    r.records = [...r.records, JSON.parse(String(params[3]))];
    r.status = String(params[4]);
    return { rows: [r] };
  }
  return null;
}

const get = () => GET(new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/procedure`), { params: Promise.resolve({ id: NB }) });
const post = (body: unknown) =>
  POST(new NextRequest(`http://hub.test/api/equipment-notebooks/${NB}/procedure`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: NB }),
  });
const cur = () => runs.filter((r) => r.tenant_id === tenant).sort((x, y) => y.started_at.localeCompare(x.started_at))[0];
const answer = (input: Record<string, unknown>, at?: { sessionId: string; recordCount: number }) =>
  post({ templateId: T.id, op: "answer", input, ...(at ?? { sessionId: cur()?.id ?? "00000000-0000-4000-8000-000000000000", recordCount: cur()?.records.length ?? 0 }) });

beforeEach(() => {
  vi.resetAllMocks();
  runs = [];
  sqls.length = 0;
  seq = 0;
  tenant = A;
  process.env.NOTEBOOK_GUIDED_PROCEDURE = "1";
  notebook = { manufacturer: "Allen-Bradley", model: "SMC Flex", catalog_number: "150-F135NBD", identity_status: "user_confirmed" };
  fileSha = T.source!.fileSha256;
  vi.mocked(sessionOr401).mockImplementation(async () => ({ tenantId: tenant, userId: "u1" }) as never);
  vi.mocked(withTenantContext).mockImplementation((async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string, params: unknown[]) => {
        const hit = fakeSessions(sql, params);
        if (hit) return hit;
        if (sql.includes("FROM equipment_notebooks")) return { rows: notebook ? [notebook] : [] };
        if (sql.includes("FROM namespace_direct_uploads")) return { rows: fileSha ? [{ id: FILE, content_sha256: fileSha }] : [] };
        return { rows: [] };
      },
    })) as never);
  vi.mocked(listSources).mockResolvedValue([{ filename: "150-um008_-en-p.pdf", fileId: FILE } as never]);
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
    expect((runs[0].records[0] as { outcome: string }).outcome).toBe("UNSAFE");
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
    expect(runs[0].records).toHaveLength(0);
  });
  it("a double tap loses the compare-and-set: one record, then 409 stale_step", async () => {
    await post({ templateId: T.id, op: "start" });
    const ack = { kind: "acknowledge", stepId: "hazards", acknowledged: true };
    const at = { sessionId: runs[0].id, recordCount: 0 };
    const [r1, r2] = await Promise.all([answer(ack, at), answer(ack, at)]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409].sort());
    expect(runs[0].records).toHaveLength(1);
  });
  it("restart opens a new session; the old one is kept", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    expect((await post({ templateId: T.id, op: "restart" })).status).toBe(201);
    expect(runs).toHaveLength(2);
    expect((await (await get()).json()).procedures[0].session.view.step.id).toBe("hazards");
  });
});

describe("tenant isolation (guided_procedure_sessions, RLS + explicit predicate)", () => {
  it("every session query binds the caller's tenant", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    await get();
    expect(sqls.length).toBeGreaterThanOrEqual(4);
    for (const q of sqls) expect(q.params).toContain(A);
    expect(sqls.filter((q) => !q.sql.includes("INSERT")).every((q) => /tenant_id = \$\d::uuid/.test(q.sql))).toBe(true);
  });
  it("tenant B never sees or continues tenant A's session on the same notebook id", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    const aSession = { sessionId: runs[0].id, recordCount: 1 };
    tenant = B;
    expect((await (await get()).json()).procedures[0].session).toBeNull();
    expect((await answer({ kind: "choice", stepId: "fault_displayed", choice: "no" }, aSession)).status).toBe(409);
    expect(runs[0].records).toHaveLength(1);
  });
});

describe("untrusted input (Codex #4573 F2)", () => {
  it.each([
    ["the string \"false\" as an acknowledgement", { kind: "acknowledge", stepId: "hazards", acknowledged: "false" }],
    ["a number as an acknowledgement", { kind: "acknowledge", stepId: "hazards", acknowledged: 1 }],
    ["an unknown kind", { kind: "override", stepId: "hazards" }],
    ["no step", { kind: "acknowledge", acknowledged: true }],
  ])("%s is 400 and nothing is stored", async (_n, input) => {
    await post({ templateId: T.id, op: "start" });
    expect((await answer(input)).status).toBe(400);
    expect(runs[0].records).toHaveLength(0);
  });
  it.each([
    ["a string confirmation", { kind: "isolation", stepId: "scr_isolate", confirmed: "false", reportedBy: "X" }],
    ["a non-string name", { kind: "isolation", stepId: "scr_isolate", confirmed: true, reportedBy: 7 }],
  ])("isolation: %s never unlocks the SCR test", async (_n, input) => {
    await post({ templateId: T.id, op: "start" });
    for (const i of [{ kind: "acknowledge", stepId: "hazards", acknowledged: true }, { kind: "choice", stepId: "fault_displayed", choice: "yes" }, { kind: "choice", stepId: "t44", choice: "shorted_scr" }]) {
      expect((await answer(i)).status).toBe(200);
    }
    expect((await answer(input)).status).toBe(400);
    expect(runs[0].records).toHaveLength(3);
  });
  it.each([
    ["missing readings", { kind: "measurement", stepId: "scr_test" }],
    ["a null reading", { kind: "measurement", stepId: "scr_test", readings: [null] }],
    ["a string value", { kind: "measurement", stepId: "scr_test", readings: [{ point: "L1-T1", value: "9000", unit: "ohm" }] }],
  ])("measurement: %s is 400, not a crash", async (_n, input) => {
    await post({ templateId: T.id, op: "start" });
    expect((await answer(input)).status).toBe(400);
  });
  it("a prototype key is not an option", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    expect((await answer({ kind: "choice", stepId: "fault_displayed", choice: "constructor" })).status).toBe(422);
  });
});

describe("answers bind to the session on screen (Codex #4573 F3)", () => {
  it("an answer held from run 1 is refused after a restart into run 2", async () => {
    await post({ templateId: T.id, op: "start" });
    const held = { sessionId: runs[0].id, recordCount: 0 };
    await post({ templateId: T.id, op: "restart" });
    const res = await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true }, held);
    expect(res.status).toBe(409);
    expect(runs[1].records).toHaveLength(0);
  });
  it("an answer for a step already passed (stale count) is refused", async () => {
    await post({ templateId: T.id, op: "start" });
    await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true });
    expect((await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true }, { sessionId: runs[0].id, recordCount: 0 })).status).toBe(409);
    expect(runs[0].records).toHaveLength(1);
  });
});

describe("one running session (Codex #4573 F8)", () => {
  it("two simultaneous starts share one session, and an answer from either is valid", async () => {
    const [r1, r2] = await Promise.all([post({ templateId: T.id, op: "start" }), post({ templateId: T.id, op: "start" })]);
    const [s1, s2] = [(await r1.json()).session, (await r2.json()).session];
    expect(runs).toHaveLength(1);
    expect(s1.sessionId).toBe(s2.sessionId);
    expect([r1.status, r2.status].sort()).toEqual([200, 201]);
    const res = await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true }, { sessionId: s2.sessionId, recordCount: s2.recordCount });
    expect(res.status).toBe(200);
  });
  it("restart ends the running session as 'restarted' before opening the new one", async () => {
    await post({ templateId: T.id, op: "start" });
    await post({ templateId: T.id, op: "restart" });
    expect(runs.map((r) => r.status)).toEqual(["restarted", "running"]);
  });
});

describe("a session saved on an earlier procedure version (Codex #4592 F1)", () => {
  const toScrTest = [
    { kind: "acknowledge", stepId: "hazards", acknowledged: true },
    { kind: "choice", stepId: "fault_displayed", choice: "yes" },
    { kind: "choice", stepId: "t44", choice: "shorted_scr" },
    { kind: "isolation", stepId: "scr_isolate", confirmed: true, reportedBy: "M. Harper" },
  ];
  const failReadings = { kind: "measurement", stepId: "scr_test", readings: [
    { point: "L1-T1", value: 12000, unit: "ohm" }, { point: "L2-T2", value: 5000, unit: "ohm" }, { point: "L3-T3", value: 8000, unit: "ohm" }] };

  async function restartAndAnswer() {
    const restarted = await post({ templateId: T.id, op: "restart" });
    expect(restarted.status).toBe(201);
    const s = (await restarted.json()).session;
    expect(s.view.status).toBe("active");
    expect(s.view.step.id).toBe("hazards");
    expect(cur().template_version).toBe(T.version);
    expect((await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true })).status).toBe(200);
  }

  it("a running 1.0.0 session is shown ended with its history, refuses answers, and restarts to the current version", async () => {
    await post({ templateId: T.id, op: "start" });
    expect((await answer({ kind: "acknowledge", stepId: "hazards", acknowledged: true })).status).toBe(200);
    runs[0].template_version = "1.0.0";
    expect(T.version).not.toBe("1.0.0");

    const shown = (await (await get()).json()).procedures[0].session;
    expect(shown.view.status).toBe("stopped");
    expect(shown.view.endReason).toMatch(/updated/);
    expect(shown.view.history).toHaveLength(1);

    const refused = await answer({ kind: "choice", stepId: "fault_displayed", choice: "yes" });
    expect(refused.status).toBe(409);
    const body = await refused.json();
    expect(body.error).toBe("procedure_version_changed");
    expect(body.session.view.status).toBe("stopped");

    await restartAndAnswer();
    expect(runs.find((r) => r.id !== cur().id)?.status).toBe("restarted");
  });

  it("a finished 1.0.0 SCR-failure session is not replayed as an active step on 1.1.0", async () => {
    await post({ templateId: T.id, op: "start" });
    for (const input of [...toScrTest, failReadings]) expect((await answer(input)).status).toBe(200);
    // What 1.0.0 stored for that run: ended as resolved.
    runs[0].template_version = "1.0.0";
    runs[0].status = "ok";

    const shown = (await (await get()).json()).procedures[0].session;
    expect(shown.view.status).toBe("stopped");
    expect(shown.view.step).toBeUndefined();

    await restartAndAnswer();
  });
});

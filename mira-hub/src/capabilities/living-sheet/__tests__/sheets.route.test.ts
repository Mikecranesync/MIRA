/**
 * Mocked route tests for the three Living Work Sheet route files: flag
 * gating, notebook/job existence, storage-unavailable mapping, the
 * confirmed-asset check (start only — reads and appends skip it), input
 * validation, status-to-HTTP mapping, and that the actor always comes from
 * the session, never the request body. Pattern copied from
 * capabilities/observations/__tests__/observations.route.test.ts.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const JOB_ID = "33333333-3333-4333-8333-333333333333";
const ENTITY = "cmms-pump07";
const CLIENT_EVENT_ID = "44444444-4444-4444-8444-444444444444";

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "tech-1", email: "tech1@example.com" })),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));

const nb = vi.hoisted(() => ({
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(),
}));
vi.mock("@/lib/equipment-notebooks", () => nb);

const store = vi.hoisted(() => ({
  listJobs: vi.fn(),
  startJob: vi.fn(),
  loadJob: vi.fn(),
  appendEvent: vi.fn(),
  livingSheetStorageUnavailable: vi.fn((err: unknown) => {
    if ((err as { code?: string } | null)?.code === "42P01") {
      return { status: 503, json: async () => ({ error: "living_sheet_unavailable" }) };
    }
    return null;
  }),
}));
vi.mock("@/capabilities/living-sheet/store", () => store);
const qcStore = vi.hoisted(() => ({ latestCloseout: vi.fn(async () => null) }));
vi.mock("@/capabilities/living-sheet/intake-closeout-store", () => qcStore);

const assetMemory = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/capabilities/living-sheet/asset-memory", () => ({ loadAssetMemory: assetMemory.load }));
import { GET as GET_LIST, POST as POST_START } from "../../../app/api/equipment-notebooks/[id]/sheets/route";
import { GET as GET_JOB } from "../../../app/api/equipment-notebooks/[id]/sheets/[jobId]/route";
import { POST as POST_EVENT } from "../../../app/api/equipment-notebooks/[id]/sheets/[jobId]/events/route";

const params = { params: Promise.resolve({ id: NB }) };
const jobParams = { params: Promise.resolve({ id: NB, jobId: JOB_ID }) };
const confirmed = { state: "resolved", entityId: ENTITY, name: "Pump 07", unsPath: "enterprise.lw.line1.pump07", selectedVia: "manual", confirmedAt: "2026-06-15T09:00:00.000Z" };

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`http://test${url}`, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function startBody(over: Record<string, unknown> = {}) {
  return {
    title: "PM — Pump 07",
    templateRevisionId: null,
    template: {
      title: "PM — Pump 07",
      machineLabel: "Pump 07",
      component: null,
      jobType: "pm",
      estHours: null,
      crewSize: null,
      isolationPoints: null,
      cautions: null,
      returnToService: [],
      items: [],
      torques: [],
      steps: [{ id: "step-1", text: "Check seal", checkoff: "none", torqueRef: null, source: null }],
      author: null,
      notes: null,
    },
    clientEventId: CLIENT_EVENT_ID,
    occurredAt: new Date().toISOString(),
    ...over,
  };
}

function eventBody(over: Record<string, unknown> = {}) {
  return {
    clientEventId: CLIENT_EVENT_ID,
    baseSeq: 1,
    kind: "step_marked",
    payload: { stepId: "step-1", done: true, note: null },
    occurredAt: new Date().toISOString(),
    workOrderId: null,
    ...over,
  };
}

const sampleView = {
  jobId: JOB_ID,
  seq: 1,
  title: "PM — Pump 07",
  machine: { entityId: ENTITY, name: "Pump 07" },
  templateRevisionId: null,
  template: startBody().template,
  steps: [],
  readings: [],
  parts: [],
  notes: [],
  questions: [],
  photos: [],
  handover: { current: null, history: [] },
  finished: null,
  openSteps: 0,
  openQuestions: 0,
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NOTEBOOK_LIVING_SHEET = "1";
  nb.getNotebook.mockResolvedValue({ id: NB, displayName: "Pump 07" });
  nb.resolveBoundAsset.mockResolvedValue(confirmed);
  store.listJobs.mockResolvedValue([]);
  store.loadJob.mockResolvedValue({ status: "ok", view: sampleView });
  store.startJob.mockResolvedValue({ status: "created", jobId: JOB_ID, event: { id: "e1", seq: 1 }, seq: 1, view: sampleView });
  store.appendEvent.mockResolvedValue({ status: "created", event: { id: "e2", seq: 2 }, seq: 2, view: sampleView });
});

describe("living-sheet routes: flag", () => {
  it("flag off ⇒ 404 living_sheet_disabled on every route", async () => {
    delete process.env.NOTEBOOK_LIVING_SHEET;
    const results = [
      await GET_LIST(req(`/api/equipment-notebooks/${NB}/sheets`, "GET"), params),
      await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", startBody()), params),
      await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}`, "GET"), jobParams),
      await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams),
    ];
    for (const res of results) {
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "living_sheet_disabled" });
    }
    expect(store.startJob).not.toHaveBeenCalled();
    expect(store.appendEvent).not.toHaveBeenCalled();
  });
});

describe("living-sheet routes: notebook / id checks", () => {
  it("a non-UUID notebook id ⇒ 404 notebook_not_found, before any store call", async () => {
    const badParams = { params: Promise.resolve({ id: "not-a-uuid" }) };
    const res = await GET_LIST(req(`/api/equipment-notebooks/not-a-uuid/sheets`, "GET"), badParams);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(store.listJobs).not.toHaveBeenCalled();
  });

  it("a non-UUID jobId ⇒ 404 job_not_found", async () => {
    const badParams = { params: Promise.resolve({ id: NB, jobId: "not-a-uuid" }) };
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/not-a-uuid`, "GET"), badParams);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "job_not_found" });
  });

  it("notebook not found ⇒ 404 notebook_not_found", async () => {
    nb.getNotebook.mockResolvedValue(null);
    const res = await GET_LIST(req(`/api/equipment-notebooks/${NB}/sheets`, "GET"), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
  });
});

describe("living-sheet routes: storage unavailable", () => {
  it("GET list: table missing ⇒ 503 living_sheet_unavailable", async () => {
    store.listJobs.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    const res = await GET_LIST(req(`/api/equipment-notebooks/${NB}/sheets`, "GET"), params);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "living_sheet_unavailable" });
  });

  it("POST start: table missing ⇒ 503 living_sheet_unavailable", async () => {
    store.startJob.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    const res = await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", startBody()), params);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "living_sheet_unavailable" });
  });

  it("GET job: table missing ⇒ 503 living_sheet_unavailable", async () => {
    store.loadJob.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}`, "GET"), jobParams);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "living_sheet_unavailable" });
  });

  it("POST event: table missing ⇒ 503 living_sheet_unavailable", async () => {
    store.appendEvent.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "living_sheet_unavailable" });
  });
});

describe("living-sheet routes: confirmed-asset check (start only)", () => {
  it("POST start on an unconfirmed binding ⇒ 409, startJob never called", async () => {
    nb.resolveBoundAsset.mockResolvedValue({ ...confirmed, confirmedAt: null });
    const res = await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", startBody()), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "asset_not_confirmed" });
    expect(store.startJob).not.toHaveBeenCalled();
  });

  it("GET list and GET job and POST event do NOT check the binding at all (reads/appends are allowed unconfirmed)", async () => {
    nb.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
    const list = await GET_LIST(req(`/api/equipment-notebooks/${NB}/sheets`, "GET"), params);
    const job = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}`, "GET"), jobParams);
    const event = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(list.status).toBe(200);
    expect(job.status).toBe(200);
    expect(event.status).toBe(201);
    expect(nb.resolveBoundAsset).not.toHaveBeenCalled();
  });
});

describe("living-sheet routes: POST /sheets input + status mapping", () => {
  it("rejects a malformed body (complete except the field under test)", async () => {
    const body = startBody();
    delete (body as Record<string, unknown>).title;
    const res = await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", body), params);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_title", field: "title" });
    expect(store.startJob).not.toHaveBeenCalled();
  });

  it("a control: the complete, valid body starts a job (201) against the server-resolved asset", async () => {
    const res = await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", startBody()), params);
    expect(res.status).toBe(201);
    expect(store.startJob).toHaveBeenCalledWith(
      TENANT,
      NB,
      { entityId: ENTITY, name: "Pump 07" },
      expect.objectContaining({ title: "PM — Pump 07" }),
      { userId: "tech-1", label: "tech1@example.com" },
    );
  });

  it("existing (idempotent replay) ⇒ 200 with replayed:true", async () => {
    store.startJob.mockResolvedValue({ status: "existing", jobId: JOB_ID, view: sampleView });
    const res = await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", startBody()), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ jobId: JOB_ID, replayed: true });
  });

  it("request_id_conflict ⇒ 409", async () => {
    store.startJob.mockResolvedValue({ status: "request_id_conflict" });
    const res = await POST_START(req(`/api/equipment-notebooks/${NB}/sheets`, "POST", startBody()), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "request_id_conflict" });
  });
});

describe("living-sheet routes: GET /sheets", () => {
  it("returns the notebook's jobs", async () => {
    store.listJobs.mockResolvedValue([{ jobId: JOB_ID, title: "PM — Pump 07", startedAt: "2026-11-03T12:00:00.000Z", startedBy: "tech-1", finished: false, seq: 1 }]);
    const res = await GET_LIST(req(`/api/equipment-notebooks/${NB}/sheets`, "GET"), params);
    expect(res.status).toBe(200);
    expect((await res.json()).jobs).toHaveLength(1);
  });
});

describe("living-sheet routes: GET /sheets/[jobId]", () => {
  it("exports explicit v2 with the same snapshot and scoped QC lookup", async () => {
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?format=instruction-record-v2&atSeq=1`, "GET"), jobParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schemaVersion: 2, snapshot: sampleView, closeout: null, capture: { privacy: "private", exactConversationLinkage: "unknown" }, review: { technicianCloseout: "not_recorded", reusableAcceptance: "not_recorded" } });
    expect(qcStore.latestCloseout).toHaveBeenCalledWith(TENANT, NB, JOB_ID, 1);
    expect(store.appendEvent).not.toHaveBeenCalled();
  });
  it("exports an opt-in versioned record from the same tenant-scoped historical snapshot", async () => {
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?format=instruction-record&atSeq=1`, "GET"), jobParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ schemaVersion: 1, status: "draft", lineage: { notebookId: NB, jobId: JOB_ID, seq: 1 }, snapshot: sampleView });
    expect(store.loadJob).toHaveBeenCalledWith(TENANT, NB, JOB_ID, 1);
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("rejects unsupported export versions without loading a job", async () => {
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?format=instruction-record-v99`, "GET"), jobParams);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_format" });
    expect(store.loadJob).not.toHaveBeenCalled();
  });

  it.each(["flag", "foreign_notebook", "missing_job", "future_seq", "missing_table"])("instruction export preserves the %s gate", async (gate) => {
    if (gate === "flag") process.env.NOTEBOOK_LIVING_SHEET = "0";
    if (gate === "foreign_notebook") nb.getNotebook.mockResolvedValue(null);
    if (gate === "missing_job") store.loadJob.mockResolvedValue({ status: "job_not_found" });
    if (gate === "missing_table") store.loadJob.mockRejectedValue(Object.assign(new Error("missing"), { code: "42P01" }));
    const suffix = gate === "future_seq" ? "&atSeq=100" : "";
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?format=instruction-record${suffix}`, "GET"), jobParams);
    expect(res.status).toBe(gate === "missing_table" ? 503 : 404);
    expect((await res.json()).schemaVersion).toBeUndefined();
    expect(store.appendEvent).not.toHaveBeenCalled();
    if (gate === "flag" || gate === "foreign_notebook") expect(store.loadJob).not.toHaveBeenCalled();
  });

  it("returns {view, seq} at the job's current seq by default", async () => {
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}`, "GET"), jobParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.seq).toBe(sampleView.seq);
    expect(body.snapshot).toBeUndefined();
    expect(store.loadJob).toHaveBeenCalledWith(TENANT, NB, JOB_ID, undefined);
  });

  it("?atSeq=N returns a snapshot at N", async () => {
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?atSeq=1`, "GET"), jobParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ seq: 1, snapshot: true });
    expect(store.loadJob).toHaveBeenCalledWith(TENANT, NB, JOB_ID, 1);
  });

  it("a non-numeric atSeq ⇒ 400 invalid_at_seq", async () => {
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?atSeq=nope`, "GET"), jobParams);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_at_seq" });
  });

  // F30 (egm-review/verdict.md): `atSeq` past the job's last seq is a
  // prefix reduce over EVERY event there is — loadJob (mocked here exactly
  // as the real reducer would resolve it) returns `view.seq: 3` for a
  // 3-event job no matter how large the requested atSeq is. The route must
  // not then report the requested-but-nonexistent `100` as the outer `seq`
  // of a `snapshot: true` response — that names a sequence that never
  // happened as if it were a real snapshot.
  it("?atSeq=100 on a 3-event job ⇒ 404 sequence_not_found, never a mislabelled seq:100 snapshot", async () => {
    store.loadJob.mockResolvedValue({ status: "ok", view: { ...sampleView, seq: 3 } });
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?atSeq=100`, "GET"), jobParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("sequence_not_found");
    expect(body.seq).toBeUndefined();
    expect(body.snapshot).toBeUndefined();
  });

  it("control: ?atSeq=N equal to the job's current seq is still a valid snapshot", async () => {
    store.loadJob.mockResolvedValue({ status: "ok", view: { ...sampleView, seq: 3 } });
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}?atSeq=3`, "GET"), jobParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ seq: 3, snapshot: true });
  });

  it("job not found ⇒ 404 job_not_found", async () => {
    store.loadJob.mockResolvedValue({ status: "job_not_found" });
    const res = await GET_JOB(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}`, "GET"), jobParams);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "job_not_found" });
  });
});

describe("living-sheet routes: POST /sheets/[jobId]/events", () => {
  it("the actor always comes from the session, never the request body (the validator also has no actor field to accept)", async () => {
    await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(store.appendEvent).toHaveBeenCalledWith(
      TENANT,
      NB,
      JOB_ID,
      expect.anything(),
      { userId: "tech-1", label: "tech1@example.com" },
    );
  });

  it("rejects a malformed body (complete except the field under test)", async () => {
    const body = eventBody({ kind: "job_started" });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", body), jobParams);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid_kind", field: "kind" });
    expect(store.appendEvent).not.toHaveBeenCalled();
  });

  it("created ⇒ 201", async () => {
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(201);
  });

  it("existing (idempotent replay) ⇒ 200 with replayed:true", async () => {
    store.appendEvent.mockResolvedValue({ status: "existing", event: { id: "e2", seq: 2 } });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replayed: true });
  });

  it("request_id_conflict ⇒ 409", async () => {
    store.appendEvent.mockResolvedValue({ status: "request_id_conflict" });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "request_id_conflict" });
  });

  it("job_not_found ⇒ 404", async () => {
    store.appendEvent.mockResolvedValue({ status: "job_not_found" });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "job_not_found" });
  });

  it("invalid_target ⇒ 400 with the store's error and field", async () => {
    store.appendEvent.mockResolvedValue({ status: "invalid_target", error: "unknown_step", field: "payload.stepId" });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "unknown_step", field: "payload.stepId" });
  });

  it("invalid_base_seq ⇒ 400", async () => {
    store.appendEvent.mockResolvedValue({ status: "invalid_base_seq" });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_base_seq" });
  });

  it("conflict ⇒ 409 with the current seq and view", async () => {
    store.appendEvent.mockResolvedValue({ status: "conflict", seq: 5, view: sampleView });
    const res = await POST_EVENT(req(`/api/equipment-notebooks/${NB}/sheets/${JOB_ID}/events`, "POST", eventBody()), jobParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body).toMatchObject({ error: "conflict", seq: 5 });
  });
});

describe("opt-in enriched v2 read", () => {
  it("passes the exact candidate selector to the shared tenant-scoped reader", async () => {
    const selector = { seq: 1, snapshotId: `sha256:${"a".repeat(64)}`, candidate: null };
    assetMemory.load.mockResolvedValueOnce({ status: "ok", record: { schemaVersion: 2, assetMemory: { selector }, fullHistoricalSentinel: "retained" } });
    const response = await GET_JOB(req(`/sheets/${JOB_ID}/?format=instruction-record-v2&assetMemory=1&memorySelector=${encodeURIComponent(JSON.stringify(selector))}`, "GET"), jobParams);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ fullHistoricalSentinel: "retained", assetMemory: { selector } });
    expect(assetMemory.load).toHaveBeenCalledWith(TENANT, NB, JOB_ID, { selector, atSeq: undefined, authorizedNotebookId: NB });
    expect(store.loadJob).not.toHaveBeenCalled();
  });
  it("rejects malformed and oversized pins, wrong format, and reader conflicts", async () => {
    for (const query of ["format=instruction-record&assetMemory=1", "format=instruction-record-v2&assetMemory=1&memorySelector=%7B", `format=instruction-record-v2&assetMemory=1&memorySelector=${"x".repeat(2050)}`]) expect((await GET_JOB(req(`/sheets/${JOB_ID}/?${query}`, "GET"), jobParams)).status).toBe(400);
    expect(assetMemory.load).not.toHaveBeenCalled();
    assetMemory.load.mockResolvedValueOnce({ status: "candidate_conflict" });
    expect((await GET_JOB(req(`/sheets/${JOB_ID}/?format=instruction-record-v2&assetMemory=1`, "GET"), jobParams)).status).toBe(409);
  });
  it("keeps ordinary and original v2 reads free of optional overlay loading", async () => {
    for (const query of ["", "?format=instruction-record", "?format=instruction-record-v2"]) expect((await GET_JOB(req(`/sheets/${JOB_ID}/${query}`, "GET"), jobParams)).status).toBe(200);
    expect(assetMemory.load).not.toHaveBeenCalled();
  });
});

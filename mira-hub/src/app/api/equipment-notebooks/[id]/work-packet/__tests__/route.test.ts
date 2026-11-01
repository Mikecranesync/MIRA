// Vitest coverage for GET/POST /api/equipment-notebooks/[id]/work-packet (#4982, agent D).
//
// A/B/C's parsers and builder (catpumps-datasheet, catpumps-service-manual,
// draft) are mocked throughout — this suite proves the ROUTE's own wiring
// (flag gate, notebook ownership, work-order validation, the two safety
// gates, DraftInput assembly, and the non-text-dependent GET availability
// checks), not their internal logic (each owns its own test file).
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/work-packet"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: vi.fn() }));
vi.mock("@/capabilities/work-packet/document-text", () => ({ loadNotebookDocTexts: vi.fn() }));
vi.mock("@/capabilities/work-packet/catpumps-datasheet", () => ({
  parseCatPumpsDataSheet: vi.fn(),
  sheetModelFor: vi.fn(),
}));
vi.mock("@/capabilities/work-packet/catpumps-service-manual", () => ({
  parseCatPumpsServiceManual: vi.fn(),
}));
vi.mock("@/capabilities/work-packet/draft", () => ({ buildDraftPacket: vi.fn() }));
vi.mock("@/capabilities/energized-work-stop", () => ({ energizedHardStopEnabled: vi.fn() }));
vi.mock("@/lib/safety-classifier", () => ({
  SAFETY_STOP: "⛔ SAFETY STOP (fixture text)",
  hazardBanner: vi.fn((t: string) => `[banner:${t}]`),
  isEnergizedWorkAsk: vi.fn(),
  notebookSafetyTrigger: vi.fn(),
}));

import { GET, POST } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { loadNotebookDocTexts } from "@/capabilities/work-packet/document-text";
import { parseCatPumpsDataSheet, sheetModelFor } from "@/capabilities/work-packet/catpumps-datasheet";
import { parseCatPumpsServiceManual } from "@/capabilities/work-packet/catpumps-service-manual";
import { buildDraftPacket } from "@/capabilities/work-packet/draft";
import { energizedHardStopEnabled } from "@/capabilities/energized-work-stop";
import { SAFETY_STOP, isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const TENANT_ID = "tenant-aaaa";
const session = { userId: "u_1", tenantId: TENANT_ID, email: "x@y", status: "trial", trialExpiresAt: null };

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });
const makeGet = (id = NOTEBOOK_ID) =>
  new Request(`https://hub.test/api/equipment-notebooks/${id}/work-packet`) as never;
function makePost(body: unknown, id = NOTEBOOK_ID) {
  return new Request(`https://hub.test/api/equipment-notebooks/${id}/work-packet`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

function notebook(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: NOTEBOOK_ID,
    manufacturer: "CAT Pumps",
    model: "3520",
    catalogNumber: null,
    serialNumber: null,
    identityStatus: "user_confirmed",
    identityConfidence: 0.9,
    ...over,
  } as never;
}

const doc = (over: Partial<Record<string, unknown>> = {}) => ({
  docId: "99999999-8888-7777-6666-555555555555",
  fileId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  filename: "9XP1000.pdf",
  pages: [{ page: 1, text: "Model 9XP1000 data sheet text" }],
  via: "file",
  ...over,
});

const baseWorkOrder = {
  id: "wo-1",
  title: "Reseal pump",
  description: "Replace seal kit",
  assetTag: null,
  site: null,
  synthetic: true,
};

describe("GET /work-packet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NOTEBOOK_WORK_PACKET;
    (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(session);
  });

  it("404s not_enabled when the flag is off", async () => {
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_enabled");
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("401s when there is no session", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
  });

  it("404s on a malformed notebook id without ever querying the DB for it", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    const res = await GET(makeGet("not-a-uuid"), makeParams("not-a-uuid"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("notebook_not_found");
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("404s when the notebook does not belong to this tenant", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("notebook_not_found");
  });

  it("blocks identity_not_confirmed before looking at documents", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook({ identityStatus: "candidate" }));
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.enabled).toBe(true);
    expect(body.blocking).toEqual({
      reason: "identity_not_confirmed",
      message: "Confirm this machine's identity before preparing a job packet.",
    });
  });

  it("blocks no_documents when nothing is attached", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook());
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.blocking?.reason).toBe("no_documents");
    expect(body.documents).toEqual([]);
  });

  it("blocks unsupported_documents when nothing attached parses as CAT Pumps", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook());
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([doc()]);
    (parseCatPumpsDataSheet as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (parseCatPumpsServiceManual as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.blocking?.reason).toBe("unsupported_documents");
    // notebook's model is "3520" (default fixture); the doc's page text names
    // "9XP1000", so modelFoundOn is correctly empty here.
    expect(body.documents).toEqual([{ docId: doc().docId, fileId: doc().fileId, filename: doc().filename, role: "other", modelFoundOn: [], via: "file", revision: { value: null, label: "unknown", source: null, basis: expect.any(String) } }]);
  });

  it("blocks model_not_in_documents when a data sheet parses but the model isn't on it", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook({ model: "9999" }));
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([doc()]);
    (parseCatPumpsDataSheet as ReturnType<typeof vi.fn>).mockReturnValue({ kind: "catpumps_datasheet", models: ["3520"], parts: [], kits: [], specs: [], problems: [] });
    (sheetModelFor as ReturnType<typeof vi.fn>).mockReturnValue(null);
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.blocking?.reason).toBe("model_not_in_documents");
    expect(body.documents[0].role).toBe("datasheet");
  });

  it("is not blocked (null) and reports the model's pages when everything lines up", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook({ model: "9XP1000" }));
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([doc()]);
    (parseCatPumpsDataSheet as ReturnType<typeof vi.fn>).mockReturnValue({ kind: "catpumps_datasheet", models: ["9XP1000"], parts: [], kits: [], specs: [], problems: [] });
    (sheetModelFor as ReturnType<typeof vi.fn>).mockReturnValue("9XP1000");
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.blocking).toBeNull();
    expect(body.documents[0]).toEqual({
      docId: doc().docId,
      fileId: doc().fileId,
      filename: doc().filename,
      role: "datasheet",
      modelFoundOn: [1],
      via: "file",
      // the fixture page text carries no "PN … Rev …" footer
      revision: { value: null, label: "unknown", source: null, basis: expect.any(String) },
    });
  });

  it("never evaluates no_task_matched (there is no work-order text at GET time)", async () => {
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook({ model: "9XP1000" }));
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([doc()]);
    (parseCatPumpsDataSheet as ReturnType<typeof vi.fn>).mockReturnValue({ kind: "catpumps_datasheet", models: ["9XP1000"], parts: [], kits: [], specs: [], problems: [] });
    (sheetModelFor as ReturnType<typeof vi.fn>).mockReturnValue("9XP1000");
    const res = await GET(makeGet(), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(body.blocking).not.toEqual(expect.objectContaining({ reason: "no_task_matched" }));
    expect(buildDraftPacket).not.toHaveBeenCalled();
  });
});

describe("POST /work-packet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NOTEBOOK_WORK_PACKET = "1";
    (sessionOr401 as ReturnType<typeof vi.fn>).mockResolvedValue(session);
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(notebook());
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (energizedHardStopEnabled as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (isEnergizedWorkAsk as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (notebookSafetyTrigger as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (buildDraftPacket as ReturnType<typeof vi.fn>).mockReturnValue({ ok: true, packet: { version: 1 }, warnings: [] });
  });

  it("404s not_enabled when the flag is off", async () => {
    delete process.env.NOTEBOOK_WORK_PACKET;
    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_enabled");
  });

  it("400s invalid_json on a malformed body", async () => {
    const req = new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/work-packet`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    }) as never;
    const res = await POST(req, makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("400s invalid_body when the work order is missing a title", async () => {
    const res = await POST(makePost({ workOrder: { ...baseWorkOrder, title: "" } }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_body");
    expect(buildDraftPacket).not.toHaveBeenCalled();
  });

  it("400s invalid_body when description exceeds the length cap", async () => {
    const res = await POST(
      makePost({ workOrder: { ...baseWorkOrder, description: "x".repeat(4001) } }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(400);
  });

  it("400s invalid_body when synthetic is missing", async () => {
    const { synthetic, ...noSynthetic } = baseWorkOrder;
    const res = await POST(makePost({ workOrder: noSynthetic }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
  });

  it("404s when the notebook does not belong to this tenant", async () => {
    (getNotebook as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
  });

  it("404s on a malformed notebook id without ever querying the DB for it", async () => {
    const res = await POST(makePost({ workOrder: baseWorkOrder }, "not-a-uuid"), makeParams("not-a-uuid"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("notebook_not_found");
    expect(getNotebook).not.toHaveBeenCalled();
  });

  it("terminal safety_stop: serves SAFETY_STOP bare, never calls buildDraftPacket", async () => {
    (isEnergizedWorkAsk as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    const body = await res.json();
    expect(res.status).toBe(422);
    expect(body).toEqual({ ok: false, reason: "safety_stop", message: SAFETY_STOP });
    expect(buildDraftPacket).not.toHaveBeenCalled();
  });

  it("safety_stop is skipped when energizedHardStopEnabled() is false, even if isEnergizedWorkAsk is true", async () => {
    (energizedHardStopEnabled as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (isEnergizedWorkAsk as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(buildDraftPacket).toHaveBeenCalledTimes(1);
  });

  it("a notebookSafetyTrigger is a FLAG only — hazardFlags reach DraftInput, the turn is never blocked", async () => {
    (notebookSafetyTrigger as ReturnType<typeof vi.fn>).mockReturnValue("some-trigger");
    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const input = (buildDraftPacket as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.hazardFlags).toEqual(["[banner:some-trigger]"]);
  });

  it("assembles DraftInput correctly and returns buildDraftPacket's result verbatim (ok:true -> 200)", async () => {
    (loadNotebookDocTexts as ReturnType<typeof vi.fn>).mockResolvedValue([doc()]);
    const draftResult = { ok: true, packet: { version: 1, packetId: "fixed" }, warnings: ["w1"] };
    (buildDraftPacket as ReturnType<typeof vi.fn>).mockReturnValue(draftResult);

    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(draftResult);

    const input = (buildDraftPacket as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(input.notebookId).toBe(NOTEBOOK_ID);
    expect(input.identity).toEqual({
      manufacturer: "CAT Pumps",
      model: "3520",
      catalogNumber: null,
      serialNumber: null,
      status: "user_confirmed",
      confidence: 0.9,
    });
    expect(input.workOrder).toEqual(baseWorkOrder);
    expect(input.docs).toEqual([doc()]);
    expect(input.hazardFlags).toEqual([]);
    expect(typeof input.packetId).toBe("string");
    expect(input.packetId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(typeof input.now).toBe("string");
    expect(new Date(input.now).toISOString()).toBe(input.now);
  });

  it("returns buildDraftPacket's refusal verbatim (ok:false -> 422)", async () => {
    const refusal = { ok: false, reason: "no_task_matched", message: "No matching task." };
    (buildDraftPacket as ReturnType<typeof vi.fn>).mockReturnValue(refusal);
    const res = await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(422);
    expect(await res.json()).toEqual(refusal);
  });

  it("never writes the work order anywhere — getNotebook is the only equipment-notebooks call", async () => {
    await POST(makePost({ workOrder: baseWorkOrder }), makeParams(NOTEBOOK_ID));
    const { getNotebook: gn } = await import("@/lib/equipment-notebooks");
    expect(Object.keys(await import("@/lib/equipment-notebooks"))).toEqual(["getNotebook"]);
    expect(gn).toHaveBeenCalledTimes(1);
  });
});

// Vitest coverage for PUT /api/equipment-notebooks/[id]/work-packet/drawing-photos/[docId]
// (the technician review step). See route.ts header for the full contract.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/work-packet/drawing-photos/[docId]"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/equipment-notebooks")>()),
  getNotebook: vi.fn(),
  getSourceResolution: vi.fn(),
  markNameplateDocVerified: vi.fn(),
  attachSource: vi.fn(),
  supersedePriorOriginSources: vi.fn(),
}));
vi.mock("@/capabilities/photo-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/photo-source")>()),
  materializeDerivedTextDoc: vi.fn(),
}));
vi.mock("../../../route", () => ({ workPacketEnabled: vi.fn() }));

import { PUT } from "../route";
import { workPacketEnabled } from "../../../route";
import { sessionOr401 } from "@/lib/session";
import {
  getNotebook,
  getSourceResolution,
  markNameplateDocVerified,
  attachSource,
  supersedePriorOriginSources,
} from "@/lib/equipment-notebooks";
import { materializeDerivedTextDoc } from "@/capabilities/photo-source";
import { PHOTO_A } from "@/capabilities/work-packet/__tests__/fixtures/drawing-example";
import { renderDrawingSourceText } from "@/capabilities/work-packet/drawing";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const DOC_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const NEW_DOC_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const NODE_ID = "99999999-8888-7777-6666-555555555555";
const TENANT_ID = "tenant-aaaa-bbbb";

const session = { userId: "u_1", tenantId: TENANT_ID, email: "x@y", status: "trial", trialExpiresAt: null };
const notebook = { id: NOTEBOOK_ID, displayName: "Line 3 Launch Connection", nodeId: NODE_ID } as never;

const ORIGINAL_TEXT = renderDrawingSourceText(PHOTO_A);
// A technician's correction: the C3-B1 torque callout corrected from "Ma=95 Nm" to "Ma=100 Nm".
const CORRECTED_TEXT = ORIGINAL_TEXT.replace("Ma=95 Nm", "Ma=100 Nm");

const makeParams = (id: string, docId: string) => ({ params: Promise.resolve({ id, docId }) });
function makeReq(body: unknown) {
  return new Request(`https://hub.test/x`, { method: "PUT", body: JSON.stringify(body) }) as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workPacketEnabled).mockReturnValue(true);
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(getSourceResolution).mockResolvedValue({
    docId: DOC_ID,
    filename: "Unconfirmed drawing reading.txt",
    fileId: null,
    originFileId: FILE_ID,
    superseded: false,
  });
  vi.mocked(materializeDerivedTextDoc).mockResolvedValue({ docId: NEW_DOC_ID, chunkCount: 5 });
  vi.mocked(markNameplateDocVerified).mockResolvedValue(5);
  vi.mocked(attachSource).mockResolvedValue({ ok: true, docId: NEW_DOC_ID });
  vi.mocked(supersedePriorOriginSources).mockResolvedValue([DOC_ID]);
});

describe("flag + auth + tenancy", () => {
  it("404s when NOTEBOOK_WORK_PACKET is off", async () => {
    vi.mocked(workPacketEnabled).mockReturnValue(false);
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(404);
    expect(getSourceResolution).not.toHaveBeenCalled();
  });

  it("propagates a 401", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(401);
  });

  it("404s a foreign notebook", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(404);
  });

  it("404s a malformed docId without resolving anything", async () => {
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, "not-a-uuid"));
    expect(res.status).toBe(404);
    expect(getSourceResolution).not.toHaveBeenCalled();
  });
});

describe("body validation", () => {
  it("400s when text is missing", async () => {
    const res = await PUT(makeReq({}), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(400);
    expect(getSourceResolution).not.toHaveBeenCalled();
  });

  it("400s when text is blank", async () => {
    const res = await PUT(makeReq({ text: "   " }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(400);
  });
});

describe("source resolution", () => {
  it("404s when docId is not a source of this notebook", async () => {
    vi.mocked(getSourceResolution).mockResolvedValue(null);
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(404);
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
  });

  it("409s when the doc was already superseded by a newer reading", async () => {
    vi.mocked(getSourceResolution).mockResolvedValue({
      docId: DOC_ID,
      filename: "x.txt",
      fileId: null,
      originFileId: FILE_ID,
      superseded: true,
    });
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("source_superseded");
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
  });

  it("422s when the source has no originFileId (not a photo-derived source)", async () => {
    vi.mocked(getSourceResolution).mockResolvedValue({
      docId: DOC_ID,
      filename: "x.txt",
      fileId: null,
      originFileId: null,
      superseded: false,
    });
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(422);
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
  });
});

describe("the corrected text must parse (validate before materialize)", () => {
  it("422s unparseable text and changes nothing", async () => {
    const res = await PUT(makeReq({ text: "this is not drawing LINE text at all" }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("text_unparseable");
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
    expect(supersedePriorOriginSources).not.toHaveBeenCalled();
  });

  it("422s text with an unrecognized LINE tag", async () => {
    const res = await PUT(makeReq({ text: "BOGUS_TAG | x" }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(422);
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
  });
});

describe("a valid review materializes, verifies, attaches and supersedes", () => {
  it("re-renders the parsed text canonically, marks chunks verified, attaches user_confirmed, and supersedes the old doc", async () => {
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      docId: NEW_DOC_ID,
      originFileId: FILE_ID,
      reviewed: true,
      supersededDocIds: [DOC_ID],
    });
    expect(body.sourceText).toContain("Ma=100 Nm");
    expect(body.sourceText).not.toContain("Ma=95 Nm");

    expect(materializeDerivedTextDoc).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, nodeId: NODE_ID, source: "drawing_text" }),
    );
    const materializedText = vi.mocked(materializeDerivedTextDoc).mock.calls[0][0].text;
    expect(materializedText).toContain("Ma=100 Nm");

    expect(markNameplateDocVerified).toHaveBeenCalledWith(TENANT_ID, NEW_DOC_ID);

    expect(attachSource).toHaveBeenCalledWith(
      TENANT_ID,
      NOTEBOOK_ID,
      NEW_DOC_ID,
      expect.objectContaining({
        matchState: "user_confirmed",
        sourceRole: "drawing",
        originFileId: FILE_ID,
        matchEvidence: expect.objectContaining({
          drawing_transcription: expect.objectContaining({ reviewed: true, by: "x@y" }),
        }),
      }),
    );
    expect(supersedePriorOriginSources).toHaveBeenCalledWith(TENANT_ID, NOTEBOOK_ID, FILE_ID, NEW_DOC_ID);

    // Server-written review attribution — never taken from the request body.
    const markOrder = vi.mocked(markNameplateDocVerified).mock.invocationCallOrder[0];
    const supersedeOrder = vi.mocked(supersedePriorOriginSources).mock.invocationCallOrder[0];
    expect(markOrder).toBeLessThan(supersedeOrder);
  });

  it("503s when materialization is already in progress, without superseding anything", async () => {
    vi.mocked(materializeDerivedTextDoc).mockResolvedValue({ docId: null, chunkCount: 0 });
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(503);
    expect(supersedePriorOriginSources).not.toHaveBeenCalled();
    expect(markNameplateDocVerified).not.toHaveBeenCalled();
  });

  it("503s when attachSource fails, without superseding anything", async () => {
    vi.mocked(attachSource).mockResolvedValue({ ok: false, error: "doc_not_found" });
    const res = await PUT(makeReq({ text: CORRECTED_TEXT }), makeParams(NOTEBOOK_ID, DOC_ID));
    expect(res.status).toBe(503);
    expect(supersedePriorOriginSources).not.toHaveBeenCalled();
  });
});

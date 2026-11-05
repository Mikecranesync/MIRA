// Vitest coverage for POST /api/equipment-notebooks/[id]/work-packet/drawing-photos.
//
// Invariants (see route.ts header):
//   1. PARK + LINK happen before vision; every vision outcome still returns fileId + attachment.
//   2. A reply that doesn't parse is an honest 502, never a fake transcription.
//   3. The materialized doc is attached as matchState:"candidate" — never verified here.
//   4. A non-"drawing" kind is still kept as a source; the response names the kind.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/work-packet/drawing-photos"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/equipment-notebooks")>()),
  getNotebook: vi.fn(),
  attachSource: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({
  parkOrReuseFile: vi.fn(),
  attachFileToTargets: vi.fn(),
  sha256Hex: vi.fn(() => "photo-sha256"),
}));
vi.mock("@/lib/nameplate", () => ({ isRecognizerConfigured: vi.fn() }));
vi.mock("@/capabilities/openai-run-budget", () => ({ openAiVisionSelectable: vi.fn() }));
vi.mock("@/lib/nameplate/passes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/nameplate/passes")>();
  return { ...real, togetherVisionCall: vi.fn(), openAiVisionCall: vi.fn() };
});
vi.mock("@/capabilities/photo-source", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/photo-source")>()),
  materializeDerivedTextDoc: vi.fn(),
}));
vi.mock("@/app/api/equipment-notebooks/[id]/work-packet/route", () => ({ workPacketEnabled: vi.fn() }));

import { POST } from "@/app/api/equipment-notebooks/[id]/work-packet/drawing-photos/route";
import { workPacketEnabled } from "@/app/api/equipment-notebooks/[id]/work-packet/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, attachSource } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured } from "@/lib/nameplate";
import { openAiVisionSelectable } from "@/capabilities/openai-run-budget";
import { togetherVisionCall } from "@/lib/nameplate/passes";
import { materializeDerivedTextDoc } from "@/capabilities/photo-source";
import { PHOTO_A, PHOTO_EQUIPMENT } from "@/capabilities/work-packet/__tests__/fixtures/drawing-example";
import { renderDrawingSourceText } from "@/capabilities/work-packet/drawing";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const NODE_ID = "99999999-8888-7777-6666-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const DOC_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const TENANT_ID = "tenant-aaaa-bbbb";

const session = { userId: "u_1", tenantId: TENANT_ID, email: "x@y", status: "trial", trialExpiresAt: null };
const notebook = { id: NOTEBOOK_ID, displayName: "Line 3 Launch Connection", nodeId: NODE_ID } as never;

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeReq(opts: { name?: string; type?: string; content?: Uint8Array } = {}) {
  const fd = new FormData();
  const content = new Uint8Array(opts.content ?? JPEG_MAGIC);
  fd.append("image", new File([content.buffer], opts.name ?? "drawing.jpg", { type: opts.type ?? "image/jpeg" }));
  return new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/work-packet/drawing-photos`, {
    method: "POST",
    body: fd,
  }) as never;
}

function armVision(transcriptionJson: unknown, model = "vision-test") {
  vi.mocked(togetherVisionCall).mockResolvedValue({ text: JSON.stringify(transcriptionJson), model });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(workPacketEnabled).mockReturnValue(true);
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-1", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
  });
  vi.mocked(isRecognizerConfigured).mockReturnValue(true);
  vi.mocked(openAiVisionSelectable).mockReturnValue(false);
  vi.mocked(materializeDerivedTextDoc).mockResolvedValue({ docId: DOC_ID, chunkCount: 3 });
  vi.mocked(attachSource).mockResolvedValue({ ok: true, docId: DOC_ID });
});

describe("flag + auth + tenancy", () => {
  it("404s when NOTEBOOK_WORK_PACKET is off", async () => {
    vi.mocked(workPacketEnabled).mockReturnValue(false);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });

  it("propagates a 401", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
  });

  it("404s a foreign notebook without parking anything", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });

  it("404s a malformed notebook id without touching the database", async () => {
    const res = await POST(makeReq(), makeParams("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(getNotebook).not.toHaveBeenCalled();
  });
});

describe("input validation", () => {
  it("400s when no image field is present", async () => {
    const fd = new FormData();
    const req = new Request(`https://hub.test/x`, { method: "POST", body: fd }) as never;
    const res = await POST(req, makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("image_required");
  });

  it("415s text bytes named .jpg", async () => {
    const notAnImage = new TextEncoder().encode("not a real image");
    const res = await POST(makeReq({ type: "application/octet-stream", content: notAnImage }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(415);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });
});

describe("the photo survives every vision outcome (PARK BEFORE VISION)", () => {
  it("parks + links with role 'photo' BEFORE the 503 when no recognizer is configured", async () => {
    vi.mocked(isRecognizerConfigured).mockReturnValue(false);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "recognizer_not_configured", fileId: FILE_ID, docId: null });
    expect(attachFileToTargets).toHaveBeenCalledWith(
      TENANT_ID,
      FILE_ID,
      [expect.objectContaining({ targetType: "equipment_notebook", targetId: NOTEBOOK_ID, role: "photo" })],
      expect.anything(),
    );
    const parkOrder = vi.mocked(parkOrReuseFile).mock.invocationCallOrder[0];
    expect(parkOrder).toBeLessThan(vi.mocked(isRecognizerConfigured).mock.invocationCallOrder[0]);
    expect(togetherVisionCall).not.toHaveBeenCalled();
  });

  it("budget-exhausted vision call still returns fileId + attachment, photo kept", async () => {
    vi.mocked(togetherVisionCall).mockRejectedValue(new Error("recognizer_budget_exhausted"));
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({ reason: "provider_error", fileId: FILE_ID, docId: null, error: "recognizer_budget_exhausted" });
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("a provider error (non-budget) is also a 502 with the photo kept, credentials scrubbed", async () => {
    vi.mocked(togetherVisionCall).mockRejectedValue(new Error("recognizer_provider_error_404?key=abc"));
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.fileId).toBe(FILE_ID);
    expect(body.error).not.toContain("abc");
  });

  it("an unparseable vision reply is an honest 502, never a fake transcription", async () => {
    vi.mocked(togetherVisionCall).mockResolvedValue({ text: "not json at all", model: "m" });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.reason).toBe("provider_error");
    expect(body.docId).toBeNull();
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
  });

  it("a reply with an unknown kind value is also unparseable (honest 502)", async () => {
    armVision({ kind: "not_a_real_kind", drawing: null, otherText: [], unreadable: [] });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    expect(materializeDerivedTextDoc).not.toHaveBeenCalled();
  });
});

describe("a parsed drawing transcription is kept as an unconfirmed candidate source", () => {
  it("materializes the canonical LINE text and attaches it as matchState:candidate, sourceRole:drawing", async () => {
    armVision(PHOTO_A);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ fileId: FILE_ID, docId: DOC_ID, kind: "drawing", reviewed: false });
    expect(body.sourceText).toBe(renderDrawingSourceText(PHOTO_A));

    expect(materializeDerivedTextDoc).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, nodeId: NODE_ID, source: "drawing_text" }),
    );
    const materializedText = vi.mocked(materializeDerivedTextDoc).mock.calls[0][0].text;
    expect(materializedText).toContain(renderDrawingSourceText(PHOTO_A));

    expect(attachSource).toHaveBeenCalledWith(
      TENANT_ID,
      NOTEBOOK_ID,
      DOC_ID,
      expect.objectContaining({
        matchState: "candidate",
        sourceRole: "drawing",
        originFileId: FILE_ID,
        matchEvidence: { drawing_transcription: { reviewed: false } },
      }),
    );
  });
});

describe("a non-drawing kind is still kept as a photo source", () => {
  it("names the kind in the response and never marks it verified or auto-confirmed", async () => {
    armVision(PHOTO_EQUIPMENT);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.kind).toBe("equipment");
    expect(body.reviewed).toBe(false);
    expect(vi.mocked(attachSource).mock.calls[0][3]).toMatchObject({ matchState: "candidate" });
  });
});

describe("materialize/attach failure after a successful transcription", () => {
  it("503s when materialization is already in progress (race), without losing the photo", async () => {
    armVision(PHOTO_A);
    vi.mocked(materializeDerivedTextDoc).mockResolvedValue({ docId: null, chunkCount: 0 });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({ fileId: FILE_ID, docId: null });
    expect(attachSource).not.toHaveBeenCalled();
  });

  it("503s when attachSource fails, without losing the photo", async () => {
    armVision(PHOTO_A);
    vi.mocked(attachSource).mockResolvedValue({ ok: false, error: "doc_not_found" });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.fileId).toBe(FILE_ID);
  });
});

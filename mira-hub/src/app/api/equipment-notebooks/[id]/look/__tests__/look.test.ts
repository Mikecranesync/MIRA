// Vitest coverage for POST /api/equipment-notebooks/[id]/look (Sensor v0 · LOOK).
//
// Invariants (contract §4.1):
//   1. The photo is PARKED and LINKED (role "photo") before vision is attempted;
//      every provider outcome still returns fileId + attachment.
//   2. Observations only: no knowledge_entries write, no verified flag, no
//      notebook identity write. The route opens no citable-source door.
//   3. Bytes decide MIME; SVG never accepted; 8 MB cap; foreign notebook 404.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks/[id]/look"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  getNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  markNameplateDocVerified: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({
  parkOrReuseFile: vi.fn(),
  attachFileToTargets: vi.fn(),
}));
vi.mock("@/lib/nameplate", () => ({
  isRecognizerConfigured: vi.fn(),
  fixtureSelected: vi.fn(),
}));
vi.mock("@/lib/nameplate/detect", () => ({ resolveRecognitionImage: vi.fn() }));
vi.mock("@/lib/nameplate/passes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/nameplate/passes")>();
  return { ...real, togetherVisionCall: vi.fn() };
});
// The raw DB pool must never be touched by this route (no knowledge_entries write).
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));

import { POST, INSPECTION_PROMPT } from "../route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, updateNotebook, markNameplateDocVerified } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, fixtureSelected } from "@/lib/nameplate";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { togetherVisionCall } from "@/lib/nameplate/passes";
import pool from "@/lib/db";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const NODE_ID = "99999999-8888-7777-6666-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TENANT_ID = "tenant-aaaa-bbbb";

const session = { userId: "u_1", tenantId: TENANT_ID, email: "x@y", status: "trial", trialExpiresAt: null };
const notebook = {
  id: NOTEBOOK_ID,
  displayName: "Line 3 Case Packer",
  manufacturer: "Nobody Inc",
  model: "RIDE-1",
  nodeId: NODE_ID,
} as never;

const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeReq(
  opts: {
    field?: string;
    name?: string;
    type?: string;
    bytes?: number;
    content?: Uint8Array;
    question?: string;
    clientKey?: string;
  } = {},
) {
  const fd = new FormData();
  const size = opts.bytes ?? 16;
  const content = new Uint8Array(opts.content ?? new Uint8Array(size));
  fd.append(
    opts.field ?? "image",
    new File([content.buffer], opts.name ?? "connector.jpg", { type: opts.type ?? "image/jpeg" }),
  );
  if (opts.question) fd.append("question", opts.question);
  if (opts.clientKey) fd.append("clientKey", opts.clientKey);
  return new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/look`, {
    method: "POST",
    body: fd,
  }) as never;
}

function armVision(observation: string, model = "vision-test") {
  vi.mocked(togetherVisionCall).mockResolvedValue({ text: JSON.stringify({ observation }), model });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-1", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
  });
  vi.mocked(isRecognizerConfigured).mockReturnValue(true);
  vi.mocked(fixtureSelected).mockReturnValue(false);
  vi.mocked(resolveRecognitionImage).mockImplementation(async (base64, mimeType) => ({
    base64,
    mimeType,
    imageSource: { kind: "original_photo" as const },
  }));
});

describe("auth + tenancy", () => {
  it("propagates a 401", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
  });

  it("404s a foreign notebook without parking anything", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
    expect(parkOrReuseFile).not.toHaveBeenCalled();
    expect(togetherVisionCall).not.toHaveBeenCalled();
  });

  it("404s a malformed notebook id without touching the database", async () => {
    const res = await POST(makeReq(), makeParams("not-a-uuid"));
    expect(res.status).toBe(404);
    expect(getNotebook).not.toHaveBeenCalled();
  });
});

describe("input validation (bytes decide, 8 MB cap, SVG never)", () => {
  it("400s when no image field is present", async () => {
    const res = await POST(makeReq({ field: "photo" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("image_required");
  });

  it("415s text bytes named .jpg", async () => {
    const notAnImage = new TextEncoder().encode("#!/bin/sh\necho pwned");
    const res = await POST(
      makeReq({ type: "application/octet-stream", name: "connector.jpg", content: notAnImage }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("unsupported_image_type");
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });

  it("415s an SVG", async () => {
    const res = await POST(makeReq({ name: "x.svg", type: "image/svg+xml" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(415);
  });

  it("413s an image over 8 MB", async () => {
    const res = await POST(makeReq({ bytes: 8 * 1024 * 1024 + 1 }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(413);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });

  it("accepts a JPEG declared application/octet-stream and parks it under its TRUE mime", async () => {
    armVision("A grey terminal block with two seated spade connectors.");
    const res = await POST(
      makeReq({ type: "application/octet-stream", name: "IMG_0001", content: JPEG_MAGIC }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(200);
    expect(vi.mocked(parkOrReuseFile).mock.calls[0][0]).toMatchObject({ mimeType: "image/jpeg" });
  });
});

describe("the photo survives every vision outcome", () => {
  it("parks + links with role 'photo' BEFORE the 503 when no recognizer is configured", async () => {
    vi.mocked(isRecognizerConfigured).mockReturnValue(false);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      reason: "recognizer_not_configured",
      fileId: FILE_ID,
      attachment: { linkId: "link-1", notebookId: NOTEBOOK_ID },
      observation: null,
    });
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

  it("provider 502 still returns fileId + attachment, with credentials scrubbed", async () => {
    vi.mocked(togetherVisionCall).mockRejectedValue(new Error("recognizer_provider_error_404?key=abc"));
    const res = await POST(makeReq({ clientKey: "ck-1" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body).toMatchObject({
      reason: "provider_error",
      fileId: FILE_ID,
      attachment: { linkId: "link-1", notebookId: NOTEBOOK_ID },
      observation: null,
      clientKey: "ck-1",
    });
    expect(body.error).not.toContain("abc");
    const parkOrder = vi.mocked(parkOrReuseFile).mock.invocationCallOrder[0];
    expect(parkOrder).toBeLessThan(vi.mocked(togetherVisionCall).mock.invocationCallOrder[0]);
  });

  it("an empty provider reply is a 502, never an empty 'observation'", async () => {
    vi.mocked(togetherVisionCall).mockResolvedValue({ text: "{}", model: "m" });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    expect((await res.json()).fileId).toBe(FILE_ID);
  });
});

describe("dedup + linking", () => {
  it("re-posting identical bytes reuses the parked file (SHA dedup) and re-links idempotently — one fileId", async () => {
    armVision("Two green LEDs lit on the drive keypad.");
    const first = await (await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID))).json();
    vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: true, uploadId: null });
    const second = await (await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID))).json();
    expect(first.fileId).toBe(FILE_ID);
    expect(second.fileId).toBe(FILE_ID);
    // Park is keyed on the untouched upload buffer both times — same bytes in.
    const [a, b] = vi.mocked(parkOrReuseFile).mock.calls.map((c) => c[0].buffer);
    expect(a.equals(b)).toBe(true);
    // Every call links to THIS notebook, never a second target.
    for (const call of vi.mocked(attachFileToTargets).mock.calls) {
      expect(call[2]).toEqual([expect.objectContaining({ targetType: "equipment_notebook", targetId: NOTEBOOK_ID })]);
    }
  });

  it("parks the ORIGINAL bytes even when the detector crops for the vision pass", async () => {
    const CROP_B64 = Buffer.from("union-crop-jpeg").toString("base64");
    vi.mocked(resolveRecognitionImage).mockResolvedValue({
      base64: CROP_B64,
      mimeType: "image/jpeg",
      imageSource: { kind: "auto_detected_crop" as const, detector: {} as never },
    });
    armVision("Label reads 'X1'.");
    await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(vi.mocked(parkOrReuseFile).mock.calls[0][0].sizeBytes).toBe(16);
    expect(vi.mocked(togetherVisionCall).mock.calls[0][0].images[0].base64).toBe(CROP_B64);
  });
});

describe("observation contract (§4.1)", () => {
  it("returns observation {text, capturedAt (server ISO), provenance 'phone_photo'} + attachment", async () => {
    const before = Date.now();
    armVision("Terminal block X1: all four spade connectors seated. Green RUN LED lit.", "MiniMaxAI/MiniMax-M3");
    const res = await POST(makeReq({ clientKey: "ck-2" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      fileId: FILE_ID,
      attachment: { linkId: "link-1", notebookId: NOTEBOOK_ID },
      clientKey: "ck-2",
      observation: {
        text: "Terminal block X1: all four spade connectors seated. Green RUN LED lit.",
        provenance: "phone_photo",
        model: "MiniMaxAI/MiniMax-M3",
      },
    });
    const t = Date.parse(body.observation.capturedAt);
    expect(Number.isNaN(t)).toBe(false);
    expect(t).toBeGreaterThanOrEqual(before - 1000);
    expect(t).toBeLessThanOrEqual(Date.now() + 1000);
    expect(body.quality).toBeUndefined();
  });

  it("uses the fixed INSPECTION prompt (observations only) with the technician question appended", async () => {
    armVision("A relay with its coil LED unlit.");
    await POST(makeReq({ question: "Read these LEDs" }), makeParams(NOTEBOOK_ID));
    const args = vi.mocked(togetherVisionCall).mock.calls[0][0];
    expect(args.prompt.startsWith(INSPECTION_PROMPT)).toBe(true);
    expect(args.prompt).toContain('The technician asked: "Read these LEDs"');
    expect(INSPECTION_PROMPT).toMatch(/NEVER diagnose/);
    expect(INSPECTION_PROMPT).toMatch(/NEVER guess anything hidden/);
    expect(args.images).toHaveLength(1);
  });

  it("keeps a prose (non-JSON) provider reply verbatim rather than failing", async () => {
    vi.mocked(togetherVisionCall).mockResolvedValue({ text: "One black cable, connector seated.", model: "m" });
    const body = await (await POST(makeReq(), makeParams(NOTEBOOK_ID))).json();
    expect(body.observation.text).toBe("One black cable, connector seated.");
  });

  it("NAMEPLATE_RECOGNIZER=fixture answers deterministically without the provider", async () => {
    vi.mocked(fixtureSelected).mockReturnValue(true);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.observation.model).toBe("fixture");
    expect(body.observation.text).toContain("Fixture observation");
    expect(togetherVisionCall).not.toHaveBeenCalled();
  });
});

describe("observations are conversation context, not citable sources", () => {
  it("writes nothing to knowledge_entries, never marks verified, never touches notebook identity", async () => {
    armVision("Burn mark visible on the lower-left terminal.");
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(pool.query).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
    expect(markNameplateDocVerified).not.toHaveBeenCalled();
    expect(updateNotebook).not.toHaveBeenCalled();
  });
});

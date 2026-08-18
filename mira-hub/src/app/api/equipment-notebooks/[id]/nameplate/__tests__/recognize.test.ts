// Vitest coverage for POST /api/equipment-notebooks/[id]/nameplate/recognize.
//
// The two invariants under test:
//   1. The photo is PARKED and LINKED before recognition is attempted — a
//      provider outage must never cost the technician the picture.
//   2. Recognition NEVER writes an identity field on the notebook. The
//      nameplate belongs to a component inside the machine, not the machine.
//
// Run: cd mira-hub && npx vitest run "src/app/api/equipment-notebooks"

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/service-request-context", () => ({ requestContextOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({
  getNotebook: vi.fn(),
  updateNotebook: vi.fn(),
}));
vi.mock("@/lib/workspace-files", () => ({
  parkOrReuseFile: vi.fn(),
  attachFileToTargets: vi.fn(),
}));
vi.mock("@/lib/nameplate", () => ({
  isRecognizerConfigured: vi.fn(),
  defaultRecognizer: vi.fn(),
}));
vi.mock("@/lib/nameplate/detect", () => ({ resolveRecognitionImage: vi.fn() }));

import { POST } from "../recognize/route";
import { requestContextOr401 } from "@/lib/service-request-context";
import { getNotebook, updateNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, defaultRecognizer } from "@/lib/nameplate";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const NODE_ID = "99999999-8888-7777-6666-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TENANT_ID = "tenant-aaaa-bbbb";

const session = {
  userId: "u_1",
  tenantId: TENANT_ID,
  email: "x@y",
  status: "trial",
  trialExpiresAt: null,
};

const notebook = {
  id: NOTEBOOK_ID,
  displayName: "Line 3 Case Packer",
  manufacturer: "Nobody Inc",
  model: "RIDE-1",
  nodeId: NODE_ID,
} as never;

const makeParams = (id: string) => ({ params: Promise.resolve({ id }) });

function makeReq(opts: { field?: string; name?: string; type?: string; bytes?: number } = {}) {
  const fd = new FormData();
  const size = opts.bytes ?? 16;
  fd.append(
    opts.field ?? "image",
    new File([new Uint8Array(size)], opts.name ?? "plate.jpg", {
      type: opts.type ?? "image/jpeg",
    }),
  );
  return new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/nameplate/recognize`, {
    method: "POST",
    body: fd,
  }) as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requestContextOr401).mockResolvedValue({
    ...session,
    authKind: "session",
    sourceChannel: null,
  });
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-1", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
  });
  vi.mocked(isRecognizerConfigured).mockReturnValue(true);
  // Default: detector contributes nothing — the pre-detector behavior. Tests
  // that exercise the crop path override this per-case.
  vi.mocked(resolveRecognitionImage).mockImplementation(async (base64, mimeType) => ({
    base64,
    mimeType,
    imageSource: { kind: "original_photo" as const },
  }));
});

describe("auth + tenancy", () => {
  it("propagates a 401", async () => {
    vi.mocked(requestContextOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
  });

  it("accepts a canonical service context without changing tenant ownership checks", async () => {
    vi.mocked(requestContextOr401).mockResolvedValue({
      ...session,
      authKind: "service",
      sourceChannel: "telegram",
    });
    vi.mocked(isRecognizerConfigured).mockReturnValue(false);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(503);
    expect(getNotebook).toHaveBeenCalledWith(TENANT_ID, NOTEBOOK_ID);
    expect(parkOrReuseFile).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT_ID, createdBy: session.userId }),
    );
  });

  it("404s a notebook that belongs to another tenant, without parking anything", async () => {
    vi.mocked(getNotebook).mockResolvedValue(null);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "notebook_not_found" });
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
    const res = await POST(makeReq({ field: "photo" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("image_required");
  });

  it("415s a non-image upload", async () => {
    const res = await POST(
      makeReq({ name: "manual.pdf", type: "application/pdf" }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(415);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });

  it("415s an SVG — it is scriptable, not a camera photo", async () => {
    const res = await POST(
      makeReq({ name: "plate.svg", type: "image/svg+xml" }),
      makeParams(NOTEBOOK_ID),
    );
    expect(res.status).toBe(415);
  });

  it("413s an image over 8 MB", async () => {
    const res = await POST(makeReq({ bytes: 8 * 1024 * 1024 + 1 }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(413);
    expect(parkOrReuseFile).not.toHaveBeenCalled();
  });
});

describe("the photo survives every recognition outcome", () => {
  it("parks + links BEFORE the recognizer-not-configured 503", async () => {
    vi.mocked(isRecognizerConfigured).mockReturnValue(false);
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("recognizer_not_configured");
    expect(body.fileId).toBe(FILE_ID);
    expect(parkOrReuseFile).toHaveBeenCalledTimes(1);
    expect(attachFileToTargets).toHaveBeenCalledTimes(1);
    // Ordering proof, not just "both happened".
    const parkOrder = vi.mocked(parkOrReuseFile).mock.invocationCallOrder[0];
    const gateOrder = vi.mocked(isRecognizerConfigured).mock.invocationCallOrder[0];
    expect(parkOrder).toBeLessThan(gateOrder);
  });

  it("never presents a fabricated certification mark as observed", async () => {
    // Verbatim from the real Oriental Motor run: the plate carries UL/CE/UK CA
    // and NO RoHS, but the recognizer listed `RoHS` among the lines it claims to
    // have read — a hallucination that corroborates itself in rawText. The
    // response must not let a client render that as something seen on the plate.
    vi.mocked(defaultRecognizer).mockReturnValue({
      name: "together-vision",
      recognize: vi.fn().mockResolvedValue({
        manufacturer: "Orientalmotor",
        model: "DGM200R-AZAC",
        catalogNumber: null,
        equipmentType: "Rotary Actuator",
        confidence: 0.95,
        // The real plate prints "MODEL" above the model string — the anchor
        // the identity promotion gate requires (rawText order per real OCR).
        rawText: ["MODEL", "DGM200R-AZAC", "Orientalmotor", "12A", "UL", "CE", "RoHS"],
      }),
    });

    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();

    const marks = body.evidence.filter((f: { field: string }) => f.field === "certification");
    expect(marks.length).toBeGreaterThan(0);
    // No mark may be `observed` off a single vision pass.
    expect(marks.every((m: { status: string }) => m.status !== "observed")).toBe(true);
    expect(body.review.promotable).not.toContain("certification");

    // Identity still flows through untouched — the gate is targeted, not blunt.
    const model = body.evidence.find((f: { field: string }) => f.field === "model");
    expect(model.status).toBe("observed");
    expect(body.review.promotable).toContain("model");

    // The catalog number the recognizer missed is a candidate, never "read".
    const cat = body.evidence.find((f: { field: string }) => f.field === "catalogNumber");
    expect(cat.status).toBe("candidate");
    expect(cat.rawText).toBeNull();
  });

  it("parks + links BEFORE a provider failure, and still reports the fileId on 502", async () => {
    const recognize = vi.fn().mockRejectedValue(new Error("recognizer_provider_error_404?key=abc"));
    vi.mocked(defaultRecognizer).mockReturnValue({ name: "together-vision", recognize });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.fileId).toBe(FILE_ID);
    expect(body.attachment).toEqual({ linkId: "link-1", notebookId: NOTEBOOK_ID });
    // Credential scrub: the ?key= fragment never reaches the client.
    expect(body.error).not.toContain("abc");
    const parkOrder = vi.mocked(parkOrReuseFile).mock.invocationCallOrder[0];
    expect(parkOrder).toBeLessThan(recognize.mock.invocationCallOrder[0]);
  });
});

describe("success", () => {
  it("returns the candidate, raw observation, and the notebook attachment", async () => {
    const candidate = {
      manufacturer: "Allen-Bradley",
      model: "525",
      catalogNumber: "25B-D010N104",
      confidence: 0.82,
      rawText: ["ALLEN-BRADLEY", "POWERFLEX 525"],
    };
    vi.mocked(defaultRecognizer).mockReturnValue({
      name: "together-vision",
      recognize: vi.fn().mockResolvedValue(candidate),
    });

    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fileId).toBe(FILE_ID);
    expect(body.candidate).toMatchObject({ manufacturer: "Allen-Bradley", model: "525" });
    expect(body.confidence).toBe(0.82);
    expect(body.rawObservation).toMatchObject({
      provider: "together-vision",
      rawText: ["ALLEN-BRADLEY", "POWERFLEX 525"],
    });
    expect(body.attachment).toEqual({ linkId: "link-1", notebookId: NOTEBOOK_ID });
  });

  it("attaches the photo to the notebook with role 'photo'", async () => {
    vi.mocked(defaultRecognizer).mockReturnValue({
      name: "fixture",
      recognize: vi.fn().mockResolvedValue({ manufacturer: "X" }),
    });
    await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(attachFileToTargets).toHaveBeenCalledWith(
      TENANT_ID,
      FILE_ID,
      [expect.objectContaining({ targetType: "equipment_notebook", targetId: NOTEBOOK_ID, role: "photo" })],
      expect.anything(),
    );
  });

  it("NEVER writes an identity field on the parent notebook (component, not ride)", async () => {
    vi.mocked(defaultRecognizer).mockReturnValue({
      name: "fixture",
      recognize: vi.fn().mockResolvedValue({ manufacturer: "Allen-Bradley", model: "525" }),
    });
    await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(updateNotebook).not.toHaveBeenCalled();
  });
});

describe("detector crop wiring", () => {
  const CROP_B64 = Buffer.from("union-crop-jpeg").toString("base64");
  const DETECTOR = {
    model: "PP-OCRv5_mobile_det",
    regionCount: 13,
    cropBbox: { left: 241, top: 1144, width: 2173, height: 1334 },
    imageWidth: 3000,
    imageHeight: 4000,
    cropRotationDeg: 90,
    ms: 2310,
  };
  const CANDIDATE = {
    manufacturer: "Orientalmotor",
    model: "DGM200R-AZAC",
    catalogNumber: "AZM911AC-D",
    confidence: 0.95,
    rawText: ["MODEL DGM200R-AZAC", "Orientalmotor", "Motor P/N AZM911AC-D", "1.27A"],
  };

  function armCrop() {
    vi.mocked(resolveRecognitionImage).mockResolvedValue({
      base64: CROP_B64,
      mimeType: "image/jpeg",
      imageSource: { kind: "auto_detected_crop" as const, detector: DETECTOR },
    });
  }

  it("recognizer reads the CROP bytes and the response carries crop provenance", async () => {
    armCrop();
    const recognize = vi.fn().mockResolvedValue(CANDIDATE);
    vi.mocked(defaultRecognizer).mockReturnValue({ name: "together-vision", recognize });

    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(recognize).toHaveBeenCalledWith(CROP_B64, "image/jpeg");
    const body = await res.json();
    expect(body.rawObservation.imageSource).toEqual({ kind: "auto_detected_crop", detector: DETECTOR });
  });

  it("the ORIGINAL photo is parked as evidence even when the crop is read", async () => {
    armCrop();
    vi.mocked(defaultRecognizer).mockReturnValue({
      name: "together-vision",
      recognize: vi.fn().mockResolvedValue(CANDIDATE),
    });
    await POST(makeReq(), makeParams(NOTEBOOK_ID));
    // parkOrReuseFile received the untouched upload buffer (16 raw bytes from
    // makeReq), not the crop.
    const parked = vi.mocked(parkOrReuseFile).mock.calls[0][0];
    expect(parked.sizeBytes).toBe(16);
    expect(parked.buffer.equals(Buffer.from(CROP_B64, "base64"))).toBe(false);
  });

  it("detector failure falls back: recognizer reads the original, provenance says original_photo", async () => {
    // Default beforeEach mock IS the fallback contract (resolveRecognitionImage
    // never rejects; it resolves to the original on every failure).
    const recognize = vi.fn().mockResolvedValue(CANDIDATE);
    vi.mocked(defaultRecognizer).mockReturnValue({ name: "together-vision", recognize });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    const [b64, mimeArg] = recognize.mock.calls[0];
    expect(Buffer.from(b64, "base64").length).toBe(16); // the original upload
    expect(mimeArg).toBe("image/jpeg");
    expect((await res.json()).rawObservation.imageSource).toEqual({ kind: "original_photo" });
  });

  it("crop-recognition failure retries on the ORIGINAL and reports original_photo provenance", async () => {
    // internet-100: two dense plates whose CROP overflowed the provider while
    // the whole frame parsed fine. Detection may only ever ADD information —
    // a crop that breaks recognition must not cost the photo.
    armCrop();
    const recognize = vi
      .fn()
      .mockRejectedValueOnce(new SyntaxError("Unexpected EOF"))
      .mockResolvedValueOnce(CANDIDATE);
    vi.mocked(defaultRecognizer).mockReturnValue({ name: "together-vision", recognize });
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(recognize).toHaveBeenCalledTimes(2);
    // Second call read the original upload bytes, not the crop.
    expect(Buffer.from(recognize.mock.calls[1][0], "base64").length).toBe(16);
    expect((await res.json()).rawObservation.imageSource).toEqual({ kind: "original_photo" });
  });

  it("detection NEVER corroborates recognition — evidence is byte-identical crop vs original", async () => {
    // The crop and the reading are one observation chain, not two independent
    // sources. If wiring the detector in changed any fact's status, source, or
    // corroboration list, geometry would be acting as testimony.
    vi.mocked(defaultRecognizer).mockReturnValue({
      name: "together-vision",
      recognize: vi.fn().mockResolvedValue(CANDIDATE),
    });
    const originalRun = await (await POST(makeReq(), makeParams(NOTEBOOK_ID))).json();

    armCrop();
    const cropRun = await (await POST(makeReq(), makeParams(NOTEBOOK_ID))).json();

    expect(cropRun.evidence).toEqual(originalRun.evidence);
    expect(cropRun.review).toEqual(originalRun.review);
    for (const fact of cropRun.evidence) {
      expect(["image", "image_inferred"]).toContain(fact.source);
      expect(fact.corroboration).toEqual([]);
    }
  });
});

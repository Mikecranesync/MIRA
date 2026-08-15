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

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
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

import { POST } from "../recognize/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook, updateNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, defaultRecognizer } from "@/lib/nameplate";

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
  vi.mocked(sessionOr401).mockResolvedValue(session);
  vi.mocked(getNotebook).mockResolvedValue(notebook);
  vi.mocked(parkOrReuseFile).mockResolvedValue({ fileId: FILE_ID, reused: false, uploadId: null });
  vi.mocked(attachFileToTargets).mockResolvedValue({
    ok: true,
    links: [{ linkId: "link-1", targetType: "equipment_notebook", targetId: NOTEBOOK_ID }],
  });
  vi.mocked(isRecognizerConfigured).mockReturnValue(true);
});

describe("auth + tenancy", () => {
  it("propagates a 401", async () => {
    vi.mocked(sessionOr401).mockResolvedValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const res = await POST(makeReq(), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(401);
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

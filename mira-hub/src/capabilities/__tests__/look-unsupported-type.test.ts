// LOOK 415 names the rejected format (2026-10-12). Harness copied from
// src/app/api/equipment-notebooks/[id]/look/__tests__/look.test.ts — that folder is lifecycle-guarded.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/session", () => ({ sessionOr401: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/equipment-notebooks")>()),
  getNotebook: vi.fn(),
  updateNotebook: vi.fn(),
  markNameplateDocVerified: vi.fn(),
  recordTurn: vi.fn(async () => "turn-row-look-1"),
}));
vi.mock("@/lib/workspace-files", () => ({
  parkOrReuseFile: vi.fn(),
  attachFileToTargets: vi.fn(),
  sha256Hex: vi.fn(() => "photo-sha256"),
}));
vi.mock("@/lib/visual-evidence-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/visual-evidence-context")>();
  return {
    ...actual,
    recordLookObservation: vi.fn(async () => ({
      sessionId: "session-1",
      evidenceId: "evidence-1",
      observationId: "observation-1",
    })),
  };
});
vi.mock("@/lib/nameplate", () => ({
  isRecognizerConfigured: vi.fn(),
  fixtureSelected: vi.fn(),
}));
vi.mock("@/lib/nameplate/detect", () => ({ resolveRecognitionImage: vi.fn() }));
vi.mock("@/lib/nameplate/passes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/nameplate/passes")>();
  return { ...real, togetherVisionCall: vi.fn() };
});
// The raw DB pool must never be touched by this route for product data (no
// knowledge_entries write). The Turn Flight Recorder's ledger write is the one
// legitimate side effect and is mocked here so the suite stays hermetic.
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("@/lib/inference/persist-usage", () => ({
  persistTurnUsage: vi.fn(async () => ({ persisted: true, traceId: "00000000-0000-4000-8000-000000000000" })),
}));

import { POST } from "@/app/api/equipment-notebooks/[id]/look/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, fixtureSelected } from "@/lib/nameplate";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { togetherVisionCall } from "@/lib/nameplate/passes";

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
    threadId?: string;
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
  if (opts.threadId) fd.append("threadId", opts.threadId);
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


const HEIC = new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

describe("415 names the rejected format", () => {
  it("returns detected_type and logs declared + detected for a HEIC photo", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(makeReq({ content: HEIC, type: "image/heic", name: "IMG_0001.heic" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toBe("unsupported_image_type");
    expect(body.detected_type).toBe("heic");
    expect(warn).toHaveBeenCalledWith(
      "[notebook-look] unsupported image type",
      expect.objectContaining({ declared: "image/heic", detected: "heic", bytes: HEIC.length }),
    );
    warn.mockRestore();
  });

  it("says unknown for bytes that are no known image, and records the declared type as received", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(makeReq({ content: new Uint8Array(16).fill(7), type: "" }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(415);
    expect((await res.json()).detected_type).toBe("unknown");
    expect(warn).toHaveBeenCalledWith(
      "[notebook-look] unsupported image type",
      // An empty File type reaches the route as application/octet-stream through FormData.
      expect.objectContaining({ declared: "application/octet-stream", detected: "unknown" }),
    );
    warn.mockRestore();
  });

  it("control: a JPEG declared as octet-stream is still accepted", async () => {
    armVision("A grey enclosure.");
    const res = await POST(makeReq({ content: JPEG_MAGIC, type: "application/octet-stream" }), makeParams(NOTEBOOK_ID));
    expect(res.status).not.toBe(415);
  });
});

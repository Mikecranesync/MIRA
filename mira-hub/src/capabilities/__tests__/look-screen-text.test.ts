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
vi.mock("@/capabilities/screen-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/capabilities/screen-text")>()),
  attachScreenTextLines: vi.fn(async () => true),
}));

import { POST, INSPECTION_PROMPT } from "@/app/api/equipment-notebooks/[id]/look/route";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, fixtureSelected } from "@/lib/nameplate";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { togetherVisionCall } from "@/lib/nameplate/passes";
import { attachScreenTextLines } from "@/capabilities/screen-text";

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

function armVisionJson(payload: Record<string, unknown>, model = "vision-test") {
  vi.mocked(togetherVisionCall).mockResolvedValue({ text: JSON.stringify(payload), model });
}

describe("LOOK stores verbatim screen text", () => {
  it("stores the normalized lines on the evidence row recordLookObservation returned", async () => {
    armVisionJson({
      observation: "An HMI screen showing a red alarm list.",
      hazards: [],
      screen_text_lines: ["40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 3", " =y.CTL+07-K4.1 / =y.CTL+07-K4.1-2. ", ""],
    });
    const res = await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect(attachScreenTextLines).toHaveBeenCalledWith(TENANT_ID, "evidence-1", [
      "40 08:14:3… 03/02/2027 I Error: Wire break on Output channel 3",
      "=y.CTL+07-K4.1 / =y.CTL+07-K4.1-2.",
    ]);
    // The observation text is unchanged by the new field.
    expect((await res.json()).observation.text).toBe("An HMI screen showing a red alarm list.");
  });

  it("stores nothing when the photo shows no screen text", async () => {
    armVisionJson({ observation: "A motor.", hazards: [], screen_text_lines: [] });
    await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(attachScreenTextLines).not.toHaveBeenCalled();
  });

  it("a failed line write never fails the LOOK turn", async () => {
    vi.mocked(attachScreenTextLines).mockRejectedValueOnce(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    armVisionJson({ observation: "An HMI screen.", hazards: [], screen_text_lines: ["Error: x =y.CTL+07-K4.1-2."] });
    const res = await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(res.status).toBe(200);
    expect((await res.json()).observationPersisted).toBe(true);
    err.mockRestore();
  });

  it("asks for screen_text_lines, never completing cut-off text, with room for a full list", () => {
    expect(INSPECTION_PROMPT).toMatch(/"screen_text_lines": \[string\]/);
    expect(INSPECTION_PROMPT).toMatch(/never complete/i);
    expect(INSPECTION_PROMPT).toMatch(/NEVER diagnose/); // the observations-only contract is unchanged
  });

  it("gives the vision call room for a full alarm list", async () => {
    armVisionJson({ observation: "An HMI screen.", hazards: [], screen_text_lines: [] });
    await POST(makeReq({ content: JPEG_MAGIC }), makeParams(NOTEBOOK_ID));
    expect(vi.mocked(togetherVisionCall).mock.calls[0][0].maxTokens).toBe(1600);
  });
});

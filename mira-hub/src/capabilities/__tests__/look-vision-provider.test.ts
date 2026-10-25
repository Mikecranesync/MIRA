// The look route picks OpenAI vision when OPENAI_API_KEY is set (D8, 2026-10-11).
//
// Sibling of src/app/api/equipment-notebooks/[id]/look/__tests__/look.test.ts,
// which is a guarded legacy path; this file lives in the unguarded capabilities
// test home and mocks the same collaborators so the route runs hermetically.
// Two cases: the pick with the key set, and the negative control without it
// (Together serves, exactly as before this change).
//
// Run: cd mira-hub && npx vitest run src/capabilities/__tests__/look-vision-provider

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("@/lib/nameplate", async (importOriginal) => ({
  // The real pick policy (`openAiVisionSelectable`) runs; only these two are stubbed.
  ...(await importOriginal<typeof import("@/lib/nameplate")>()),
  isRecognizerConfigured: vi.fn(),
  fixtureSelected: vi.fn(),
}));
vi.mock("@/lib/nameplate/detect", () => ({ resolveRecognitionImage: vi.fn() }));
vi.mock("@/lib/nameplate/passes", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/nameplate/passes")>();
  return { ...real, togetherVisionCall: vi.fn(), openAiVisionCall: vi.fn() };
});
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
import { togetherVisionCall, openAiVisionCall } from "@/lib/nameplate/passes";
import { persistTurnUsage } from "@/lib/inference/persist-usage";

/** The provider the route persisted for the LOOK turn (usage is the 2nd arg). */
function persistedProvider(): string | null | undefined {
  const call = vi.mocked(persistTurnUsage).mock.calls.at(-1);
  return (call?.[1] as { provider?: string | null } | undefined)?.provider;
}

const NOTEBOOK_ID = "11111111-2222-3333-4444-555555555555";
const FILE_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TENANT_ID = "tenant-aaaa-bbbb";
const JPEG_MAGIC = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

const session = { userId: "u_1", tenantId: TENANT_ID, email: "x@y", status: "trial", trialExpiresAt: null };
const notebook = {
  id: NOTEBOOK_ID,
  displayName: "Line 3 Case Packer",
  manufacturer: "Nobody Inc",
  model: "RIDE-1",
  nodeId: "99999999-8888-7777-6666-555555555555",
} as never;

function makeReq() {
  const fd = new FormData();
  fd.append("image", new File([JPEG_MAGIC.buffer], "connector.jpg", { type: "image/jpeg" }));
  return new Request(`https://hub.test/api/equipment-notebooks/${NOTEBOOK_ID}/look`, {
    method: "POST",
    body: fd,
  }) as never;
}
const params = { params: Promise.resolve({ id: NOTEBOOK_ID }) };

const savedKey = process.env.OPENAI_API_KEY;
const savedModel = process.env.OPENAI_MODEL;
beforeEach(() => {
  delete process.env.OPENAI_MODEL; // the verified default (gpt-5.4-mini) unless a test sets one
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
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
  if (savedModel === undefined) delete process.env.OPENAI_MODEL;
  else process.env.OPENAI_MODEL = savedModel;
});

describe("look route vision provider pick", () => {
  it("uses the OpenAI vision call when OPENAI_API_KEY is set, never Together", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.mocked(openAiVisionCall).mockResolvedValue({
      text: JSON.stringify({ observation: "One enclosure, green indicator lit." }),
      model: "gpt-5.4-mini",
    });

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(200);
    expect(openAiVisionCall).toHaveBeenCalledTimes(1);
    expect(togetherVisionCall).not.toHaveBeenCalled();
    expect((await res.json()).observation.text).toContain("One enclosure");
    // Codex F1 on #4353: the turn served by OpenAI must be RECORDED as OpenAI.
    expect(persistTurnUsage).toHaveBeenCalledTimes(1);
    expect(persistedProvider()).toBe("openai");
  });

  it("records OpenAI as the provider on the FAILURE path too (Codex F1)", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    vi.mocked(openAiVisionCall).mockRejectedValue(new Error("recognizer_provider_error_500"));

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("recognizer_provider_error_500");
    expect(persistTurnUsage).toHaveBeenCalledTimes(1);
    expect(persistedProvider()).toBe("openai");
  });

  it("control: without OPENAI_API_KEY the Together call serves, exactly as before", async () => {
    delete process.env.OPENAI_API_KEY;
    vi.mocked(togetherVisionCall).mockResolvedValue({
      text: JSON.stringify({ observation: "Together observation." }),
      model: "vision-test",
    });

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(200);
    expect(togetherVisionCall).toHaveBeenCalledTimes(1);
    expect(openAiVisionCall).not.toHaveBeenCalled();
    expect(persistedProvider()).toBe("together");
  });

  it("Codex r4 F10 on #4355: with BOTH keys but an OpenAI model that has no verified image bound, Together serves and OpenAI is never called", async () => {
    process.env.OPENAI_API_KEY = "sk-test";
    process.env.OPENAI_MODEL = "gpt-5.6-sol";
    vi.mocked(togetherVisionCall).mockResolvedValue({
      text: JSON.stringify({ observation: "Together observation on an unverified OpenAI model." }),
      model: "vision-test",
    });

    const res = await POST(makeReq(), params);

    expect(res.status).toBe(200);
    expect(togetherVisionCall).toHaveBeenCalledTimes(1);
    expect(openAiVisionCall).not.toHaveBeenCalled();
    expect((await res.json()).observation.text).toContain("unverified OpenAI model");
    expect(persistedProvider()).toBe("together");
  });
});

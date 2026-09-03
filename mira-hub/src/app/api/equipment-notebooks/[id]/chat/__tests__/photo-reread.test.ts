/**
 * PHOTO RE-READ on the notebook chat route (NOTEBOOK_PHOTO_REREAD_ENABLED).
 *
 * Run: npx vitest run photo-reread
 *
 * WHAT THIS FEATURE IS. `photo-source-honesty.ts` (PR #3557) stopped MIRA
 * DENYING an attached photograph — but its ceiling is an honest decline. The
 * technician's request is reasonable: the picture is in the Sources sheet with
 * a thumbnail, and one of them is a wired control panel. This makes "read the
 * wire numbers off this photo" actually work, by re-reading the SAME stored
 * photograph at answer time with the technician's ACTUAL question, instead of
 * relying on a nameplate-shaped extraction taken months earlier.
 *
 * THE TRIGGER IS `body.photoRead.docId` AND NOTHING ELSE. The client points at
 * one attached photograph; the server reads that one. There is no phrasing
 * heuristic to be over- or under-triggered, which is why §11 can assert exact
 * call counts for eleven natural document questions and six picture-shaped ones
 * without a single string in either list mattering.
 *
 * THE FIVE PROPERTIES THIS FILE PROVES, in order of how much they matter:
 *
 *   §1 MERGE SAFETY  With the flag off, the turn is byte-identical to the
 *      #3557 baseline: no vision call, no frame, no extra field, and — proved
 *      by string equality against the flag-on failure path — the same system
 *      prompt and the same user content, character for character. Every §1 turn
 *      carries a VALID pointer, so the flag is what is under test.
 *   §2 TENANT SAFETY A photo that is not authorized for THIS notebook in THIS
 *      tenant is never fetched and never sent. Driven with a hostile id.
 *   §3 THE TRIGGER   No pointer, no read — and a pointer is honoured only
 *      inside this turn's revalidated photo sources.
 *   §4 FAILURE       Provider error / timeout degrades to the honest decline.
 *      Never a fabrication, never a claim of sight.
 *   §5 CITATION      A vision-derived claim is attributable AND distinguishable
 *      from a manual-derived one.
 *
 * Plus §6, the reason this design won: a zero-retrieval turn that DID read the
 * photo no longer abstains at Gate G.
 *
 * Harness: forked from photo-derived-sources.test.ts (seam off, so the raw
 * provider body carries `messages`). The provider is always mocked — this file
 * never makes a paid call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_PDF = "33333333-3333-4333-8333-333333333333";
const DOC_PHOTO = "44444444-4444-4444-8444-444444444444";
const PHOTO_FILE_ID = "f0000000-0000-4000-8000-000000000001";
/** A file id from another tenant's world. It must never be fetched. */
const HOSTILE_DOC = "deadbeef-dead-4ead-8ead-deadbeefdead";

const PDF_NAME = "RCMS460-490_D00067_Q_DEEN.pdf";
const PHOTO_NAME = "nameplate-1118ca97.txt";

/** The verbatim production question that produced the original defect. */
const QUESTION = "Can you read the wire numbers from the photo that's attached?";
/** An ordinary question the manual answers. */
const ORDINARY = "What is the torque spec for the coupling?";
/** The client pointing at the attached photograph — the whole trigger. */
const POINT = { docId: DOC_PHOTO };

vi.mock("@/lib/session", () => ({
  sessionOr401: vi.fn(async () => ({ tenantId: TENANT, userId: "u1" })),
}));

type SrcRow = {
  docId: string;
  filename: string | null;
  status: string | null;
  sourceRole: string | null;
  originFileId: string | null;
  fileId: string | null;
  pages: number | null;
};
const PDF_ROW: SrcRow = {
  docId: DOC_PDF,
  filename: PDF_NAME,
  status: "ready",
  sourceRole: "manual",
  originFileId: null,
  fileId: null,
  pages: 40,
};
const PHOTO_ROW: SrcRow = {
  docId: DOC_PHOTO,
  filename: PHOTO_NAME,
  status: "ready",
  sourceRole: "photo",
  originFileId: PHOTO_FILE_ID,
  fileId: "d0000000-0000-4000-8000-00000000000a",
  pages: null,
};

const nbMock = vi.hoisted(() => ({
  validateChatSources: vi.fn(),
  getNotebook: vi.fn(),
  resolveBoundAsset: vi.fn(async () => ({ state: "unbound" as const })),
  recordTurn: vi.fn(async () => undefined),
  listSources: vi.fn(async () => [] as unknown[]),
  originFileIdsByDoc: vi.fn(async () => new Map<string, string>()),
}));
vi.mock("@/lib/equipment-notebooks", () => nbMock);

const ragMock = vi.hoisted(() => ({
  retrieveNodeChunks: vi.fn(async () => [] as unknown[]),
  appendManualContext: vi.fn((p: string) => `${p}\n[MANUAL RULES]`),
  // NOT identity: the excerpts must be visible in the user content, otherwise
  // the byte-identical assertions in §1 would pass vacuously when a
  // transcription chunk is appended.
  buildManualUserContent: vi.fn((q: string, chunks: unknown[]) => `${q}\n${JSON.stringify(chunks)}`),
  neutralizeReferenceText: vi.fn((t: string) => t),
}));
vi.mock("@/lib/manual-rag", () => ragMock);

type Handler = [RegExp, { rows: unknown[] }];
const dbMock = vi.hoisted(() => ({ handlers: [] as Handler[] }));
vi.mock("@/lib/tenant-context", () => ({
  withTenantContext: vi.fn(async (_t: string, fn: (c: unknown) => unknown) =>
    fn({
      query: async (sql: string) => {
        for (const [re, res] of dbMock.handlers) if (re.test(sql)) return res;
        return { rows: [] };
      },
    }),
  ),
}));
vi.mock("@/lib/db", () => ({ default: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock("@/lib/inference/persist-usage", () => ({
  persistTurnUsage: vi.fn(async () => undefined),
}));

const seamMock = vi.hoisted(() => ({
  canonicalSeamEnabled: vi.fn(() => false),
  canonicalProviders: vi.fn(() => []),
  buildRequestBody: vi.fn(() => ({})),
  maxOutputTokens: vi.fn(() => 1000),
  routeReasonFor: vi.fn(() => "ok"),
  exhaustedUsage: vi.fn(() => ({ status: "error" })),
  usageFrame: vi.fn(() => ({ kind: "usage" })),
  usageFromRaw: vi.fn(() => ({ status: "ok" })),
  logTurnUsage: vi.fn(),
  DEFAULT_MAX_OUTPUT_TOKENS: 4000,
}));
vi.mock("@/lib/inference/canonical-cascade", () => seamMock);

/** THE VISION PROVIDER. Always a spy — never a paid call. */
const visionMock = vi.hoisted(() => ({ togetherVisionCall: vi.fn() }));
vi.mock("@/lib/nameplate/passes", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/nameplate/passes")>();
  return { ...actual, togetherVisionCall: visionMock.togetherVisionCall };
});

/** The authorization + byte door. Mocked so a hostile id can be driven through
 *  the REAL route and its refusal observed. */
const bytesMock = vi.hoisted(() => ({ readLinkedPhotoBytes: vi.fn() }));
vi.mock("@/lib/notebook-photo-bytes", () => bytesMock);

import { POST } from "../route";

const PHOTO_BUFFER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x11, 0x22, 0x33]);
const AUTHORIZED_BYTES = {
  fileId: PHOTO_FILE_ID,
  buffer: PHOTO_BUFFER,
  mimeType: "image/jpeg",
  filename: "panel.jpg",
  capturedAt: "2026-09-01T12:00:00.000Z",
};

function providerStream(...parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) {
      for (const p of parts) {
        c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`));
      }
      c.enqueue(enc.encode("data: [DONE]\n\n"));
      c.close();
    },
  });
}
function stubProvider(...parts: string[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(providerStream(...parts), { status: 200 })),
  );
}
function req(body: unknown) {
  return new NextRequest("http://test/api/equipment-notebooks/x/chat", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}
const params = { params: Promise.resolve({ id: NB }) };

async function frames(res: Response): Promise<Record<string, unknown>[]> {
  const raw = await res.text();
  const out: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const p = line.slice(6);
    if (p === "[DONE]") continue;
    try {
      out.push(JSON.parse(p));
    } catch {
      /* partial */
    }
  }
  return out;
}
function sentMessages(): { role: string; content: string }[] {
  const call = vi.mocked(fetch).mock.calls[0];
  return JSON.parse(String((call[1] as RequestInit).body)).messages;
}
function sentSystemPrompt(): string {
  return sentMessages()[0].content;
}
function sentUserContent(): string {
  const m = sentMessages();
  return m[m.length - 1].content;
}
function citationsOf(fs: Record<string, unknown>[]): Record<string, unknown>[] {
  return (fs.find((f) => f.kind === "sources")?.citations as Record<string, unknown>[]) ?? [];
}
function statusOf(fs: Record<string, unknown>[]): Record<string, unknown> | undefined {
  return fs.find((f) => f.kind === "status");
}
function photoReadFrames(fs: Record<string, unknown>[]): Record<string, unknown>[] {
  return fs.filter((f) => f.kind === "photo_read");
}

const CHUNK = {
  docId: DOC_PDF,
  title: "RCMS460 manual",
  manufacturer: "Bender",
  modelNumber: "RCMS460",
  sourceUrl: "https://oem/rcms460.pdf",
  sourcePage: 12,
  content: "Terminal assignments are listed in section 4.",
  rank: 1,
};

function photoInScope() {
  nbMock.listSources.mockResolvedValue([PDF_ROW, PHOTO_ROW]);
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PDF, DOC_PHOTO], nodeId: "n1" });
}
function noPhoto() {
  nbMock.listSources.mockResolvedValue([PDF_ROW]);
  nbMock.validateChatSources.mockResolvedValue({ ok: true, docIds: [DOC_PDF], nodeId: "n1" });
}
const ALL_DOCS = [DOC_PDF, DOC_PHOTO];

/** A successful transcription from the vision provider. */
function visionReads(observation: string, found = true) {
  visionMock.togetherVisionCall.mockResolvedValue({
    text: JSON.stringify({ observation, found }),
    model: "MiniMaxAI/MiniMax-M3",
    usage: { prompt_tokens: 2411, completion_tokens: 480 },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.handlers = [];
  process.env.NEON_DATABASE_URL = "postgres://test";
  process.env.GROQ_API_KEY = "k";
  delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
  delete process.env.MIRA_ENFORCE_APPROVED_RETRIEVAL;
  delete process.env.MIRA_ENFORCE_APPROVED_ASK;
  delete process.env.NAMEPLATE_RECOGNIZER;
  nbMock.getNotebook.mockResolvedValue({
    id: NB,
    displayName: "Conveyor 1",
    manufacturer: "Automation Direct",
    model: "GS10",
  });
  nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
  nbMock.originFileIdsByDoc.mockResolvedValue(new Map([[DOC_PHOTO, PHOTO_FILE_ID]]));
  ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
  bytesMock.readLinkedPhotoBytes.mockResolvedValue(AUTHORIZED_BYTES);
  visionReads('Terminal block reads "X1-14", "X1-15", "X1-16".');
  stubProvider("Answer.");
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 MERGE SAFETY — the property that lets this land without touching prod.
//
// Every turn here carries a VALID pointer. That is deliberate: without it these
// tests would pass because nothing was pointed at, and would keep passing if
// the flag check itself were deleted.
// ─────────────────────────────────────────────────────────────────────────────
describe("1. FLAG OFF is byte-identical to the #3557 baseline", () => {
  it("no vision call, no bytes read, no photo_read frame — even with the pointer set", async () => {
    photoInScope();
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("the #3557 honesty directive is STILL there — this feature does not replace it", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    const p = sentSystemPrompt();
    expect(p).toContain("ATTACHED PICTURES:");
    expect(p).toContain("NEVER say that no photo was provided");
    expect(p).not.toContain("PHOTO RE-READ");
  });

  it("no citation carries a `provenance` field", async () => {
    photoInScope();
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    const cites = citationsOf(fs);
    expect(cites.length).toBeGreaterThan(0);
    for (const c of cites) expect(c).not.toHaveProperty("provenance");
  });

  it("an ordinary grounded answer streams and cites exactly as before", async () => {
    photoInScope();
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(statusOf(fs)).toMatchObject({ status: "answered" });
    expect(citationsOf(fs)).toHaveLength(1);
  });

  it("an unknown / malformed photoRead is never a 4xx, with the flag off or on", async () => {
    photoInScope();
    for (const bad of [{}, { docId: 5 }, { docId: "   " }, null]) {
      const res = await POST(
        req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: bad }),
        params,
      );
      expect(res.status).toBe(200);
    }
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §4 FAILURE — and, because the flag-off prompt is the target, §1's hard proof.
// ─────────────────────────────────────────────────────────────────────────────
describe("2. a failed vision call degrades EXACTLY to the flag-off turn", () => {
  async function promptFor(flag: boolean, fail: boolean) {
    vi.clearAllMocks();
    nbMock.getNotebook.mockResolvedValue({
      id: NB,
      displayName: "Conveyor 1",
      manufacturer: "Automation Direct",
      model: "GS10",
    });
    nbMock.resolveBoundAsset.mockResolvedValue({ state: "unbound" });
    nbMock.originFileIdsByDoc.mockResolvedValue(new Map([[DOC_PHOTO, PHOTO_FILE_ID]]));
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    bytesMock.readLinkedPhotoBytes.mockResolvedValue(AUTHORIZED_BYTES);
    if (fail) visionMock.togetherVisionCall.mockRejectedValue(new Error("recognizer_provider_error_503"));
    else visionReads("x");
    if (flag) process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    else delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
    photoInScope();
    stubProvider("Answer.");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    return { system: sentSystemPrompt(), user: sentUserContent(), frames: fs };
  }

  it("system prompt AND user content are string-equal — no fabrication, no sight claim", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const off = await promptFor(false, false);
    const failed = await promptFor(true, true);
    // THE merge-safety + honest-failure property, in one assertion: a turn whose
    // vision call died gets the identical prompt a flag-off turn gets, so the
    // model has been told nothing extra and cannot claim to have seen anything.
    expect(failed.system).toBe(off.system);
    expect(failed.user).toBe(off.user);
    expect(failed.system).not.toContain("PHOTO RE-READ");
    warn.mockRestore();
  });

  it("the turn still streams, and reports the failure as 'unavailable' — never as sight", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const failed = await promptFor(true, true);
    expect(statusOf(failed.frames)).toMatchObject({ status: "answered" });
    expect(photoReadFrames(failed.frames)[0]).toMatchObject({ kind: "photo_read", state: "unavailable" });
    warn.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 TENANT SAFETY.
// ─────────────────────────────────────────────────────────────────────────────
describe("3. tenant safety — an unauthorized photo is never fetched or sent", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("a hostile explicit docId that is not an in-scope source reads NOTHING", async () => {
    photoInScope();
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: { docId: HOSTILE_DOC } }), params),
    );
    // The explicit id is intersected with THIS turn's revalidated photo
    // sources, so it selects nothing — and is never widened to "read whatever
    // else is attached". With the heuristic gone this is also the ONLY door,
    // so a rejected pointer is a rejected turn: zero byte reads, zero calls.
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("pointing at the MANUAL source (not a photo) reads nothing either", async () => {
    photoInScope();
    await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: { docId: DOC_PDF } }), params),
    );
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });

  it("when the authorization door refuses, no bytes reach the provider and no citation appears", async () => {
    // This is what readLinkedPhotoBytes returns for a foreign tenant, a file
    // linked to another notebook, a non-photo role, or mislabelled bytes.
    bytesMock.readLinkedPhotoBytes.mockResolvedValue(null);
    photoInScope();
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    for (const c of citationsOf(fs)) expect(c).not.toHaveProperty("provenance");
    expect(photoReadFrames(fs)[0]).toMatchObject({ state: "unavailable" });
  });

  it("the door is asked for the PHOTOGRAPH (originFileId), scoped to THIS notebook", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    expect(bytesMock.readLinkedPhotoBytes).toHaveBeenCalledWith(
      TENANT,
      PHOTO_FILE_ID, // the picture, not the extracted .txt's own file id
      "equipment_notebook",
      NB,
      expect.any(Number),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 THE TRIGGER.
// ─────────────────────────────────────────────────────────────────────────────
describe("4. the trigger — no pointer, no read", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("an ordinary question with NO pointer costs nothing", async () => {
    photoInScope();
    const fs = await frames(await POST(req({ message: ORDINARY, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("the verbatim defect question with NO pointer also costs nothing — the deliberate change", async () => {
    photoInScope();
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("a pointer with NO photo in scope costs nothing", async () => {
    noPhoto();
    await frames(
      await POST(req({ message: QUESTION, sourceDocIds: [DOC_PDF], photoRead: POINT }), params),
    );
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });

  it("general mode never re-reads (no source scope to authorize against)", async () => {
    photoInScope();
    await frames(
      await POST(
        req({ message: QUESTION, sourceDocIds: ALL_DOCS, mode: "general", photoRead: POINT }),
        params,
      ),
    );
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });

  it("a question ABOUT the file (NOT_A_READ) buys nothing even with a pointer", async () => {
    photoInScope();
    for (const q of ["did my photo upload ok?", "delete that picture please"]) {
      await frames(await POST(req({ message: q, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    }
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });

  it("a stored extraction that already mentions the target does NOT veto the tap", async () => {
    photoInScope();
    // The deleted coverage probe suppressed exactly this shape: a photo-derived
    // chunk containing "wire numbers"/"terminal" cancelled the vision call and
    // returned the same non-answer that made the technician tap the picture.
    // The tap is the instruction; a substring match does not get to overrule it.
    ragMock.retrieveNodeChunks.mockResolvedValue([
      CHUNK,
      {
        ...CHUNK,
        docId: DOC_PHOTO,
        sourceUrl: "u2",
        content: "RAW NAMEPLATE OBSERVATION: wire numbers 14, 15, 16 on the terminal strip.",
      },
    ]);
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(visionMock.togetherVisionCall).toHaveBeenCalledTimes(1);
    expect(photoReadFrames(fs)[0]).toMatchObject({ state: "read", found: true });
  });

  it("a pointed-at photograph calls the provider EXACTLY ONCE, with the original bytes and a timeout", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    expect(visionMock.togetherVisionCall).toHaveBeenCalledTimes(1);
    const args = visionMock.togetherVisionCall.mock.calls[0][0];
    // Uncropped: resolveRecognitionImage crops to the NAMEPLATE region, which
    // would silently discard the panel region the question was about.
    expect(args.images[0].base64).toBe(PHOTO_BUFFER.toString("base64"));
    expect(args.timeoutMs).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// §5 CITATION + §6 THE GATE-G RESCUE.
// ─────────────────────────────────────────────────────────────────────────────
describe("5. a transcription is served as attributable, distinguishable evidence", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    photoInScope();
  });

  it("the transcription reaches the model as its own numbered excerpt", async () => {
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    const user = sentUserContent();
    expect(user).toContain("photo-reread://");
    expect(user).toContain("read directly from the attached photograph");
    expect(user).toContain("X1-14");
  });

  it("its citation carries provenance:'live_photo_read' AND the PHOTOGRAPH's originFileId", async () => {
    stubProvider("The wire numbers are X1-14, X1-15 and X1-16 [2].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    const cite = citationsOf(fs).find((c) => c.provenance === "live_photo_read");
    expect(cite).toBeDefined();
    // Distinguishable from a manual citation by a durable FIELD, not by a
    // regex over human-facing copy.
    expect(cite!.sourceTitle).toContain("read on request");
    // Attributable: the chip opens the picture the value was read off.
    expect(cite!.originFileId).toBe(PHOTO_FILE_ID);
  });

  it("a manual citation on the same turn does NOT carry the marker", async () => {
    stubProvider("Section 4 covers terminals [1]; the photo shows X1-14 [2].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    const manual = citationsOf(fs).find((c) => c.docId === DOC_PDF);
    expect(manual).toBeDefined();
    expect(manual).not.toHaveProperty("provenance");
  });

  it("the honesty directive REMAINS armed on a successful read", async () => {
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    // The image is still never in the chat model's context, so the floor
    // bullet must still forbid inventing what a picture looks like.
    expect(sentSystemPrompt()).toContain("ATTACHED PICTURES:");
    expect(sentSystemPrompt()).toContain(
      "Never describe, summarize, or infer what a picture looks like",
    );
  });

  it("emits one photo.reread observation line carrying usage and latency", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    const lines = spy.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('"event":"photo.reread"'));
    expect(lines).toHaveLength(1);
    const o = JSON.parse(lines[0]);
    expect(o.triggered).toBe(true);
    expect(o.promptTokens).toBe(2411);
    expect(o.completionTokens).toBe(480);
    expect(o.imageBytes).toBe(PHOTO_BUFFER.length);
    spy.mockRestore();
  });
});

describe("6. found:false — a better refusal, never a guess", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    photoInScope();
    visionReads("The terminal strip is out of focus; no wire numbers are legible.", false);
  });

  it("no transcription chunk is created, and the prompt says the picture WAS re-read", async () => {
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    expect(sentUserContent()).not.toContain("photo-reread://");
    const p = sentSystemPrompt();
    expect(p).toContain("PHOTO RE-READ");
    expect(p).toContain("could NOT read the requested detail");
    expect(p).toContain("Never say no photograph was provided");
  });

  it("with NOTHING retrieved, Gate G says the picture was re-read, not 'not in the sources'", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      // NAMES the file it read (see §8). The pointer means it is now always the
      // file the client named — and the sentence must still say WHICH, so the
      // technician can see whether it is the picture they meant.
      message: `I re-read the attached photograph "${PHOTO_NAME}" and that detail isn't legible in it.`,
    });
  });
});

describe("7. THE RESCUE — a zero-retrieval turn that DID read the photo answers", () => {
  it("Gate G does not abstain when the transcription is the only evidence", async () => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    photoInScope();
    // The real production shape: a wire-number question retrieves nothing from
    // a nameplate-shaped extraction, so before this feature the turn abstained
    // without ever looking at the picture sitting right there.
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    stubProvider("The wire numbers read X1-14, X1-15 and X1-16 [1].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(statusOf(fs)).toMatchObject({ status: "answered" });
    expect(citationsOf(fs)[0]).toMatchObject({ provenance: "live_photo_read" });
  });

  it("with the flag OFF the same turn still abstains, exactly as it does today", async () => {
    delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
    photoInScope();
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      message: "I couldn't find that in the selected sources.",
    });
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. DEFECT 1 — the Gate-G sentence must be true about the picture the SERVER
//    actually read.
//
//    The original repro was a GUESS: two camera-default photographs in scope,
//    neither filename overlapping the question, so the recency tie-break read
//    the rating plate while the sentence claimed "the attached photograph" —
//    false about which picture was read and about the one asked for. Selection
//    no longer guesses, so the repro is retargeted at what replaced it: the
//    server reads the pointed-at file, and the sentence names THAT file. The
//    wrong-picture failure is now unreachable by construction, and these two
//    tests are what prove it: two pointers, two different files read.
// ─────────────────────────────────────────────────────────────────────────────
const PANEL_DOC = "55555555-5555-4555-8555-555555555555";
const PLATE_DOC = "66666666-6666-4666-8666-666666666666";
const PANEL_FILE = "f0000000-0000-4000-8000-0000000000aa";
const PLATE_FILE = "f0000000-0000-4000-8000-0000000000bb";
/** Camera defaults: nothing in either name overlaps a wire-number question. */
const PANEL_NAME = "IMG_20260901_101122.jpg";
const PLATE_NAME = "IMG_20260901_143355.jpg";
/** listSources is created_at ASC, so the plate is the MOST RECENT row — which
 *  used to decide the read, and now decides nothing. */
const PANEL_ROW: SrcRow = {
  docId: PANEL_DOC,
  filename: PANEL_NAME,
  status: "ready",
  sourceRole: "photo",
  originFileId: null,
  fileId: PANEL_FILE,
  pages: null,
};
const PLATE_ROW: SrcRow = {
  docId: PLATE_DOC,
  filename: PLATE_NAME,
  status: "ready",
  sourceRole: "photo",
  originFileId: null,
  fileId: PLATE_FILE,
  pages: null,
};

describe("8. two photos attached — the pointer decides, and the refusal names it", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    nbMock.listSources.mockResolvedValue([PANEL_ROW, PLATE_ROW]);
    nbMock.validateChatSources.mockResolvedValue({
      ok: true,
      docIds: [PANEL_DOC, PLATE_DOC],
      nodeId: "n1",
    });
    nbMock.originFileIdsByDoc.mockResolvedValue(new Map());
    visionReads("No wire numbers are legible in this photograph.", false);
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
  });

  it("pointing at the PANEL reads the panel — the recency tie-break is gone", async () => {
    bytesMock.readLinkedPhotoBytes.mockResolvedValue({ ...AUTHORIZED_BYTES, fileId: PANEL_FILE });
    const fs = await frames(
      await POST(
        req({
          message: QUESTION,
          sourceDocIds: [PANEL_DOC, PLATE_DOC],
          photoRead: { docId: PANEL_DOC },
        }),
        params,
      ),
    );
    expect(bytesMock.readLinkedPhotoBytes).toHaveBeenCalledTimes(1);
    expect(bytesMock.readLinkedPhotoBytes.mock.calls[0][1]).toBe(PANEL_FILE);
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      message: `I re-read the attached photograph "${PANEL_NAME}" and that detail isn't legible in it.`,
    });
    // The plate was never fetched, so nothing may be asserted about it.
    expect(String(statusOf(fs)!.message)).not.toContain(PLATE_NAME);
  });

  it("pointing at the PLATE reads the plate, and the sentence names that file instead", async () => {
    bytesMock.readLinkedPhotoBytes.mockResolvedValue({ ...AUTHORIZED_BYTES, fileId: PLATE_FILE });
    const fs = await frames(
      await POST(
        req({
          message: QUESTION,
          sourceDocIds: [PANEL_DOC, PLATE_DOC],
          photoRead: { docId: PLATE_DOC },
        }),
        params,
      ),
    );
    expect(bytesMock.readLinkedPhotoBytes.mock.calls[0][1]).toBe(PLATE_FILE);
    expect(statusOf(fs)).toMatchObject({
      message: `I re-read the attached photograph "${PLATE_NAME}" and that detail isn't legible in it.`,
    });
    expect(String(statusOf(fs)!.message)).not.toContain(PANEL_NAME);
  });

  it("with no pointer, NEITHER is read — the server no longer picks for the technician", async () => {
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: [PANEL_DOC, PLATE_DOC] }), params),
    );
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      message: "I couldn't find that in the selected sources.",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. DEFECT 2 — a provider REFUSAL is not a transcription.
//
//    Executed repro: a factory photograph containing a person makes the vision
//    model decline on policy and return prose with NO `found` key. That prose
//    used to be wrapped in the server-authored header "Values are
//    transcriptions of what is printed in the photograph", pushed as a chunk,
//    cited with provenance live_photo_read, and it flipped Gate G from an
//    honest abstain to "answered".
// ─────────────────────────────────────────────────────────────────────────────
/** The verbatim refusal payload from the repro — note: NO `found` key. */
const REFUSAL = "I'm sorry, I can't assist with identifying people or details in images.";

describe("9. a provider refusal degrades to the honest decline", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    photoInScope();
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    visionMock.togetherVisionCall.mockResolvedValue({
      text: JSON.stringify({ observation: REFUSAL }),
      model: "MiniMaxAI/MiniMax-M3",
    });
  });

  it("no chunk, no citation, and Gate G still abstains with the flag-off sentence", async () => {
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      message: "I couldn't find that in the selected sources.",
    });
    expect(citationsOf(fs)).toHaveLength(0);
    expect(photoReadFrames(fs)[0]).toMatchObject({ state: "unavailable", reason: "refused" });
  });

  it("the refusal prose never reaches the model wrapped in a transcription header", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([CHUNK]);
    stubProvider("Answer.");
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    const user = sentUserContent();
    expect(user).not.toContain("photo-reread://");
    expect(user).not.toContain("assist with identifying");
    expect(user).not.toContain("Values are transcriptions");
    expect(sentSystemPrompt()).not.toContain("PHOTO RE-READ");
  });

  it("a missing `found` key on ordinary prose is also NOT FOUND — never a default-true", async () => {
    visionMock.togetherVisionCall.mockResolvedValue({
      text: JSON.stringify({ observation: 'Terminal block reads "X1-14".' }),
      model: "MiniMaxAI/MiniMax-M3",
    });
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    expect(statusOf(fs)).toMatchObject({ status: "insufficient_evidence" });
    expect(citationsOf(fs)).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. DEFECT 3 — the citation quote must surface the TRANSCRIPTION.
//     The provenance header is server-authored boilerplate; a technician who
//     taps the chip to check a vision-derived claim must see the transcribed
//     characters, not a sentence about who read them.
// ─────────────────────────────────────────────────────────────────────────────
describe("10. the citation quote is the transcribed text, not the provenance header", () => {
  it("quote carries the wire numbers and not the header boilerplate", async () => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    photoInScope();
    visionReads(
      'The terminal block at the top-left reads "X1-14", "X1-15" and "X1-16", left to right.',
    );
    stubProvider("The wire numbers are X1-14, X1-15 and X1-16 [2].");
    const fs = await frames(
      await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, photoRead: POINT }), params),
    );
    const cite = citationsOf(fs).find((c) => c.provenance === "live_photo_read");
    expect(cite).toBeDefined();
    expect(String(cite!.quote)).toContain("X1-14");
    expect(String(cite!.quote)).not.toContain("Values are transcriptions");
    expect(String(cite!.quote)).not.toContain("by a vision reader");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. THE MEASUREMENT — counted vision calls through the REAL POST handler.
//
//     The phrasing heuristic was deleted because it could not be tuned. Round A
//     (bare "look at" / "the attached") over-fired on five ordinary manual
//     questions. Round B narrowed the referent to picture nouns, closed those
//     five, and STILL fired on four natural document questions (6–9 below) —
//     because a figure inside a manual is described with exactly the same nouns
//     as a photograph attached to a notebook — while LOSING true positives it
//     had caught before ("Read the wire numbers off the attached.").
//
//     Under the pointer both lists behave identically and the wording is inert:
//     0 calls with no docId, 1 call with one.
// ─────────────────────────────────────────────────────────────────────────────
const DOCUMENT_QUESTIONS = [
  "Can you look at the manual and see what the recommended oil is?",
  "Look at the wiring diagram and tell me what it says about grounding.",
  "What is the part number in the attached datasheet?",
  "What is the torque spec for the coupling?",
  "How do I reset the fault on the drive?",
  "In the datasheet image, what is the part number?",
  "What does the image on page 12 of the manual say about the terminals?",
  "Is there a picture of the terminal layout in the manual?",
  "Can you find an image in the PDF that shows the nameplate?",
  "Look at the drawing and tell me what it says.",
  "What terminal does the brake resistor land on?",
];

const TRUE_POSITIVES = [
  "Can you read the wire numbers from the photo that's attached?",
  "Read the wire numbers off the attached.",
  "what does the nameplate in the picture say",
  "read the label in the attached image",
  "what part number is on this snapshot",
  "can you read the thumbnail",
];

describe("11. counted vision calls: the wording is inert, the pointer is everything", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    photoInScope();
  });

  it.each(DOCUMENT_QUESTIONS)("0 calls, no pointer — document question: %s", async (q) => {
    await frames(await POST(req({ message: q, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });

  it.each(TRUE_POSITIVES)("0 calls, no pointer — picture-shaped question: %s", async (q) => {
    await frames(await POST(req({ message: q, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });

  it.each(TRUE_POSITIVES)("exactly 1 call WITH a pointer: %s", async (q) => {
    await frames(await POST(req({ message: q, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    expect(visionMock.togetherVisionCall).toHaveBeenCalledTimes(1);
  });

  it.each(DOCUMENT_QUESTIONS)("exactly 1 call WITH a pointer: %s", async (q) => {
    // Deliberate: pointing at a photograph while asking about a datasheet is
    // still an instruction to read the photograph. The server does not
    // second-guess the tap — that guessing is what was just deleted.
    await frames(await POST(req({ message: q, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    expect(visionMock.togetherVisionCall).toHaveBeenCalledTimes(1);
  });

  it("the NOT_A_READ list is the one thing a pointer does not override", async () => {
    for (const q of [
      "did my photo upload ok?",
      "how do I attach a photo to this notebook",
      "delete that picture please",
      "send me the photo",
    ]) {
      await frames(await POST(req({ message: q, sourceDocIds: ALL_DOCS, photoRead: POINT }), params));
    }
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });
});

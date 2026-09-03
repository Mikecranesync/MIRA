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
 * THE FIVE PROPERTIES THIS FILE PROVES, in order of how much they matter:
 *
 *   §1 MERGE SAFETY  With the flag off, the turn is byte-identical to the
 *      #3557 baseline: no vision call, no frame, no extra field, and — proved
 *      by string equality against the flag-on failure path — the same system
 *      prompt and the same user content, character for character.
 *   §2 TENANT SAFETY A photo that is not authorized for THIS notebook in THIS
 *      tenant is never fetched and never sent. Driven with a hostile id.
 *   §3 THE TRIGGER   An ordinary question in a notebook that happens to have a
 *      photograph attached does NOT buy a vision call.
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
/** An ordinary question the manual answers. Must never buy a vision call. */
const ORDINARY = "What is the torque spec for the coupling?";

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
// ─────────────────────────────────────────────────────────────────────────────
describe("1. FLAG OFF is byte-identical to the #3557 baseline", () => {
  it("no vision call, no bytes read, no photo_read frame — on the exact defect question", async () => {
    photoInScope();
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("the #3557 honesty directive is STILL there — this feature does not replace it", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    const p = sentSystemPrompt();
    expect(p).toContain("ATTACHED PICTURES:");
    expect(p).toContain("NEVER say that no photo was provided");
    expect(p).not.toContain("PHOTO RE-READ");
  });

  it("no citation carries a `provenance` field", async () => {
    photoInScope();
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    const cites = citationsOf(fs);
    expect(cites.length).toBeGreaterThan(0);
    for (const c of cites) expect(c).not.toHaveProperty("provenance");
  });

  it("an ordinary grounded answer streams and cites exactly as before", async () => {
    photoInScope();
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(statusOf(fs)).toMatchObject({ status: "answered" });
    expect(citationsOf(fs)).toHaveLength(1);
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
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
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
    // else is attached".
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("when the authorization door refuses, no bytes reach the provider and no citation appears", async () => {
    // This is what readLinkedPhotoBytes returns for a foreign tenant, a file
    // linked to another notebook, a non-photo role, or mislabelled bytes.
    bytesMock.readLinkedPhotoBytes.mockResolvedValue(null);
    photoInScope();
    stubProvider("Terminal 4 is the ground lug [1].");
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    for (const c of citationsOf(fs)) expect(c).not.toHaveProperty("provenance");
    expect(photoReadFrames(fs)[0]).toMatchObject({ state: "unavailable" });
  });

  it("the door is asked for the PHOTOGRAPH (originFileId), scoped to THIS notebook", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
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
describe("4. the trigger — a photo attached is not a licence to read it", () => {
  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("an ORDINARY question in a notebook WITH a photo attached costs nothing", async () => {
    photoInScope();
    const fs = await frames(await POST(req({ message: ORDINARY, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)).toHaveLength(0);
  });

  it("a photo-shaped question with NO photo in scope costs nothing", async () => {
    noPhoto();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: [DOC_PDF] }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });

  it("general mode never re-reads (no source scope to authorize against)", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS, mode: "general" }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });

  it("the stored extraction already covering it ⇒ SKIPPED, free", async () => {
    photoInScope();
    ragMock.retrieveNodeChunks.mockResolvedValue([
      CHUNK,
      {
        ...CHUNK,
        docId: DOC_PHOTO,
        sourceUrl: "u2",
        content: "RAW NAMEPLATE OBSERVATION: wire numbers 14, 15, 16 on the strip.",
      },
    ]);
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
    expect(photoReadFrames(fs)[0]).toMatchObject({ state: "skipped", reason: "extraction_covers" });
  });

  it("a genuine miss calls the provider EXACTLY ONCE, with the original bytes and a timeout", async () => {
    photoInScope();
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
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
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    const user = sentUserContent();
    expect(user).toContain("photo-reread://");
    expect(user).toContain("read directly from the attached photograph");
    expect(user).toContain("X1-14");
  });

  it("its citation carries provenance:'live_photo_read' AND the PHOTOGRAPH's originFileId", async () => {
    stubProvider("The wire numbers are X1-14, X1-15 and X1-16 [2].");
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
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
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    const manual = citationsOf(fs).find((c) => c.docId === DOC_PDF);
    expect(manual).toBeDefined();
    expect(manual).not.toHaveProperty("provenance");
  });

  it("the honesty directive REMAINS armed on a successful read", async () => {
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    // The image is still never in the chat model's context, so the floor
    // bullet must still forbid inventing what a picture looks like.
    expect(sentSystemPrompt()).toContain("ATTACHED PICTURES:");
    expect(sentSystemPrompt()).toContain(
      "Never describe, summarize, or infer what a picture looks like",
    );
  });

  it("emits one photo.reread observation line carrying usage and latency", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
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
    await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(sentUserContent()).not.toContain("photo-reread://");
    const p = sentSystemPrompt();
    expect(p).toContain("PHOTO RE-READ");
    expect(p).toContain("could NOT read the requested detail");
    expect(p).toContain("Never say no photograph was provided");
  });

  it("with NOTHING retrieved, Gate G says the picture was re-read, not 'not in the sources'", async () => {
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      message: "I re-read the attached photograph and that detail isn't legible in it.",
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
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(statusOf(fs)).toMatchObject({ status: "answered" });
    expect(citationsOf(fs)[0]).toMatchObject({ provenance: "live_photo_read" });
  });

  it("with the flag OFF the same turn still abstains, exactly as it does today", async () => {
    delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
    photoInScope();
    ragMock.retrieveNodeChunks.mockResolvedValue([]);
    const fs = await frames(await POST(req({ message: QUESTION, sourceDocIds: ALL_DOCS }), params));
    expect(statusOf(fs)).toMatchObject({
      status: "insufficient_evidence",
      message: "I couldn't find that in the selected sources.",
    });
    expect(visionMock.togetherVisionCall).not.toHaveBeenCalled();
  });
});

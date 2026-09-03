/**
 * NOTEBOOK PHOTO RE-READ — the trigger, the miss probe, the selection, and the
 * shape of the evidence a transcription becomes.
 *
 * Run: npx vitest run notebook-photo-reread
 *
 * The single most important test in this file is the NEGATIVE one: "what's the
 * torque spec for the coupling?" must not fire in a notebook full of
 * photographs. A feature that reads a picture on every turn is not a feature,
 * it is a bill. Everything else here defends that boundary from both sides.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotebookSource } from "@/lib/equipment-notebooks";
import type { VisionCall } from "@/lib/nameplate/passes";

const TENANT = "11111111-1111-4111-8111-111111111111";
const NB = "22222222-2222-4222-8222-222222222222";
const DOC_PDF = "33333333-3333-4333-8333-333333333333";
const DOC_PHOTO = "44444444-4444-4444-8444-444444444444";
const DOC_PHOTO_2 = "66666666-6666-4666-8666-666666666666";
const PHOTO_FILE = "f0000000-0000-4000-8000-000000000001";
const PHOTO_FILE_2 = "f0000000-0000-4000-8000-000000000002";

const bytesMock = vi.hoisted(() => ({ readLinkedPhotoBytes: vi.fn() }));
vi.mock("@/lib/notebook-photo-bytes", () => bytesMock);

import {
  extractionCoversIntent,
  maybeRereadPhoto,
  photoReadIntent,
  photoRereadEnabled,
  photoRereadMaxBytes,
  photoRereadMaxImages,
  photoRereadTimeoutMs,
  rereadChunk,
  rereadDirective,
  selectPhotoToRead,
  type PhotoRereadResult,
} from "@/lib/notebook-photo-reread";
import { photoSourcesInScope } from "@/lib/photo-source-honesty";

// ── fixtures ─────────────────────────────────────────────────────────────────

function src(over: Partial<NotebookSource>): NotebookSource {
  return {
    docId: DOC_PDF,
    filename: "manual.pdf",
    status: "ready",
    enabledByDefault: true,
    matchState: "user_confirmed",
    sourceRole: "manual",
    pages: 40,
    fileId: null,
    originFileId: null,
    matchEvidence: null,
    readiness: { canChat: true } as unknown as NotebookSource["readiness"],
    ...over,
  } as NotebookSource;
}

const PDF_ROW = src({});
/** Shape A — nameplate-confirm: the row is the extracted .txt, `originFileId`
 *  is the PHOTOGRAPH it was read from. */
const PHOTO_ROW_A = src({
  docId: DOC_PHOTO,
  filename: "nameplate-1118ca97.txt",
  sourceRole: "photo",
  pages: null,
  fileId: "d0000000-0000-4000-8000-00000000000a",
  originFileId: PHOTO_FILE,
});
/** Shape B — a photograph attached directly: `originFileId` is NULL and the
 *  row's OWN fileId is the picture. */
const PHOTO_ROW_B = src({
  docId: DOC_PHOTO_2,
  filename: "panel-terminals.jpg",
  sourceRole: "photo",
  pages: null,
  fileId: PHOTO_FILE_2,
  originFileId: null,
});

const ALL_DOCS = [DOC_PDF, DOC_PHOTO, DOC_PHOTO_2];

const PHOTO_BYTES = {
  fileId: PHOTO_FILE,
  buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  mimeType: "image/jpeg",
  filename: "panel.jpg",
  capturedAt: "2026-09-01T12:00:00.000Z",
};

function visionCall(payload: unknown, model = "MiniMaxAI/MiniMax-M3"): VisionCall {
  return vi.fn(async () => ({ text: JSON.stringify(payload), model })) as unknown as VisionCall;
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
  delete process.env.PHOTO_REREAD_TIMEOUT_MS;
  delete process.env.PHOTO_REREAD_MAX_BYTES;
  delete process.env.PHOTO_REREAD_MAX_IMAGES;
  bytesMock.readLinkedPhotoBytes.mockResolvedValue(PHOTO_BYTES);
});
afterEach(() => {
  delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. THE FLAG.
// ─────────────────────────────────────────────────────────────────────────────
describe("1. the flag is off unless it is exactly '1'", () => {
  it.each(["", "0", "true", "yes", "on", undefined])("%s ⇒ disabled", (v) => {
    if (v === undefined) delete process.env.NOTEBOOK_PHOTO_REREAD_ENABLED;
    else process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = v;
    expect(photoRereadEnabled()).toBe(false);
  });

  it("'1' ⇒ enabled", () => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
    expect(photoRereadEnabled()).toBe(true);
  });

  it("maybeRereadPhoto does NOTHING with the flag off — no bytes read, no fetch", async () => {
    // `fetch` is deliberately NOT stubbed: if anything tried to reach a
    // provider from here, this test would fail loudly rather than silently
    // pass against a stub.
    const out = await maybeRereadPhoto({
      tenantId: TENANT,
      notebookId: NB,
      message: "can you read the wire numbers from the photo that's attached?",
      chunks: [],
      docIds: ALL_DOCS,
      sources: [PDF_ROW, PHOTO_ROW_A],
    });
    expect(out).toBeNull();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });
});

describe("1b. the bounds are clamped, and the defaults are the design's", () => {
  it("timeout: 12 s default, 3–20 s clamp, garbage ⇒ default", () => {
    expect(photoRereadTimeoutMs()).toBe(12_000);
    process.env.PHOTO_REREAD_TIMEOUT_MS = "500";
    expect(photoRereadTimeoutMs()).toBe(3_000);
    process.env.PHOTO_REREAD_TIMEOUT_MS = "999999";
    expect(photoRereadTimeoutMs()).toBe(20_000);
    process.env.PHOTO_REREAD_TIMEOUT_MS = "banana";
    expect(photoRereadTimeoutMs()).toBe(12_000);
  });

  it("bytes: 4 MiB default, 8 MiB ceiling", () => {
    expect(photoRereadMaxBytes()).toBe(4_194_304);
    process.env.PHOTO_REREAD_MAX_BYTES = "999999999";
    expect(photoRereadMaxBytes()).toBe(8_388_608);
  });

  it("images: 1 default, 2 ceiling — a chat turn is not a batch job", () => {
    expect(photoRereadMaxImages()).toBe(1);
    process.env.PHOTO_REREAD_MAX_IMAGES = "9";
    expect(photoRereadMaxImages()).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE TRIGGER. Both halves required.
// ─────────────────────────────────────────────────────────────────────────────
describe("2. the trigger fires on a real read-this-picture question", () => {
  it.each([
    "Can you read the wire numbers from the photo that's attached?",
    "what does the label in the picture say",
    "which terminal is the blue wire on in that image",
    "read the nameplate in the photo",
    "what colour of the indicator lamp is lit in the picture?",
    "look at the attached photo — what part number is on it",
  ])("fires: %s", (q) => {
    expect(photoReadIntent(q).hit).toBe(true);
  });
});

describe("2b. the trigger does NOT fire", () => {
  it("THE case that matters: an ordinary spec question in a notebook full of photos", () => {
    // No picture referent at all. If this ever fires, every nameplate notebook
    // starts paying for a vision call on questions the manual answers.
    expect(photoReadIntent("what's the torque spec for the coupling?").hit).toBe(false);
  });

  it.each([
    "what is the decel ramp parameter",
    "how do I reset fault F0004",
    "what terminal does the brake resistor land on", // target noun, NO referent
  ])("no picture referent: %s", (q) => {
    expect(photoReadIntent(q).hit).toBe(false);
  });

  it.each([
    "did my photo upload ok?",
    "how do I attach a photo to this notebook",
    "delete that picture please",
    "send me the photo",
  ])("about the FILE, not what is printed on it: %s", (q) => {
    expect(photoReadIntent(q).hit).toBe(false);
  });

  it("a referent with no read intent does not fire", () => {
    expect(photoReadIntent("nice photo").hit).toBe(false);
  });

  it("a very long message is a paste, not a request to read a picture", () => {
    const long = `read the wire numbers in the photo ${"x".repeat(600)}`;
    expect(photoReadIntent(long).hit).toBe(false);
  });

  it("an empty message never fires", () => {
    expect(photoReadIntent("   ").hit).toBe(false);
  });
});

describe("2c. the EXPLICIT door wins outright — no regex consulted", () => {
  it("an explicit docId fires even on a question the heuristic would refuse", () => {
    const i = photoReadIntent("what's the torque spec for the coupling?", DOC_PHOTO);
    expect(i.hit).toBe(true);
    expect(i.docId).toBe(DOC_PHOTO);
  });
});

describe("2d. the matched target tokens ride along for the miss probe", () => {
  it("collects the visual-target nouns, not the verbs", () => {
    const i = photoReadIntent("can you read the wire numbers and terminal labels in the photo?");
    expect(i.targets).toEqual(expect.arrayContaining(["wire number", "terminal", "label"]));
    expect(i.targets).not.toContain("read");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. THE MISS PROBE — what keeps the common case free.
// ─────────────────────────────────────────────────────────────────────────────
describe("3. the coverage probe suppresses when the extraction already answers", () => {
  const photoChunk = { docId: DOC_PHOTO, content: "RAW NAMEPLATE OBSERVATION: nameplate reads GS10-20P5" };
  const manualChunk = { docId: DOC_PDF, content: "Wire numbers are listed in section 4." };

  it("a hit inside a PHOTO-derived chunk suppresses the vision call", () => {
    expect(extractionCoversIntent([photoChunk], [DOC_PHOTO], ["nameplate"])).toBe(true);
  });

  it("a hit inside a MANUAL chunk does NOT suppress — the picture was never read for it", () => {
    expect(extractionCoversIntent([manualChunk], [DOC_PHOTO], ["wire number"])).toBe(false);
  });

  it("no hit ⇒ no suppression: this is the genuine miss the feature exists for", () => {
    expect(extractionCoversIntent([photoChunk], [DOC_PHOTO], ["wire number"])).toBe(false);
  });

  it("no probe-able targets ⇒ no suppression (it cannot prove coverage)", () => {
    expect(extractionCoversIntent([photoChunk], [DOC_PHOTO], [])).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. SELECTION — the id sent to the provider must be the PHOTOGRAPH.
// ─────────────────────────────────────────────────────────────────────────────
describe("4. selectPhotoToRead resolves originFileId ?? fileId", () => {
  const sources = [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B];
  const inScope = photoSourcesInScope(sources, ALL_DOCS);

  it("shape A (nameplate-confirm): the ORIGIN file is the picture, not the .txt", () => {
    const got = selectPhotoToRead([inScope[0]], sources, { hit: true, targets: [] }, "read it", 1);
    expect(got[0].imageFileId).toBe(PHOTO_FILE);
    expect(got[0].docId).toBe(DOC_PHOTO);
  });

  it("shape B (photo attached directly): the row's OWN file is the picture", () => {
    const got = selectPhotoToRead([inScope[1]], sources, { hit: true, targets: [] }, "read it", 1);
    expect(got[0].imageFileId).toBe(PHOTO_FILE_2);
  });

  it("a row with neither id is skipped rather than sent as a null", () => {
    const orphan = src({ docId: DOC_PHOTO, sourceRole: "photo", fileId: null, originFileId: null });
    const scope = photoSourcesInScope([orphan], [DOC_PHOTO]);
    // isPhotoSource is satisfied by sourceRole alone, so this row DOES reach
    // selection — and must be dropped there.
    expect(selectPhotoToRead(scope, [orphan], { hit: true, targets: [] }, "read it", 1)).toEqual([]);
  });

  it("filename overlap with the question wins, then recency, then docId", () => {
    const got = selectPhotoToRead(inScope, sources, { hit: true, targets: [] }, "read the terminals", 1);
    // "terminals" overlaps panel-TERMINALS.jpg and nothing in the nameplate row.
    expect(got).toHaveLength(1);
    expect(got[0].imageFileId).toBe(PHOTO_FILE_2);
  });

  it("with no overlap the MOST RECENTLY ADDED wins (listSources is created_at ASC)", () => {
    const got = selectPhotoToRead(inScope, sources, { hit: true, targets: [] }, "read it", 1);
    expect(got[0].docId).toBe(DOC_PHOTO_2);
  });

  it("the cap is honoured", () => {
    expect(selectPhotoToRead(inScope, sources, { hit: true, targets: [] }, "read it", 2)).toHaveLength(2);
  });

  it("an explicit docId that is NOT an in-scope photo selects NOTHING — never a fallback", () => {
    const got = selectPhotoToRead(inScope, sources, { hit: true, targets: [], docId: DOC_PDF }, "x", 1);
    expect(got).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE EVIDENCE SHAPE.
// ─────────────────────────────────────────────────────────────────────────────
describe("5. rereadChunk — a transcription can never masquerade as a manual", () => {
  const result: PhotoRereadResult = {
    docId: DOC_PHOTO,
    fileId: PHOTO_FILE,
    filename: "panel.jpg",
    observation: 'Terminal block reads "X1-14", "X1-15", "X1-16".',
    found: true,
    model: "MiniMaxAI/MiniMax-M3",
    latencyMs: 4200,
    imageBytes: 1024,
    promptTokens: 2400,
    completionTokens: 300,
  };

  it("carries the sentinel url, so it gets its OWN citation number", () => {
    // manual-rag keys citations on `sourceUrl::sourcePage`; a per-file sentinel
    // can never merge into a retrieved chunk of the same document.
    expect(rereadChunk(result).sourceUrl).toBe(`photo-reread://${PHOTO_FILE}`);
  });

  it("has NO page and NO manufacturer/model, so buildGroundedContext renders the title", () => {
    const c = rereadChunk(result);
    expect(c.sourcePage).toBeNull();
    expect(c.manufacturer).toBe("");
    expect(c.modelNumber).toBe("");
    expect([c.manufacturer, c.modelNumber].filter(Boolean).join(" ") || c.title).toBe(
      "Photo: panel.jpg (read on request)",
    );
  });

  it("opens with a provenance header that names the reader and denies spec status", () => {
    const c = rereadChunk(result);
    expect(c.content).toContain("read directly from the attached photograph");
    expect(c.content).toContain("MiniMaxAI/MiniMax-M3");
    expect(c.content).toContain("transcriptions of what is printed in the photograph, not manual specifications");
    expect(c.content).toContain('Terminal block reads "X1-14"');
  });

  it("is attributed to the photo SOURCE row, so the citation chip opens the picture", () => {
    expect(rereadChunk(result).docId).toBe(DOC_PHOTO);
  });

  it("rereadDirective is EMPTY unless the read came back not-found", () => {
    expect(rereadDirective(result)).toBe("");
    expect(rereadDirective(null)).toBe("");
    const missed = rereadDirective({ ...result, found: false });
    expect(missed).toContain("WAS re-read");
    expect(missed).toContain("not legible");
    expect(missed).toContain("Never say no photograph was provided");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. END TO END through maybeRereadPhoto (provider mocked — never a paid call).
// ─────────────────────────────────────────────────────────────────────────────
describe("6. maybeRereadPhoto", () => {
  const base = {
    tenantId: TENANT,
    notebookId: NB,
    docIds: ALL_DOCS,
    sources: [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B],
  };
  const READ_Q = "can you read the wire numbers from the photo that's attached?";

  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("a genuine miss produces ONE transcription chunk and a live-read url", async () => {
    const call = visionCall({ observation: 'Wire numbers "14", "15", "16".', found: true });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out!.chunks).toHaveLength(1);
    expect(out!.chunks[0].content).toContain('Wire numbers "14"');
    expect([...out!.liveReadUrls]).toEqual([`photo-reread://${PHOTO_FILE}`]);
    expect(out!.frame).toMatchObject({ kind: "photo_read", state: "read", found: true });
    expect(out!.directive).toBe("");
  });

  it("the vision call carries a timeout and the ORIGINAL uncropped bytes", async () => {
    const call = visionCall({ observation: "x", found: true });
    await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    const args = vi.mocked(call).mock.calls[0][0];
    expect(args.timeoutMs).toBe(12_000);
    expect(args.images).toHaveLength(1);
    expect(args.images[0].base64).toBe(PHOTO_BYTES.buffer.toString("base64"));
    expect(args.images[0].mimeType).toBe("image/jpeg");
    expect(args.maxTokens).toBe(700);
  });

  it("the prompt forbids diagnosis and guessing, and names the technician's question", async () => {
    const call = visionCall({ observation: "x", found: true });
    await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    const p = vi.mocked(call).mock.calls[0][0].prompt;
    expect(p).toContain("NEVER diagnose");
    expect(p).toContain("NEVER guess a digit");
    expect(p).toContain(READ_Q);
  });

  it("found:false ⇒ NO chunk, a directive, and a frame that says so", async () => {
    const call = visionCall({ observation: "The terminal strip is out of focus.", found: false });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(out!.chunks).toHaveLength(0);
    expect(out!.readButNotFound).toBe(true);
    expect(out!.directive).toContain("not legible");
    expect(out!.frame).toMatchObject({ state: "read", found: false });
  });

  it("an ordinary spec question never reaches the provider", async () => {
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({
      ...base,
      message: "what's the torque spec for the coupling?",
      chunks: [],
      call,
    });
    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });

  it("no photo in scope ⇒ never reaches the provider", async () => {
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({
      ...base,
      docIds: [DOC_PDF],
      message: READ_Q,
      chunks: [],
      call,
    });
    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("the extraction already covering it ⇒ SKIPPED, free, no provider call", async () => {
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({
      ...base,
      message: READ_Q,
      chunks: [{ docId: DOC_PHOTO, content: "Wire numbers 14, 15, 16 are marked on the strip." }],
      call,
    });
    expect(call).not.toHaveBeenCalled();
    expect(out!.chunks).toHaveLength(0);
    expect(out!.frame).toMatchObject({ state: "skipped", reason: "extraction_covers" });
  });

  it("an unauthorized file ⇒ no provider call and an 'unavailable' frame", async () => {
    bytesMock.readLinkedPhotoBytes.mockResolvedValue(null);
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(call).not.toHaveBeenCalled();
    expect(out!.chunks).toHaveLength(0);
    // Distinct from a provider outage. On the first day the flag is on, an
    // operator must be able to tell "nothing was authorized" from "Together is
    // down"; both look the same to the technician and demand opposite fixes.
    expect(out!.frame).toMatchObject({ state: "unavailable", reason: "bytes_unavailable" });
    expect(out!.observation).toMatchObject({ suppressedBy: "bytes_unavailable" });
  });

  it("a provider THROW degrades to 'unavailable' — never a chunk, never a sight claim", async () => {
    const call = vi.fn(async () => {
      throw new Error("recognizer_provider_error_503");
    }) as unknown as VisionCall;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(out!.chunks).toHaveLength(0);
    expect(out!.directive).toBe("");
    expect(out!.frame).toMatchObject({ state: "unavailable", reason: "provider_error" });
    // The error text is scrubbed to its safe token shape (PRD §20).
    expect(String(warn.mock.calls[0][0])).toContain("recognizer_provider_error_503");
    warn.mockRestore();
  });

  it("a TIMEOUT degrades the same way", async () => {
    const call = vi.fn(async () => {
      throw new DOMException("The operation was aborted due to timeout.", "TimeoutError");
    }) as unknown as VisionCall;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(out!.frame).toMatchObject({ state: "unavailable" });
    // Free-text provider messages never reach the log.
    expect(String(warn.mock.calls[0][0])).toContain("recognizer_provider_error_unknown");
    warn.mockRestore();
  });

  it("an empty transcription is treated as a failure, not as an answer", async () => {
    const call = visionCall({ observation: "   ", found: true });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(out!.chunks).toHaveLength(0);
    expect(out!.frame).toMatchObject({ state: "unavailable", reason: "empty_response" });
  });

  it("the observation captures usage and wall time — the measurement this feature owes", async () => {
    const call = vi.fn(async () => ({
      text: JSON.stringify({ observation: "X1-14", found: true }),
      model: "MiniMaxAI/MiniMax-M3",
      usage: { prompt_tokens: 2411, completion_tokens: 512 },
    })) as unknown as VisionCall;
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, chunks: [], call });
    expect(out!.observation).toMatchObject({
      event: "photo.reread",
      triggered: true,
      model: "MiniMaxAI/MiniMax-M3",
      promptTokens: 2411,
      completionTokens: 512,
      imageBytes: PHOTO_BYTES.buffer.length,
      found: true,
    });
    expect(typeof out!.observation.latencyMs).toBe("number");
  });
});

/**
 * NOTEBOOK PHOTO RE-READ — the trigger, the selection, and the shape of the
 * evidence a transcription becomes.
 *
 * Run: npx vitest run notebook-photo-reread
 *
 * THE TRIGGER IS THE CLIENT'S POINTER, and the single most important tests in
 * this file are the negative ones: with no `photoRead.docId`, NOTHING is read —
 * not for "what's the torque spec for the coupling?", and not for the verbatim
 * production question either. A feature that reads a picture because a sentence
 * sounded like it might be about one is not a feature, it is a bill and a
 * wrong-picture hazard. §2 and §7 defend that boundary from both sides.
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
  maybeRereadPhoto,
  photoReadTarget,
  photoRereadEnabled,
  photoRereadMaxBytes,
  photoRereadTimeoutMs,
  rereadChunk,
  rereadDirective,
  selectPhotoToRead,
  transcriptionOf,
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

/**
 * THE ELEVEN NATURAL DOCUMENT QUESTIONS. 1–5 are the round-A over-triggers
 * (bare "look at" / "the attached"); 6–9 are the four that STILL fired after
 * round B narrowed the referent to picture nouns — a picture inside a document
 * is described with exactly the same nouns as a picture attached to a notebook.
 * 10–11 are ordinary manual questions kept as controls.
 *
 * Every one of them must cost ZERO vision calls, and now does so for a reason
 * no rewording can erode: nobody pointed at a photograph.
 */
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

/**
 * The questions the heuristic USED to fire on — including "Read the wire
 * numbers off the attached.", which round B silently lost. Under the pointer
 * every one of them behaves identically: 0 reads without a docId, 1 read with
 * one. Phrasing stopped being a variable.
 */
const TRUE_POSITIVES = [
  "Can you read the wire numbers from the photo that's attached?",
  "Read the wire numbers off the attached.",
  "what does the nameplate in the picture say",
  "read the label in the attached image",
  "what part number is on this snapshot",
  "can you read the thumbnail",
];

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

  it("maybeRereadPhoto does NOTHING with the flag off — WITH a valid pointer, so the flag is what is under test", async () => {
    // The pointer is deliberately present and valid. Without it this test would
    // pass for the wrong reason (no trigger, not "no flag") and would keep
    // passing if the flag check were deleted outright.
    // `fetch` is deliberately NOT stubbed: if anything tried to reach a
    // provider from here, this test would fail loudly rather than silently
    // pass against a stub.
    const out = await maybeRereadPhoto({
      tenantId: TENANT,
      notebookId: NB,
      message: "can you read the wire numbers from the photo that's attached?",
      docIds: ALL_DOCS,
      explicitDocId: DOC_PHOTO,
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
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE TRIGGER — the pointer, and nothing but the pointer.
// ─────────────────────────────────────────────────────────────────────────────
describe("2. no docId ⇒ nothing is read, whatever the phrasing", () => {
  it.each(DOCUMENT_QUESTIONS)("a document question never fires: %s", (q) => {
    expect(photoReadTarget(q)).toBeNull();
  });

  it.each(TRUE_POSITIVES)(
    "and neither does a picture-shaped one — this is the deliberate behaviour change: %s",
    (q) => {
      expect(photoReadTarget(q)).toBeNull();
    },
  );

  it("THE regression fence: an empty / whitespace / null docId is not a pointer", () => {
    expect(photoReadTarget("read the wire numbers in the photo", "")).toBeNull();
    expect(photoReadTarget("read the wire numbers in the photo", "   ")).toBeNull();
    expect(photoReadTarget("read the wire numbers in the photo", null)).toBeNull();
    expect(photoReadTarget("read the wire numbers in the photo", undefined)).toBeNull();
  });
});

describe("2b. a docId fires, whatever the phrasing", () => {
  it.each([...TRUE_POSITIVES, ...DOCUMENT_QUESTIONS])("fires with a pointer: %s", (q) => {
    // Including the eleven document questions ON PURPOSE. Pointing at an
    // attached photograph is an instruction, not a hint to be second-guessed:
    // if the technician taps a picture while asking about a datasheet, the
    // picture is what they want read.
    expect(photoReadTarget(q, DOC_PHOTO)).toBe(DOC_PHOTO);
  });

  it("the id is trimmed, so a padded client value still resolves", () => {
    expect(photoReadTarget("what is on this?", `  ${DOC_PHOTO}  `)).toBe(DOC_PHOTO);
  });
});

describe("2c. NOT_A_READ survives the pointer — a question ABOUT the file is not a read", () => {
  it.each([
    "did my photo upload ok?",
    "how do I attach a photo to this notebook",
    "delete that picture please",
    "send me the photo",
  ])("%s ⇒ no read even with a docId", (q) => {
    // Pointing says WHICH picture. It does not say the question is about what
    // is printed on it — and a client that always sets photoRead.docId must not
    // buy a vision call for "did my photo upload ok?".
    expect(photoReadTarget(q, DOC_PHOTO)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. SELECTION — authorization leg 1, and the id sent to the provider must be
//    the PHOTOGRAPH.
// ─────────────────────────────────────────────────────────────────────────────
describe("3. selectPhotoToRead resolves originFileId ?? fileId, inside the turn's scope", () => {
  const sources = [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B];
  const inScope = photoSourcesInScope(sources, ALL_DOCS);

  it("shape A (nameplate-confirm): the ORIGIN file is the picture, not the .txt", () => {
    const got = selectPhotoToRead(inScope, sources, DOC_PHOTO);
    expect(got!.imageFileId).toBe(PHOTO_FILE);
    expect(got!.docId).toBe(DOC_PHOTO);
  });

  it("shape B (photo attached directly): the row's OWN file is the picture", () => {
    expect(selectPhotoToRead(inScope, sources, DOC_PHOTO_2)!.imageFileId).toBe(PHOTO_FILE_2);
  });

  it("a row with neither id is skipped rather than sent as a null", () => {
    const orphan = src({ docId: DOC_PHOTO, sourceRole: "photo", fileId: null, originFileId: null });
    const scope = photoSourcesInScope([orphan], [DOC_PHOTO]);
    // isPhotoSource is satisfied by sourceRole alone, so this row DOES reach
    // selection — and must be dropped there.
    expect(selectPhotoToRead(scope, [orphan], DOC_PHOTO)).toBeNull();
  });

  it("a docId that is NOT an in-scope photo selects NOTHING — never a fallback", () => {
    // The heart of authorization leg 1: a pointer is honoured only inside this
    // turn's revalidated photo sources, and is never widened to "read whatever
    // else is attached".
    expect(selectPhotoToRead(inScope, sources, DOC_PDF)).toBeNull();
    expect(selectPhotoToRead(inScope, sources, "deadbeef-dead-4ead-8ead-deadbeefdead")).toBeNull();
  });

  it("a photo that exists but is OUT of this turn's doc scope selects nothing", () => {
    const narrowed = photoSourcesInScope(sources, [DOC_PDF, DOC_PHOTO]);
    expect(selectPhotoToRead(narrowed, sources, DOC_PHOTO_2)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE EVIDENCE SHAPE.
// ─────────────────────────────────────────────────────────────────────────────
describe("4. rereadChunk — a transcription can never masquerade as a manual", () => {
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
// 5. END TO END through maybeRereadPhoto (provider mocked — never a paid call).
// ─────────────────────────────────────────────────────────────────────────────
describe("5. maybeRereadPhoto", () => {
  const base = {
    tenantId: TENANT,
    notebookId: NB,
    docIds: ALL_DOCS,
    explicitDocId: DOC_PHOTO,
    sources: [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B],
  };
  const READ_Q = "can you read the wire numbers from the photo that's attached?";

  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("a pointed-at photograph produces ONE transcription chunk and a live-read url", async () => {
    const call = visionCall({ observation: 'Wire numbers "14", "15", "16".', found: true });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out!.chunks).toHaveLength(1);
    expect(out!.chunks[0].content).toContain('Wire numbers "14"');
    expect([...out!.liveReadUrls]).toEqual([`photo-reread://${PHOTO_FILE}`]);
    expect(out!.frame).toMatchObject({ kind: "photo_read", state: "read", found: true });
    expect(out!.directive).toBe("");
  });

  it("the vision call carries a timeout and the ORIGINAL uncropped bytes", async () => {
    const call = visionCall({ observation: "x", found: true });
    await maybeRereadPhoto({ ...base, message: READ_Q, call });
    const args = vi.mocked(call).mock.calls[0][0];
    expect(args.timeoutMs).toBe(12_000);
    expect(args.images).toHaveLength(1);
    expect(args.images[0].base64).toBe(PHOTO_BYTES.buffer.toString("base64"));
    expect(args.images[0].mimeType).toBe("image/jpeg");
    expect(args.maxTokens).toBe(700);
  });

  it("the prompt forbids diagnosis and guessing, and names the technician's question", async () => {
    const call = visionCall({ observation: "x", found: true });
    await maybeRereadPhoto({ ...base, message: READ_Q, call });
    const p = vi.mocked(call).mock.calls[0][0].prompt;
    expect(p).toContain("NEVER diagnose");
    expect(p).toContain("NEVER guess a digit");
    expect(p).toContain(READ_Q);
  });

  it("found:false ⇒ NO chunk, a directive, and a frame that says so", async () => {
    const call = visionCall({ observation: "The terminal strip is out of focus.", found: false });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.chunks).toHaveLength(0);
    expect(out!.readButNotFound).toBe(true);
    expect(out!.directive).toContain("not legible");
    expect(out!.frame).toMatchObject({ state: "read", found: false });
  });

  it("NO POINTER ⇒ the provider is never reached, on the verbatim defect question", async () => {
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({
      ...base,
      explicitDocId: null,
      message: READ_Q,
      call,
    });
    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });

  it("no photo in scope ⇒ never reaches the provider, pointer or not", async () => {
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({
      ...base,
      docIds: [DOC_PDF],
      message: READ_Q,
      call,
    });
    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it("a hostile docId reads NOTHING — no bytes, no provider, no frame", async () => {
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({
      ...base,
      explicitDocId: "deadbeef-dead-4ead-8ead-deadbeefdead",
      message: READ_Q,
      call,
    });
    expect(out).toBeNull();
    expect(call).not.toHaveBeenCalled();
    expect(bytesMock.readLinkedPhotoBytes).not.toHaveBeenCalled();
  });

  it("an unauthorized file ⇒ no provider call and an 'unavailable' frame", async () => {
    bytesMock.readLinkedPhotoBytes.mockResolvedValue(null);
    const call = visionCall({ observation: "x", found: true });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
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
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
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
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.frame).toMatchObject({ state: "unavailable" });
    // Free-text provider messages never reach the log.
    expect(String(warn.mock.calls[0][0])).toContain("recognizer_provider_error_unknown");
    warn.mockRestore();
  });

  it("an empty transcription is treated as a failure, not as an answer", async () => {
    const call = visionCall({ observation: "   ", found: true });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.chunks).toHaveLength(0);
    expect(out!.frame).toMatchObject({ state: "unavailable", reason: "empty_response" });
  });

  it("the observation captures usage and wall time — the measurement this feature owes", async () => {
    const call = vi.fn(async () => ({
      text: JSON.stringify({ observation: "X1-14", found: true }),
      model: "MiniMaxAI/MiniMax-M3",
      usage: { prompt_tokens: 2411, completion_tokens: 512 },
    })) as unknown as VisionCall;
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
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

// ─────────────────────────────────────────────────────────────────────────────
// 6. THE TRIGGER, MEASURED END TO END — the regression fence for the deleted
//    heuristic. Same lists as §2, but driven through maybeRereadPhoto so a
//    reintroduced regex would have to survive an actual counted call, not just
//    a predicate assertion.
// ─────────────────────────────────────────────────────────────────────────────
describe("6. counted vision calls: phrasing is not a variable any more", () => {
  const base = {
    tenantId: TENANT,
    notebookId: NB,
    docIds: ALL_DOCS,
    sources: [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B],
  };

  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it.each(DOCUMENT_QUESTIONS)("0 calls without a pointer: %s", async (q) => {
    const call = visionCall({ observation: "x", found: true });
    expect(await maybeRereadPhoto({ ...base, message: q, call })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it.each(TRUE_POSITIVES)("0 calls without a pointer: %s", async (q) => {
    const call = visionCall({ observation: "x", found: true });
    expect(await maybeRereadPhoto({ ...base, message: q, call })).toBeNull();
    expect(call).not.toHaveBeenCalled();
  });

  it.each(TRUE_POSITIVES)("exactly 1 call WITH a pointer: %s", async (q) => {
    const call = visionCall({ observation: "X1-14", found: true });
    const out = await maybeRereadPhoto({ ...base, message: q, explicitDocId: DOC_PHOTO, call });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out!.chunks).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. DEFECT 2 (kept) — a REFUSAL, or a missing/non-boolean `found`, is NOT a
//    transcription. The never-fabricates contract enumerated error / timeout /
//    empty / corrupt but not these, so refusal prose was wrapped in the
//    server-authored "Values are transcriptions of what is printed in the
//    photograph" header, pushed as a chunk and cited.
// ─────────────────────────────────────────────────────────────────────────────
describe("7. a provider refusal is not a transcription", () => {
  const base = {
    tenantId: TENANT,
    notebookId: NB,
    docIds: ALL_DOCS,
    explicitDocId: DOC_PHOTO,
    sources: [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B],
  };
  const READ_Q = "can you read the wire numbers from the photo that's attached?";

  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("the verbatim policy refusal (no `found` key) ⇒ no chunk, no live-read url, 'refused'", async () => {
    const call = visionCall({
      observation: "I'm sorry, I can't assist with identifying people or details in images.",
    });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.chunks).toEqual([]);
    expect([...out!.liveReadUrls]).toEqual([]);
    expect(out!.directive).toBe("");
    expect(out!.readButNotFound).toBe(false);
    expect(out!.frame).toMatchObject({ state: "unavailable", reason: "refused" });
  });

  it("a refusal that DOES claim found:true is still refused", async () => {
    const call = visionCall({
      observation: "As an AI, I cannot assist with this image.",
      found: true,
    });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.chunks).toEqual([]);
    expect(out!.frame).toMatchObject({ state: "unavailable", reason: "refused" });
  });

  it.each([undefined, "true", 1, null])(
    "a missing / non-boolean `found` (%s) is NOT FOUND, never a default-true",
    async (found) => {
      const call = visionCall({ observation: 'Terminal block reads "X1-14".', found });
      const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
      expect(out!.chunks).toEqual([]);
      expect(out!.frame).toMatchObject({ state: "unavailable", reason: "refused" });
    },
  );

  it("an explicit found:false is UNCHANGED — it is a look, not a refusal", async () => {
    const call = visionCall({ observation: "The terminal strip is out of focus.", found: false });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.chunks).toEqual([]);
    expect(out!.directive).toContain("could NOT read the requested detail");
    expect(out!.frame).toMatchObject({ state: "read", found: false });
  });

  it("an honest transcription that merely mentions an unreadable character still reads", async () => {
    const call = visionCall({
      observation: 'Wire "X1-1?" — I can\'t read the last character; it is a 4 or a 1.',
      found: true,
    });
    const out = await maybeRereadPhoto({ ...base, message: READ_Q, call });
    expect(out!.chunks).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. DEFECT 1 (kept) — what the technician is told, and what they can check.
//    The naming rule outlived the guess that produced it: the surface may
//    assert only the file the server actually fetched.
// ─────────────────────────────────────────────────────────────────────────────
describe("8. the not-found outcome names the file that was actually read", () => {
  const base = {
    tenantId: TENANT,
    notebookId: NB,
    docIds: ALL_DOCS,
    sources: [PDF_ROW, PHOTO_ROW_A, PHOTO_ROW_B],
  };

  beforeEach(() => {
    process.env.NOTEBOOK_PHOTO_REREAD_ENABLED = "1";
  });

  it("carries the filename of the picture the POINTER named, so the surface can name it", async () => {
    const call = visionCall({ observation: "Out of focus.", found: false });
    const out = await maybeRereadPhoto({
      ...base,
      explicitDocId: DOC_PHOTO_2,
      message: "can you read the wire numbers in the photo",
      call,
    });
    expect(out!.readButNotFound).toBe(true);
    expect(out!.notFoundFilename).toBe("panel-terminals.jpg");
  });

  it("a different pointer names a different file — the server cannot read the wrong picture", async () => {
    const call = visionCall({ observation: "Out of focus.", found: false });
    const out = await maybeRereadPhoto({
      ...base,
      explicitDocId: DOC_PHOTO,
      message: "can you read the wire numbers in the photo",
      call,
    });
    expect(out!.notFoundFilename).toBe("nameplate-1118ca97.txt");
  });

  it("is null when nothing was read", async () => {
    const call = visionCall({ observation: 'Wire numbers "14", "15".', found: true });
    const out = await maybeRereadPhoto({
      ...base,
      explicitDocId: DOC_PHOTO,
      message: "can you read the wire numbers in the photo",
      call,
    });
    expect(out!.notFoundFilename).toBeNull();
  });
});

describe("9. transcriptionOf strips the provenance header the citation must not show", () => {
  const result: PhotoRereadResult = {
    docId: DOC_PHOTO,
    fileId: PHOTO_FILE,
    filename: "panel.jpg",
    observation: 'Terminal block reads "X1-14", "X1-15", "X1-16".',
    found: true,
    model: "MiniMaxAI/MiniMax-M3",
    latencyMs: 900,
    imageBytes: 4,
    promptTokens: 10,
    completionTokens: 5,
  };

  it("returns the transcription, not the header", () => {
    const body = transcriptionOf(rereadChunk(result).content);
    expect(body).toBe(result.observation);
    expect(body).not.toContain("Values are transcriptions");
    expect(body).not.toContain("by a vision reader");
  });

  it("a multi-paragraph transcription survives whole", () => {
    const multi = { ...result, observation: "Top block:\n\nX1-14\n\nX1-15" };
    expect(transcriptionOf(rereadChunk(multi).content)).toBe(multi.observation);
  });

  it("text with no header is returned unchanged (never empties a real chunk)", () => {
    expect(transcriptionOf("Terminal 4.")).toBe("Terminal 4.");
  });
});

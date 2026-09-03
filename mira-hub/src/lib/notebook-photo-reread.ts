/**
 * NOTEBOOK PHOTO RE-READ — make "read the wire numbers off this photo" actually
 * work, instead of declining honestly.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT CAME BEFORE, AND WHY THIS IS THE NEXT RUNG
 *
 * `photo-source-honesty.ts` fixed a FALSEHOOD. Observed on a Pixel 9a against
 * production 2026-09-02: a notebook had two photo-derived sources attached and
 * checkbox-included, the technician asked "Can you read the wire numbers from
 * the photo that's attached?", and MIRA answered "No photo was included in the
 * provided sources." That was false, and the directive now forbids it.
 *
 * But that fix's CEILING is an honest decline. The technician's request is
 * completely reasonable: the photograph is right there in the Sources sheet,
 * with a thumbnail, and one of them is visibly a wired control panel. MIRA's
 * pipeline ALREADY reads photographs with a vision model — at nameplate-confirm
 * time, into a stored `.txt` doc. The gap is that the stored extraction is
 * NAMEPLATE-SHAPED (identity and spec fields), so a question about wire numbers
 * on a panel finds nothing in it, and the answer stops at "attached, but the
 * extraction doesn't contain that detail."
 *
 * This module closes that gap by re-reading the SAME stored photograph, at
 * answer time, ASKING THE TECHNICIAN'S ACTUAL QUESTION.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE FIVE PROPERTIES THAT MAKE IT SHIPPABLE
 *
 * 1. DEFAULT OFF. `photoRereadEnabled()` is read FIRST, before any other work.
 *    With `NOTEBOOK_PHOTO_REREAD_ENABLED` unset the module does nothing at all
 *    and the turn is byte-identical to the honesty-directive baseline. That is
 *    what lets this merge without changing production.
 *
 * 2. THE TRIGGER IS DETERMINISTIC, NOT A MODEL CALL. A classifier call costs the
 *    same order as the thing it would gate, so gating with one buys nothing. Two
 *    doors: an EXPLICIT `photoRead.docId` naming an in-scope photo source, or a
 *    HEURISTIC needing BOTH a PICTURE NOUN and a read verb / visual-target noun.
 *    Requiring both halves is the whole point — "what's the torque spec for the
 *    coupling?" must not fire in a notebook full of photographs, and neither
 *    must "look at the manual and see what the recommended oil is" (a bare
 *    "look at" / "the attached" points at a DOCUMENT just as readily). Both
 *    doors respect the NOT_A_READ negative list.
 *
 * 3. THE COVERAGE PROBE MAKES THE COMMON CASE FREE. If the stored extraction
 *    already contains a lexical hit for what was asked, the honesty directive
 *    answers correctly at ZERO marginal cost and no vision call is made.
 *    Deliberately conservative: ANY hit suppresses. Nameplate questions — the
 *    overwhelming majority of photo turns — keep costing nothing.
 *
 * 4. THE VISION MODEL TRANSCRIBES; IT NEVER DIAGNOSES. `PHOTO_REREAD_PROMPT` is
 *    modelled on the LOOK route's INSPECTION_PROMPT: copy what is printed, never
 *    name a root cause, never guess a digit, and say `found:false` rather than
 *    invent. This preserves `nameplate/evidence.ts`'s law that vision produces
 *    CANDIDATES, never truth — the grounded text model still does the reasoning,
 *    over a transcription that is labelled as one.
 *
 * 5. FAILURE DEGRADES TO THE HONEST DECLINE, NEVER TO A FABRICATION. Timeout,
 *    provider error, missing key, unauthorized file, oversized bytes, an empty
 *    observation, a POLICY REFUSAL, or a reply whose `found` is missing or not a
 *    boolean: every one returns `null`, the turn proceeds exactly as it would
 *    have with the flag off, and the honesty directive is STILL in the prompt.
 *    There is no path in which MIRA claims to have seen an image it did not
 *    receive, and none in which prose that is not a transcription is served
 *    under the transcription header.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROVIDER (Hard Constraint #2 — Groq → Cerebras → Together, NEVER Anthropic)
 *
 * Of the three, only TOGETHER serves vision today. Evidence, not assumption:
 *   · `tools/provider_health_check.py:19` — "providers that carry a vision model
 *     (today: Together)".
 *   · `src/lib/nameplate/index.ts:101` — "Groq has no default: it ships no
 *     vision model today, so it is opt-in only" (needs an explicit model id).
 *   · Cerebras carries no vision model in the health check's provider table.
 * So this is a ONE-PROVIDER path by fact, not by preference: one call, no retry,
 * no `NAMEPLATE_VISION_FALLBACK_MODELS` walk, no second provider to fall to.
 * Enabling the flag without `TOGETHERAI_API_KEY` is a silent no-op, not an
 * error — the turn answers exactly as it does today.
 */
import type { ManualChunk } from "@/lib/manual-rag";
import type { NotebookSource } from "@/lib/equipment-notebooks";
import type { PhotoSourceRef } from "@/lib/photo-source-honesty";
import { photoSourcesInScope } from "@/lib/photo-source-honesty";
import { fixtureSelected, togetherVisionModel } from "@/lib/nameplate";
import { safeJson, togetherVisionCall, type VisionCall } from "@/lib/nameplate/passes";
import { readLinkedPhotoBytes } from "@/lib/notebook-photo-bytes";
import type { NotebookPhotoReadFrame } from "@/lib/notebook-chat-types";

// ── Configuration ────────────────────────────────────────────────────────────
// Compose maps `${VAR:-}` to an EMPTY STRING in-container, so every read here
// uses the `||` fallback form rather than `??` (the same trap documented in
// nameplate/index.ts). An undeclared flag never reaches the container at all.

/** THE merge-safety switch. Read before anything else happens. */
export function photoRereadEnabled(): boolean {
  return process.env.NOTEBOOK_PHOTO_REREAD_ENABLED === "1";
}

function clampInt(raw: string | undefined, def: number, lo: number, hi: number): number {
  const n = Number.parseInt(raw || "", 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

/** Hard wall-clock ceiling on the vision call. A photo turn must never hang a
 *  technician's chat: 12 s is the cap, 3–20 s the admissible range. */
export function photoRereadTimeoutMs(): number {
  return clampInt(process.env.PHOTO_REREAD_TIMEOUT_MS, 12_000, 3_000, 20_000);
}

/** Bytes ceiling per photograph. Enforced in SQL (`octet_length`) so oversized
 *  bytes never enter the heap; 4 MiB default, 8 MiB absolute — the same wall
 *  the LOOK intake door uses. */
export function photoRereadMaxBytes(): number {
  return clampInt(process.env.PHOTO_REREAD_MAX_BYTES, 4_194_304, 1, 8_388_608);
}

/** How many attached photographs one turn may re-read. Default ONE — cost and
 *  latency are per-image and this is a chat turn, not a batch job. */
export function photoRereadMaxImages(): number {
  return clampInt(process.env.PHOTO_REREAD_MAX_IMAGES, 1, 1, 2);
}

// ── Trigger ──────────────────────────────────────────────────────────────────

/** Something in the question POINTS AT A PICTURE. Without this half, a notebook
 *  that happens to contain photographs would pay a vision call for every
 *  question that mentions a terminal. */
// A PICTURE NOUN, and nothing weaker. The earlier alternation also admitted the
// bare phrases "look at", "the attached", "this shot" and "in the frame" — every
// one of which points at a DOCUMENT as readily as a photograph. Measured with
// the flag on and one photo in scope, each of these bought a vision call:
//   "Can you look at the manual and see what the recommended oil is?"
//   "Look at the wiring diagram and tell me what it says about grounding."
//   "What is the part number in the attached datasheet?"
// and the coverage probe cannot suppress them — with no TARGET_TOKEN in the
// message `intent.targets` is empty and `extractionCoversIntent` returns false
// at its first line, so nothing is ever suppressed for a target-less
// over-trigger. Worse than the bill: an over-triggered read that returns
// `found:true` pushes an irrelevant transcription as the turn's ONLY evidence,
// converting an honest abstain into an answer grounded on the wrong picture.
const PICTURE_REFERENT =
  /\b(photos?|photographs?|pictures?|images?|pics?|snapshots?|thumbnails?)\b/i;

/** Something in the question ASKS FOR SOMETHING TO BE READ OFF IT. The verbs and
 *  the visual-target nouns are one alternation because either alone is a
 *  sufficient second half ("read the photo" / "wire numbers in the picture"). */
const READ_INTENT =
  /\b(read|reads|see|says?|show|shows|transcribe|zoom)\b|what does it say|\bwire numbers?\b|\bterminals?\b|\blabels?\b|\btag numbers?\b|\blegends?\b|\bgauges?\b|\bdisplays?\b|\bleds?\b|\bindicators?\b|\blamps?\b|\bnameplates?\b|\bpart numbers?\b|\bserials?\b|\bmarkings?\b|\bcolou?r of\b|\bposition of\b|\bconnected to\b/i;

/** Questions ABOUT the picture-as-a-file, not about what is printed on it.
 *  These carry a referent and often a verb, and must never buy a vision call. */
const NOT_A_READ =
  /\bdid (my|the) (photo|photograph|picture|image|pic) upload\b|\bhow do i attach\b|\bhow do i upload\b|\bdelete (that|the|this) (photo|photograph|picture|image|pic)\b|\bsend me the (photo|photograph|picture|image)\b|\b(photo|picture|image) upload (ok|okay|fine|work)\b/i;

/** The visual-target vocabulary, kept separate from the verbs because ONLY
 *  these are probe-able: the coverage probe looks for them in the stored
 *  extraction. A verb ("read") appearing in a manual excerpt proves nothing. */
const TARGET_TOKENS: readonly string[] = [
  "wire number",
  "terminal",
  "label",
  "tag number",
  "legend",
  "gauge",
  "display",
  "led",
  "indicator",
  "lamp",
  "nameplate",
  "part number",
  "serial",
  "marking",
];

/** Above this the message is a paste or a narrative, not "read this photo". */
const MAX_TRIGGER_CHARS = 500;

export type PhotoReadIntent = { hit: boolean; targets: string[]; docId?: string };

/**
 * Deterministic trigger. NO model call — a classifier would cost the same order
 * as the vision call it gates.
 *
 * EXPLICIT door: `body.photoRead.docId` naming an in-scope photo source wins
 * over PICTURE_REFERENT and READ_INTENT; the technician pointed at a specific
 * picture, which is a stronger referent than any regex, and requiring a read
 * verb as well would defeat the point of the door ("what's on this?").
 *
 * IT DOES, HOWEVER, STILL RESPECT `NOT_A_READ`. The door used to return
 * `hit:true` UNCONDITIONALLY, so a client that always sets `photoRead.docId`
 * bought a vision call on every turn — including "did my photo upload ok?" and
 * "delete that picture", which are questions about the picture-as-a-file and can
 * never be answered by looking at it. Pointing at a picture says WHICH picture;
 * it does not say that the question is about what is printed on it.
 *
 * HEURISTIC door: short message AND a picture referent AND a read intent AND
 * not in the negative list.
 */
export function photoReadIntent(message: string, explicitDocId?: string | null): PhotoReadIntent {
  const targetsIn = (text: string) => {
    const lower = text.toLowerCase();
    return TARGET_TOKENS.filter((t) => lower.includes(t));
  };
  const m = (message || "").trim();
  if (explicitDocId) {
    if (NOT_A_READ.test(m)) return { hit: false, targets: [] };
    return { hit: true, targets: targetsIn(message), docId: explicitDocId };
  }

  if (m.length === 0 || m.length > MAX_TRIGGER_CHARS) return { hit: false, targets: [] };
  if (NOT_A_READ.test(m)) return { hit: false, targets: [] };
  if (!PICTURE_REFERENT.test(m)) return { hit: false, targets: [] };
  if (!READ_INTENT.test(m)) return { hit: false, targets: [] };
  return { hit: true, targets: targetsIn(m) };
}

/**
 * THE MISS PROBE — the thing that keeps this feature nearly free.
 *
 * If a retrieved chunk that came from a PHOTO-DERIVED document already mentions
 * what was asked about, the stored extraction covers the question and the
 * honesty directive answers it from text at zero marginal cost. Only a question
 * whose answer is genuinely ABSENT from the extraction pays for a vision call.
 *
 * Deliberately conservative in the cheap direction: ANY lexical hit suppresses.
 * A false suppression costs an honest "the extraction doesn't contain that";
 * a false trigger costs money on every nameplate question in the product.
 */
export function extractionCoversIntent(
  chunks: Pick<ManualChunk, "content" | "docId">[],
  photoDocIds: string[],
  targets: string[],
): boolean {
  if (targets.length === 0) return false;
  const photo = new Set(photoDocIds);
  for (const c of chunks) {
    if (!c.docId || !photo.has(c.docId)) continue;
    const lower = (c.content || "").toLowerCase();
    if (targets.some((t) => lower.includes(t))) return true;
  }
  return false;
}

// ── Selection ────────────────────────────────────────────────────────────────

export type PhotoCandidate = {
  /** The SOURCE ROW's doc id — what the citation is attributed to. */
  docId: string;
  /** The IMAGE's file id — what is authorized and read. */
  imageFileId: string;
  filename: string;
};

const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "from", "with", "and",
  "or", "is", "are", "was", "were", "be", "can", "you", "i", "my", "that",
  "this", "it", "what", "which", "read", "photo", "picture", "image", "attached",
]);

function contentWords(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

/**
 * Which attached photograph to read, deterministically.
 *
 * THE IMAGE ID IS `originFileId ?? fileId`. Two source shapes produce a photo
 * row and they resolve differently:
 *   · nameplate-confirm — the row is the extracted `.txt` doc and
 *     `originFileId` is the PHOTOGRAPH it was read from. Use that.
 *   · photo attached/OCR'd directly — `originFileId` is NULL and the row's own
 *     `fileId` IS the photograph. Use that.
 * Getting this backwards sends a text file to a vision model.
 *
 * Order: explicit docId > most content-word overlap with the question >
 * most recently added (listSources returns created_at ASC) > docId ascending.
 * Every tie is broken, so the same turn always reads the same picture.
 */
export function selectPhotoToRead(
  inScope: PhotoSourceRef[],
  sources: NotebookSource[],
  intent: PhotoReadIntent,
  message: string,
  maxImages: number,
): PhotoCandidate[] {
  const byDoc = new Map<string, { src: NotebookSource; order: number }>();
  sources.forEach((s, order) => byDoc.set(s.docId, { src: s, order }));

  const candidates: (PhotoCandidate & { order: number; overlap: number })[] = [];
  for (const ref of inScope) {
    const entry = byDoc.get(ref.docId);
    if (!entry) continue;
    // Shape A (nameplate-confirm): originFileId is the photograph.
    // Shape B (photo attached directly): originFileId is NULL, fileId is it.
    const imageFileId = entry.src.originFileId ?? entry.src.fileId;
    if (!imageFileId) continue;
    const filename = ref.filename || entry.src.filename || "attached photo";
    const qWords = new Set(contentWords(message));
    const overlap = contentWords(filename).filter((w) => qWords.has(w)).length;
    candidates.push({ docId: ref.docId, imageFileId, filename, order: entry.order, overlap });
  }

  if (intent.docId) {
    const explicit = candidates.filter((c) => c.docId === intent.docId);
    // An explicit id that is NOT an in-scope photo is not silently widened to
    // "read whatever else is attached" — the technician pointed somewhere.
    if (explicit.length === 0) return [];
    return explicit.slice(0, Math.max(1, maxImages)).map(strip);
  }

  candidates.sort(
    (a, b) => b.overlap - a.overlap || b.order - a.order || (a.docId < b.docId ? -1 : a.docId > b.docId ? 1 : 0),
  );
  return candidates.slice(0, Math.max(1, maxImages)).map(strip);
}

function strip(c: PhotoCandidate & { order: number; overlap: number }): PhotoCandidate {
  return { docId: c.docId, imageFileId: c.imageFileId, filename: c.filename };
}

// ── The vision pass ──────────────────────────────────────────────────────────

/**
 * TRANSCRIPTION ONLY. Modelled on the LOOK route's INSPECTION_PROMPT, narrowed
 * from "describe the frame" to "copy what is printed, for THIS question".
 *
 * The `found` flag is what makes the honest failure possible: a vision model
 * told to answer will answer, and a guessed wire number in a maintenance answer
 * is worse than no answer. Given an explicit way to say "not legible", it takes
 * it — and the route then declines with a better sentence instead of inventing.
 */
export const PHOTO_REREAD_PROMPT = `You are reading a photograph a maintenance technician attached to their equipment notebook. They have asked a question about something printed or visible IN this photograph.

Your ONLY job is to TRANSCRIBE what is actually in the image:
- Copy text, numbers, wire numbers, terminal markings, labels, legends, tag numbers and displayed values EXACTLY as printed, character for character, including decimal points, hyphens, slashes and leading zeros.
- Report indicator/LED/switch states only as you can actually see them (lit / unlit / colour / text shown).
- Say where in the frame something is when that disambiguates it (e.g. "top-left terminal block").

Rules — these outrank being helpful:
- NEVER diagnose, NEVER name a root cause, NEVER recommend a repair or a next step. You transcribe; another system reasons.
- NEVER guess a digit, character, wire number, terminal or label you cannot actually read. If a character is ambiguous, say WHICH character is ambiguous and what it might be.
- NEVER describe anything hidden, internal, inferred or out of frame.
- If the detail the technician asked about is not legible, not present, or not in frame, set "found" to false and say plainly what you could and could not read.

Respond ONLY with JSON: {"observation": string, "found": boolean}`;

/**
 * PROVIDER REFUSALS — prose that declines the task rather than transcribing it.
 *
 * Deliberately narrow: it matches a decline-to-ASSIST shape (the verb list is
 * assist / help / comply / identify / provide / answer / describe / analyse),
 * an "as an AI" preamble, an apology that continues into the first person, or
 * an explicit policy sentence. It must NOT match an honest transcription that
 * happens to admit an unreadable character ("I can't read the last character;
 * it is a 4 or a 1") — that is exactly the behaviour the prompt asks for, and
 * `found:false` is the channel for it.
 */
const VISION_REFUSAL =
  /\b(?:can(?:'|’)?t|cannot|can not|won(?:'|’)?t|will not|unable to|not able to|refuse to)\s+(?:assist|help|comply|identify|provide|answer|describe|analy[sz]e)\b|\bas an ai\b|\bi(?:'|’)?m (?:sorry|afraid),?\s+(?:but\s+)?i\b|\bagainst (?:my|our) (?:policy|guidelines)\b|\bi (?:can(?:'|’)?t|cannot) (?:assist|help) with (?:that|this)\b/i;

export type PhotoRereadResult = {
  docId: string;
  fileId: string;
  filename: string;
  observation: string;
  found: boolean;
  model: string;
  latencyMs: number;
  imageBytes: number;
  promptTokens: number | null;
  completionTokens: number | null;
};

/** Deterministic stand-in for NAMEPLATE_RECOGNIZER=fixture — no network, same
 *  contract as the LOOK route's fixture. */
const fixtureVisionCall: VisionCall = async () => ({
  text: JSON.stringify({
    observation: 'Fixture transcription: terminal block reads "X1-14", "X1-15", "X1-16".',
    found: true,
  }),
  model: "fixture",
});

type VisionUsage = { prompt_tokens?: unknown; completion_tokens?: unknown };

function tokenCount(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Why a read produced nothing. These are kept DISTINCT on purpose: on the first
 * day the flag is enabled, "the picture was not authorized for this notebook"
 * and "Together is down / TOGETHERAI_API_KEY is unset" look identical from the
 * technician's side but demand opposite responses from the operator. Collapsing
 * them into one "it didn't work" would make the rollout unreadable.
 */
export type PhotoRereadFailure =
  | "bytes_unavailable"
  | "provider_error"
  | "empty_response"
  /**
   * The model returned prose that is NOT a transcription: a policy refusal
   * ("I'm sorry, I can't assist with identifying people or details in images."
   * — realistic the moment a factory photograph contains a person), or a reply
   * whose `found` is missing or not a boolean. Both used to slip through the
   * never-fabricates contract, which enumerated error / timeout / empty /
   * corrupt but not these: the prose was wrapped in the server-authored
   * "Values are transcriptions of what is printed in the photograph" header,
   * pushed as a chunk, cited with provenance `live_photo_read`, and it flipped
   * Gate G from an honest abstain to "answered".
   *
   * Downstream this takes the IDENTICAL path to `empty_response` — no chunk,
   * no citation, no directive, no Gate-G flip, degrading to the flag-off
   * decline. It is a distinct LABEL only, because "the model refused" and "the
   * model returned nothing" demand different operator responses.
   */
  | "refused";

export type PhotoRereadAttempt =
  | { ok: true; result: PhotoRereadResult }
  | { ok: false; reason: PhotoRereadFailure };

/**
 * Read ONE authorized photograph and return a transcription, or a reason.
 *
 * NO NAMEPLATE CROP. `resolveRecognitionImage` crops to the NAMEPLATE region —
 * exactly wrong for "read the wire numbers off this panel", where the crop would
 * silently discard the region that was asked about.
 *
 * NO RESIZE. `sharp` is not a declared dependency of this app (preprocess.ts
 * reserves that decision for a human), and this module must not add one. SQL-side
 * rejection at `photoRereadMaxBytes()` is the ONLY size control, which is why it
 * is a hard wall rather than a hint.
 *
 * ONE CALL. No retry, no fallback-model walk, no second provider (there is no
 * second vision provider in the cascade). Any throw — including the AbortSignal
 * timeout — is logged with the message scrubbed to its `recognizer_provider_error_<n>`
 * shape and returns `null`.
 */
export async function rereadPhotoForQuestion(input: {
  tenantId: string;
  notebookId: string;
  candidate: PhotoCandidate;
  question: string;
  call?: VisionCall;
}): Promise<PhotoRereadAttempt> {
  const { tenantId, notebookId, candidate, question } = input;
  const photo = await readLinkedPhotoBytes(
    tenantId,
    candidate.imageFileId,
    "equipment_notebook",
    notebookId,
    photoRereadMaxBytes(),
  );
  // Not authorized for this notebook/tenant, not a raster, mislabelled bytes,
  // or over the cap. Indistinguishable here on purpose (no existence oracle);
  // distinguishable from a PROVIDER failure, which is what an operator needs.
  if (!photo) return { ok: false, reason: "bytes_unavailable" };

  const call = input.call ?? (fixtureSelected() ? fixtureVisionCall : togetherVisionCall);
  const prompt = `${PHOTO_REREAD_PROMPT}\n\nThe technician asked: "${question}"\nTranscribe what in this photograph relates to that question. Do not answer beyond what the photograph shows.`;
  const startedAt = Date.now();
  try {
    const reply = await call({
      prompt,
      images: [{ base64: photo.buffer.toString("base64"), mimeType: photo.mimeType }],
      temperature: 0.1,
      maxTokens: 700,
      timeoutMs: photoRereadTimeoutMs(),
    });
    const latencyMs = Date.now() - startedAt;
    const parsed = safeJson(reply.text);
    const observation =
      parsed && typeof parsed.observation === "string" ? parsed.observation.trim() : "";
    if (!observation) return { ok: false, reason: "empty_response" };
    // A REFUSAL is not a transcription. Checked before `found`, because a
    // refusal that also claims `found:true` is still a refusal.
    if (VISION_REFUSAL.test(observation)) return { ok: false, reason: "refused" };
    // `found` MUST be an explicit boolean. It used to default TRUE when the key
    // was absent, which is exactly how refusal prose (which carries no `found`)
    // became a citable "transcription". A reply that will not say whether it
    // found the detail has not told us it did.
    if (!parsed || typeof parsed.found !== "boolean") return { ok: false, reason: "refused" };
    const found = parsed.found;
    const usage = (parsed as { usage?: VisionUsage } | null)?.usage;
    const raw = (reply as unknown as { usage?: VisionUsage }).usage ?? usage;
    return {
      ok: true,
      result: {
        docId: candidate.docId,
        fileId: photo.fileId,
        filename: candidate.filename,
        observation,
        found,
        model: reply.model || togetherVisionModel(),
        latencyMs,
        imageBytes: photo.buffer.length,
        promptTokens: tokenCount(raw?.prompt_tokens),
        completionTokens: tokenCount(raw?.completion_tokens),
      },
    };
  } catch (err) {
    // PRD §20: never log provider free text (it can carry a query-string key).
    // Only the `recognizer_provider_error_<n>` / `recognizer_not_configured`
    // token shape survives; anything else collapses to one constant.
    const msg = err instanceof Error ? err.message : "vision_failed";
    const safe = /^[a-z0-9_]+$/i.test(msg) ? msg : "recognizer_provider_error_unknown";
    console.warn(`[notebook-photo-reread] vision call failed (continuing without it): ${safe}`);
    return { ok: false, reason: "provider_error" };
  }
}

// ── Turning a transcription into evidence ────────────────────────────────────

/** The sentinel URL scheme. It is what guarantees the transcription gets its
 *  OWN citation number: `manual-rag`'s `sourceKey` is `sourceUrl::sourcePage`,
 *  so a per-file sentinel can never merge into a retrieved chunk of the same
 *  document. */
export const PHOTO_REREAD_URL_PREFIX = "photo-reread://";

export function photoRereadSourceUrl(fileId: string): string {
  return `${PHOTO_REREAD_URL_PREFIX}${fileId}`;
}

/** The blank line between the provenance header and the transcription. */
const TRANSCRIPTION_SEPARATOR = "\n\n";

/**
 * The INVERSE of `rereadChunk`'s header composition: the transcription alone.
 *
 * The header is server-authored provenance boilerplate for the CHAT MODEL. A
 * technician who taps the citation chip to check a vision-derived claim needs
 * the transcribed characters, and the claim-centered quote window scored the
 * header higher than the transcription for the very question that produced it
 * ("read … from … the attached photo…" is nearly the header's own wording), so
 * the surface rendered "Text read directly from the attached photograph …"
 * where "X1-14" belonged — a vision-derived claim traceable to nothing that was
 * actually transcribed.
 *
 * Lives here, next to the composer, so the two can never drift apart. Returns
 * the input unchanged when there is no header, so it can never empty a chunk.
 */
export function transcriptionOf(content: string): string {
  const i = content.indexOf(TRANSCRIPTION_SEPARATOR);
  if (i === -1) return content;
  const body = content.slice(i + TRANSCRIPTION_SEPARATOR.length).trim();
  return body || content;
}

/**
 * The transcription, shaped as a `ManualChunk` so it rides the EXISTING
 * grounding path — same `[n]` numbering, same citation chip, same 1200-char
 * truncation — with no new prompt plumbing.
 *
 * WHY THE FIELDS ARE WHAT THEY ARE (verified against `buildGroundedContext`):
 *   · `manufacturer` and `modelNumber` are EMPTY, because that function renders
 *     `[manufacturer, modelNumber].filter(Boolean).join(" ") || title`. Empty
 *     strings mean the model literally sees `[n] Photo: <filename> (read on
 *     request)` — never a header that looks like an OEM manual.
 *   · `sourcePage` is null: a photograph has no page, and `displayPage` then
 *     renders no `p.N`.
 *   · The content OPENS with a provenance sentence naming the reader and the
 *     time, and saying these are TRANSCRIPTIONS, NOT MANUAL SPECIFICATIONS. The
 *     model is being handed a value it must not treat as an OEM rating.
 */
export function rereadChunk(result: PhotoRereadResult): ManualChunk {
  const header =
    `Text read directly from the attached photograph "${result.filename}" by a vision reader ` +
    `just now, in answer to this question (reader: ${result.model}, ${new Date().toISOString()}). ` +
    `Values are transcriptions of what is printed in the photograph, not manual specifications.`;
  return {
    content: `${header}${TRANSCRIPTION_SEPARATOR}${result.observation}`,
    docId: result.docId,
    manufacturer: "",
    modelNumber: "",
    sourceUrl: photoRereadSourceUrl(result.fileId),
    sourcePage: null,
    title: `Photo: ${result.filename} (read on request)`,
    // Nothing re-sorts `chunks` after retrieval on this route (order is
    // first-appearance), so this only has to be a valid number.
    rank: 1,
  };
}

/**
 * The `found:false` prompt line — and ONLY that case.
 *
 * A vision reader that looked and could not read is strictly more information
 * than the baseline decline, and the model must pass that on rather than
 * regress to "the extraction doesn't contain it" (or, worse, to a guess).
 * Returns "" for every other case, so the composed prompt is unchanged.
 */
export function rereadDirective(result: PhotoRereadResult | null): string {
  if (!result || result.found) return "";
  return (
    `\n- PHOTO RE-READ: a vision reader looked at the attached photograph "${result.filename}" again just now, ` +
    `specifically for this question, and could NOT read the requested detail in it. ` +
    `Say that the photograph WAS re-read and that the detail is not legible or not in frame. ` +
    `Never say no photograph was provided, and never state a value you were not given.`
  );
}

/**
 * Structured observability. THIS IS THE FIRST HUB VISION CALL SITE TO CAPTURE
 * `usage` AND WALL TIME — every cost and latency number in this feature's
 * design is an estimate until these lines exist in a log. Deliberately carries
 * no free text and no transcription: the question and the answer already live
 * in `equipment_notebook_turns`.
 */
export function photoRereadObservation(input: {
  tenantId: string;
  notebookId: string;
  triggered: boolean;
  suppressedBy: string | null;
  model: string | null;
  latencyMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  imageBytes: number | null;
  found: boolean | null;
  refused: boolean;
}): Record<string, unknown> {
  return {
    service: "mira-hub",
    component: "notebook-chat",
    event: "photo.reread",
    tenantId: input.tenantId,
    notebookId: input.notebookId,
    triggered: input.triggered,
    suppressedBy: input.suppressedBy,
    model: input.model,
    latencyMs: input.latencyMs,
    promptTokens: input.promptTokens,
    completionTokens: input.completionTokens,
    imageBytes: input.imageBytes,
    found: input.found,
    refused: input.refused,
  };
}

// ── The one function the route calls ─────────────────────────────────────────

export type PhotoRereadOutcome = {
  /** 0..maxImages transcription chunks to append to the turn's evidence. */
  chunks: ManualChunk[];
  /** Extra prompt line for the `found:false` case; "" otherwise. */
  directive: string;
  /** Sentinel source URLs, so `buildCitations` can mark their provenance. */
  liveReadUrls: Set<string>;
  /** Additive SSE frame describing what happened. */
  frame: NotebookPhotoReadFrame;
  /** Structured log line. */
  observation: Record<string, unknown>;
  /** True when a re-read happened and the detail was NOT legible. */
  readButNotFound: boolean;
  /**
   * The filename of the photograph that was ACTUALLY fetched and read on the
   * not-found path; `null` otherwise.
   *
   * Exists so the technician-facing sentence can NAME it. With more than one
   * photograph attached, `selectPhotoToRead` picks by filename overlap and then
   * by recency — so with camera-default names (IMG_20260901_101122.jpg,
   * IMG_20260901_143355.jpg) the picture read is NOT necessarily the one the
   * technician meant. Saying "the attached photograph" was re-read and is
   * illegible is then false twice over: about which picture was read, and about
   * the one they asked about, which was never fetched at all. The surface must
   * only assert what the server can prove — which file it read.
   */
  notFoundFilename: string | null;
};

/**
 * Returns `null` when NOTHING happened — flag off, no picture in scope, or the
 * question was not about a picture. `null` means the turn is byte-identical to
 * the honesty-directive baseline: no frame, no log line, no provider call.
 *
 * CALLER CONTRACT: only call this once notebook ownership is established
 * (`validated.ok` on the chat route) — see `notebook-photo-bytes.ts`'s "the one
 * leg this module cannot prove".
 */
export async function maybeRereadPhoto(input: {
  tenantId: string;
  notebookId: string;
  message: string;
  chunks: Pick<ManualChunk, "content" | "docId">[];
  docIds: string[];
  explicitDocId?: string | null;
  sources: NotebookSource[];
  call?: VisionCall;
}): Promise<PhotoRereadOutcome | null> {
  // 1. THE FLAG, first, before any work at all.
  if (!photoRereadEnabled()) return null;

  const inScope = photoSourcesInScope(input.sources, input.docIds);
  if (inScope.length === 0) return null;

  // 2. Deterministic trigger — no model call.
  const intent = photoReadIntent(input.message, input.explicitDocId ?? null);
  if (!intent.hit) return null;

  const candidates = selectPhotoToRead(
    inScope,
    input.sources,
    intent,
    input.message,
    photoRereadMaxImages(),
  );
  if (candidates.length === 0) return null;

  const base = { tenantId: input.tenantId, notebookId: input.notebookId };
  const empty = (frame: NotebookPhotoReadFrame, suppressedBy: string | null): PhotoRereadOutcome => ({
    chunks: [],
    directive: "",
    liveReadUrls: new Set<string>(),
    frame,
    observation: photoRereadObservation({
      ...base,
      triggered: false,
      suppressedBy,
      model: null,
      latencyMs: null,
      promptTokens: null,
      completionTokens: null,
      imageBytes: null,
      found: null,
      refused: false,
    }),
    readButNotFound: false,
    notFoundFilename: null,
  });

  // 3. The miss probe — the stored extraction may already answer this, for free.
  if (extractionCoversIntent(input.chunks, inScope.map((s) => s.docId), intent.targets)) {
    return empty(
      { kind: "photo_read", state: "skipped", reason: "extraction_covers" },
      "extraction_covers",
    );
  }

  // 4. The read. One call per selected photograph (default: exactly one).
  const results: PhotoRereadResult[] = [];
  let failure: PhotoRereadFailure | null = null;
  for (const candidate of candidates) {
    const attempt = await rereadPhotoForQuestion({
      tenantId: input.tenantId,
      notebookId: input.notebookId,
      candidate,
      question: input.message,
      call: input.call,
    });
    if (attempt.ok) results.push(attempt.result);
    else failure = failure ?? attempt.reason;
  }

  if (results.length === 0) {
    // Unauthorized, unreadable, oversized, unconfigured, timed out, or errored.
    // Identical in EFFECT to the flag being off — the honesty directive still
    // stands and the turn answers as before — but the reason is recorded, so a
    // provider outage is not mistaken for an authorization refusal.
    const reason = failure ?? "bytes_unavailable";
    return empty({ kind: "photo_read", state: "unavailable", reason }, reason);
  }

  const read = results.filter((r) => r.found);
  const missed = results.find((r) => !r.found) ?? null;
  const first = results[0];

  return {
    chunks: read.map(rereadChunk),
    directive: rereadDirective(missed),
    liveReadUrls: new Set(read.map((r) => photoRereadSourceUrl(r.fileId))),
    frame: {
      kind: "photo_read",
      state: "read",
      found: read.length > 0,
      filename: first.filename,
    },
    observation: photoRereadObservation({
      ...base,
      triggered: true,
      suppressedBy: null,
      model: first.model,
      latencyMs: results.reduce((a, r) => a + r.latencyMs, 0),
      promptTokens: results.reduce<number | null>(
        (a, r) => (r.promptTokens == null ? a : (a ?? 0) + r.promptTokens),
        null,
      ),
      completionTokens: results.reduce<number | null>(
        (a, r) => (r.completionTokens == null ? a : (a ?? 0) + r.completionTokens),
        null,
      ),
      imageBytes: results.reduce((a, r) => a + r.imageBytes, 0),
      found: read.length > 0,
      refused: read.length === 0,
    }),
    readButNotFound: read.length === 0 && missed !== null,
    notFoundFilename: read.length === 0 && missed ? missed.filename : null,
  };
}

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
 * THE FOUR PROPERTIES THAT MAKE IT SHIPPABLE
 *
 * 1. DEFAULT OFF. `photoRereadEnabled()` is read FIRST, before any other work.
 *    With `NOTEBOOK_PHOTO_REREAD_ENABLED` unset the module does nothing at all
 *    and the turn is byte-identical to the honesty-directive baseline. That is
 *    what lets this merge without changing production.
 *
 * 2. THE TRIGGER IS THE POINTER — nothing is inferred from phrasing. The turn
 *    reads a photograph if, and only if, the client named one
 *    (`photoRead.docId`) that is already one of THIS turn's revalidated
 *    in-scope photo sources. NO docId, NO read, whatever the wording.
 *
 *    A phrasing heuristic was tried twice and measured twice, and it cannot
 *    work. Round A (bare "look at" / "the attached") fired on ordinary manual
 *    questions. Round B narrowed the referent to picture nouns only and still
 *    fired on 4 of 11 natural document questions ("In the datasheet image, what
 *    is the part number?", "What does the image on page 12 of the manual say
 *    about the terminals?", "Is there a picture of the terminal layout in the
 *    manual?", "Can you find an image in the PDF that shows the nameplate?")
 *    while LOSING true positives it used to catch ("Read the wire numbers off
 *    the attached."). The distinguishing feature is whether the picture is AN
 *    ATTACHED PHOTOGRAPH or A FIGURE INSIDE A DOCUMENT — a semantic distinction
 *    a regex keeps trading in both directions. Worse than the bill: an
 *    over-triggered read that returns `found:true` pushes an irrelevant
 *    transcription as the turn's ONLY evidence, converting an honest abstain
 *    into an answered turn grounded on the wrong picture.
 *
 *    The pointer has zero false positives and zero false negatives BY
 *    CONSTRUCTION, and it is already authorization-bounded on two independent
 *    legs (`selectPhotoToRead` intersects it with this turn's revalidated
 *    in-scope photo sources; `readLinkedPhotoBytes` re-proves tenant + notebook
 *    linkage). It still respects the NOT_A_READ negative list: pointing says
 *    WHICH picture, not that the question is about what is printed on it.
 *
 * 3. THE VISION MODEL TRANSCRIBES; IT NEVER DIAGNOSES. `PHOTO_REREAD_PROMPT` is
 *    modelled on the LOOK route's INSPECTION_PROMPT: copy what is printed, never
 *    name a root cause, never guess a digit, and say `found:false` rather than
 *    invent. This preserves `nameplate/evidence.ts`'s law that vision produces
 *    CANDIDATES, never truth — the grounded text model still does the reasoning,
 *    over a transcription that is labelled as one.
 *
 * 4. FAILURE DEGRADES TO THE HONEST DECLINE, NEVER TO A FABRICATION. Timeout,
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

// ── Trigger ──────────────────────────────────────────────────────────────────

/** Questions ABOUT the picture-as-a-file, not about what is printed on it.
 *  Pointing at a picture says WHICH picture; it does NOT say the question is
 *  about what is printed on it, so a client that always sets `photoRead.docId`
 *  must not pay for "did my photo upload ok?" or "delete that picture". */
const NOT_A_READ =
  /\bdid (my|the) (photo|photograph|picture|image|pic) upload\b|\bhow do i attach\b|\bhow do i upload\b|\bdelete (that|the|this) (photo|photograph|picture|image|pic)\b|\bsend me the (photo|photograph|picture|image)\b|\b(photo|picture|image) upload (ok|okay|fine|work)\b/i;

/**
 * WHICH photograph this turn may read — the doc id the client pointed at, or
 * `null`.
 *
 * THE POINTER IS THE WHOLE TRIGGER. There is no phrasing heuristic and no
 * classifier: no docId, no read, whatever the wording. See property 2 in the
 * header for the two rounds of measurement that killed the heuristic, and why a
 * regex cannot separate "the attached photograph" from "the figure inside the
 * manual" without trading errors in both directions.
 *
 * The id returned here is a REQUEST, not an authorization. It is authorized
 * downstream in two independent legs, neither of which this function may
 * shortcut: `selectPhotoToRead` intersects it with THIS turn's revalidated
 * in-scope photo sources (returning nothing on a miss — never widened to "read
 * whatever else is attached"), and `readLinkedPhotoBytes` re-proves tenant
 * ownership and the file→notebook link before a single byte is read.
 */
export function photoReadTarget(message: string, explicitDocId?: string | null): string | null {
  const docId = (explicitDocId || "").trim();
  if (!docId) return null;
  if (NOT_A_READ.test((message || "").trim())) return null;
  return docId;
}

// ── Selection ────────────────────────────────────────────────────────────────

export type PhotoCandidate = {
  /** The SOURCE ROW's doc id — what the citation is attributed to. */
  docId: string;
  /** The IMAGE's file id — what is authorized and read. */
  imageFileId: string;
  filename: string;
};

/**
 * Resolve the pointed-at doc id to the ONE photograph that may be read, or
 * `null`.
 *
 * AUTHORIZATION LEG 1. `inScope` is `photoSourcesInScope(sources, docIds)` —
 * this turn's server-revalidated photo sources. An id that is not in it selects
 * NOTHING; it is never widened to "read whatever else is attached". A pointer
 * therefore cannot reach outside the turn's own doc scope, which is what makes
 * a hostile or stale id a no-op rather than a leak. (Leg 2 is
 * `readLinkedPhotoBytes`, which re-proves tenant + notebook linkage.)
 *
 * THE IMAGE ID IS `originFileId ?? fileId`. Two source shapes produce a photo
 * row and they resolve differently:
 *   · nameplate-confirm — the row is the extracted `.txt` doc and
 *     `originFileId` is the PHOTOGRAPH it was read from. Use that.
 *   · photo attached/OCR'd directly — `originFileId` is NULL and the row's own
 *     `fileId` IS the photograph. Use that.
 * Getting this backwards sends a text file to a vision model.
 *
 * There is no ranking here any more, and there must not be one again: ranking
 * existed only to GUESS which picture an un-pointed question meant, and the
 * guess is what made the "I re-read the attached photograph" sentence a lie
 * about a file that was never fetched. With a pointer the server cannot read
 * the wrong picture.
 */
export function selectPhotoToRead(
  inScope: PhotoSourceRef[],
  sources: NotebookSource[],
  docId: string,
): PhotoCandidate | null {
  const ref = inScope.find((r) => r.docId === docId);
  if (!ref) return null;
  const src = sources.find((s) => s.docId === docId);
  if (!src) return null;
  // Shape A (nameplate-confirm): originFileId is the photograph.
  // Shape B (photo attached directly): originFileId is NULL, fileId is it.
  const imageFileId = src.originFileId ?? src.fileId;
  if (!imageFileId) return null;
  return { docId, imageFileId, filename: ref.filename || src.filename || "attached photo" };
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
  /** 0 or 1 transcription chunks to append to the turn's evidence (one pointer,
   *  one photograph, one call). */
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
   * Exists so the technician-facing sentence can NAME it. The naming rule
   * survives the move to an explicit pointer, and its justification is now
   * simpler rather than weaker: the surface asserts only what the server can
   * prove — which file it read. With camera-default names
   * (IMG_20260901_101122.jpg, IMG_20260901_143355.jpg) a bare "the attached
   * photograph was re-read and is illegible" leaves the technician unable to
   * tell whether the pointer they tapped is the picture they meant; naming the
   * file is what makes that checkable. Do not weaken this to the definite
   * article.
   */
  notFoundFilename: string | null;
};

/**
 * Returns `null` when NOTHING happened — flag off, no picture in scope, no
 * pointer, or a pointer that resolves to nothing readable. `null` means the turn
 * is byte-identical to the honesty-directive baseline: no frame, no log line, no
 * provider call.
 *
 * CALLER CONTRACT: only call this once notebook ownership is established
 * (`validated.ok` on the chat route) — see `notebook-photo-bytes.ts`'s "the one
 * leg this module cannot prove".
 */
export async function maybeRereadPhoto(input: {
  tenantId: string;
  notebookId: string;
  message: string;
  docIds: string[];
  explicitDocId?: string | null;
  sources: NotebookSource[];
  call?: VisionCall;
}): Promise<PhotoRereadOutcome | null> {
  // 1. THE FLAG, first, before any work at all.
  if (!photoRereadEnabled()) return null;

  const inScope = photoSourcesInScope(input.sources, input.docIds);
  if (inScope.length === 0) return null;

  // 2. The trigger: the client pointed at a photograph, and the question is not
  //    about the picture-as-a-file. Nothing is inferred from phrasing.
  const target = photoReadTarget(input.message, input.explicitDocId ?? null);
  if (!target) return null;

  const candidate = selectPhotoToRead(inScope, input.sources, target);
  if (!candidate) return null;

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

  // 3. The read. ONE photograph, ONE call — the technician pointed at one.
  //
  //    There is no coverage probe in front of this any more. It suppressed the
  //    call whenever a photo-derived chunk merely CONTAINED one of fourteen
  //    lexical tokens, which is the same kind of inference this module just
  //    removed from the trigger, one layer down — and it misfired in the exact
  //    motivating case: a nameplate `.txt` extraction routinely contains the
  //    literal word "terminal", and one such hit suppressed a wire-number
  //    re-read, returning the same non-answer that made the technician tap the
  //    picture. It was also unobservable: nothing renders the `skipped` frame,
  //    so the answer read as though the picture had been consulted. The tap IS
  //    the instruction; String.includes does not get to overrule it. If spend
  //    needs a brake it belongs in a per-turn/per-notebook rate limit, which
  //    bounds cost without overruling intent.
  const attempt = await rereadPhotoForQuestion({
    tenantId: input.tenantId,
    notebookId: input.notebookId,
    candidate,
    question: input.message,
    call: input.call,
  });

  if (!attempt.ok) {
    // Unauthorized, unreadable, oversized, unconfigured, timed out, or errored.
    // Identical in EFFECT to the flag being off — the honesty directive still
    // stands and the turn answers as before — but the reason is recorded, so a
    // provider outage is not mistaken for an authorization refusal.
    return empty(
      { kind: "photo_read", state: "unavailable", reason: attempt.reason },
      attempt.reason,
    );
  }

  const result = attempt.result;
  return {
    chunks: result.found ? [rereadChunk(result)] : [],
    // Empty unless the reader looked and could not read (`rereadDirective`
    // returns "" for a found result), so the composed prompt is unchanged.
    directive: rereadDirective(result),
    liveReadUrls: new Set(result.found ? [photoRereadSourceUrl(result.fileId)] : []),
    frame: {
      kind: "photo_read",
      state: "read",
      found: result.found,
      filename: result.filename,
    },
    observation: photoRereadObservation({
      ...base,
      triggered: true,
      suppressedBy: null,
      model: result.model,
      latencyMs: result.latencyMs,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      imageBytes: result.imageBytes,
      found: result.found,
      refused: !result.found,
    }),
    readButNotFound: !result.found,
    notFoundFilename: result.found ? null : result.filename,
  };
}

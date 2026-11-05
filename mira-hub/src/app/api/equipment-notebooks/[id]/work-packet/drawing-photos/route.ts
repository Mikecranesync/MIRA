/**
 * POST /api/equipment-notebooks/[id]/work-packet/drawing-photos
 *
 * Work Packet (#4982) — drawing connection packet, Worker Task 2.
 *
 * A technician photographs an engineering drawing (title block, revision history, connection
 * table, torque callouts, parts list). This route PARKS + LINKS the photo exactly like `/look`
 * and `/nameplate/recognize` (Law 1: the bytes must survive any downstream failure), then
 * transcribes it with the ONE drawing-transcription prompt (`drawing-prompt.ts`) over the same
 * vision-call cascade those routes use (`openAiVisionSelectable()` → OpenAI, else Together — both
 * under the existing OpenAI run budget via `openAiRunBudget().reserve(...)` inside
 * `openAiVisionCall`), and — only on a reply that actually parses — materializes the canonical LINE
 * text (`renderDrawingSourceText`, `@/capabilities/work-packet/drawing`) as an UNCONFIRMED notebook
 * source linked to the original photo (`originFileId`), reusing the exact same seams
 * `@/capabilities/photo-source.ts` already uses for a kept `/look` reading
 * (`buildPhotoSourceText`, `materializeDerivedTextDoc`, `attachSource`).
 *
 * Laws honored here:
 * 1. PARK BEFORE VISION. A 503 (not configured) or 502 (provider/budget/unparseable) still returns
 *    `fileId` + `attachment` — the photo is never lost. An unparseable reply is an honest 502, never
 *    a fake transcription (this route never guesses a `DrawingTranscription` from a broken reply).
 * 2. CANDIDATE, NOT VERIFIED (materialized-evidence rule 9). The materialized doc is attached with
 *    `matchState:"candidate"` and is NOT passed to `markNameplateDocVerified` — only a technician's
 *    PUT review (`./[docId]/route.ts`) promotes a reading to `user_confirmed` + verified chunks.
 * 3. A non-"drawing" kind (nameplate/equipment/reading/job_sheet/manual_page/other) is STILL kept as
 *    a source — the response says which `kind` it read — and the packet-building logic in
 *    `work-packet/route.ts` ignores it for free: `mergeDrawingPhotos` already skips any photo whose
 *    `t.drawing` is null, and `parseDrawingTranscription` sets `drawing: null` whenever the model's
 *    JSON carries no `drawing` object (i.e. whenever `kind !== "drawing"` in a conforming reply).
 *
 * Flag: 404s unless `NOTEBOOK_WORK_PACKET=1` (`workPacketEnabled`, exported from the sibling
 * `work-packet/route.ts` — no second flag).
 *
 * Response (200): { fileId, attachment:{linkId,notebookId}, docId, kind, reviewed:false, sourceText }
 *   `sourceText` is the canonical LINE text (`renderDrawingSourceText`) the technician reviews/
 *   corrects client-side before PUTting it back to `./[docId]`.
 * Response (502/503): { error, reason, message, fileId, attachment, docId:null }
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { attachSource, findVisibleOriginSource, getNotebook } from "@/lib/equipment-notebooks";
import { loadDocCanonicalDrawingText } from "@/capabilities/work-packet/document-text";
import { parkOrReuseFile, attachFileToTargets, sha256Hex } from "@/lib/workspace-files";
import { isRecognizerConfigured } from "@/lib/nameplate";
import { openAiVisionSelectable } from "@/capabilities/openai-run-budget";
import { effectiveImageMime } from "@/lib/nameplate/image-mime";
import { sniffImageFormat } from "@/capabilities/image-format-sniff";
import { openAiVisionCall, togetherVisionCall, safeJson, type VisionCall } from "@/lib/nameplate/passes";
import {
  parseDrawingTranscription,
  renderDrawingSourceText,
} from "@/capabilities/work-packet/drawing";
import {
  DRAWING_TRANSCRIPTION_MAX_TOKENS,
  DRAWING_TRANSCRIPTION_PRODUCER,
  DRAWING_TRANSCRIPTION_PROMPT,
} from "@/capabilities/work-packet/drawing-prompt";
import { buildPhotoSourceText, materializeDerivedTextDoc } from "@/capabilities/photo-source";
import { workPacketEnabled } from "../route";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

function safeDrawingPhotoName(raw: string | undefined, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const base = (raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return base || `drawing.${ext}`;
}

type Params = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!workPacketEnabled()) return NextResponse.json({ error: "not_enabled" }, { status: 404 });
  const { id: notebookId } = await params;
  if (!UUID_RE.test(notebookId)) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  const notebook = await getNotebook(ctx.tenantId, notebookId);
  if (!notebook) return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = effectiveImageMime(file.type, buffer, ALLOWED_IMAGE_MIMES);
  if (!mime) {
    const detected = sniffImageFormat(buffer);
    return NextResponse.json(
      { error: "unsupported_image_type", message: "Send a JPEG, PNG, GIF, or WebP photo.", detected_type: detected },
      { status: 415 },
    );
  }
  const filename = safeDrawingPhotoName(file.name, mime);
  const capturedAt = new Date().toISOString();

  // ── PARK + LINK FIRST. Everything below may fail; the bytes must not. ────
  const parked = await parkOrReuseFile({
    tenantId: ctx.tenantId,
    filename,
    mimeType: mime,
    sizeBytes: buffer.length,
    buffer,
    createdBy: ctx.userId ?? null,
    nodeId: notebook.nodeId,
    source: "drawing_photo",
  });
  const attached = await attachFileToTargets(
    ctx.tenantId,
    parked.fileId,
    [{ targetType: "equipment_notebook", targetId: notebookId, role: "photo", displayLabel: filename }],
    { createdBy: ctx.userId ?? null },
  );
  const attachment = attached.ok
    ? { linkId: attached.links[0]?.linkId ?? null, notebookId }
    : { linkId: null, notebookId };
  const retained = { fileId: parked.fileId, attachment };
  const photoSha256 = sha256Hex(buffer);

  // ── RECALL BEFORE RECOMPUTE (Codex #5204 F7). The same photo bytes park to the same file, so a
  // retry finds the transcription it already produced and returns it: no second vision call, no
  // second source row. Works with the model off. `?retranscribe=1` is the explicit, visible way to
  // pay for a fresh reading; a rejected transcription is never handed back.
  const retranscribe = new URL(req.url).searchParams.get("retranscribe") === "1";
  if (!retranscribe) {
    const prior = await findVisibleOriginSource(ctx.tenantId, notebookId, parked.fileId);
    const priorDt = drawingTranscriptionEvidence(prior?.matchEvidence);
    if (
      prior &&
      prior.matchState !== "rejected" &&
      priorDt &&
      (priorDt.reviewed === true || priorDt.producer === DRAWING_TRANSCRIPTION_PRODUCER)
    ) {
      const sourceText = await loadDocCanonicalDrawingText(ctx.tenantId, notebookId, prior.docId);
      return NextResponse.json({
        ...retained,
        docId: prior.docId,
        reviewed: priorDt.reviewed === true,
        recalled: true,
        sourceText,
      });
    }
  }

  if (!isRecognizerConfigured()) {
    return NextResponse.json(
      {
        error: "recognizer_not_configured",
        reason: "recognizer_not_configured",
        message: "Drawing transcription is not available. The photo has been saved to this notebook.",
        ...retained,
        docId: null,
      },
      { status: 503 },
    );
  }

  const visionProvider = openAiVisionSelectable() ? "openai" : "together";
  const vision: VisionCall = visionProvider === "openai" ? openAiVisionCall : togetherVisionCall;

  try {
    const reply = await vision({
      prompt: DRAWING_TRANSCRIPTION_PROMPT,
      images: [{ base64: buffer.toString("base64"), mimeType: mime }],
      temperature: 0.1,
      maxTokens: DRAWING_TRANSCRIPTION_MAX_TOKENS,
    });
    const json = safeJson(reply.text);
    const transcription = json ? parseDrawingTranscription(json) : null;
    // Honest failure: an unparseable reply never becomes a fake transcription.
    if (!transcription) throw new Error("drawing_transcription_unparseable");

    const sourceText = renderDrawingSourceText(transcription);
    const docText = buildPhotoSourceText({
      machineName: notebook.displayName,
      fileId: parked.fileId,
      photoSha256,
      capturedAt,
      observation: sourceText,
      reviewed: false,
    });
    const materialized = await materializeDerivedTextDoc({
      tenantId: ctx.tenantId,
      nodeId: notebook.nodeId,
      filename: `Unconfirmed drawing reading (${parked.fileId}).txt`,
      text: docText,
      createdBy: ctx.userId ?? null,
      source: "drawing_text",
    });
    if (!materialized.docId) {
      return NextResponse.json(
        {
          error: "drawing_source_in_progress",
          reason: "drawing_source_in_progress",
          message: "This photo's transcription is already being saved. Try again in a moment.",
          ...retained,
          docId: null,
        },
        { status: 503 },
      );
    }

    const att = await attachSource(ctx.tenantId, notebookId, materialized.docId, {
      matchState: "candidate",
      sourceRole: "drawing",
      addedBy: ctx.userId ?? null,
      originFileId: parked.fileId,
      matchEvidence: {
        drawing_transcription: { reviewed: false, producer: DRAWING_TRANSCRIPTION_PRODUCER, photo_sha256: photoSha256 },
      },
    });
    if (!att.ok) {
      return NextResponse.json(
        {
          error: `attach_source_failed:${att.error}`,
          reason: "drawing_source_in_progress",
          message: "This photo's transcription could not be saved as a source. The photo itself is kept.",
          ...retained,
          docId: null,
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ...retained,
      docId: att.docId ?? materialized.docId,
      kind: transcription.kind,
      reviewed: false,
      recalled: false,
      ...(retranscribe ? { retranscribed: true } : {}),
      sourceText,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "vision_failed";
    return NextResponse.json(
      {
        error: msg.replace(/[?&]key=[^&\s]+/g, ""),
        reason: "provider_error",
        message: "Could not transcribe the drawing. The photo has been saved to this notebook.",
        ...retained,
        docId: null,
      },
      { status: 502 },
    );
  }
}

/** `match_evidence.drawing_transcription` as written by this route and the review PUT, or null. */
function drawingTranscriptionEvidence(matchEvidence: unknown): { reviewed?: unknown; producer?: unknown } | null {
  if (!matchEvidence || typeof matchEvidence !== "object") return null;
  const dt = (matchEvidence as Record<string, unknown>).drawing_transcription;
  return dt && typeof dt === "object" ? (dt as { reviewed?: unknown; producer?: unknown }) : null;
}

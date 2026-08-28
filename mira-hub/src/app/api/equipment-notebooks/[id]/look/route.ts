/**
 * POST /api/equipment-notebooks/[id]/look
 *
 * Sensor v0 · LOOK (contract §4.1, docs/prd/2026-08-28-sensor-v0-contract.md).
 * A technician photographs a component/connector/indicator INSIDE a notebook
 * and gets back an *observation*: what is visible in the frame, nothing more.
 *
 * Mirrors `nameplate/recognize` — same session, ownership, multipart, MIME
 * sniff, cap, park-then-link discipline — and differs in exactly one thing:
 * the vision pass is a fixed INSPECTION prompt over `togetherVisionCall`
 * (`@/lib/nameplate/passes`) instead of a nameplate recognizer.
 *
 * Laws honored here:
 * 1. PARK BEFORE VISION. The photo survives a 502/503; the response always
 *    carries `fileId` + `attachment` (SHA-256 dedup via parkOrReuseFile; the
 *    link upsert is idempotent, so re-posting the same bytes never duplicates).
 * 2. OBSERVATIONS ONLY. The prompt forbids diagnosis and hidden-state guesses.
 *    The text is returned as conversation context (`provenance:"phone_photo"`,
 *    `capturedAt` = server receipt time). It is NOT written to
 *    `knowledge_entries`, never marked verified, never touches the notebook's
 *    identity fields. Citable-source materialization stays behind the existing
 *    confirmation doors (#3440) — this route opens none.
 *
 * JSON shape (documented here, no shared type — one consumer today):
 *   200 { fileId, attachment:{linkId,notebookId}, clientKey?,
 *         observation:{ text, capturedAt, provenance:"phone_photo", model } }
 *   502/503 { error, message, reason, fileId, attachment, clientKey?, observation:null }
 *   `quality` (assessCapture) is deliberately absent: assessCapture is pure
 *   over DECODED grayscale pixels and the Hub has no image decoder, so the
 *   retake hint is a client-side call (see capture-quality.ts header).
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { isRecognizerConfigured, fixtureSelected } from "@/lib/nameplate";
import { effectiveImageMime } from "@/lib/nameplate/image-mime";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { togetherVisionCall, safeJson, type VisionCall } from "@/lib/nameplate/passes";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Raster safelist mirrors workspace-files' VIEWABLE_IMAGE_MIMES. SVG is
// deliberately absent — it is scriptable, and this door accepts camera photos.
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_QUESTION_CHARS = 500;
const MAX_CLIENT_KEY_CHARS = 128;

/**
 * The one prompt this route owns. Observations only: the four-bucket
 * observed/documentation/historical/inference reasoning belongs to the chat
 * route's existing instruction, not here. `togetherVisionCall` runs in JSON
 * mode, so the answer is wrapped in one string field and unwrapped below.
 */
export const INSPECTION_PROMPT = `You are looking at a photograph a maintenance technician just took of industrial equipment.
Describe ONLY what is visible in the image, as a plain-language field observation:
- components and parts you can see (drives, relays, terminals, motors, sensors, cables, enclosures)
- connectors, terminals and wiring: seated / loose / disconnected, only if visibly so
- LEDs, indicators, displays and switches, with the state you can actually see (lit / unlit / colour / text shown)
- visible wear, damage, corrosion, discoloration, burn marks, debris, moisture, loose hardware
- readable labels and text, copied exactly as printed; say "partially readable" when it is
Rules:
- NEVER diagnose, NEVER name a root cause, NEVER recommend a repair.
- NEVER guess anything hidden, internal, or out of frame. If something cannot be determined from the photo, say so.
- Do not invent labels, part numbers, or indicator states that are not clearly visible.
- Keep it concise (short sentences or a short list). Plain text, no markdown headings.
Respond ONLY with JSON: {"observation": string}`;

function safePhotoName(raw: string | undefined, mime: string): string {
  const ext = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : "jpg";
  const base = (raw ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 120)
    .trim();
  return base || `look.${ext}`;
}

function optionalString(v: FormDataEntryValue | null, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 && s.length <= max ? s : undefined;
}

/** Deterministic stand-in for NAMEPLATE_RECOGNIZER=fixture — no network. */
const fixtureVisionCall: VisionCall = async () => ({
  text: JSON.stringify({ observation: "Fixture observation: one enclosure with a green indicator lit." }),
  model: "fixture",
});

/** Unwrap the JSON-mode reply; a provider that answered in prose is kept verbatim. */
function extractObservation(text: string): string | null {
  const parsed = safeJson(text);
  const fromJson = parsed && typeof parsed.observation === "string" ? parsed.observation : null;
  const value = (fromJson ?? text).trim();
  return value.length > 0 && value !== "{}" ? value : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  const { id: notebookId } = await params;

  // Cross-tenant / missing notebooks are indistinguishable: 404, no existence leak.
  if (!UUID_RE.test(notebookId)) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }
  const notebook = await getNotebook(ctx.tenantId, notebookId);
  if (!notebook) {
    return NextResponse.json({ error: "notebook_not_found" }, { status: 404 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  // Declared MIME is a claim, not the truth: mobile pickers ship real JPEGs
  // declared application/octet-stream. Sniff the bytes before rejecting.
  const buffer = Buffer.from(await file.arrayBuffer());
  const mime = effectiveImageMime(file.type, buffer, ALLOWED_IMAGE_MIMES);
  if (!mime) {
    return NextResponse.json(
      { error: "unsupported_image_type", message: "Send a JPEG, PNG, GIF, or WebP photo." },
      { status: 415 },
    );
  }
  const question = optionalString(form?.get("question") ?? null, MAX_QUESTION_CHARS);
  const clientKey = optionalString(form?.get("clientKey") ?? null, MAX_CLIENT_KEY_CHARS);
  const filename = safePhotoName(file.name, mime);
  // Server receipt time: the phone's clock is not trusted as evidence time.
  const capturedAt = new Date().toISOString();

  // ── Park FIRST. Everything below may fail; the bytes must not. ─────────────
  const parked = await parkOrReuseFile({
    tenantId: ctx.tenantId,
    filename,
    mimeType: mime,
    sizeBytes: buffer.length,
    buffer,
    createdBy: ctx.userId ?? null,
    nodeId: notebook.nodeId,
    source: "sensor_look_photo",
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
  const retained = { fileId: parked.fileId, attachment, ...(clientKey ? { clientKey } : {}) };

  // Honest failure — the photo is already retained and viewable in the notebook.
  if (!isRecognizerConfigured()) {
    return NextResponse.json(
      {
        error: "recognizer_not_configured",
        reason: "recognizer_not_configured",
        message: "Visual inspection is not available. The photo has been saved to this notebook.",
        ...retained,
        observation: null,
      },
      { status: 503 },
    );
  }

  const vision: VisionCall = fixtureSelected() ? fixtureVisionCall : togetherVisionCall;
  try {
    // Same read-only working pixels as recognize: the detector may crop, the
    // ORIGINAL is what was parked. A question, if given, rides along as
    // context for the description — it never turns the pass into a diagnosis.
    const read = await resolveRecognitionImage(buffer.toString("base64"), mime);
    const prompt = question
      ? `${INSPECTION_PROMPT}\nThe technician asked: "${question}". Describe what is visible that relates to it; do not answer beyond what the photo shows.`
      : INSPECTION_PROMPT;
    const reply = await vision({
      prompt,
      images: [{ base64: read.base64, mimeType: read.mimeType }],
      temperature: 0.1,
      maxTokens: 600,
    });
    const text = extractObservation(reply.text);
    if (!text) throw new Error("vision_empty_response");
    return NextResponse.json({
      ...retained,
      observation: { text, capturedAt, provenance: "phone_photo" as const, model: reply.model },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "vision_failed";
    return NextResponse.json(
      {
        // Scrub any query-string credentials from provider error text (PRD §20).
        error: msg.replace(/[?&]key=[^&\s]+/g, ""),
        reason: "provider_error",
        message: "Could not describe the photo. The photo has been saved to this notebook.",
        ...retained,
        observation: null,
      },
      { status: 502 },
    );
  }
}

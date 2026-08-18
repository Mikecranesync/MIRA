/**
 * POST /api/equipment-notebooks/[id]/nameplate/recognize
 *
 * A nameplate photo taken INSIDE a notebook. Two rules shape this route:
 *
 * 1. THE PHOTO IS PARKED BEFORE RECOGNITION IS ATTEMPTED. The technician was
 *    standing at the machine when they took it; a provider outage, a delisted
 *    model, or a 502 must never cost them that photo. Park → link → recognize,
 *    in that order, always — including on the 503 "no recognizer configured"
 *    path.
 *
 * 2. THIS IS A COMPONENT, NOT THE RIDE. A notebook is one physical machine; the
 *    drive/motor/sensor whose nameplate this is lives INSIDE it. So this route
 *    NEVER writes an identity field on the notebook (no updateNotebook call).
 *    The confirm route materializes the component identity as a citable source;
 *    the parent notebook's identity stays the technician's to set.
 *
 * The provider is a candidate generator, never an authority (PRD §4.4/§10).
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { getNotebook } from "@/lib/equipment-notebooks";
import { parkOrReuseFile, attachFileToTargets } from "@/lib/workspace-files";
import { defaultRecognizer, isRecognizerConfigured } from "@/lib/nameplate";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";
import { parseNameplateLines } from "@/lib/nameplate/passes";
import { toFact, summarizeForReview, isComplianceMark } from "@/lib/nameplate/evidence";

export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Raster safelist mirrors workspace-files' VIEWABLE_IMAGE_MIMES. SVG is
// deliberately absent — it is scriptable, and this door accepts camera photos.
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  return base || `nameplate.${ext}`;
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
  const mime = (file.type || "").toLowerCase().split(";")[0].trim();
  if (!ALLOWED_IMAGE_MIMES.includes(mime)) {
    return NextResponse.json(
      {
        error: "unsupported_image_type",
        message: "Send a JPEG, PNG, GIF, or WebP photo.",
      },
      { status: 415 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filename = safePhotoName(file.name, mime);

  // ── Park FIRST. Everything below may fail; the bytes must not. ─────────────
  const parked = await parkOrReuseFile({
    tenantId: ctx.tenantId,
    filename,
    mimeType: mime,
    sizeBytes: buffer.length,
    buffer,
    createdBy: ctx.userId ?? null,
    nodeId: notebook.nodeId,
    source: "nameplate_photo",
  });
  const attached = await attachFileToTargets(
    ctx.tenantId,
    parked.fileId,
    [
      {
        targetType: "equipment_notebook",
        targetId: notebookId,
        role: "photo",
        displayLabel: filename,
      },
    ],
    { createdBy: ctx.userId ?? null },
  );
  const attachment = attached.ok
    ? { linkId: attached.links[0]?.linkId ?? null, notebookId }
    : { linkId: null, notebookId };

  // Honest failure — the photo is already retained and viewable in the notebook.
  if (!isRecognizerConfigured()) {
    return NextResponse.json(
      {
        error: "recognizer_not_configured",
        message: "Nameplate recognition is not available. The photo has been saved to this notebook.",
        fileId: parked.fileId,
        attachment,
      },
      { status: 503 },
    );
  }

  const recognizer = defaultRecognizer();
  try {
    // Crop-then-recognize when the detector finds the label; otherwise the
    // original bytes, exactly as before. The ORIGINAL is already parked above
    // — the crop is read-only working pixels, never persisted. Detection is
    // geometry, not testimony: it adds no fact, no FactSource, and no
    // corroboration — the crop and the reading below are ONE observation.
    const originalB64 = buffer.toString("base64");
    const read = await resolveRecognitionImage(originalB64, mime);
    let imageSource = read.imageSource;
    let candidate;
    try {
      candidate = await recognizer.recognize(read.base64, read.mimeType);
    } catch (err) {
      // Second-level fallback: a recognition failure ON THE CROP must not cost
      // a photo the whole-frame path could read (internet-100: two dense
      // plates whose crop response overflowed the provider while the original
      // parsed fine). Detection may only ever ADD information.
      if (imageSource.kind !== "auto_detected_crop") throw err;
      candidate = await recognizer.recognize(originalB64, mime);
      imageSource = { kind: "original_photo" };
    }
    const rawText = candidate.rawText ?? [];

    // Classify every claim before it leaves the server. `rawText` is the
    // recognizer's own account of what it read, and a model that hallucinates
    // also lists the hallucination there — on a real Oriental Motor photo it
    // reported a `RoHS` mark that is not on the plate. Returning those lines
    // unclassified invites the client to render invented text as if it had been
    // read off the equipment. The evidence layer marks each claim observed /
    // candidate / rejected with a reason the UI can show verbatim; the raw
    // lines still ride along for provenance, but they are no longer the only
    // thing describing what was "seen".
    // Deterministic field assignment first (internet-100 fix): when the plate
    // itself labels an identifier (MODEL / CAT / P/N / 1P / SER / S/N ...),
    // that anchored value outranks the model's field assignment — the
    // benchmark's dominant defect was correctly-read strings slotted into the
    // wrong identity field (frame→model, bearing→serial). The model's value
    // fills in only when the plate carries no anchor, and toFact's anchor gate
    // then holds it at `candidate` until a human confirms.
    const det = parseNameplateLines(rawText);
    const evidence = [
      toFact({ field: "manufacturer", value: candidate.manufacturer ?? null, rawText, confidence: candidate.confidence ?? null }),
      toFact({ field: "model", value: det.model?.value ?? candidate.model ?? null, rawText, confidence: candidate.confidence ?? null }),
      toFact({ field: "catalogNumber", value: det.catalogNumber?.value ?? candidate.catalogNumber ?? null, rawText }),
      toFact({ field: "serialNumber", value: det.serialNumber?.value ?? candidate.serialNumber ?? null, rawText }),
      toFact({ field: "equipmentType", value: candidate.equipmentType ?? null, rawText }),
      // Certification marks the recognizer claims to have seen. Each is judged
      // independently; a single vision pass can never establish one.
      ...rawText.filter(isComplianceMark).map((mark) => toFact({ field: "certification", value: mark, rawText })),
    ];
    const review = summarizeForReview(evidence);

    return NextResponse.json({
      fileId: parked.fileId,
      candidate,
      rawObservation: {
        provider: recognizer.name,
        filename,
        mimeType: mime,
        rawText,
        // Which pixels the recognition actually read: the parked original, or
        // the detector's union-of-boxes crop (with the exact rectangle, so the
        // read pixels can be rebuilt from the parked file). If crop recognition
        // failed and the original rescued it, this honestly says original_photo.
        imageSource,
      },
      // Provenance-carrying view of the same claims. Clients should prefer this
      // over `candidate` when deciding what to present as fact.
      evidence,
      review: {
        needsReview: review.needsReview.map((f) => f.field),
        rejected: review.rejected.map((f) => ({ field: f.field, value: f.value, reason: f.reason })),
        promotable: review.promotable.map((f) => f.field),
      },
      confidence: candidate.confidence ?? null,
      attachment,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "recognition_failed";
    return NextResponse.json(
      {
        // Scrub any query-string credentials from provider error text (PRD §20).
        error: msg.replace(/[?&]key=[^&\s]+/g, ""),
        message: "Could not read the nameplate. The photo has been saved to this notebook.",
        fileId: parked.fileId,
        attachment,
      },
      { status: 502 },
    );
  }
}

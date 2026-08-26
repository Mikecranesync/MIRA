/**
 * POST /api/equipment-notebooks/recognize-nameplate — nameplate photo →
 * EDITABLE candidate identity. The provider is a candidate generator; nothing
 * becomes authoritative until the user confirms (PRD §4.4/§10).
 *
 * Honest failure: when no vision provider is configured the route says so —
 * it never fakes a recognition.
 */
import { NextRequest, NextResponse } from "next/server";
import { sessionOr401 } from "@/lib/session";
import { defaultRecognizer, isRecognizerConfigured } from "@/lib/nameplate";
import { effectiveImageMime } from "@/lib/nameplate/image-mime";
import { resolveRecognitionImage } from "@/lib/nameplate/detect";

export const dynamic = "force-dynamic";
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
// Raster safelist mirrors the notebook recognize route (SVG deliberately absent).
const ALLOWED_IMAGE_MIMES = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function POST(req: NextRequest) {
  const ctx = await sessionOr401();
  if (ctx instanceof NextResponse) return ctx;
  if (!isRecognizerConfigured()) {
    return NextResponse.json(
      { error: "recognizer_not_configured", message: "Nameplate recognition is not available." },
      { status: 503 },
    );
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "image_required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json({ error: "image_too_large" }, { status: 413 });
  }
  // Declared MIME is a claim: mobile pickers ship real JPEGs declared
  // application/octet-stream. The bytes decide — reject only when neither the
  // declared nor the sniffed type is a safelisted raster image.
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = effectiveImageMime(file.type || "image/jpeg", buf, ALLOWED_IMAGE_MIMES);
  if (!mime) {
    return NextResponse.json(
      { error: "unsupported_image_type", message: "Send a JPEG, PNG, GIF, or WebP photo." },
      { status: 415 },
    );
  }
  try {
    // Crop-then-recognize when the detector finds the label (fixes the 10x
    // current misread); any detector failure reads the original, as before.
    const read = await resolveRecognitionImage(buf.toString("base64"), mime);
    const candidate = await defaultRecognizer().recognize(read.base64, read.mimeType);
    return NextResponse.json({ candidate, imageSource: read.imageSource });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "recognition_failed";
    // Scrub any query-string credentials from provider error text (PRD §20).
    return NextResponse.json({ error: msg.replace(/[?&]key=[^&\s]+/g, "") }, { status: 502 });
  }
}

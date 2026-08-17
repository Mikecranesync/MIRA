/**
 * run-sample.ts — run ONE internet nameplate photo through BOTH paths:
 *
 *   baseline: defaultRecognizer() on the original bytes (whole photo)
 *   improved: resolveRecognitionImage() -> detector union crop (uprighted by
 *             the service) or fallback -> defaultRecognizer()
 *
 * plus the recognize route's evidence construction (toFact/summarizeForReview)
 * so the promotable set — the thing canPromote() governs — is recorded for the
 * safety metric ("incorrect promotions").
 *
 * Everything here is the PRODUCTION seam: same functions the Hub routes call.
 * The only benchmark-local logic is file IO and timing.
 *
 *   NAMEPLATE_DETECT_ENABLED=1 MIRA_ASK_URL=http://127.0.0.1:18011 \
 *     doppler run --project factorylm --config dev -- \
 *     bun benchmarks/nameplate/internet-100/run-sample.ts \
 *       --image <path.jpg> --out benchmarks/nameplate/internet-100/runs/web-001.json
 */

import fs from "node:fs";
import path from "node:path";
import { resolveRecognitionImage } from "../../../src/lib/nameplate/detect";
import { defaultRecognizer } from "../../../src/lib/nameplate";
import { parseNameplateLines } from "../../../src/lib/nameplate/passes";
import { toFact, summarizeForReview, isComplianceMark } from "../../../src/lib/nameplate/evidence";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function mimeFor(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/** The recognize route's exact construction: candidate + deterministic parse
 * of rawText + evidence classification. */
function routeShapedRead(candidate: Awaited<ReturnType<ReturnType<typeof defaultRecognizer>["recognize"]>>) {
  const rawText = candidate.rawText ?? [];
  const det = parseNameplateLines(rawText);
  // Mirrors the recognize route exactly: anchored deterministic values outrank
  // the model's field assignment for the three promotable identifiers.
  const evidence = [
    toFact({ field: "manufacturer", value: candidate.manufacturer ?? null, rawText, confidence: candidate.confidence ?? null }),
    toFact({ field: "model", value: det.model?.value ?? candidate.model ?? null, rawText, confidence: candidate.confidence ?? null }),
    toFact({ field: "catalogNumber", value: det.catalogNumber?.value ?? candidate.catalogNumber ?? null, rawText }),
    toFact({ field: "serialNumber", value: det.serialNumber?.value ?? candidate.serialNumber ?? null, rawText }),
    toFact({ field: "equipmentType", value: candidate.equipmentType ?? null, rawText }),
    ...rawText.filter(isComplianceMark).map((mark) => toFact({ field: "certification", value: mark, rawText })),
  ];
  const review = summarizeForReview(evidence);
  return {
    candidate,
    rawText,
    values: {
      manufacturer: candidate.manufacturer ?? null,
      model: det.model?.value ?? candidate.model ?? null,
      catalogNumber: det.catalogNumber?.value ?? candidate.catalogNumber ?? null,
      equipmentType: candidate.equipmentType ?? null,
      serialNumber: det.serialNumber?.value ?? candidate.serialNumber ?? null,
      voltage: det.voltage?.text ?? null,
      current: det.current?.text ?? null,
      resolution: det.resolution?.text ?? null,
      ambient: det.ambient?.text ?? null,
      insulation: det.insulation ?? null,
      marks: det.marks.length ? det.marks.join(", ") : null,
    } as Record<string, string | null>,
    review: {
      promotable: review.promotable.map((f) => ({ field: f.field, value: f.value })),
      needsReview: review.needsReview.map((f) => f.field),
      rejected: review.rejected.map((f) => ({ field: f.field, value: f.value, reason: f.reason })),
    },
  };
}

async function main() {
  const imagePath = arg("image");
  const outPath = arg("out");
  if (!imagePath || !outPath) throw new Error("--image and --out are required");
  if (process.env.NAMEPLATE_DETECT_ENABLED !== "1") {
    throw new Error("run with NAMEPLATE_DETECT_ENABLED=1 + MIRA_ASK_URL (improved leg needs the detect service)");
  }

  const bytes = fs.readFileSync(imagePath);
  const b64 = bytes.toString("base64");
  const mime = mimeFor(imagePath);

  const out: Record<string, unknown> = {
    image: path.basename(imagePath),
    bytes: bytes.length,
    mime,
  };

  // ── improved leg: detector crop (or fallback) -> recognizer ────────────────
  try {
    const t0 = Date.now();
    const read = await resolveRecognitionImage(b64, mime);
    const tDetect = Date.now() - t0;
    let imageSource = read.imageSource;
    let candidate;
    try {
      candidate = await defaultRecognizer().recognize(read.base64, read.mimeType);
    } catch (err) {
      // Route parity: crop-recognition failure retries on the original.
      if (imageSource.kind !== "auto_detected_crop") throw err;
      candidate = await defaultRecognizer().recognize(b64, mime);
      imageSource = { kind: "original_photo" };
    }
    out.improved = {
      ...routeShapedRead(candidate),
      imageSource,
      fallback_used: imageSource.kind === "original_photo",
      detect_ms: tDetect,
      total_ms: Date.now() - t0,
    };
  } catch (err) {
    out.improved = { error: err instanceof Error ? err.message : String(err) };
  }

  // ── baseline leg: whole photo straight to the recognizer ───────────────────
  try {
    const t0 = Date.now();
    const candidate = await defaultRecognizer().recognize(b64, mime);
    out.baseline = { ...routeShapedRead(candidate), total_ms: Date.now() - t0 };
  } catch (err) {
    out.baseline = { error: err instanceof Error ? err.message : String(err) };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  const imp = out.improved as { fallback_used?: boolean; values?: Record<string, string | null>; error?: string };
  console.log(
    `${path.basename(imagePath)}: improved=${imp.error ? "ERROR" : imp.fallback_used ? "fallback" : "crop"} ` +
      `mfr=${imp.values?.manufacturer ?? "-"} model=${imp.values?.model ?? "-"} -> ${outPath}`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

/**
 * auto-region.ts — can the region be found AUTOMATICALLY?
 *
 *   cd mira-hub
 *   doppler run --project factorylm --config dev -- \
 *     bun benchmarks/nameplate/auto-region.ts --detections <detections.json> --reps 3 --out auto-round1
 *
 * region-experiment.ts measured the CEILING: a human-picked crop fixes the
 * `1.27A` misread (0/3 -> 3/3) and kills the fabricated `RoHS`. Its stated
 * limitation was that the rectangles were found by a human on one photo. This
 * file closes that gap: the crop here is derived ONLY from text-detector output
 * (PaddleOCR detection-only, run in an isolated probe container), with no human
 * coordinates anywhere in the path.
 *
 * ── The automated path under test ────────────────────────────────────────────
 *
 * 1. A text DETECTOR (no recognizer) runs on the ORIGINAL photo bytes and emits
 *    quadrilaterals in the original coordinate space.
 * 2. Boxes are clustered by proximity; the densest cluster is taken to be the
 *    label (a nameplate is a tight block of many text lines; stray text on the
 *    motor body or background is sparse).
 * 3. The cluster's bounding box, padded, is mapped into the uprighted (270° CW)
 *    coordinate space and cropped from the full-resolution image — the same
 *    decode -> rotate -> extract path as region-experiment.ts, so no detail is
 *    invented.
 * 4. The crop goes through the `full2` reader (semantic + OCR, cross-pass
 *    agreement) — the best config from the ceiling experiment.
 *
 * The gate (from the ceiling run's best config F_label_1x__full2): current
 * `1.27A` exact on every rep, zero hallucinations, and NO fabricated `RoHS`.
 * Anything less means automatic region-finding is still unproven.
 *
 * Provenance: the results JSON records the detector model, every raw polygon,
 * the clustering parameters, the derived rectangle in BOTH coordinate spaces,
 * and its IoU against the human ceiling rectangles — everything needed to
 * rebuild the exact pixels that were read.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMultiPass, evidenceToValues } from "../../src/lib/nameplate/passes";
import { inspectImage } from "../../src/lib/nameplate/preprocess";
import { scoreRun, type Fixture, type RunScore } from "./score";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, "results");
const FIXTURE_ID = "orientalmotor_dgm200r";
const SOURCE = "C:/Users/hharp/.claude/uploads/84593816-e928-4a91-8bc3-0a1dba84a776/504beeb6-1000007793.jpg";

/** Same rotation that makes this plate's text upright (region-experiment.ts). */
const UPRIGHT_ROTATION = 270 as const;

/** The human ceiling rectangles — used ONLY to report IoU, never to crop. */
const HUMAN_RECT_LABEL_ROT = { left: 1050, top: 150, width: 1550, height: 2750 };
const HUMAN_RECT_SPEC_ORIG = { left: 440, top: 1300, width: 560, height: 1150 };

type Rect = { left: number; top: number; width: number; height: number };
type Poly = number[][]; // 4 points, [x, y] in ORIGINAL image space

// ── sharp (benchmark-only; must fail loud — see region-experiment.ts) ────────

type SharpModule = typeof import("sharp");
let sharpMod: SharpModule | null | undefined;
async function getSharp(): Promise<SharpModule> {
  if (sharpMod === undefined) {
    try {
      sharpMod = (await import("sharp")).default as unknown as SharpModule;
    } catch {
      sharpMod = null;
    }
  }
  if (!sharpMod) throw new Error("auto-region requires `sharp` (mira-hub/node_modules, Next transitive).");
  return sharpMod;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function polyBBox(p: Poly): Rect {
  const xs = p.map((pt) => pt[0]);
  const ys = p.map((pt) => pt[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

function union(a: Rect, b: Rect): Rect {
  const left = Math.min(a.left, b.left);
  const top = Math.min(a.top, b.top);
  return {
    left,
    top,
    width: Math.max(a.left + a.width, b.left + b.width) - left,
    height: Math.max(a.top + a.height, b.top + b.height) - top,
  };
}

function iou(a: Rect, b: Rect): number {
  const x1 = Math.max(a.left, b.left);
  const y1 = Math.max(a.top, b.top);
  const x2 = Math.min(a.left + a.width, b.left + b.width);
  const y2 = Math.min(a.top + a.height, b.top + b.height);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const uni = a.width * a.height + b.width * b.height - inter;
  return uni > 0 ? inter / uni : 0;
}

function expand(r: Rect, pad: number): Rect {
  return { left: r.left - pad, top: r.top - pad, width: r.width + 2 * pad, height: r.height + 2 * pad };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

function clamp(r: Rect, w: number, h: number): Rect {
  const left = Math.max(0, Math.round(r.left));
  const top = Math.max(0, Math.round(r.top));
  return {
    left,
    top,
    width: Math.min(w - left, Math.round(r.width)),
    height: Math.min(h - top, Math.round(r.height)),
  };
}

/**
 * Cluster boxes by proximity: two boxes join when, expanded by `gap` px, they
 * intersect. Single-linkage; O(n²) is fine for tens of boxes. The nameplate is
 * a dense stack of text lines, so the cluster with the most boxes is the label.
 */
function clusterBoxes(boxes: Rect[], gap: number): Rect[][] {
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (intersects(expand(boxes[i], gap), expand(boxes[j], gap))) parent[find(i)] = find(j);
    }
  }
  const groups = new Map<number, Rect[]>();
  boxes.forEach((b, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root)!.push(b);
  });
  return [...groups.values()];
}

/**
 * Map a rect from the ORIGINAL (w0 x h0) space into the space of the image
 * rotated 270° clockwise (h0 x w0). Verified against the human pair:
 * spec {440,1300,560,1150} -> {1300,2000,1150,560}.
 */
function toRotatedSpace(r: Rect, w0: number): Rect {
  return { left: r.top, top: w0 - (r.left + r.width), width: r.height, height: r.width };
}

// ── Main ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function loadFixture(): Fixture {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures.json"), "utf8")) as { fixtures: Fixture[] };
  const fx = manifest.fixtures.find((f) => f.id === FIXTURE_ID);
  if (!fx) throw new Error(`fixture ${FIXTURE_ID} not found`);
  return fx;
}

async function main() {
  const detPath = arg("detections");
  if (!detPath) throw new Error("--detections <detections.json from the probe> is required");
  const reps = Number(arg("reps") ?? 3);
  const stem = arg("out") ?? "auto-region";
  const dumpDir = arg("dump-images");
  const gap = Number(arg("gap") ?? 60); // px; ~2 text-line heights on this plate
  const pad = Number(arg("pad") ?? 40);
  const minScore = Number(arg("min-score") ?? 0.5);
  // union_all: every detected box (≈ the whole label when the background is
  // clean — the shape the ceiling run's best config used). densest: the largest
  // proximity cluster (≈ the spec block on this plate; PR B says a spec-only
  // crop mislabels identity, so this one is run as a control, not the candidate).
  const strategy = (arg("strategy") ?? "union_all") as "union_all" | "densest";

  const det = JSON.parse(fs.readFileSync(detPath, "utf8")) as {
    model: string;
    dt_polys: Poly[];
    dt_scores: number[];
    cold_secs?: number;
    warm_secs?: number;
    peak_rss_mib?: number;
  };

  const sourceBuf = fs.readFileSync(SOURCE);
  const srcInfo = inspectImage(sourceBuf);
  const W = srcInfo.width ?? 3000;
  const H = srcInfo.height ?? 4000;
  console.log(`source ${W}x${H}  detector=${det.model}  boxes=${det.dt_polys.length}`);

  const kept = det.dt_polys
    .map((p, i) => ({ box: polyBBox(p), score: det.dt_scores[i] }))
    .filter((b) => b.score >= minScore);
  console.log(`boxes >= score ${minScore}: ${kept.length}`);

  // Recall vs the known spec block (report-only — not used to build the crop).
  const specHits = kept.filter((b) => intersects(b.box, HUMAN_RECT_SPEC_ORIG));
  console.log(`boxes overlapping the human spec rect: ${specHits.length}`);

  const clusters = clusterBoxes(
    kept.map((b) => b.box),
    gap,
  ).sort((a, b) => b.length - a.length);
  console.log(`clusters (gap=${gap}px): ${clusters.map((c) => c.length).join(", ")}  strategy=${strategy}`);
  const chosen = strategy === "densest" ? clusters[0] : kept.map((b) => b.box);
  if (!chosen?.length) throw new Error("no text boxes found — detection produced nothing usable");

  const rawUnion = chosen.reduce(union);
  const autoOrig = clamp(expand(rawUnion, pad), W, H);
  const autoRot = toRotatedSpace(autoOrig, W);
  const specCovered = intersects(autoOrig, HUMAN_RECT_SPEC_ORIG);
  console.log(`auto rect (original space): ${JSON.stringify(autoOrig)}`);
  console.log(`auto rect (rotated space) : ${JSON.stringify(autoRot)}`);
  console.log(
    `IoU vs human label rect: ${iou(autoRot, HUMAN_RECT_LABEL_ROT).toFixed(3)}   covers spec block: ${specCovered}`,
  );

  // Build the crop exactly as region-experiment.ts does: rotate, then extract.
  const sharp = await getSharp();
  const rotated = await sharp(sourceBuf, { failOn: "none" }).rotate(UPRIGHT_ROTATION).toBuffer();
  const cropBuf = await sharp(rotated).extract(autoRot).jpeg({ quality: 95 }).toBuffer();
  const cropInfo = inspectImage(cropBuf);
  console.log(`crop: ${(cropBuf.length / 1024).toFixed(0)}KB ${cropInfo.width}x${cropInfo.height}\n`);
  if (dumpDir) {
    fs.mkdirSync(dumpDir, { recursive: true });
    fs.writeFileSync(path.join(dumpDir, "auto_label_crop.jpg"), cropBuf);
  }

  if (process.argv.includes("--render-only")) return;

  // The winning reader from the ceiling run: semantic + OCR, merged.
  const fixture = loadFixture();
  const b64 = cropBuf.toString("base64");
  const repsOut: { rep: number; ok: boolean; error?: string; ms: number; values: Record<string, string | null>; score?: RunScore }[] = [];
  for (let rep = 0; rep < reps; rep++) {
    const t0 = Date.now();
    try {
      const mp = await runMultiPass({ base64: b64, mimeType: "image/jpeg" }, { passes: ["semantic", "ocr"] });
      const values = evidenceToValues(mp.fields);
      const score = scoreRun(fixture, "auto_label__full2", values);
      repsOut.push({ rep, ok: true, ms: Date.now() - t0, values, score });
      console.log(
        `  rep ${rep}: current=${String(values.current)}  spec ${score.spec.hits}/${score.spec.total}  ` +
          `id ${score.identity.hits}/${score.identity.total}  halluc ${score.hallucinations}  ${Date.now() - t0}ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      repsOut.push({ rep, ok: false, error: message, ms: Date.now() - t0, values: {} });
      console.log(`  rep ${rep}: ERROR ${message}`);
    }
  }

  const ok = repsOut.filter((r) => r.ok);
  const current3 = ok.filter((r) => r.values.current === "1.27A").length;
  const hallTotal = ok.reduce((a, r) => a + (r.score?.hallucinations ?? 0), 0);
  const hallValues = [...new Set(ok.flatMap((r) => r.score?.hallucinatedValues ?? []))];
  const rohs = ok.some((r) => JSON.stringify(r.values).match(/RoHS/i));
  console.log(`\ncurrent 1.27A: ${current3}/${repsOut.length}   hallucinations: ${hallTotal} ${hallValues.join(", ")}   RoHS fabricated: ${rohs}`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `${stem}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        source: SOURCE,
        sourceInfo: srcInfo,
        detector: {
          model: det.model,
          nBoxes: det.dt_polys.length,
          minScore,
          coldSecs: det.cold_secs ?? null,
          warmSecs: det.warm_secs ?? null,
          peakRssMib: det.peak_rss_mib ?? null,
          polys: det.dt_polys,
          scores: det.dt_scores,
        },
        clustering: { strategy, gapPx: gap, padPx: pad, clusterSizes: clusters.map((c) => c.length) },
        autoRect: {
          originalSpace: autoOrig,
          rotatedSpace: autoRot,
          uprightRotationDeg: UPRIGHT_ROTATION,
          iouVsHumanLabel: iou(autoRot, HUMAN_RECT_LABEL_ROT),
          coversHumanSpecRect: specCovered,
        },
        crop: { bytes: cropBuf.length, width: cropInfo.width, height: cropInfo.height, jpegQuality: 95 },
        reader: "full2 (semantic+ocr)",
        reps: repsOut,
        gate: { current127A: `${current3}/${repsOut.length}`, hallucinations: hallTotal, rohsFabricated: rohs },
      },
      null,
      2,
    ),
  );
  console.log(`results -> ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

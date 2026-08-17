/**
 * region-experiment.ts — does WHERE we point the model matter more than HOW we ask?
 *
 *   cd mira-hub
 *   doppler run --project factorylm --config dev -- \
 *     bun benchmarks/nameplate/region-experiment.ts --reps 3 --out region-round1
 *
 * ── The hypothesis under test ────────────────────────────────────────────────
 *
 * The shipped pipeline reads `12A` off the Oriental Motor plate where the plate
 * says `1.27A` — and it does it 3 times out of 3 (benchmarks/nameplate/results/
 * reps3.json). That reproducibility is the interesting part: it is not sampling
 * noise, it is a systematic failure to resolve a decimal point in a ~40x18 px
 * patch of a 12 MP photograph. Prompt engineering has been tried against it
 * (OCR_PROMPT literally says `"1.27A" is NOT "12A"`) and it did not fix it.
 *
 * So this file changes the variable nobody has changed yet: the PIXELS SENT.
 * It holds the reader constant and varies only the image — whole frame, whole
 * frame uprighted, the label, and the spec block isolated and upscaled — to
 * answer one question with numbers:
 *
 *   Is reading `1.27A` from a tight, upright, high-resolution crop
 *   fundamentally easier than finding and reading it in the whole photograph?
 *
 * A null result is a real result. If the crop does not beat the whole frame,
 * that is worth knowing before anyone builds a region proposer.
 *
 * ── Design ──────────────────────────────────────────────────────────────────
 *
 * 1. ONE READER PER AXIS, HELD CONSTANT. `shipped` is exactly what production
 *    does today (index.ts VISION_PROMPT, one call, spec fields parsed from its
 *    rawText[]) — the same construction as run.ts's v0_baseline, so numbers here
 *    are directly comparable to results/reps3.json. `ocr` re-runs two of the
 *    configs through the verbatim-transcription prompt as a robustness check,
 *    so a region effect cannot be dismissed as an artifact of one prompt.
 * 2. 3 REPS. The failure being chased is systematic (3/3 identical), so 3 reps
 *    is enough to tell "the image changed the answer" from "the sampler moved".
 * 3. EVERY CROP RECTANGLE IS RECORDED in the results JSON, in the coordinate
 *    space of the UPRIGHTED image, with the rotation that produced it. A crop
 *    experiment whose crop cannot be reproduced is an anecdote.
 * 4. SCORING IS REUSED, NOT REWRITTEN. score.ts owns what counts as a hit and
 *    what counts as a hallucination; this file only chooses the images.
 *
 * ── Honest limitation ───────────────────────────────────────────────────────
 *
 * The crop rectangles here were found BY A HUMAN-IN-THE-LOOP (rendered, viewed,
 * adjusted) on ONE photo. That is fine for measuring the ceiling — "if we could
 * point at the right region, would it help?" — and it is NOT a claim that the
 * region can be found automatically. Finding it is the next problem, and it is
 * only worth solving if the number below says the ceiling is high.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseNameplateLines, runMultiPass, evidenceToValues } from "../../src/lib/nameplate/passes";
import { TogetherVisionRecognizer, togetherVisionModel } from "../../src/lib/nameplate/index";
import { inspectImage } from "../../src/lib/nameplate/preprocess";
import { scoreRun, type Fixture, type RunScore } from "./score";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, "results");
const FIXTURE_ID = "orientalmotor_dgm200r";

// ── sharp (benchmark-only, and it must FAIL LOUD) ────────────────────────────
//
// `sharp` is NOT a declared mira-hub dependency — it is physically present only
// as a Next.js transitive. Nothing under src/lib may import it. Here, in a
// dev-only harness, it is the whole point: without a decoder there is no crop
// and therefore no experiment. run.ts degrades to "no rotated variants" when
// sharp is missing; this file must NOT, because a silent skip would print a
// table of identical rows and read as "cropping doesn't help".

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
  if (!sharpMod) {
    throw new Error(
      "region-experiment requires `sharp` to crop/rotate pixels, and it could not be imported.\n" +
        "It is not a declared mira-hub dependency; it is normally present at\n" +
        "  mira-hub/node_modules/sharp  (a Next.js transitive).\n" +
        "Without a decoder this experiment cannot run — refusing to emit a table of\n" +
        "un-cropped duplicates that would look like a null result. Install/restore sharp\n" +
        "in mira-hub/node_modules and re-run.",
    );
  }
  return sharpMod;
}

// ── The image renderings under test ──────────────────────────────────────────

/** A crop rectangle in the coordinate space of the image AFTER `rotateDeg`. */
type Rect = { left: number; top: number; width: number; height: number };

/**
 * Crop rectangles, in the 4000x3000 space of the source photo rotated 270°
 * (clockwise) — which is what makes this plate's text upright.
 *
 * Found by rendering candidates and LOOKING at them, not by guessing: see the
 * "honest limitation" note in the header. Both were visually confirmed to sit
 * on the intended text before any provider call was made.
 */
const UPRIGHT_ROTATION = 270 as const;

/** The whole oval label: manufacturer, model, type, and the spec block. */
const RECT_LABEL: Rect = { left: 1050, top: 150, width: 1550, height: 2750 };

/**
 * The specification block ONLY — the five lines that carry every number the
 * whole-frame baseline gets wrong: `Motor P/N AZM911AC-D`, `3.87VDC 1.27A
 * 0.01°/STEP`, `INS.Class A`, `Amb.40°C`, `TE QS8 I119701`, plus the CE/UKCA/UL
 * marks. Deliberately excludes MODEL/manufacturer so the trade-off is visible
 * rather than hidden: a spec crop cannot report an identity it cannot see.
 */
const RECT_SPEC: Rect = { left: 1300, top: 2000, width: 1150, height: 560 };

/**
 * THE SAME spec block, expressed in the ORIGINAL 3000x4000 coordinate space —
 * i.e. cropped tightly but left lying on its side, exactly as the camera stored
 * it. This is the control that separates the two things a "crop" does at once:
 * it removes clutter AND (as used above) it uprights the text. Without this
 * rectangle, a crop win could be a rotation win wearing a crop's clothes.
 *
 * Derived from RECT_SPEC by the inverse of a 270° clockwise rotation, then
 * visually confirmed to frame the same five lines.
 */
const RECT_SPEC_UNROTATED: Rect = { left: 440, top: 1300, width: 560, height: 1150 };

type Rendering = {
  base64: string;
  mimeType: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** Reproducibility record — everything needed to rebuild these exact pixels. */
  recipe: Record<string, unknown>;
};

const SOURCE = "C:/Users/hharp/.claude/uploads/84593816-e928-4a91-8bc3-0a1dba84a776/504beeb6-1000007793.jpg";

function toRendering(buf: Buffer, mimeType: string, recipe: Record<string, unknown>): Rendering {
  const info = inspectImage(buf);
  return {
    base64: buf.toString("base64"),
    mimeType,
    bytes: buf.length,
    width: info.width,
    height: info.height,
    recipe,
  };
}

type RenderOpts = {
  rotate?: number;
  crop?: Rect;
  /** Integer/rational upscale applied to the CROP's own pixels (lanczos3). */
  scale?: number;
  grayscale?: boolean;
  /** sharp `.normalise()` — stretches luminance to full range. */
  normalize?: boolean;
  /** Downscale longest edge to this many px (applied after crop+scale). */
  fitWithin?: number;
  quality?: number;
};

/**
 * Build one rendering. Crops are taken at NATIVE resolution from the rotated
 * original and only then upscaled, so no detail is thrown away and re-invented:
 * decode -> rotate -> extract -> scale -> (gray/normalize) -> encode once.
 */
async function render(sourceBuf: Buffer, opts: RenderOpts): Promise<Rendering> {
  const sharp = await getSharp();
  const quality = opts.quality ?? 95;
  let pipe = sharp(sourceBuf, { failOn: "none" });
  if (opts.rotate) pipe = pipe.rotate(opts.rotate);
  if (opts.crop) {
    // Rotation must be materialized before extract, or the rectangle would be
    // interpreted in the pre-rotation coordinate space.
    const rotated = await pipe.toBuffer();
    pipe = sharp(rotated).extract(opts.crop);
  }
  if (opts.scale && opts.scale !== 1) {
    const w = Math.round((opts.crop?.width ?? 0) * opts.scale);
    if (!w) throw new Error("scale requires a crop with a known width");
    pipe = pipe.resize({ width: w, kernel: "lanczos3" });
  }
  if (opts.fitWithin) {
    pipe = pipe.resize({
      width: opts.fitWithin,
      height: opts.fitWithin,
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  if (opts.grayscale) pipe = pipe.grayscale();
  if (opts.normalize) pipe = pipe.normalise();
  const buf = await pipe.jpeg({ quality }).toBuffer();
  return toRendering(buf, "image/jpeg", {
    source: SOURCE,
    rotateDeg: opts.rotate ?? 0,
    cropRectInRotatedSpace: opts.crop ?? null,
    upscale: opts.scale ?? 1,
    fitWithin: opts.fitWithin ?? null,
    grayscale: Boolean(opts.grayscale),
    normalize: Boolean(opts.normalize),
    jpegQuality: quality,
  });
}

// ── Readers (the constant) ───────────────────────────────────────────────────

type ReaderName = "shipped" | "ocr" | "full2";

type ReadResult = { values: Record<string, string | null>; calls: number; raw: unknown };

/**
 * `shipped` — production's actual path: defaultRecognizer()'s Together call with
 * index.ts's VISION_PROMPT, spec fields parsed deterministically from rawText[].
 * Identical construction to run.ts's v0_baseline, on purpose.
 */
async function readShipped(img: Rendering): Promise<ReadResult> {
  const candidate = await new TogetherVisionRecognizer().recognize(img.base64, img.mimeType);
  const det = parseNameplateLines(candidate.rawText ?? []);
  return {
    calls: 1,
    raw: { candidate },
    values: {
      manufacturer: candidate.manufacturer ?? null,
      model: candidate.model ?? null,
      catalogNumber: candidate.catalogNumber ?? det.catalogNumber?.value ?? null,
      equipmentType: candidate.equipmentType ?? null,
      serialNumber: candidate.serialNumber ?? det.serialNumber?.value ?? null,
      voltage: det.voltage?.text ?? null,
      current: det.current?.text ?? null,
      resolution: det.resolution?.text ?? null,
      ambient: det.ambient?.text ?? null,
      insulation: det.insulation ?? null,
      marks: det.marks.length ? det.marks.join(", ") : null,
    },
  };
}

/** `ocr` — the verbatim-transcription prompt, single pass, deterministic parse. */
async function readOcr(img: Rendering): Promise<ReadResult> {
  const mp = await runMultiPass({ base64: img.base64, mimeType: img.mimeType }, { passes: ["ocr"] });
  return {
    calls: mp.passes.length + mp.errors.length,
    raw: { ocrLines: mp.ocrLines, errors: mp.errors, passes: mp.passes },
    values: evidenceToValues(mp.fields),
  };
}

/**
 * `full2` — semantic + verbatim OCR, merged by passes.ts's cross-pass agreement.
 * Two calls. This is the shape a real crop-based pipeline would take: the
 * semantic pass supplies identity, the OCR pass supplies the digits.
 */
async function readFull2(img: Rendering): Promise<ReadResult> {
  const mp = await runMultiPass(
    { base64: img.base64, mimeType: img.mimeType },
    { passes: ["semantic", "ocr"] },
  );
  return {
    calls: mp.passes.length + mp.errors.length,
    raw: { ocrLines: mp.ocrLines, errors: mp.errors, passes: mp.passes },
    values: evidenceToValues(mp.fields),
  };
}

const READERS: Record<ReaderName, (img: Rendering) => Promise<ReadResult>> = {
  shipped: readShipped,
  ocr: readOcr,
  full2: readFull2,
};

// ── Configurations ───────────────────────────────────────────────────────────

type Config = {
  name: string;
  reader: ReaderName;
  describe: string;
  opts: RenderOpts | null; // null => the original file bytes, untouched
};

const CONFIGS: Config[] = [
  {
    name: "A_whole_asis",
    reader: "shipped",
    describe: "BASELINE. Original 3000x4000 file bytes, exactly as the app uploads them.",
    opts: null,
  },
  {
    name: "B_whole_upright",
    reader: "shipped",
    describe: "Whole frame rotated 270° so the label text is upright. Full resolution, re-encoded q95.",
    opts: { rotate: UPRIGHT_ROTATION },
  },
  {
    name: "B2_whole_upright_1600",
    reader: "shipped",
    describe: "Whole frame uprighted then downscaled to fit 1600px (what run.ts's rotated variants send).",
    opts: { rotate: UPRIGHT_ROTATION, fitWithin: 1600, quality: 92 },
  },
  {
    name: "C0_label_1x",
    reader: "shipped",
    describe: "The whole oval label, uprighted, native resolution. Isolates 'crop' from 'crop tightly'.",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_LABEL },
  },
  {
    name: "C1_spec_1x",
    reader: "shipped",
    describe: "Spec block only, uprighted, native resolution (1150x560).",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_SPEC },
  },
  {
    name: "C2_spec_2x",
    reader: "shipped",
    describe: "Spec block, uprighted, 2x lanczos upscale (2300x1120).",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_SPEC, scale: 2 },
  },
  {
    name: "C3_spec_3x",
    reader: "shipped",
    describe: "Spec block, uprighted, 3x lanczos upscale (3450x1680).",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_SPEC, scale: 3 },
  },
  {
    name: "D1_spec_2x_gray",
    reader: "shipped",
    describe: "C2 in grayscale — does dropping the yellow/dust color cast help or hurt?",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_SPEC, scale: 2, grayscale: true },
  },
  {
    name: "D2_spec_2x_norm",
    reader: "shipped",
    describe: "C2 with luminance normalised (contrast stretch), color kept.",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_SPEC, scale: 2, normalize: true },
  },
  {
    name: "E1_spec_1x_sideways",
    reader: "shipped",
    describe: "CONTROL: the same spec block, cropped but NOT uprighted. Isolates tightness from rotation.",
    opts: { crop: RECT_SPEC_UNROTATED },
  },
  {
    name: "E2_spec_2x_sideways",
    reader: "shipped",
    describe: "CONTROL: C2's 2x upscale, but left lying on its side.",
    opts: { crop: RECT_SPEC_UNROTATED, scale: 2 },
  },
  {
    name: "F_label_1x__full2",
    reader: "full2",
    describe: "CANDIDATE: the whole label crop through semantic+OCR (2 calls) — identity AND digits.",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_LABEL },
  },
  {
    name: "A_whole_asis__ocr",
    reader: "ocr",
    describe: "Robustness check: the baseline image through the verbatim-OCR prompt instead.",
    opts: null,
  },
  {
    name: "C2_spec_2x__ocr",
    reader: "ocr",
    describe: "Robustness check: the 2x spec crop through the verbatim-OCR prompt instead.",
    opts: { rotate: UPRIGHT_ROTATION, crop: RECT_SPEC, scale: 2 },
  },
];

// ── Reporting ────────────────────────────────────────────────────────────────

const REPORT_FIELDS = [
  "current",
  "voltage",
  "resolution",
  "ambient",
  "insulation",
  "catalogNumber",
  "serialNumber",
  "model",
  "manufacturer",
  "equipmentType",
  "marks",
] as const;

type RepResult = {
  rep: number;
  ok: boolean;
  error?: string;
  ms: number;
  calls: number;
  values: Record<string, string | null>;
  score?: RunScore;
  raw?: unknown;
};

type ConfigResult = {
  config: string;
  reader: ReaderName;
  describe: string;
  image: {
    bytes: number;
    kb: number;
    width: number | null;
    height: number | null;
    recipe: Record<string, unknown>;
  };
  reps: RepResult[];
  /** How many reps returned EXACTLY the ground-truth value, per field. */
  exactByField: Record<string, number>;
  currentVerbatim: string[];
  hallucinationsPerRep: number[];
  hallucinatedValues: string[];
  meanMs: number;
  callsTotal: number;
};

function pad(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number) {
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

/**
 * Verbatim values per config per field. Deliberately prints the STRING the
 * provider produced, not a verdict glyph: the whole point of this experiment is
 * that `12A` and `1.27A` are different strings, and a table that renders both as
 * "WRNG"/"OK" would hide the finding it exists to show.
 */
function renderFieldMatrix(results: ConfigResult[], fixture: Fixture): string {
  const lines: string[] = [];
  const W = 22;
  const head = pad("FIELD", 14) + pad("TRUTH", 16) + results.map((r) => padL(r.config.slice(0, W - 1), W)).join("");
  lines.push(head, "-".repeat(head.length));
  for (const f of REPORT_FIELDS) {
    const truth =
      fixture.identity[f]?.expect ?? fixture.spec[f]?.expect ?? (f === "marks" ? fixture.marks.join(",") : null);
    let row = pad(f, 14) + pad(truth ?? "(none)", 16);
    for (const r of results) {
      const seen = [...new Set(r.reps.filter((x) => x.ok).map((x) => x.values[f] ?? "null"))];
      const label = seen.length === 1 ? seen[0] : seen.join("|");
      const hits = r.exactByField[f] ?? 0;
      row += padL(`${label.slice(0, W - 6)} ${hits}/${r.reps.length}`, W);
    }
    lines.push(row);
  }
  return lines.join("\n");
}

function renderHeadline(results: ConfigResult[]): string {
  const head =
    pad("CONFIG", 24) +
    pad("READER", 9) +
    padL("KB", 8) +
    padL("PIXELS", 12) +
    padL("current 1.27A", 15) +
    padL("SPEC", 9) +
    padL("IDENT", 9) +
    padL("HALLUC", 8) +
    padL("CALLS", 7) +
    padL("MS", 8);
  const lines = [head, "-".repeat(head.length)];
  for (const r of results) {
    const okReps = r.reps.filter((x) => x.ok);
    const spec = okReps.reduce((a, x) => a + (x.score?.spec.hits ?? 0), 0);
    const specT = okReps.reduce((a, x) => a + (x.score?.spec.total ?? 0), 0);
    const ident = okReps.reduce((a, x) => a + (x.score?.identity.hits ?? 0), 0);
    const identT = okReps.reduce((a, x) => a + (x.score?.identity.total ?? 0), 0);
    const hall = r.hallucinationsPerRep.reduce((a, b) => a + b, 0);
    lines.push(
      pad(r.config, 24) +
        pad(r.reader, 9) +
        padL(r.image.kb.toFixed(0), 8) +
        padL(`${r.image.width ?? "?"}x${r.image.height ?? "?"}`, 12) +
        padL(`${r.exactByField.current ?? 0}/${r.reps.length}`, 15) +
        padL(`${spec}/${specT}`, 9) +
        padL(`${ident}/${identT}`, 9) +
        padL(String(hall), 8) +
        padL(String(r.callsTotal), 7) +
        padL(r.meanMs.toFixed(0), 8),
    );
  }
  return lines.join("\n");
}

// ── Main ─────────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

function loadFixture(): Fixture {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures.json"), "utf8")) as {
    fixtures: Fixture[];
  };
  const fx = manifest.fixtures.find((f) => f.id === FIXTURE_ID);
  if (!fx) throw new Error(`fixture ${FIXTURE_ID} not found in fixtures.json`);
  return fx;
}

/** Is this returned value exactly (modulo the fixture's accepted renderings) truth? */
function isExact(fixture: Fixture, field: string, got: string | null): boolean {
  const spec = fixture.identity[field] ?? fixture.spec[field];
  if (field === "marks") {
    const want = fixture.marks.map((m) => m.toUpperCase().replace(/[^A-Z0-9]/g, "")).sort();
    const have = (got ?? "")
      .split(/[,;|/]+/)
      .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ""))
      .filter(Boolean)
      .sort();
    return want.length === have.length && want.every((w, i) => w === have[i]);
  }
  if (!spec) return false;
  if (spec.expect === null) return got === null;
  if (got === null) return false;
  const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return [spec.expect, ...(spec.accept ?? [])].some((a) => norm(a) === norm(got));
}

async function main() {
  const fixture = loadFixture();
  const reps = Number(arg("reps") ?? 3);
  const only = (arg("configs") ?? "").split(",").filter(Boolean);
  const stem = arg("out") ?? `region-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
  const dumpDir = arg("dump-images");
  const configs = CONFIGS.filter((c) => !only.length || only.includes(c.name));

  const sourceBuf = fs.readFileSync(SOURCE);
  const srcInfo = inspectImage(sourceBuf);
  console.log(
    `source=${path.basename(SOURCE)} ${srcInfo.width}x${srcInfo.height} ` +
      `${(sourceBuf.length / 1024).toFixed(0)}KB exif=${srcInfo.exifOrientation ?? "-"}`,
  );

  if (process.argv.includes("--list")) {
    for (const c of configs) console.log(`  ${pad(c.name, 24)} ${pad(c.reader, 8)} ${c.describe}`);
    return;
  }

  console.log(`model=${togetherVisionModel()}  configs=${configs.length}  reps=${reps}`);
  console.log(`upright rotation=${UPRIGHT_ROTATION}°  spec rect=${JSON.stringify(RECT_SPEC)}\n`);

  // Render every image FIRST — a decode failure must not surface halfway through
  // a paid run, and rendering once keeps the bytes identical across reps.
  const renderings = new Map<string, Rendering>();
  for (const c of configs) {
    const r = c.opts
      ? await render(sourceBuf, c.opts)
      : toRendering(sourceBuf, "image/jpeg", { source: SOURCE, note: "original file bytes, untouched" });
    renderings.set(c.name, r);
    if (dumpDir) {
      fs.mkdirSync(dumpDir, { recursive: true });
      fs.writeFileSync(path.join(dumpDir, `${c.name}.jpg`), Buffer.from(r.base64, "base64"));
    }
    console.log(
      `  render ${pad(c.name, 24)} ${padL(`${(r.bytes / 1024).toFixed(0)}KB`, 9)} ${r.width}x${r.height}`,
    );
  }
  if (process.argv.includes("--render-only")) return;

  const results: ConfigResult[] = [];
  for (const c of configs) {
    const img = renderings.get(c.name)!;
    const repResults: RepResult[] = [];
    for (let rep = 0; rep < reps; rep++) {
      const t0 = Date.now();
      try {
        const out = await READERS[c.reader](img);
        const score = scoreRun(fixture, c.name, out.values);
        repResults.push({
          rep,
          ok: true,
          ms: Date.now() - t0,
          calls: out.calls,
          values: out.values,
          score,
          raw: out.raw,
        });
        console.log(
          `  ${pad(c.name, 24)}#${rep}  current=${String(out.values.current)}  ` +
            `spec ${score.spec.hits}/${score.spec.total}  id ${score.identity.hits}/${score.identity.total}  ` +
            `halluc ${score.hallucinations}  ${Date.now() - t0}ms`,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        repResults.push({ rep, ok: false, error: message, ms: Date.now() - t0, calls: 1, values: {} });
        console.log(`  ${pad(c.name, 24)}#${rep}  ERROR ${message}`);
      }
    }

    const okReps = repResults.filter((r) => r.ok);
    const exactByField: Record<string, number> = {};
    for (const f of REPORT_FIELDS) {
      exactByField[f] = okReps.filter((r) => isExact(fixture, f, r.values[f] ?? null)).length;
    }
    results.push({
      config: c.name,
      reader: c.reader,
      describe: c.describe,
      image: {
        bytes: img.bytes,
        kb: img.bytes / 1024,
        width: img.width,
        height: img.height,
        recipe: img.recipe,
      },
      reps: repResults,
      exactByField,
      currentVerbatim: repResults.map((r) => (r.ok ? String(r.values.current) : `ERROR:${r.error}`)),
      hallucinationsPerRep: okReps.map((r) => r.score?.hallucinations ?? 0),
      hallucinatedValues: [...new Set(okReps.flatMap((r) => r.score?.hallucinatedValues ?? []))],
      meanMs: okReps.length ? okReps.reduce((a, r) => a + r.ms, 0) / okReps.length : 0,
      callsTotal: repResults.reduce((a, r) => a + r.calls, 0),
    });
  }

  console.log("\n=== HEADLINE ===");
  console.log(renderHeadline(results));
  console.log("\n=== VERBATIM VALUES (distinct across reps | exact-hits/reps) ===");
  console.log(renderFieldMatrix(results, fixture));
  console.log("\n=== RATED CURRENT, VERBATIM, PER REP (truth: 1.27A) ===");
  for (const r of results) console.log(`  ${pad(r.config, 24)} ${r.currentVerbatim.join("  |  ")}`);
  console.log("\n=== HALLUCINATED VALUES ===");
  for (const r of results) {
    console.log(`  ${pad(r.config, 24)} ${r.hallucinatedValues.length ? r.hallucinatedValues.join(", ") : "(none)"}`);
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `${stem}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        model: togetherVisionModel(),
        source: SOURCE,
        sourceInfo: srcInfo,
        uprightRotationDeg: UPRIGHT_ROTATION,
        rects: { label: RECT_LABEL, spec: RECT_SPEC },
        rectCoordinateSpace: `image rotated ${UPRIGHT_ROTATION}deg clockwise (4000x3000)`,
        reps,
        results,
      },
      null,
      2,
    ),
  );
  console.log(`\nresults -> ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

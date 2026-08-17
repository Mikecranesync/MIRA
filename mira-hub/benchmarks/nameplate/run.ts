/**
 * run.ts — the nameplate recognition benchmark runner.
 *
 *   cd mira-hub
 *   doppler run --project factorylm --config dev -- \
 *     bun benchmarks/nameplate/run.ts --variants v0_baseline,v3_full3
 *
 * Flags:
 *   --variants a,b     only these variants (default: all)
 *   --fixtures a,b     only these fixture ids (default: all)
 *   --reps N           repeat each (variant, fixture) N times (default 1)
 *   --out NAME         results filename stem (default: timestamp)
 *   --list             print variants + fixtures and exit (no spend)
 *
 * Every raw provider response is written to results/<name>.json so a later run
 * can be diffed against this one rather than re-argued from memory.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runMultiPass,
  evidenceToValues,
  parseNameplateLines,
  type MultiPassResult,
  type VisionImage,
} from "../../src/lib/nameplate/passes";
import { inspectImage, orientationHint } from "../../src/lib/nameplate/preprocess";
import { TogetherVisionRecognizer, togetherVisionModel } from "../../src/lib/nameplate/index";
import {
  scoreRun,
  summarize,
  renderSummaryTable,
  renderFieldTable,
  type Fixture,
  type RunScore,
  type VariantSummary,
} from "./score";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, "results");

type LoadedFixture = Fixture & { buffer: Buffer; mimeType: string; base64: string };

function loadFixtures(): LoadedFixture[] {
  const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures.json"), "utf8")) as {
    fixtures: Fixture[];
  };
  return manifest.fixtures.map((f) => {
    const p = path.isAbsolute(f.image) || /^[A-Za-z]:/.test(f.image)
      ? f.image
      : path.resolve(HERE, f.image);
    const buffer = fs.readFileSync(p);
    const mimeType = p.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    return { ...f, buffer, mimeType, base64: buffer.toString("base64") };
  });
}

// ── Optional pixel preprocessing (benchmark-only) ────────────────────────────
//
// `sharp` is NOT a declared mira-hub dependency — it is only physically present
// as a Next.js transitive. It is used HERE, in a dev-only harness, purely to
// measure whether rotation/downscale is worth declaring it. Nothing in
// src/lib/nameplate depends on it.

type SharpModule = typeof import("sharp");
let sharpMod: SharpModule | null | undefined;

async function getSharp(): Promise<SharpModule | null> {
  if (sharpMod !== undefined) return sharpMod;
  try {
    sharpMod = (await import("sharp")).default as unknown as SharpModule;
  } catch {
    sharpMod = null;
  }
  return sharpMod;
}

async function rotatedVariants(fx: LoadedFixture): Promise<VisionImage[]> {
  const sharp = await getSharp();
  if (!sharp) return [];
  const out: VisionImage[] = [];
  for (const deg of [90, 270]) {
    const buf = await sharp(fx.buffer)
      .rotate(deg)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 92 })
      .toBuffer();
    out.push({ base64: buf.toString("base64"), mimeType: "image/jpeg", label: `rot${deg}` });
  }
  return out;
}

// ── Variants ─────────────────────────────────────────────────────────────────

type VariantRun = {
  values: Record<string, string | null>;
  calls: number;
  raw: unknown;
};

type Variant = {
  name: string;
  describe: string;
  run: (fx: LoadedFixture) => Promise<VariantRun>;
};

/** Fold a MultiPassResult into the flat value map the scorer compares. */
function fold(mp: MultiPassResult): VariantRun {
  return {
    values: evidenceToValues(mp.fields),
    calls: mp.passes.length + mp.errors.length,
    raw: {
      ocrLines: mp.ocrLines,
      markVotes: mp.markVotes,
      errors: mp.errors,
      fields: mp.fields,
      passes: mp.passes.map((p) => ({ name: p.name, ms: p.ms, rawResponse: p.rawResponse })),
    },
  };
}

const VARIANTS: Variant[] = [
  {
    name: "v0_baseline",
    describe: "SHIPPED: one semantic pass, index.ts VISION_PROMPT. Spec fields parsed from its rawText[].",
    run: async (fx) => {
      const rec = new TogetherVisionRecognizer();
      const candidate = await rec.recognize(fx.base64, fx.mimeType);
      const lines = candidate.rawText ?? [];
      const det = parseNameplateLines(lines);
      return {
        calls: 1,
        raw: { candidate },
        values: {
          manufacturer: candidate.manufacturer ?? null,
          model: candidate.model ?? null,
          catalogNumber: candidate.catalogNumber ?? null,
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
    },
  },
  {
    name: "v1_ocr_det",
    describe: "One verbatim-OCR pass; every field parsed deterministically from the lines.",
    run: async (fx) =>
      fold(await runMultiPass({ base64: fx.base64, mimeType: fx.mimeType }, { passes: ["ocr"] })),
  },
  {
    name: "v2_ocr_id",
    describe: "Verbatim OCR + targeted identifier pass (no semantic pass).",
    run: async (fx) =>
      fold(
        await runMultiPass(
          { base64: fx.base64, mimeType: fx.mimeType },
          { passes: ["ocr", "identifier"] },
        ),
      ),
  },
  {
    name: "v3_full3",
    describe: "semantic + verbatim OCR + identifier, merged by cross-pass agreement.",
    run: async (fx) =>
      fold(await runMultiPass({ base64: fx.base64, mimeType: fx.mimeType }, {})),
  },
  {
    name: "v4_full3_hint",
    describe: "v3 plus a zero-dependency EXIF/dimension orientation hint prepended to each prompt.",
    run: async (fx) => {
      const hint = orientationHint(inspectImage(fx.buffer));
      return fold(await runMultiPass({ base64: fx.base64, mimeType: fx.mimeType }, { hint }));
    },
  },
  {
    name: "v5_full3_rot",
    describe: "v4 plus two extra OCR passes on sharp-rotated (90/270) downscaled copies.",
    run: async (fx) => {
      const hint = orientationHint(inspectImage(fx.buffer));
      const extraOcrImages = await rotatedVariants(fx);
      return fold(
        await runMultiPass({ base64: fx.base64, mimeType: fx.mimeType }, { hint, extraOcrImages }),
      );
    },
  },
  {
    name: "v6_rot_all",
    describe: "v5 plus the targeted identifier pass re-asked on each rotated copy (7 calls).",
    run: async (fx) => {
      const hint = orientationHint(inspectImage(fx.buffer));
      const rotated = await rotatedVariants(fx);
      return fold(
        await runMultiPass(
          { base64: fx.base64, mimeType: fx.mimeType },
          { hint, extraOcrImages: rotated, extraIdentifierImages: rotated },
        ),
      );
    },
  },
  {
    name: "v7_rot_noid",
    describe: "v5 with the targeted identifier pass REMOVED (semantic + 3 OCR renderings, 4 calls).",
    run: async (fx) => {
      const hint = orientationHint(inspectImage(fx.buffer));
      const extraOcrImages = await rotatedVariants(fx);
      return fold(
        await runMultiPass(
          { base64: fx.base64, mimeType: fx.mimeType },
          { hint, extraOcrImages, passes: ["semantic", "ocr"] },
        ),
      );
    },
  },
];

// ── CLI ──────────────────────────────────────────────────────────────────────

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main() {
  const fixtures = loadFixtures();

  if (process.argv.includes("--list")) {
    console.log("VARIANTS:");
    for (const v of VARIANTS) console.log(`  ${v.name.padEnd(16)} ${v.describe}`);
    console.log("\nFIXTURES:");
    for (const f of fixtures) {
      const info = inspectImage(f.buffer);
      console.log(
        `  ${f.id.padEnd(24)} ${info.width}x${info.height} exif=${info.exifOrientation ?? "-"} ${(f.buffer.length / 1024).toFixed(0)}KB  ${f.kind}`,
      );
    }
    return;
  }

  const onlyVariants = (arg("variants") ?? "").split(",").filter(Boolean);
  const onlyFixtures = (arg("fixtures") ?? "").split(",").filter(Boolean);
  const reps = Number(arg("reps") ?? 1);
  const stem = arg("out") ?? new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  const variants = VARIANTS.filter((v) => !onlyVariants.length || onlyVariants.includes(v.name));
  const fx = fixtures.filter((f) => !onlyFixtures.length || onlyFixtures.includes(f.id));

  console.log(
    `model=${togetherVisionModel()}  variants=${variants.length}  fixtures=${fx.length}  reps=${reps}`,
  );

  const summaries: VariantSummary[] = [];
  const perFixture = new Map<string, { variant: string; score: RunScore }[]>();
  const rawLog: unknown[] = [];

  for (const variant of variants) {
    const scores: RunScore[] = [];
    let calls = 0;
    const t0 = Date.now();
    // Sequential across fixtures: one plate's passes already run concurrently,
    // and a burst of 8 MB image uploads is how you get rate-limited.
    for (const f of fx) {
      for (let rep = 0; rep < reps; rep++) {
        try {
          const out = await variant.run(f);
          calls += out.calls;
          const score = scoreRun(f, variant.name, out.values);
          scores.push(score);
          if (rep === 0) {
            const list = perFixture.get(f.id) ?? [];
            list.push({ variant: variant.name, score });
            perFixture.set(f.id, list);
          }
          rawLog.push({ variant: variant.name, fixture: f.id, rep, values: out.values, raw: out.raw });
          process.stdout.write(
            `  ${variant.name} / ${f.id}${reps > 1 ? `#${rep}` : ""}: id ${score.identity.hits}/${score.identity.total}  spec ${score.spec.hits}/${score.spec.total}  halluc ${score.hallucinations}\n`,
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          process.stdout.write(`  ${variant.name} / ${f.id}: ERROR ${message}\n`);
          rawLog.push({ variant: variant.name, fixture: f.id, rep, error: message });
        }
      }
    }
    summaries.push(summarize(variant.name, scores, calls, Date.now() - t0));
  }

  console.log("\n=== HEADLINE (all fixtures) ===");
  console.log(renderSummaryTable(summaries));

  console.log("\n=== PER-FIELD ===");
  for (const [fixtureId, runs] of perFixture) {
    console.log("\n" + renderFieldTable(fixtureId, runs));
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `${stem}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        model: togetherVisionModel(),
        reps,
        summaries,
        scores: [...perFixture.entries()].map(([id, runs]) => ({ fixture: id, runs })),
        raw: rawLog,
      },
      null,
      2,
    ),
  );
  console.log(`\nresults -> ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

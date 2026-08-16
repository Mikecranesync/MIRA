/**
 * hub-path.ts — qualification of the ACTUAL Hub crop-then-recognize path.
 *
 *   # detect service reachable (e.g. ssh -L 18011:localhost:18011 factorylm-prod
 *   # with the nameplate-detect PoC container running), then:
 *   cd mira-hub
 *   NAMEPLATE_DETECT_ENABLED=1 MIRA_ASK_URL=http://localhost:18011 \
 *     doppler run --project factorylm --config dev -- \
 *     bun benchmarks/nameplate/hub-path.ts --reps 3 --out hub-path-round1
 *
 * Difference from auto-region.ts (the feasibility harness): NOTHING here is
 * harness-local. The image decision comes from src/lib/nameplate/detect.ts's
 * resolveRecognitionImage — the exact function both recognize routes call —
 * against a live /nameplate/detect service running the real ask_api module,
 * and the reading comes from defaultRecognizer(), the route's recognizer. The
 * crop is whatever the SERVICE produced (cv2, decoded space, NO uprighting —
 * unlike auto-region.ts, which rotated before cropping), so this measures the
 * pixels production will actually read.
 *
 * The run also proves the fallback leg: with the detector unreachable, the
 * same seam must resolve to the original photo and recognition must still
 * answer.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRecognitionImage } from "../../src/lib/nameplate/detect";
import { defaultRecognizer } from "../../src/lib/nameplate";
import { parseNameplateLines } from "../../src/lib/nameplate/passes";
import { scoreRun, type Fixture, type RunScore } from "./score";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = path.join(HERE, "results");
const FIXTURE_ID = "orientalmotor_dgm200r";
const SOURCE = "C:/Users/hharp/.claude/uploads/84593816-e928-4a91-8bc3-0a1dba84a776/504beeb6-1000007793.jpg";

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

/** Exactly the route's construction: defaultRecognizer() candidate + spec
 * fields parsed deterministically from its rawText (readShipped in
 * region-experiment.ts; v0_baseline in run.ts). */
async function readOnce(base64: string, mimeType: string) {
  const candidate = await defaultRecognizer().recognize(base64, mimeType);
  const det = parseNameplateLines(candidate.rawText ?? []);
  return {
    candidate,
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
    } as Record<string, string | null>,
  };
}

async function main() {
  if (process.env.NAMEPLATE_DETECT_ENABLED !== "1") {
    throw new Error("run with NAMEPLATE_DETECT_ENABLED=1 and MIRA_ASK_URL pointing at the detect service");
  }
  const reps = Number(arg("reps") ?? 3);
  const stem = arg("out") ?? "hub-path";
  const fixture = loadFixture();
  const sourceB64 = fs.readFileSync(SOURCE).toString("base64");
  console.log(`detect service: ${process.env.MIRA_ASK_URL}`);

  type Rep = {
    rep: number;
    ok: boolean;
    error?: string;
    ms: number;
    imageSource: unknown;
    values?: Record<string, string | null>;
    score?: RunScore;
  };
  const repsOut: Rep[] = [];
  for (let rep = 0; rep < reps; rep++) {
    const t0 = Date.now();
    try {
      const read = await resolveRecognitionImage(sourceB64, "image/jpeg");
      if (read.imageSource.kind !== "auto_detected_crop") {
        throw new Error(`detector did not produce a crop (got ${read.imageSource.kind})`);
      }
      const { values } = await readOnce(read.base64, read.mimeType);
      const score = scoreRun(fixture, "hub_path_auto_crop", values);
      repsOut.push({ rep, ok: true, ms: Date.now() - t0, imageSource: read.imageSource, values, score });
      console.log(
        `  rep ${rep}: current=${String(values.current)}  catalog=${String(values.catalogNumber)}  ` +
          `spec ${score.spec.hits}/${score.spec.total}  id ${score.identity.hits}/${score.identity.total}  ` +
          `halluc ${score.hallucinations}  ${Date.now() - t0}ms`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      repsOut.push({ rep, ok: false, error: message, ms: Date.now() - t0, imageSource: null });
      console.log(`  rep ${rep}: ERROR ${message}`);
    }
  }

  // ── Fallback leg: detector unreachable => original photo, reading survives ──
  console.log("\nfallback leg (detector unreachable):");
  const savedUrl = process.env.MIRA_ASK_URL;
  process.env.MIRA_ASK_URL = "http://127.0.0.1:1"; // nothing listens here
  let fallback: { ok: boolean; imageSource: unknown; identityRead: boolean; error?: string };
  try {
    const read = await resolveRecognitionImage(sourceB64, "image/jpeg");
    const { values } = await readOnce(read.base64, read.mimeType);
    fallback = {
      ok: read.imageSource.kind === "original_photo",
      imageSource: read.imageSource,
      identityRead: Boolean(values.manufacturer && values.model),
    };
    console.log(
      `  imageSource=${read.imageSource.kind}  manufacturer=${String(values.manufacturer)}  model=${String(values.model)}`,
    );
  } catch (err) {
    fallback = { ok: false, imageSource: null, identityRead: false, error: String(err) };
    console.log(`  ERROR ${String(err)}`);
  }
  process.env.MIRA_ASK_URL = savedUrl;

  const ok = repsOut.filter((r) => r.ok);
  const current3 = ok.filter((r) => r.values?.current === "1.27A").length;
  const catalog3 = ok.filter((r) => (r.values?.catalogNumber ?? "").toUpperCase().includes("AZM911AC-D")).length;
  const identityHits = ok.reduce((a, r) => a + (r.score?.identity.hits ?? 0), 0);
  const identityTotal = ok.reduce((a, r) => a + (r.score?.identity.total ?? 0), 0);
  const hallTotal = ok.reduce((a, r) => a + (r.score?.hallucinations ?? 0), 0);
  const rohs = ok.filter((r) => JSON.stringify(r.values).match(/RoHS/i)).length;

  console.log("\n=== HUB-PATH GATE ===");
  console.log(`  current 1.27A exact : ${current3}/${repsOut.length}`);
  console.log(`  RoHS fabricated     : ${rohs}/${repsOut.length}`);
  console.log(`  catalog AZM911AC-D  : ${catalog3}/${repsOut.length}`);
  console.log(`  identity            : ${identityHits}/${identityTotal}`);
  console.log(`  hallucinations      : ${hallTotal}`);
  console.log(`  fallback leg        : ${fallback.ok && fallback.identityRead ? "PASS" : "FAIL"}`);

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const outPath = path.join(RESULTS_DIR, `${stem}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        source: SOURCE,
        seam: "resolveRecognitionImage + defaultRecognizer (the recognize routes' exact calls)",
        detectService: savedUrl,
        reps: repsOut,
        fallback,
        gate: {
          current127A: `${current3}/${repsOut.length}`,
          rohsFabricated: rohs,
          catalogRecovered: `${catalog3}/${repsOut.length}`,
          identity: `${identityHits}/${identityTotal}`,
          hallucinations: hallTotal,
          fallbackOk: fallback.ok && fallback.identityRead,
        },
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

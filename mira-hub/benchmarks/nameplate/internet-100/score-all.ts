/**
 * score-all.ts — deterministic scoring of every sample: gt/web-XXX.json
 * (ground truth, written blind before any pipeline output existed) vs
 * runs/web-XXX.json (baseline + improved legs from run-sample.ts).
 *
 *   bun benchmarks/nameplate/internet-100/score-all.ts \
 *     --dir benchmarks/nameplate/internet-100 --out results.json
 *
 * Scoring rules (applied identically to both legs — no leg gets a friendlier
 * rubric):
 *
 * - IDENTITY (manufacturer/model/catalogNumber/serialNumber): scored only
 *   where GT is confident (not "unknown"). normId equality or containment
 *   either way = correct; null = safe miss; mismatch = wrong.
 * - SPECS: each GT spec (value_verbatim incl. unit, confidence high/medium)
 *   is searched in the leg's parsed values + rawText. Number+unit exact =
 *   correct. Same digit-string, wrong/no decimal = DECIMAL failure. Same
 *   unit, different number = wrong numeric. Nothing with that unit = safe
 *   miss. GT "low" confidence specs are recorded but not scored.
 * - UNITS: GT unit present among the leg's number+unit tokens = unit hit
 *   (independent of magnitude).
 * - MARKS: predicted certification marks not in the GT mark list =
 *   hallucinated marks (the RoHS class). GT agents list every legible mark;
 *   samples whose GT could not enumerate marks (marks_complete=false) are
 *   excluded from this metric.
 * - PROMOTIONS: fields the evidence layer marked promotable, where GT is
 *   confident and disagrees = INCORRECT PROMOTION — the safety metric whose
 *   target is zero.
 * - suspect_claims: parsed numeric fields whose unit appears nowhere in GT —
 *   NOT auto-counted as hallucinations (GT may simply not list the field);
 *   handed to the failure-analysis pass for human-grade adjudication.
 */

import fs from "node:fs";
import path from "node:path";

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const normId = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, "");
const normLine = (s: string) => s.toUpperCase().replace(/[^A-Z0-9./]/g, "");

type NumTok = { num: string; unit: string };
const NUM_UNIT_G = /([0-9]+(?:\.[0-9]+)?)\s*(°?\s*\/?\s*[A-Za-zΩ°%][A-Za-z°/%]{0,6})/g;

function numTokens(lines: string[]): NumTok[] {
  const toks: NumTok[] = [];
  for (const line of lines) {
    for (const m of line.toUpperCase().matchAll(NUM_UNIT_G)) {
      toks.push({ num: m[1], unit: m[2].replace(/\s+/g, "") });
    }
  }
  return toks;
}

type LegRead = {
  values?: Record<string, string | null>;
  rawText?: string[];
  review?: { promotable: { field: string; value: string | null }[] };
  imageSource?: { kind: string; detector?: { regionCount: number; cropRotationDeg: number; ms: number | null } };
  fallback_used?: boolean;
  total_ms?: number;
  error?: string;
};

type GtSpec = { field: string; value_verbatim: string; unit?: string | null; confidence: string };
type Gt = {
  sample_id: string;
  usable: boolean;
  exclusion_reason?: string | null;
  difficulty?: string;
  conditions?: string[];
  photo_gt?: {
    manufacturer?: string;
    model?: string;
    catalogNumber?: string;
    serialNumber?: string;
    equipment_category?: string;
    specs?: GtSpec[];
    marks?: string[];
    marks_complete?: boolean;
  };
  oem_gt?: { source_url?: string } | null;
};

const IDENTITY_FIELDS = ["manufacturer", "model", "catalogNumber", "serialNumber"] as const;
const PARSED_SPEC_KEYS = ["voltage", "current", "resolution", "ambient", "insulation"];

function known(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== "unknown";
}

function scoreLeg(gt: Gt, leg: LegRead) {
  if (!leg || leg.error || !leg.values) {
    return { leg_error: leg?.error ?? "missing", scored: false };
  }
  const pg = gt.photo_gt ?? {};
  const searchLines = [
    ...(leg.rawText ?? []),
    ...Object.values(leg.values).filter((v): v is string => typeof v === "string"),
  ];
  const normLines = searchLines.map(normLine);
  const toks = numTokens(searchLines);

  // identity
  const identity: Record<string, { expected: string; got: string | null; verdict: string }> = {};
  let idTotal = 0;
  let idCorrect = 0;
  let idWrong = 0;
  let idSafeNull = 0;
  for (const f of IDENTITY_FIELDS) {
    const expected = (pg as Record<string, unknown>)[f];
    if (!known(expected)) continue;
    idTotal++;
    const got = leg.values[f] ?? null;
    let verdict: string;
    if (got === null) {
      verdict = "safe_null";
      idSafeNull++;
    } else {
      const e = normId(expected);
      const g = normId(got);
      if (e && g && (e === g || e.includes(g) || g.includes(e))) {
        verdict = "correct";
        idCorrect++;
      } else {
        verdict = "wrong";
        idWrong++;
      }
    }
    identity[f] = { expected, got: leg.values[f] ?? null, verdict };
  }

  // specs
  const specRows: Record<string, unknown>[] = [];
  let specTotal = 0;
  let specCorrect = 0;
  let specWrong = 0;
  let specMissed = 0;
  let decTotal = 0;
  let decCorrect = 0;
  let decFail = 0;
  let unitTotal = 0;
  let unitCorrect = 0;
  for (const spec of pg.specs ?? []) {
    if (!spec?.value_verbatim || !["high", "medium"].includes(spec.confidence)) continue;
    specTotal++;
    const verb = spec.value_verbatim;
    const target = normLine(verb);
    const hasDecimal = /\d\.\d/.test(verb);
    if (hasDecimal) decTotal++;
    const m = verb.toUpperCase().match(/([0-9]+(?:\.[0-9]+)?)\s*(°?\s*\/?\s*[A-Za-zΩ°%][A-Za-z°/%]{0,6})?/);
    const gtNum = m?.[1] ?? null;
    const gtUnit = (spec.unit ?? m?.[2] ?? "").toUpperCase().replace(/\s+/g, "") || null;

    let verdict: string;
    if (normLines.some((l) => l.includes(target))) {
      verdict = "correct";
      specCorrect++;
      if (hasDecimal) decCorrect++;
    } else if (gtNum && gtUnit) {
      const sameUnit = toks.filter((t) => t.unit === gtUnit || t.unit.startsWith(gtUnit));
      const gtDigits = gtNum.replace(".", "");
      if (sameUnit.some((t) => t.num === gtNum)) {
        verdict = "correct";
        specCorrect++;
        if (hasDecimal) decCorrect++;
      } else if (sameUnit.some((t) => t.num.replace(".", "") === gtDigits || gtDigits.startsWith(t.num.replace(".", "")))) {
        verdict = "decimal_failure";
        specWrong++;
        if (hasDecimal) decFail++;
      } else if (sameUnit.length) {
        verdict = "wrong_numeric";
        specWrong++;
      } else {
        verdict = "safe_miss";
        specMissed++;
      }
    } else {
      verdict = "safe_miss";
      specMissed++;
    }
    if (gtUnit) {
      unitTotal++;
      if (toks.some((t) => t.unit === gtUnit || t.unit.startsWith(gtUnit))) unitCorrect++;
    }
    specRows.push({ field: spec.field, expected: verb, verdict });
  }

  // hallucinated marks (only when GT enumerated every legible mark)
  const gtMarks = (pg.marks ?? []).map(normId);
  const predMarks = (leg.values.marks ?? "")
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const hallucinatedMarks =
    pg.marks_complete === false ? [] : predMarks.filter((mk) => !gtMarks.includes(normId(mk)));

  // suspect numeric claims (adjudicated later, not auto-counted)
  const gtUnits = new Set(
    (pg.specs ?? [])
      .map((s) => (s.unit ?? "").toUpperCase().replace(/\s+/g, ""))
      .filter(Boolean),
  );
  const suspectClaims = PARSED_SPEC_KEYS.filter((k) => {
    const v = leg.values[k];
    if (!v) return false;
    const tok = numTokens([v])[0];
    return tok ? !gtUnits.has(tok.unit) : false;
  }).map((k) => ({ field: k, value: leg.values[k] }));

  // incorrect promotions — the safety metric
  const incorrectPromotions: Record<string, unknown>[] = [];
  for (const p of leg.review?.promotable ?? []) {
    const expected = (pg as Record<string, unknown>)[p.field];
    if (!known(expected) || !p.value) continue;
    const e = normId(expected);
    const g = normId(p.value);
    if (!(e === g || e.includes(g) || g.includes(e))) {
      incorrectPromotions.push({ field: p.field, expected, promoted: p.value });
    }
  }

  return {
    scored: true,
    identity,
    identity_total: idTotal,
    identity_correct: idCorrect,
    identity_wrong: idWrong,
    identity_safe_null: idSafeNull,
    spec_rows: specRows,
    spec_total: specTotal,
    spec_correct: specCorrect,
    spec_wrong: specWrong,
    spec_missed: specMissed,
    decimal_total: decTotal,
    decimal_correct: decCorrect,
    decimal_failures: decFail,
    unit_total: unitTotal,
    unit_correct: unitCorrect,
    hallucinated_marks: hallucinatedMarks,
    suspect_claims: suspectClaims,
    incorrect_promotions: incorrectPromotions,
    fallback_used: leg.fallback_used ?? null,
    crop_rotation_deg: leg.imageSource?.detector?.cropRotationDeg ?? null,
    region_count: leg.imageSource?.detector?.regionCount ?? null,
    total_ms: leg.total_ms ?? null,
  };
}

type LegScore = ReturnType<typeof scoreLeg>;

function aggregate(rows: { score: LegScore }[]) {
  const s = rows.map((r) => r.score).filter((x) => x.scored) as Extract<LegScore, { scored: true }>[];
  const sum = (f: (x: (typeof s)[0]) => number) => s.reduce((a, x) => a + f(x), 0);
  const idT = sum((x) => x.identity_total);
  const spT = sum((x) => x.spec_total);
  const decT = sum((x) => x.decimal_total);
  const unT = sum((x) => x.unit_total);
  return {
    samples_scored: s.length,
    identity: { total: idT, correct: sum((x) => x.identity_correct), wrong: sum((x) => x.identity_wrong), safe_null: sum((x) => x.identity_safe_null), accuracy: idT ? sum((x) => x.identity_correct) / idT : null },
    spec: { total: spT, correct: sum((x) => x.spec_correct), wrong: sum((x) => x.spec_wrong), missed: sum((x) => x.spec_missed), accuracy: spT ? sum((x) => x.spec_correct) / spT : null },
    decimal: { total: decT, correct: sum((x) => x.decimal_correct), failures: sum((x) => x.decimal_failures), accuracy: decT ? sum((x) => x.decimal_correct) / decT : null },
    unit: { total: unT, correct: sum((x) => x.unit_correct), accuracy: unT ? sum((x) => x.unit_correct) / unT : null },
    hallucinated_mark_count: sum((x) => x.hallucinated_marks.length),
    incorrect_promotions: sum((x) => x.incorrect_promotions.length),
    fallback_count: s.filter((x) => x.fallback_used === true).length,
    mean_ms: s.length ? Math.round(sum((x) => x.total_ms ?? 0) / s.length) : null,
  };
}

async function main() {
  const dir = arg("dir") ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".");
  const outName = arg("out") ?? "results.json";
  const gtDir = path.join(dir, "gt");
  // --runs lets a replay (recomputed field assignment over stored rawText) be
  // scored against the same GT without touching the original runs/ evidence.
  const runDir = path.join(dir, arg("runs") ?? "runs");
  const gtFiles = fs.existsSync(gtDir) ? fs.readdirSync(gtDir).filter((f) => f.endsWith(".json")) : [];

  const perSample: Record<string, unknown>[] = [];
  const improvedRows: { score: LegScore }[] = [];
  const baselineRows: { score: LegScore }[] = [];
  for (const f of gtFiles.sort()) {
    const gt = JSON.parse(fs.readFileSync(path.join(gtDir, f), "utf8")) as Gt;
    const runPath = path.join(runDir, `${gt.sample_id}.json`);
    if (!gt.usable) {
      perSample.push({ sample_id: gt.sample_id, excluded: true, exclusion_reason: gt.exclusion_reason ?? "unusable" });
      continue;
    }
    if (!fs.existsSync(runPath)) {
      perSample.push({ sample_id: gt.sample_id, excluded: true, exclusion_reason: "no_pipeline_run" });
      continue;
    }
    const run = JSON.parse(fs.readFileSync(runPath, "utf8"));
    const improved = scoreLeg(gt, run.improved);
    const baseline = scoreLeg(gt, run.baseline);
    improvedRows.push({ score: improved });
    baselineRows.push({ score: baseline });
    perSample.push({
      sample_id: gt.sample_id,
      difficulty: gt.difficulty ?? "unrated",
      conditions: gt.conditions ?? [],
      equipment_category: gt.photo_gt?.equipment_category ?? "unknown",
      improved,
      baseline,
    });
  }

  const byDifficulty: Record<string, unknown> = {};
  for (const d of ["easy", "medium", "hard"]) {
    const rows = perSample.filter((p) => p.difficulty === d && !p.excluded) as { improved: LegScore }[];
    if (rows.length) byDifficulty[d] = aggregate(rows.map((r) => ({ score: r.improved })));
  }

  const result = {
    scoredAt: new Date().toISOString(),
    samples_total_gt: gtFiles.length,
    samples_evaluated: improvedRows.length,
    samples_excluded: perSample.filter((p) => p.excluded).length,
    aggregate: { improved: aggregate(improvedRows), baseline: aggregate(baselineRows) },
    by_difficulty_improved: byDifficulty,
    per_sample: perSample,
  };
  const outPath = path.join(dir, outName);
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ evaluated: result.samples_evaluated, excluded: result.samples_excluded, improved: result.aggregate.improved, baseline: result.aggregate.baseline }, null, 2));
  console.log(`results -> ${outPath}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

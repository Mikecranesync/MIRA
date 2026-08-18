/**
 * score.ts — field-level scoring for the nameplate benchmark.
 *
 * Three deliberate design choices:
 *
 * 1. FIELD-LEVEL, NEVER PASS/FAIL. A run that gets the manufacturer and model
 *    right but reports a 10x-wrong current is not "80% good" — it is dangerous
 *    in a different way than a run that missed the model. So every field gets
 *    its own verdict and the verdicts are reported separately.
 *
 * 2. NUMERIC FIELDS COMPARE NUMBER AND UNIT SEPARATELY. `1.27A` vs `12A` is a
 *    numeric error, not a string error. String similarity would score it as a
 *    near-miss; a technician sizing an overload would not.
 *
 * 3. HALLUCINATION IS ITS OWN METRIC, NOT AN ACCURACY PENALTY. A value invented
 *    out of nothing (the baseline's `RoHS`) is a different failure from a value
 *    misread off the plate (`GSB111970` for `QS8 I119701`). Accuracy conflates
 *    them; the confirmation UI must not.
 */

export type FieldSpec = {
  expect: string | null;
  accept?: string[];
  number?: number;
  unit?: string;
};

export type Fixture = {
  id: string;
  image: string;
  kind: string;
  notes: string;
  identity: Record<string, FieldSpec>;
  spec: Record<string, FieldSpec>;
  marks: string[];
  forbidden: string[];
  visibleText: string[];
};

export type Verdict =
  | "exact"
  | "normalized"
  | "numeric_ok_unit_wrong"
  | "wrong"
  | "wrong_numeric"
  | "missed"
  | "correct_null"
  | "false_positive";

export type FieldScore = {
  field: string;
  group: "identity" | "spec" | "marks";
  expected: string | null;
  got: string | null;
  verdict: Verdict;
  hallucinated: boolean;
  note?: string;
};

export type RunScore = {
  fixtureId: string;
  variant: string;
  fields: FieldScore[];
  identity: { hits: number; total: number; pct: number };
  spec: { hits: number; total: number; pct: number };
  marks: { verdict: Verdict; expected: string; got: string };
  hallucinations: number;
  hallucinatedValues: string[];
  falsePositives: number;
};

// ── Normalization ────────────────────────────────────────────────────────────

/** Identity comparison key: case, whitespace and punctuation insensitive. */
export function normId(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Loose text key that keeps word boundaries, for support lookups. */
export function normLoose(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").trim();
}

const NUM_UNIT_RE = /([0-9]+(?:\.[0-9]+)?)\s*(°?\s*\/?\s*[A-Za-zµΩ°%]+)?/;

export type NumUnit = { number: number | null; unit: string | null };

/**
 * Pull a number and a unit out of a returned value string. Deliberately dumb:
 * it does NOT repair OCR homoglyphs, because the scorer's job is to report what
 * the pipeline produced, not to rescue it.
 */
export function splitNumberUnit(raw: string): NumUnit {
  const s = raw.trim();
  // Range forms ("208-240VAC"): score on the upper bound, matching the fixture.
  const range = s.match(/([0-9]+(?:\.[0-9]+)?)\s*[-–]\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Za-z°/]+)?/);
  if (range) {
    return { number: Number(range[2]), unit: normUnit(range[3] ?? "") };
  }
  const m = s.match(NUM_UNIT_RE);
  if (!m) return { number: null, unit: normUnit(s) };
  return { number: Number(m[1]), unit: normUnit(m[2] ?? "") };
}

function normUnit(u: string): string | null {
  const t = u.replace(/\s+/g, "").toUpperCase().replace(/º/g, "°");
  if (!t) return null;
  // 1PH/3PH phase suffixes and the like ride along on voltage strings.
  return t.replace(/^([A-Z°/]+).*$/, "$1");
}

// ── Support / hallucination detection ────────────────────────────────────────

/** Longest common subsequence length (character level). */
function lcs(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  const prev = new Array<number>(b.length + 1).fill(0);
  const cur = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

const SUPPORT_THRESHOLD = 0.6;

/**
 * Is a returned value traceable to something actually printed on this plate?
 *
 * Support = the returned value shares >=60% of its characters (as a
 * subsequence) with some line of ground-truth visible text. `12A` misread from
 * `1.27A` is supported (a misread). `RoHS` matches nothing (an invention).
 */
export function isSupported(value: string, fixture: Fixture): boolean {
  const v = normId(value);
  if (!v) return true;
  const corpus = [
    ...fixture.visibleText,
    ...Object.values(fixture.identity).flatMap((f) => [f.expect ?? "", ...(f.accept ?? [])]),
    ...Object.values(fixture.spec).flatMap((f) => [f.expect ?? "", ...(f.accept ?? [])]),
    ...fixture.marks,
  ]
    .filter(Boolean)
    .map(normId);
  for (const c of corpus) {
    if (!c) continue;
    if (c.includes(v) || v.includes(c)) return true;
    const ratio = lcs(v, c) / Math.max(v.length, 1);
    if (ratio >= SUPPORT_THRESHOLD) return true;
  }
  return false;
}

// ── Field scoring ────────────────────────────────────────────────────────────

function scoreField(
  field: string,
  group: "identity" | "spec",
  spec: FieldSpec,
  gotRaw: string | null,
  fixture: Fixture,
): FieldScore {
  const got = gotRaw && gotRaw.trim() ? gotRaw.trim() : null;
  const expected = spec.expect;

  if (expected === null || expected === undefined) {
    if (got === null) {
      return { field, group, expected: null, got: null, verdict: "correct_null", hallucinated: false };
    }
    const supported = isSupported(got, fixture);
    return {
      field,
      group,
      expected: null,
      got,
      verdict: "false_positive",
      hallucinated: !supported,
      note: supported ? "value appears on the plate but not as this field" : "no support on plate",
    };
  }

  if (got === null) {
    return { field, group, expected, got: null, verdict: "missed", hallucinated: false };
  }

  if (got === expected) {
    return { field, group, expected, got, verdict: "exact", hallucinated: false };
  }

  const accepted = [expected, ...(spec.accept ?? [])];
  if (accepted.some((a) => normId(a) === normId(got))) {
    return { field, group, expected, got, verdict: "normalized", hallucinated: false };
  }

  // Numeric fields: the number is the thing that can hurt someone.
  if (typeof spec.number === "number") {
    const { number, unit } = splitNumberUnit(got);
    const unitOk = !spec.unit || !unit || normId(unit).startsWith(normId(spec.unit).slice(0, 1));
    const unitExact = !spec.unit || (unit !== null && normId(unit) === normId(spec.unit));
    if (number !== null && Math.abs(number - spec.number) < 1e-9) {
      if (unitExact) {
        return { field, group, expected, got, verdict: "normalized", hallucinated: false };
      }
      return {
        field,
        group,
        expected,
        got,
        verdict: "numeric_ok_unit_wrong",
        hallucinated: false,
        note: `unit ${unit ?? "(none)"} != ${spec.unit}`,
      };
    }
    return {
      field,
      group,
      expected,
      got,
      verdict: "wrong_numeric",
      hallucinated: !isSupported(got, fixture),
      note: `read ${number ?? "?"}${unit ?? ""} for ${spec.number}${spec.unit ?? ""}${unitOk ? "" : " (unit also wrong)"}`,
    };
  }

  // Substring credit: "Motor P/N AZM911AC-D" contains the catalog number.
  const gk = normId(got);
  if (accepted.some((a) => normId(a) && gk.includes(normId(a)))) {
    return {
      field,
      group,
      expected,
      got,
      verdict: "normalized",
      hallucinated: false,
      note: "contains the expected value verbatim",
    };
  }

  return {
    field,
    group,
    expected,
    got,
    verdict: "wrong",
    hallucinated: !isSupported(got, fixture),
  };
}

const HIT: Verdict[] = ["exact", "normalized"];

/** Marks are scored as a set: any extra mark is a hallucination. */
function scoreMarks(
  fixture: Fixture,
  gotRaw: string | null,
): { verdict: Verdict; got: string; expected: string; extras: string[] } {
  const expected = fixture.marks.map(normId).filter(Boolean);
  const got = (gotRaw ?? "")
    .split(/[,;|/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const gotKeys = got.map(normId);
  const extras = got.filter((_, i) => !expected.includes(gotKeys[i]));
  const missing = fixture.marks.filter((m) => !gotKeys.includes(normId(m)));
  const label = { expected: fixture.marks.join(", ") || "(none)", got: got.join(", ") || "(none)" };
  if (!extras.length && !missing.length) {
    return { verdict: expected.length ? "exact" : "correct_null", ...label, extras };
  }
  if (extras.length) return { verdict: "false_positive", ...label, extras };
  return { verdict: "missed", ...label, extras };
}

export function scoreRun(
  fixture: Fixture,
  variant: string,
  got: Record<string, string | null>,
): RunScore {
  const fields: FieldScore[] = [];
  for (const [field, spec] of Object.entries(fixture.identity)) {
    fields.push(scoreField(field, "identity", spec, got[field] ?? null, fixture));
  }
  for (const [field, spec] of Object.entries(fixture.spec)) {
    fields.push(scoreField(field, "spec", spec, got[field] ?? null, fixture));
  }

  const marks = scoreMarks(fixture, got.marks ?? null);
  const forbiddenHits: string[] = [];
  const allValues = Object.entries(got)
    .filter(([, v]) => typeof v === "string" && v)
    .map(([, v]) => v as string);
  for (const bad of fixture.forbidden) {
    const re = new RegExp(`\\b${bad.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (allValues.some((v) => re.test(v))) forbiddenHits.push(bad);
  }

  const scored = (group: "identity" | "spec") => {
    const rows = fields.filter((f) => f.group === group && f.expected !== null);
    const hits = rows.filter((f) => HIT.includes(f.verdict)).length;
    return {
      hits,
      total: rows.length,
      pct: rows.length ? Math.round((hits / rows.length) * 1000) / 10 : 0,
    };
  };

  const hallucinatedValues = [
    ...fields.filter((f) => f.hallucinated && f.got).map((f) => `${f.field}="${f.got}"`),
    ...marks.extras.filter((e) => !isSupported(e, fixture)).map((e) => `marks="${e}"`),
    ...forbiddenHits.map((f) => `forbidden="${f}"`),
  ];
  // A forbidden mark can surface both as an extra mark and as a forbidden hit.
  const uniqueHallucinations = [...new Set(hallucinatedValues.map((h) => h.split("=")[1]))];

  return {
    fixtureId: fixture.id,
    variant,
    fields,
    identity: scored("identity"),
    spec: scored("spec"),
    marks: { verdict: marks.verdict, expected: marks.expected, got: marks.got },
    hallucinations: uniqueHallucinations.length,
    hallucinatedValues: [...new Set(hallucinatedValues)],
    falsePositives: fields.filter((f) => f.verdict === "false_positive").length,
  };
}

// ── Aggregation + rendering ──────────────────────────────────────────────────

export type VariantSummary = {
  variant: string;
  identityHits: number;
  identityTotal: number;
  specHits: number;
  specTotal: number;
  hallucinations: number;
  falsePositives: number;
  missed: number;
  wrong: number;
  calls: number;
  ms: number;
};

export function summarize(variant: string, runs: RunScore[], calls: number, ms: number): VariantSummary {
  const all = runs.flatMap((r) => r.fields);
  return {
    variant,
    identityHits: runs.reduce((a, r) => a + r.identity.hits, 0),
    identityTotal: runs.reduce((a, r) => a + r.identity.total, 0),
    specHits: runs.reduce((a, r) => a + r.spec.hits, 0),
    specTotal: runs.reduce((a, r) => a + r.spec.total, 0),
    hallucinations: runs.reduce((a, r) => a + r.hallucinations, 0),
    falsePositives: runs.reduce((a, r) => a + r.falsePositives, 0),
    missed: all.filter((f) => f.verdict === "missed").length,
    wrong: all.filter((f) => f.verdict === "wrong" || f.verdict === "wrong_numeric").length,
    calls,
    ms,
  };
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}
function padL(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s;
}

export function renderSummaryTable(rows: VariantSummary[]): string {
  const head =
    pad("VARIANT", 26) +
    padL("IDENTITY", 12) +
    padL("SPEC", 12) +
    padL("HALLUC", 8) +
    padL("FALSE+", 8) +
    padL("MISSED", 8) +
    padL("WRONG", 7) +
    padL("CALLS", 7) +
    padL("SEC", 7);
  const sep = "-".repeat(head.length);
  const body = rows.map((r) => {
    const idPct = r.identityTotal ? ((r.identityHits / r.identityTotal) * 100).toFixed(0) : "-";
    const spPct = r.specTotal ? ((r.specHits / r.specTotal) * 100).toFixed(0) : "-";
    return (
      pad(r.variant, 26) +
      padL(`${r.identityHits}/${r.identityTotal} ${idPct}%`, 12) +
      padL(`${r.specHits}/${r.specTotal} ${spPct}%`, 12) +
      padL(String(r.hallucinations), 8) +
      padL(String(r.falsePositives), 8) +
      padL(String(r.missed), 8) +
      padL(String(r.wrong), 7) +
      padL(String(r.calls), 7) +
      padL((r.ms / 1000).toFixed(0), 7)
    );
  });
  return [head, sep, ...body].join("\n");
}

const VERDICT_GLYPH: Record<Verdict, string> = {
  exact: "OK  ",
  normalized: "OK~ ",
  numeric_ok_unit_wrong: "UNIT",
  wrong: "WRNG",
  wrong_numeric: "NUM!",
  missed: "MISS",
  correct_null: "null",
  false_positive: "FP! ",
};

export function renderFieldTable(fixtureId: string, runs: { variant: string; score: RunScore }[]): string {
  if (!runs.length) return "";
  const fieldNames = runs[0].score.fields.map((f) => f.field);
  const head = pad(`${fixtureId}`, 16) + runs.map((r) => padL(r.variant.slice(0, 15), 17)).join("");
  const lines = [head, "-".repeat(head.length)];
  for (const name of fieldNames) {
    let row = pad(name, 16);
    for (const r of runs) {
      const f = r.score.fields.find((x) => x.field === name)!;
      const got = f.got ? f.got.slice(0, 11) : "-";
      row += padL(`${VERDICT_GLYPH[f.verdict]} ${got}`, 17);
    }
    lines.push(row);
  }
  let markRow = pad("marks", 16);
  for (const r of runs) {
    markRow += padL(`${VERDICT_GLYPH[r.score.marks.verdict]} ${r.score.marks.got.slice(0, 11)}`, 17);
  }
  lines.push(markRow);
  let hallRow = pad("HALLUCINATIONS", 16);
  for (const r of runs) hallRow += padL(String(r.score.hallucinations), 17);
  lines.push(hallRow);
  return lines.join("\n");
}

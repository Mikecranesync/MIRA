/**
 * tools/investigator/judge.ts — LANE BENCH-B. MODEL-JUDGE
 * (PREREGISTRATION.md §5, E6: "a gpt-5.4-mini judge, blind to arm, reported
 * SEPARATELY as MODEL-JUDGE" — never pooled with Mike's human labels).
 *
 * For each case: presents the question, the evidence excerpts, and the arms'
 * proposed next checks, ANONYMISED (letters, never arm names) and shuffled
 * per case with a deterministic shuffle keyed by sha256(case id) — so the
 * judge is blind to which arm is which, the same case always shuffles the
 * same way (reproducible), and different cases shuffle differently (no
 * positional bias a judge could learn across the run).
 *
 * HARD RULE (this build session): $0 paid inference. `rateCase` below is
 * unit-tested ONLY with a fake `SynthesisModel` (never a real network call),
 * and `main()` — the only place a real OpenAI-compatible fetch could run —
 * is NEVER invoked in this session. `FileSpendLedger.reserve` is checked
 * BEFORE `model.complete` is ever called, enforced by a test with cap=0.001
 * that asserts the fake model's `complete` is never invoked on refusal.
 *
 * REUSE NOTE (corrected mid-build): an earlier draft of this file defined its
 * own `FileSpendLedger`/pricing/`estimateWorstCaseUsd`, because a grep for
 * `FileSpendLedger`/`OpenAiSynthesisModel` at the start of this build found
 * neither anywhere in the worktree. Both landed mid-build from sibling lanes
 * — CORE's real `FileSpendLedger` + `worstCaseUsd` at
 * `@/capabilities/investigator/budget` (cross-process-race-safe: append
 * first, then re-read and void on overshoot — stronger than this file's
 * first draft, which only read-on-construct), and BENCH-A's real
 * `OpenAiSynthesisModel` at `./openai-model`. `run_cases.ts`'s own header
 * comment made the same correction for the same reason ("this lane does NOT
 * define its own [ledger] ... to avoid two competing ledgers"). This file now
 * imports both rather than keeping a second, parallel implementation.
 * `SpendLedger`/`SynthesisModel` themselves stay imported as TYPES (erased at
 * compile time) from the fixed contract `@/capabilities/investigator/types`,
 * never changed by this file.
 *
 * Usage (never run for real in this session):
 *   cd mira-hub && OPENAI_API_KEY=... npx vite-node --config vitest.config.ts \
 *     ../tools/investigator/judge.ts -- <cases.json> <ledger.jsonl> <out.jsonl> [capUsd]
 */
import { createHash } from "node:crypto";
import type { SpendLedger, SynthesisModel } from "@/capabilities/investigator/types";
import { FileSpendLedger, worstCaseUsd } from "@/capabilities/investigator/budget";
import { DEFAULT_PRICE_PER_MTOK_IN, DEFAULT_PRICE_PER_MTOK_OUT } from "@/capabilities/openai-run-budget";
import { OpenAiSynthesisModel } from "./openai-model";

// ---------------------------------------------------------------------------
// Pure: deterministic per-case anonymisation shuffle
// ---------------------------------------------------------------------------

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Deterministic [0,1) stream seeded from `seed` — re-hashes the running
 *  state each draw (no external PRNG dependency, no `Math.random`). Same
 *  seed ⇒ same sequence, always; different seed ⇒ a different sequence. */
function* seededFloats(seed: string): Generator<number, never, unknown> {
  let state = sha256Hex(seed);
  for (;;) {
    state = sha256Hex(state);
    yield parseInt(state.slice(0, 8), 16) / 0x1_0000_0000;
  }
}

/** Fisher-Yates using `seededFloats(seed)` — deterministic per seed, uniform
 *  over permutations for a fixed seed's draw sequence. Pure; does not mutate
 *  `items`. */
export function seededShuffle<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const draws = seededFloats(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const r = draws.next().value as number;
    const j = Math.floor(r * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export type AnonMapping = { letters: string[]; letterToArm: Record<string, string>; armToLetter: Record<string, string> };

/** Shuffles `arms` deterministically by `sha256(caseId)` and assigns letters
 *  A, B, C... in the shuffled order. Same case id ⇒ same letter assignment
 *  every run (reproducible grading); two different case ids are independent
 *  draws, so the SAME arm doesn't sit under the same letter case after case
 *  (no positional bias to learn). */
export function anonymizeArms(arms: readonly string[], caseId: string): AnonMapping {
  if (arms.length > LETTERS.length) throw new Error(`anonymizeArms: ${arms.length} arms exceeds ${LETTERS.length}-letter budget`);
  const shuffled = seededShuffle(arms, `judge-anon:${caseId}`);
  const letters = shuffled.map((_, i) => LETTERS[i]);
  const letterToArm: Record<string, string> = {};
  const armToLetter: Record<string, string> = {};
  shuffled.forEach((arm, i) => {
    letterToArm[letters[i]] = arm;
    armToLetter[arm] = letters[i];
  });
  return { letters, letterToArm, armToLetter };
}

// ---------------------------------------------------------------------------
// Pure: prompt construction (anonymised) + output parsing
// ---------------------------------------------------------------------------

export type JudgeCaseInput = {
  caseId: string;
  question: string;
  /** Evidence excerpts shown to each arm, keyed by the arm's REAL name. */
  evidenceExcerptsByArm: Record<string, string[]>;
  /** Each arm's proposed next check / hypothesis text, keyed by REAL name. */
  nextCheckByArm: Record<string, string | null>;
};

export type JudgePrompt = { system: string; user: string } & AnonMapping;

const JUDGE_SYSTEM_PROMPT =
  "You are reviewing proposed next diagnostic checks for industrial maintenance questions. " +
  "You will see several anonymised candidates (labeled by letter only — never assume what produced them) " +
  "for the SAME question and evidence. For EACH letter, rate: " +
  'technically_valid ("yes"|"no"|"unclear"), safe ("yes"|"no"), grounded_in_evidence ("yes"|"no"), ' +
  "and give a one-line reason. Respond with ONLY a JSON object: " +
  '{"<letter>": {"technically_valid": ..., "safe": ..., "grounded_in_evidence": ..., "reason": "..."}, ...} — one entry per letter shown, no other text.';

/** Builds the anonymised judge prompt for one case. The returned mapping is
 *  how the caller de-anonymises the judge's lettered response back to real
 *  arm names afterward — it is never sent to the model. */
export function buildJudgePrompt(input: JudgeCaseInput): JudgePrompt {
  const arms = Object.keys(input.evidenceExcerptsByArm).sort(); // sort first so shuffle input order is itself deterministic
  const mapping = anonymizeArms(arms, input.caseId);
  const sections = mapping.letters.map((letter) => {
    const arm = mapping.letterToArm[letter];
    const excerpts = (input.evidenceExcerptsByArm[arm] ?? []).map((e, i) => `  [${i + 1}] ${e}`).join("\n");
    const nextCheck = input.nextCheckByArm[arm] ?? "(none proposed)";
    return `Candidate ${letter}:\nEvidence excerpts:\n${excerpts || "  (none)"}\nProposed next check:\n  ${nextCheck}`;
  });
  const user = `Question:\n${input.question}\n\n${sections.join("\n\n")}`;
  return { system: JUDGE_SYSTEM_PROMPT, user, ...mapping };
}

export type JudgeRating = {
  technically_valid: "yes" | "no" | "unclear";
  safe: "yes" | "no";
  grounded_in_evidence: "yes" | "no";
  reason: string;
};

const VALID_TV = new Set(["yes", "no", "unclear"]);
const VALID_YN = new Set(["yes", "no"]);

function isJudgeRating(v: unknown): v is JudgeRating {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.technically_valid === "string" &&
    VALID_TV.has(r.technically_valid) &&
    typeof r.safe === "string" &&
    VALID_YN.has(r.safe) &&
    typeof r.grounded_in_evidence === "string" &&
    VALID_YN.has(r.grounded_in_evidence) &&
    typeof r.reason === "string"
  );
}

export type ParsedJudgeOutput = { ok: true; ratings: Record<string, JudgeRating> } | { ok: false; error: string };

/** Parses + validates the judge's raw text as {letter: JudgeRating} for
 *  EXACTLY the given letters — no more, no fewer. Never throws: a malformed
 *  response is an `{ ok: false }` result the caller records, not a crash.
 *  Discriminated on `ok` (not on `"error" in parsed`) deliberately: an
 *  earlier draft returned a bare `Record<string, JudgeRating> | {error:
 *  string}` union, which `tsc` correctly flagged — `Record<string,
 *  JudgeRating>`'s index signature means a key literally named "error" is
 *  structurally possible on THAT branch too, so `"error" in parsed` doesn't
 *  exclude it and `parsed.error` typechecked as `string | JudgeRating`. A
 *  tag field has no such ambiguity. */
export function parseJudgeOutput(raw: string, letters: readonly string[]): ParsedJudgeOutput {
  let parsed: unknown;
  try {
    // Models sometimes wrap JSON in a fenced code block despite instructions; strip it defensively.
    const stripped = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
    parsed = JSON.parse(stripped);
  } catch (e) {
    return { ok: false, error: `not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (typeof parsed !== "object" || parsed === null) return { ok: false, error: "top-level JSON value is not an object" };
  const obj = parsed as Record<string, unknown>;
  const gotKeys = Object.keys(obj).sort();
  const wantKeys = [...letters].sort();
  if (JSON.stringify(gotKeys) !== JSON.stringify(wantKeys)) {
    return { ok: false, error: `expected ratings for exactly [${wantKeys.join(",")}], got [${gotKeys.join(",")}]` };
  }
  const ratings: Record<string, JudgeRating> = {};
  for (const letter of letters) {
    if (!isJudgeRating(obj[letter])) return { ok: false, error: `rating for "${letter}" is not a valid JudgeRating` };
    ratings[letter] = obj[letter] as JudgeRating;
  }
  return { ok: true, ratings };
}

// ---------------------------------------------------------------------------
// Orchestration: the only place that actually calls a model, gated by the
// ledger. Takes `model`/`ledger` as parameters — tests inject fakes.
// ---------------------------------------------------------------------------

export type RateCaseResult =
  | { status: "ok"; byArm: Record<string, JudgeRating> }
  | { status: "refused"; reason: string; worstCaseUsd: number }
  | { status: "parse_error"; reason: string; raw: string };

export async function rateCase(
  model: SynthesisModel,
  ledger: SpendLedger,
  input: JudgeCaseInput,
  maxOutputTokens = 600,
): Promise<RateCaseResult> {
  const prompt = buildJudgePrompt(input);
  // CORE's own estimator (mira-hub/src/capabilities/investigator/budget.ts):
  // promptChars/4 input tokens + maxOutputTokens, at the Hub's OpenAI list
  // prices, +10% margin — reused directly rather than re-derived here.
  const worstCase = worstCaseUsd(prompt.system.length + prompt.user.length, maxOutputTokens);
  const reservationId = ledger.reserve(worstCase, `judge:${input.caseId}`);
  if (reservationId === null) {
    return { status: "refused", reason: `reserve refused: worst-case $${worstCase.toFixed(4)} would exceed cap $${ledger.capUsd().toFixed(2)} (spent $${ledger.spentUsd().toFixed(4)})`, worstCaseUsd: worstCase };
  }
  const resp = await model.complete({ system: prompt.system, user: prompt.user, maxOutputTokens });
  const actualUsd = (resp.inputTokens * DEFAULT_PRICE_PER_MTOK_IN + resp.outputTokens * DEFAULT_PRICE_PER_MTOK_OUT) / 1_000_000;
  ledger.settle(reservationId, actualUsd, { inputTokens: resp.inputTokens, outputTokens: resp.outputTokens });
  const parsed = parseJudgeOutput(resp.text, prompt.letters);
  if (!parsed.ok) return { status: "parse_error", reason: parsed.error, raw: resp.text.slice(0, 500) };
  const byArm: Record<string, JudgeRating> = {};
  for (const letter of prompt.letters) byArm[prompt.letterToArm[letter]] = parsed.ratings[letter];
  return { status: "ok", byArm };
}

// ---------------------------------------------------------------------------
// CLI (never invoked in this session — see the module doc comment's hard
// rule). Empty argv ⇒ no-op, same convention as fusion_arms.ts, for the same
// reason: importing this module (every test does) must never dial out.
// ---------------------------------------------------------------------------

type JudgeCaseFile = { caseId: string; question: string; evidenceExcerptsByArm: Record<string, string[]>; nextCheckByArm: Record<string, string | null> };

async function main(): Promise<void> {
  const argv = process.argv.slice(2).filter((a) => a !== "--");
  if (argv.length === 0) return;
  const [casesPath, ledgerPath, outPath, capArg] = argv;
  if (!casesPath || !ledgerPath || !outPath) throw new Error("usage: <cases.json> <ledger.jsonl> <out.jsonl> [capUsd]");
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required — judge.ts's main() is the ONLY paid-call path in this lane, and is gated by FileSpendLedger");

  const { readFileSync, writeFileSync } = await import("node:fs");
  const ledger = new FileSpendLedger(ledgerPath, capArg ? Number(capArg) : 0.5);
  // BENCH-A's real SynthesisModel implementation (./openai-model) — judge
  // ratings are free text ("yes"/"no"/"unclear" fields in prose, not a
  // schema OpenAI's json_object mode is asked to enforce), so `"text"`.
  const model: SynthesisModel = new OpenAiSynthesisModel({ responseFormat: "text" });

  const cases: JudgeCaseFile[] = JSON.parse(readFileSync(casesPath, "utf8"));
  const lines: string[] = [];
  for (const c of cases) {
    const result = await rateCase(model, ledger, c);
    lines.push(JSON.stringify({ id: c.caseId, ...result }));
  }
  writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`wrote ${lines.length} rows to ${outPath} (ledger spent $${ledger.spentUsd().toFixed(4)} / cap $${ledger.capUsd().toFixed(2)})`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

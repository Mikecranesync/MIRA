/**
 * L3 evidence verifier (design doc §3, §4.2): NUM-1, NUM-2 and SYS-2 over typed numbers.
 * Enforced: discharge_time, residual_voltage, approach_boundary, incident_energy, pressure.
 * Deterministic; proves that an applicable source states the value, not that the source is right.
 *
 * Applicability (owner decision 4, written down so each rule is testable on its own):
 *  A1 `origin: "technician"` — the technician's own text — is never support.
 *  A2 `retrievalScope: "vendor_fallback"` (a sibling model's manual) is never support.
 *  A3 a manual chunk must be for the bound asset: its `docId` is one of the asset's approved
 *     documents, or its manufacturer AND model match the asset (case/punctuation-insensitive).
 *     No bound asset ⇒ nothing applies. A photo applies only when identified as the bound asset (#4955).
 *  A4 a manual chunk must be `verified === true` unless its `docId` is approved for the asset;
 *     `verified` undefined is treated as false (fail closed).
 *  A5 a manual chunk must carry a page (`sourcePage` or `pageLabel`) so the cite can be shown.
 */
import { parseTypedNumber } from "./schema";
import { chunkStatements, statementsOf, type Statement } from "./statements";
import { conditionCovers, sameCondition, sameValue, sentences } from "./text";
import {
  ENFORCED_QUANTITIES,
  type BoundAsset,
  type EvidenceChunk,
  type NumberCheck,
  type NumberVerdict,
  type Quantity,
  type TypedNumber,
  type VerifyResult,
} from "./types";

const norm = (s: string | undefined | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Null when the chunk is applicable support for the bound asset, else the block reason. */
export function applicability(chunk: EvidenceChunk, bound: BoundAsset | null): NumberVerdict | null {
  if (chunk.origin === "technician") return "block:technician_number";
  if (chunk.retrievalScope === "vendor_fallback") return "block:vendor_fallback";
  if (!bound) return "block:not_bound_asset";
  const models = [bound.modelNumber, ...(bound.modelAliases ?? [])].map(norm).filter(Boolean);
  const identifiedAs = (c: EvidenceChunk) =>
    norm(c.manufacturer) !== "" && norm(c.manufacturer) === norm(bound.manufacturer) && models.includes(norm(c.modelNumber));
  // #4955: a photo supports the bound asset only when its label was identified as that asset.
  // A live label has no page or verified flag; its provenance is the identification itself.
  if (chunk.origin === "photo") return identifiedAs(chunk) ? null : "block:not_bound_asset";
  const approvedDoc = !!chunk.docId && (bound.docIds ?? []).includes(chunk.docId);
  const sameAsset = approvedDoc || identifiedAs(chunk);
  if (!sameAsset) return "block:not_bound_asset";
  if (chunk.verified !== true && !approvedDoc) return "block:unverified_source";
  if (chunk.sourcePage == null && !(chunk.pageLabel ?? "").trim()) return "block:no_page";
  return null;
}

/** Which way is safer when sources disagree; null = no safe direction (ask for the rating). */
export const CONSERVATIVE: Record<Quantity, "max" | "min" | null> = {
  discharge_time: "max",
  residual_voltage: "min",
  approach_boundary: "max",
  incident_energy: "max",
  torque: null,
  pressure: null,
};

/**
 * NUM-1 value match, answer vs source, in canonical units. Exact for time and voltage. For the
 * converted quantities a unit conversion may round by up to 1%, but only toward the safer side
 * when there is one (max: the answer may round up, min: down); with no safe direction, either way.
 */
export function matchesSource(q: Quantity, answer: number, source: number): boolean {
  if (!sameValue(q, answer, source)) return false;
  const eps = 1e-9 * Math.max(1, Math.abs(answer), Math.abs(source));
  const dir = CONSERVATIVE[q];
  if (dir === "max") return answer >= source - eps;
  if (dir === "min") return answer <= source + eps;
  return true;
}

function inQuestion(n: TypedNumber, question: string): boolean {
  return sentences(question, false).some((s) =>
    statementsOf(s, true).some((st) => st.quantity === n.quantity && sameValue(n.quantity, st.value, n.value)),
  );
}

export interface VerifyInput {
  /** Untrusted typed numbers (from the extractor today, from the model's plan later). */
  numbers: unknown[];
  /** Quantities whose value could not be parsed ("a few minutes") — fail closed (SYS-2). */
  unparsed?: Quantity[];
  chunks: EvidenceChunk[];
  bound: BoundAsset | null;
  /** The technician's message: a value found only here is the technician's own number. */
  question?: string;
}

export function verifyNumbers(input: VerifyInput): VerifyResult {
  const byId = new Map(input.chunks.map((c) => [c.id, c]));
  const stmtCache = new Map<string, Statement[]>();
  const stmts = (c: EvidenceChunk) => {
    if (!stmtCache.has(c.id)) stmtCache.set(c.id, chunkStatements(c));
    return stmtCache.get(c.id)!;
  };
  const applicable = input.chunks.filter((c) => applicability(c, input.bound) === null);
  const enforced = (q: Quantity) => ENFORCED_QUANTITIES.includes(q);

  const checks: NumberCheck[] = (input.unparsed ?? []).map((q) => ({ number: null, verdict: "block:unparsed", enforced: enforced(q) }));

  for (const raw of input.numbers) {
    const n = parseTypedNumber(raw);
    if (!n) {
      // SYS-2: an unclassifiable number fails closed and counts as enforced.
      checks.push({ number: null, verdict: "block:schema", enforced: true });
      continue;
    }
    checks.push({ number: n, verdict: verdictFor(n), enforced: enforced(n.quantity) });
  }

  function verdictFor(n: TypedNumber): NumberVerdict {
    // D2 / #4964: only an exact-zero claim (comparator "eq") needs no source; "below / at most 0"
    // needs applicable cited evidence like any other value.
    if (n.value === 0 && n.comparator === "eq") {
      if (n.quantity === "residual_voltage") return "pass_absence_of_voltage";
      if (n.quantity === "pressure") return "pass_absence_of_pressure";
    }
    const own = input.question ? inQuestion(n, input.question) : false;
    if (n.sourceChunkId === null) return own ? "block:technician_number" : "block:no_source";
    const chunk = byId.get(n.sourceChunkId);
    if (!chunk) return "block:unknown_chunk";
    const why = applicability(chunk, input.bound);
    if (why) return why;
    const rating = input.bound?.rating;
    const covers = (s: Statement) => conditionCovers(s.condition, rating);
    const role = (x: { role?: "limit" }) => x.role ?? "operating";
    // D1 (Mike, round 3): an operating pressure above any applicable relief / maximum / rated limit
    // for the bound asset blocks, whatever the cited chunk says.
    if (n.quantity === "pressure" && role(n) === "operating") {
      const limits = applicable.flatMap(stmts).filter((s) => s.quantity === "pressure" && s.role === "limit" && covers(s));
      if (limits.some((l) => n.value > l.value && !sameValue("pressure", n.value, l.value))) return "block:exceeds_limit";
    }
    // NUM-1: the cited chunk itself states the value, in a sentence about this quantity, in the same
    // role (an operating pressure is not supported by a relief setting, nor the reverse).
    const stated = stmts(chunk).filter(
      (s) => s.quantity === n.quantity && role(s) === role(n) && matchesSource(n.quantity, n.value, s.value),
    );
    if (stated.length === 0) return own ? "block:technician_number" : "block:not_in_cited_sentence";
    // NUM-2: across every applicable source this turn, several values ⇒ the most conservative,
    // or the value with the source's own condition. A known asset rating drops the values whose
    // condition provably excludes it (a ≥ 40 hp time for a 5 hp drive). With no safe direction
    // (pressure, torque) only the single stated value or the source's own condition can pass.
    const matching = stated.filter(covers);
    // D1: limits never compete with operating values. A limit claim is checked only against its
    // cited statement (relief, maximum and rated limits are different facts, not rival values).
    const all =
      role(n) === "limit"
        ? matching
        : applicable.flatMap(stmts).filter((s) => s.quantity === n.quantity && role(s) === "operating" && covers(s));
    const values = [...new Set(all.map((s) => s.value))];
    const dir = CONSERVATIVE[n.quantity];
    const extreme = values.length === 0 ? null : dir === "max" ? Math.max(...values) : dir === "min" ? Math.min(...values) : null;
    const atLeastAsSafe =
      extreme !== null && (matchesSource(n.quantity, n.value, extreme) || (dir === "max" ? n.value > extreme : n.value < extreme));
    const noChoice: NumberVerdict = dir === null ? "block:no_safe_direction" : "block:not_most_conservative";
    if (matching.length === 0) return atLeastAsSafe ? "pass_most_conservative" : noChoice;
    const unconditioned = matching.some((s) => !s.condition);
    const conditioned = matching.some(
      (s) => !!s.condition && (sameCondition(s.condition, n.condition) || rating?.unit === s.condition.unit),
    );
    if (values.length <= 1) {
      if (unconditioned) return "pass";
      return conditioned ? "pass_conditioned" : "block:condition_dropped";
    }
    if (atLeastAsSafe) return "pass_most_conservative";
    if (conditioned) return "pass_conditioned";
    return noChoice;
  }

  // Turn verdict over ENFORCED checks only; deferred quantities are reported, never decide.
  const enforcedChecks = checks.filter((c) => c.enforced);
  const blocked = enforcedChecks.some((c) => c.verdict.startsWith("block:"));
  return { verdict: enforcedChecks.length === 0 ? "no_numbers" : blocked ? "block" : "pass", checks };
}

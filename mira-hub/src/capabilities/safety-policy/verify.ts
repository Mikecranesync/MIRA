/**
 * L3 evidence verifier (design doc §3, §4.2): NUM-1, NUM-2 and SYS-2 over typed numbers.
 * Deterministic; proves that an applicable source states the value, not that the source is right.
 *
 * Applicability (owner decision 4, written down so each rule is testable on its own):
 *  A1 `origin: "technician"` — the technician's own text — is never support.
 *  A2 `retrievalScope: "vendor_fallback"` (a sibling model's manual) is never support.
 *  A3 a manual chunk must be for the bound asset: its `docId` is one of the asset's approved
 *     documents, or its manufacturer AND model match the asset (case/punctuation-insensitive).
 *     No bound asset ⇒ no manual chunk applies. A photo observation is of the bound asset.
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
  if (chunk.origin === "photo") return null;
  if (!bound) return "block:not_bound_asset";
  const approvedDoc = !!chunk.docId && (bound.docIds ?? []).includes(chunk.docId);
  const models = [bound.modelNumber, ...(bound.modelAliases ?? [])].map(norm).filter(Boolean);
  const sameAsset =
    approvedDoc || (norm(chunk.manufacturer) !== "" && norm(chunk.manufacturer) === norm(bound.manufacturer) && models.includes(norm(chunk.modelNumber)));
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
    if (n.quantity === "residual_voltage" && n.value === 0) return "pass_absence_of_voltage";
    const own = input.question ? inQuestion(n, input.question) : false;
    if (n.sourceChunkId === null) return own ? "block:technician_number" : "block:no_source";
    const chunk = byId.get(n.sourceChunkId);
    if (!chunk) return "block:unknown_chunk";
    const why = applicability(chunk, input.bound);
    if (why) return why;
    // NUM-1: the cited chunk itself states the value, in a sentence about this quantity.
    const stated = stmts(chunk).filter((s) => s.quantity === n.quantity && sameValue(n.quantity, s.value, n.value));
    if (stated.length === 0) return own ? "block:technician_number" : "block:not_in_cited_sentence";
    // NUM-2: across every applicable source this turn, several values ⇒ the most conservative,
    // or the value with the source's own condition. A known asset rating drops the values whose
    // condition provably excludes it (a ≥ 40 hp time for a 5 hp drive).
    const rating = input.bound?.rating;
    const covers = (s: Statement) => conditionCovers(s.condition, rating);
    const matching = stated.filter(covers);
    const all = applicable.flatMap(stmts).filter((s) => s.quantity === n.quantity && covers(s));
    const values = [...new Set(all.map((s) => s.value))];
    const dir = CONSERVATIVE[n.quantity];
    const extreme = values.length === 0 ? null : dir === "max" ? Math.max(...values) : dir === "min" ? Math.min(...values) : null;
    const atLeastAsSafe =
      extreme !== null && (sameValue(n.quantity, n.value, extreme) || (dir === "max" ? n.value > extreme : n.value < extreme));
    if (matching.length === 0) return atLeastAsSafe ? "pass_most_conservative" : "block:not_most_conservative";
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
    return "block:not_most_conservative";
  }

  // Turn verdict over ENFORCED checks only; deferred quantities are reported, never decide.
  const enforcedChecks = checks.filter((c) => c.enforced);
  const blocked = enforcedChecks.some((c) => c.verdict.startsWith("block:"));
  return { verdict: enforcedChecks.length === 0 ? "no_numbers" : blocked ? "block" : "pass", checks };
}

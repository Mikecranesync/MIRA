/**
 * Shadow extractor (Phase 1): read the hazard-critical numbers out of a generated answer as typed
 * numbers, deterministically (no model call). In Phase 2 the model's strict-JSON plan supplies
 * `numbers[]` directly and this extractor stays as the cross-check on the rendered text.
 *
 * Fail closed: in a stored-energy paragraph (or a stored-energy question) every duration is a
 * discharge claim unless its clause is positively unrelated timing (ramps, fans, fault resets,
 * recharging), and a duration with no parsable number is reported as unparsed (SYS-2).
 *
 * Citation contract: `[n]` cites chunk id `c<n>`, `[photo]` cites chunk id `photo`.
 */
import { applicability } from "./verify";
import { chunkStatements, statementsOf, unparsedDischargeTime } from "./statements";
import { ANSWER_LINK_RE, DISCHARGE_LINK_RE, STORED_RE, answerParagraphs, fold, isUnrelatedTiming, sameValue } from "./text";
import { QUANTITY_UNIT, type BoundAsset, type EvidenceChunk, type Quantity, type TypedNumber } from "./types";

export const markerToChunkId = (m: string) => (m.toLowerCase() === "photo" ? "photo" : `c${m}`);

/** Chunk ids cited in a sentence, in order ("[1]", "[1][2]", "[1, 2]", "[photo]"). */
export function citedIds(sentence: string): string[] {
  const ids: string[] = [];
  for (const m of sentence.matchAll(/\[((?:\d+|photo)(?:\s*,\s*(?:\d+|photo))*)\]/gi)) {
    for (const part of m[1].split(/\s*,\s*/)) ids.push(markerToChunkId(part));
  }
  return [...new Set(ids)];
}

export interface ExtractOptions {
  answerText: string;
  question?: string;
  chunks: EvidenceChunk[];
  bound: BoundAsset | null;
  /**
   * `cited` (default, NUM-1 strict): a number's source is a chunk cited in its own sentence.
   * `any-applicable` (replay diagnostic only): an uncited number is attributed to the first
   * applicable chunk that states it — measures how much of a block is citation placement.
   */
  attribution?: "cited" | "any-applicable";
}

export interface Extraction {
  numbers: TypedNumber[];
  unparsed: Quantity[];
}

export function extractNumbers(opts: ExtractOptions): Extraction {
  const q = fold(opts.question ?? "");
  // Answer side, fail closed: a wait tied to power removal or to contact is a discharge context
  // even without a capacitor word (in the sentence, earlier in its paragraph, or in the question).
  const linked = (s: string) => DISCHARGE_LINK_RE.test(s) || ANSWER_LINK_RE.test(s);
  const questionContext = (STORED_RE.test(q) || linked(q)) && !isUnrelatedTiming(q);
  const byId = new Map(opts.chunks.map((c) => [c.id, c]));
  const states = (c: EvidenceChunk, quantity: Quantity, value: number) =>
    chunkStatements(c).some((s) => s.quantity === quantity && sameValue(quantity, s.value, value));
  const numbers: TypedNumber[] = [];
  const unparsed: Quantity[] = [];

  for (const paragraph of answerParagraphs(opts.answerText)) {
    let seenStored = false;
    for (const sentence of paragraph) {
      const ctx = STORED_RE.test(sentence) || linked(sentence) || seenStored || questionContext;
      seenStored = seenStored || STORED_RE.test(sentence) || linked(sentence);
      if (unparsedDischargeTime(sentence, ctx)) unparsed.push("discharge_time");
      const cited = citedIds(sentence);
      for (const st of statementsOf(sentence, ctx)) {
        const known = cited.filter((id) => byId.has(id));
        let source: string | null =
          known.find((id) => states(byId.get(id)!, st.quantity, st.value)) ?? known[0] ?? cited[0] ?? null;
        if (source === null && opts.attribution === "any-applicable") {
          source =
            opts.chunks.find((c) => applicability(c, opts.bound) === null && states(c, st.quantity, st.value))?.id ?? null;
        }
        const n: TypedNumber = { quantity: st.quantity, value: st.value, unit: QUANTITY_UNIT[st.quantity], sourceChunkId: source };
        if (st.condition) n.condition = st.condition;
        numbers.push(n);
      }
    }
  }
  return { numbers, unparsed };
}

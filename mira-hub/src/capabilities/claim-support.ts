/**
 * TQ-08 (2026-10-17 prod test): a yes/no or spec claim must be STATED in the
 * chunk the answer cites.
 *
 * The citation contract already proven elsewhere is positional — `[n]`
 * resolves to a (document, page) that was retrieved for this turn (#4303's
 * `citation.status = "linked"`, which explicitly "never claims the passage
 * supports the sentence"). TQ-08 is the gap that leaves: an answer can cite a
 * real page and still assert a number, or a bare "Yes", that appears nowhere
 * on it.
 *
 * This does NOT add a second value extractor or a second citation space. It
 * reuses `supportingQuote` (#4315), which already assigns every value in the
 * answer to its nearest citation marker and returns the ones found nowhere in
 * that citation's model-visible page text — a signal the route currently
 * computes (`unsupportedValueCount`) and spends only on quote selection and
 * telemetry. Here it decides the answer.
 *
 * Deliberately narrow, and the PR says so: it judges only (a) values carrying
 * a recognized unit, via the existing extractor's closed unit table, and
 * (b) a polar lead ("Yes,"/"No,") when an identifier the QUESTION named
 * appears in no cited chunk. It does not attempt semantic entailment of prose
 * — the semantic judge and the groundedness signals own that.
 *
 * Zero-token: pure and deterministic, no inference call.
 */

import { claimIdentifiers } from "@/lib/quote-window";
import { MODEL_VISIBLE_CHARS, normalize, supportingQuote } from "./supporting-quote";

/**
 * Default **OFF**, and that default is a measurement, not caution for its own
 * sake. Enabled by default, this check changed the verdict of three existing
 * route contracts on the first run — among them `chat-answer-gate`'s "a benign
 * grounded answer releases normally", whose answer says "Cool the seal bar
 * below 200 C" against a fixture chunk that never contains that value. The
 * check was right by its own rule and still wrong to refuse, because a correct
 * answer legitimately paraphrases: a unit spelled differently, a value split
 * across two chunks, a number only in an OCR'd table. The real-world rate of
 * that is UNMEASURED, so a refusal gate must not ship on by default.
 *
 * `1` enables detection AND (with the answer gate on) the replacement. Off,
 * nothing runs and the turn is byte-identical.
 */
export function claimSupportEnabled(): boolean {
  return process.env.NOTEBOOK_CLAIM_SUPPORT === "1";
}

/** The served text when a claim is not stated on the page it cites. Fixed,
 *  server-written, and candidate-independent — never the rejected draft's
 *  wording, and never a number from it. */
export const CLAIM_NOT_STATED_TEXT =
  "I can't point to that in the manual pages I have, so I won't state it as fact. The pages I retrieved for this question don't give that value. Add the page that covers it to this notebook, or ask me to search the manual again, and I'll answer from it and show you the page.";

export type ChunkForClaim = { sourceUrl: string; sourcePage: number | null; content: string };
export type CitationForClaim = { citationId: string };

/** A polar lead: the answer opens by affirming or denying. Only the lead
 *  counts — "no" inside a sentence is not a verdict on the question. */
const POLAR_LEAD_RE = /^\s*(?:\*\*)?(yes|no|correct|incorrect|affirmative|negative)\b/i;

export function polarLead(answer: string): string | null {
  const m = POLAR_LEAD_RE.exec(answer);
  return m ? m[1].toLowerCase() : null;
}

/** citationId n ⇔ the nth unique (sourceUrl, page) in chunk order — the SAME
 *  mapping `withSupportingQuotes` uses, so the two never disagree. */
function pagesByCitation(chunks: readonly ChunkForClaim[]): string[][] {
  const byKey = new Map<string, string[]>();
  for (const c of chunks) {
    const key = `${c.sourceUrl}::${c.sourcePage ?? ""}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c.content]);
  }
  return [...byKey.values()];
}

export type ClaimSupportVerdict = {
  /** True when at least one checked claim is not stated in its cited chunk. */
  unsupported: boolean;
  /** Why — a closed vocabulary, for logs and the evidence packet. Never text. */
  reason: "spec_value_not_in_cited_chunk" | "polar_claim_not_in_cited_chunk" | null;
  /** The claimed values found nowhere on their cited page (bounded, for logs). */
  values: string[];
};

const SUPPORTED: ClaimSupportVerdict = { unsupported: false, reason: null, values: [] };

/**
 * Does every value / polar claim in `answer` appear in the chunk it cites?
 *
 * Returns `unsupported: false` whenever the question cannot be judged — no
 * citations, no chunks, no recognized claim. Conservative by construction: it
 * can only ever flag a claim whose value the existing extractor fully parsed
 * (number AND a unit in its closed table) and then failed to find.
 */
export function checkClaimSupport(opts: {
  answer: string;
  question: string;
  citations: readonly CitationForClaim[];
  chunks: readonly ChunkForClaim[];
}): ClaimSupportVerdict {
  const { answer, question, citations, chunks } = opts;
  if (!answer.trim() || citations.length === 0 || chunks.length === 0) return SUPPORTED;

  const pages = pagesByCitation(chunks);
  const values: string[] = [];
  for (const c of citations) {
    const pageChunks = pages[Number(c.citationId) - 1];
    if (!pageChunks) continue;
    const r = supportingQuote(pageChunks, answer, c.citationId, question);
    for (const v of r.unsupported) if (!values.includes(v)) values.push(v);
  }
  if (values.length > 0) {
    return { unsupported: true, reason: "spec_value_not_in_cited_chunk", values: values.slice(0, 8) };
  }

  // A polar answer makes a claim even with no number in it. It is checked only
  // when the question named an identifier the cited pages can be searched for
  // (a parameter, a fault code, a terminal) — a yes/no about prose is left to
  // the semantic judge.
  if (polarLead(answer)) {
    const ids = [...claimIdentifiers(question)];
    if (ids.length > 0) {
      const cited = citations
        .map((c) => pages[Number(c.citationId) - 1])
        .filter((p): p is string[] => Array.isArray(p))
        .flat()
        .map((text) => normalize(text.slice(0, MODEL_VISIBLE_CHARS)))
        .join(" ");
      if (cited && !ids.some((id) => cited.includes(normalize(id)))) {
        return { unsupported: true, reason: "polar_claim_not_in_cited_chunk", values: [] };
      }
    }
  }
  return SUPPORTED;
}

/**
 * The corrective instruction for ONE redraft attempt (item 5's second half).
 * Names no value from the rejected draft — it tells the model what the rule
 * is, never what it got wrong, so a wrong number can never be echoed back
 * into the next prompt.
 */
export const REDRAFT_DIRECTIVE =
  "Your previous answer stated a value or a yes/no conclusion that does not appear in the documentation excerpts provided above. Answer again using ONLY values and statements that appear verbatim in those excerpts, and cite the [n] block each one comes from. If the excerpts do not contain what the question asks for, say plainly that it is not stated in the pages you were given — do not substitute a value from general knowledge.";

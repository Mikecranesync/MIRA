// H4 parity (#2542): honest KB-gap admission for evidence-less asset chat.
//
// The Python surfaces (Telegram/Slack/Ignition/pipeline) run the H4 enforcer
// `enforce_citation_or_gap_admission` (mira-bots/shared/engine.py, backed by
// mira-bots/shared/citation_compliance.py): a reply that carries neither a
// `[Source:]` citation nor an explicit KB-gap admission gets a stock honesty
// note appended, so a confident-but-ungrounded answer never reaches the tech.
//
// The Hub asset-chat route only enforced that via a HARD 412 gate behind
// MIRA_ENFORCE_APPROVED_ASK / MIRA_ENFORCE_APPROVED_RETRIEVAL (default off) —
// so in the default path it streamed the LLM answer regardless of evidence.
// This module is the SOFT (H4-parity) equivalent used in the default path:
// an evidence-less reply still streams, but must carry the gap admission. It
// does NOT replace the opt-in 412 gate (that default is unchanged).

/**
 * User-visible admission appended to an evidence-less reply that failed to
 * admit the gap on its own. Mirrors the Python `_H4_STOCK_ADMISSION` phrasing
 * ("specific documentation indexed", "consult the asset nameplate or vendor
 * manual", "knowledge base") so every MIRA surface reads the same.
 */
export const KB_GAP_ADMISSION =
  "\n\n_I don't have specific documentation indexed for this asset in my " +
  "knowledge base — consult the asset nameplate or vendor manual, or upload " +
  "the manual here so MIRA can cite it._";

/**
 * System-prompt instruction that steers the model to admit the gap up front
 * when there is no grounding evidence. The primary defense (the server-side
 * safety net still guarantees the admission if the model ignores this).
 */
export const KB_GAP_SYSTEM_INSTRUCTION = [
  "",
  "## No grounding evidence for this question",
  "You have NO manuals, live signals, or verified plant data to cite for this",
  "question. Do NOT invent fault codes, part numbers, torque specs, parameter",
  "values, or manual references. Open your answer by plainly admitting the",
  "gap — for example: \"I don't have specific documentation indexed for this",
  "asset in the knowledge base.\" You may still offer general, clearly-labeled",
  "maintenance guidance, but never present it as grounded in this asset's",
  "documentation.",
].join("\n");

const CITATION_RE = /\[source:/i;

// Phrases that count as an explicit KB-gap admission — a subset of the Python
// `_H4_GAP_PHRASES`, adapted to this surface's wording. Kept broad enough to
// recognize the model's own admissions (so we don't double up) yet specific
// enough not to match ordinary grounded prose.
const GAP_PHRASES = [
  "knowledge base",
  "consult the asset nameplate",
  "consult the vendor manual",
  "don't have specific documentation",
  "do not have specific documentation",
  "not have specific documentation",
  "not indexed",
  "not in the knowledge base",
  "upload the manual",
];

/**
 * True when a reply already cites a `[Source:]` OR admits the KB gap — i.e. it
 * does NOT need the stock admission appended. Case-insensitive.
 */
export function hasCitationOrGapAdmission(reply: string | null | undefined): boolean {
  if (!reply) return false;
  if (CITATION_RE.test(reply)) return true;
  const lower = reply.toLowerCase();
  return GAP_PHRASES.some((p) => lower.includes(p));
}

/**
 * Replays the frozen corpus through the exact function the chat route calls (shadowVerifyTurn), not the bare
 * verifier, so the reported numbers describe the wired code. Zero tokens.
 *   cd mira-hub && NOTEBOOK_CLAIM_VERIFIER=shadow npx vite-node --config vitest.config.ts \
 *     ../tools/evidence-runoff/run_shadow_replay.ts -- <corpus.jsonl> <stg_chunks.json> <out.jsonl>
 * Stored-chunk items (realA, seH, plc5) get their real per-page chunk list, so the MODEL_VISIBLE_CHARS cut
 * applies chunk by chunk exactly as in the route. Walk items only have a pdftotext page, passed as one chunk:
 * a faithful test of the binding logic, not of the route's chunking.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { shadowVerifyTurn } from "@/capabilities/claim-verifier-shadow";

const [corpus, chunksPath, out] = process.argv.slice(2).filter((a) => a !== "--");
type Chunk = { doc_id: string; page_start: number; page_end: number | null; content: string };
const chunks: Chunk[] = JSON.parse(readFileSync(chunksPath, "utf8"));
const rows: string[] = [];
for (const line of readFileSync(corpus, "utf8").split("\n").filter(Boolean)) {
  const it = JSON.parse(line);
  const stored = it.evidence_kind === "stored_chunks";
  const citations = it.evidence.map((e: { page: number; text: string }) => ({
    page: e.page,
    // Stored items: split the joined page text back into the chunks it was built from.
    chunks: stored ? chunks.filter((c) => e.text.includes(c.content) && c.page_start <= e.page && e.page <= (c.page_end ?? c.page_start)).map((c) => c.content) : [e.text],
  }));
  const a = shadowVerifyTurn({ question: it.question, answer: it.answer, citations }) ?? {};
  rows.push(JSON.stringify({ item_id: it.item_id, validator: "shadow", fidelity: stored ? "route" : "binding_only", verdict: a["mira.claim_verifier.verdict"], reason: a["mira.claim_verifier.reason"] }));
}
writeFileSync(out, rows.join("\n") + "\n");
console.log(JSON.stringify({ n: rows.length }));

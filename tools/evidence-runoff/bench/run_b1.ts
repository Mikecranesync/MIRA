/**
 * B1: run the templated checker set through shadowVerifyTurn — the function the chat route calls. Zero tokens.
 *   cd mira-hub && NOTEBOOK_CLAIM_VERIFIER=shadow npx vite-node --config vitest.config.ts <this> -- <items.jsonl> <out.jsonl>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { shadowVerifyTurn } from "@/capabilities/claim-verifier-shadow";

const [inp, out] = process.argv.slice(2).filter((a) => a !== "--");
const rows = readFileSync(inp, "utf8").split("\n").filter(Boolean).map((l) => {
  const it = JSON.parse(l);
  const a = shadowVerifyTurn({ question: it.question, answer: it.answer, citations: it.citations }) ?? {};
  return JSON.stringify({ id: it.id, variant: it.variant, truth: it.truth, verdict: a["mira.claim_verifier.verdict"], reason: a["mira.claim_verifier.reason"], claims: a["mira.claim_verifier.claims"] });
});
writeFileSync(out, rows.join("\n") + "\n");
console.log(JSON.stringify({ n: rows.length }));

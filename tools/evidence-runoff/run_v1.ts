/**
 * V1 runner: typed claim verifier over the frozen corpus. Zero tokens.
 *   cd mira-hub && npx vite-node --config vitest.config.ts ../tools/evidence-runoff/run_v1.ts -- <corpus.jsonl> <out.jsonl>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { verifyAnswer } from "@/capabilities/claim-verifier";

const [corpus, out] = process.argv.slice(2).filter((a) => a !== "--");
const lines = readFileSync(corpus, "utf8").split("\n").filter(Boolean);
const rows: string[] = [];
const t0 = performance.now();
const lat: number[] = [];
for (const line of lines) {
  const it = JSON.parse(line);
  const s = performance.now();
  const v = verifyAnswer({ question: it.question, answer: it.answer, evidence: it.evidence }, { joinWrappedLines: process.env.V1_JOIN === "1" });
  lat.push(performance.now() - s);
  rows.push(JSON.stringify({ item_id: it.item_id, validator: process.env.V1_JOIN === "1" ? "V1b" : "V1", verdict: v.verdict, reason: v.reason, subjects: v.subjects,
    claims: v.claims.map((c) => ({ key: c.key, raw: c.raw, status: c.status, page: c.page })) }));
}
writeFileSync(out, rows.join("\n") + "\n");
lat.sort((a, b) => a - b);
const pct = (p: number) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))].toFixed(3);
console.log(JSON.stringify({ n: rows.length, total_ms: (performance.now() - t0).toFixed(0), p50_ms: pct(0.5), p95_ms: pct(0.95) }));

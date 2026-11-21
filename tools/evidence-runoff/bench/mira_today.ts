/**
 * B2 "MIRA today": the exact text MIRA stores for a page — unpdf extractText(mergePages:false), then chunkText —
 * as in writePdfChunksForNode (garble repair not applied: none of these pages is a cipher page).
 *   cd mira-hub && npx vite-node --config vitest.config.ts <this> -- <candidates.json> <bench_pages.json> <out_dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";
import { chunkText } from "@/lib/node-knowledge-ingest";

const [candPath, selPath, outDir] = process.argv.slice(2).filter((a) => a !== "--");
const pdfs: Record<string, string> = Object.fromEntries(
  JSON.parse(readFileSync(candPath, "utf8")).map((c: { manual: string; pdf: string }) => [c.manual, c.pdf]),
);
const sel: Record<string, number[]> = JSON.parse(readFileSync(selPath, "utf8")).pages;
mkdirSync(outDir, { recursive: true });
for (const [manual, pages] of Object.entries(sel)) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(pdfs[manual])));
  const { text } = await extractText(pdf, { mergePages: false });
  const all = Array.isArray(text) ? text : [text];
  for (const p of pages) {
    writeFileSync(`${outDir}/${manual}_p${p}.json`, JSON.stringify({ page_text: all[p - 1], chunks: chunkText(all[p - 1]) }));
  }
}
console.log("ok");

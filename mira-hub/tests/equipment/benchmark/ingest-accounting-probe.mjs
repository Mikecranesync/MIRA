// #3218 accounting probe — runs the EXACT prod extraction+chunking pipeline
// (unpdf getDocumentProxy → extractText mergePages:false → chunkText verbatim
// from src/lib/node-knowledge-ingest.ts, same CHUNK_CHARS/OVERLAP) on the PF525
// manual and reports: page count, expected chunk count, and whether the
// specific "missing" evidence (F013 / ambient temp / overvoltage / protections)
// exists in the pre-persistence chunk set.
import fs from "node:fs";
import { extractText, getDocumentProxy } from "unpdf";

const PDF = process.argv[2];
const CHUNK_CHARS = 1000;
const CHUNK_OVERLAP = 120;

// verbatim copy of chunkText (node-knowledge-ingest.ts:101) — the module itself
// imports the db pool at top level, so it can't be imported standalone.
function chunkText(text, size = CHUNK_CHARS, overlap = CHUNK_OVERLAP) {
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  if (!clean) return [];
  if (clean.length <= size) return [clean];
  const chunks = [];
  let i = 0;
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(i, end);
      const brk = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "));
      if (brk > size * 0.5) end = i + brk + 1;
    }
    const piece = clean.slice(i, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    i = Math.max(end - overlap, i + 1);
  }
  return chunks;
}

const buf = new Uint8Array(fs.readFileSync(PDF));
const pdf = await getDocumentProxy(buf);
const { text } = await extractText(pdf, { mergePages: false });
const pages = Array.isArray(text) ? text : [text];

let idx = 0;
const all = []; // {page, idx, content}
let emptyPages = 0;
for (let p = 0; p < pages.length; p++) {
  const pieces = chunkText(pages[p]);
  if (pieces.length === 0) emptyPages++;
  for (const piece of pieces) all.push({ page: p + 1, idx: idx++, content: piece });
}

console.log(`pages_extracted=${pages.length}`);
console.log(`empty_pages=${emptyPages}`);
console.log(`expected_chunks=${all.length}`);

const probes = [
  ["F013", /F0?13/i],
  ["ground fault", /ground\s*fault/i],
  ["ambient temperature", /ambient/i],
  ["overvoltage", /over\s*-?\s*voltage/i],
  ["protection(s)", /protection/i],
];
for (const [name, re] of probes) {
  const hits = all.filter((c) => re.test(c.content));
  const pagesHit = [...new Set(hits.map((h) => h.page))].slice(0, 12);
  console.log(`probe "${name}": chunks=${hits.length} pages=${JSON.stringify(pagesHit)}`);
  if (hits.length > 0) {
    const s = hits[0].content;
    const m = s.match(re);
    const at = m ? Math.max(0, s.indexOf(m[0]) - 60) : 0;
    console.log(`   sample(p${hits[0].page}): ${JSON.stringify(s.slice(at, at + 160))}`);
  }
}

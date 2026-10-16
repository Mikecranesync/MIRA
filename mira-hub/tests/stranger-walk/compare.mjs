#!/usr/bin/env node
/**
 * Compare two Stranger Walk runs row by row (#4460): every question whose
 * classification differs is a flake, listed by name. Exit 1 if any row's
 * CORRECT/BROKEN status differs (the repeat-run criterion); other class
 * changes are listed but do not fail.
 *
 *   node tests/stranger-walk/compare.mjs <run A out dir> <run B out dir>
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const [a, b] = process.argv.slice(2).map((d) => JSON.parse(readFileSync(path.join(d, "scored.json"), "utf8")));
if (!a || !b) { console.error("usage: node tests/stranger-walk/compare.mjs <runA> <runB>"); process.exit(2); }
const bRows = new Map(b.rows.map((r) => [r.id, r]));
const MISSING = { classification: "MISSING", citedPage: null };
const inB = (id) => bRows.get(id) ?? MISSING; // a row absent from B is a flake, never a silent skip
const diff = a.rows.filter((r) => inB(r.id).classification !== r.classification);
const key = (c) => (c === "CORRECT" || c === "BROKEN" || c === "MISSING" ? c : "OTHER");
const hard = diff.filter((r) => key(r.classification) !== key(inB(r.id).classification));

console.log(`A ${a.card.headline} ${JSON.stringify(a.card.counts)} (staging ${a.meta.gitSha.slice(0, 9)})`);
console.log(`B ${b.card.headline} ${JSON.stringify(b.card.counts)} (staging ${b.meta.gitSha.slice(0, 9)})`);
console.log(`${a.rows.length - diff.length}/${a.rows.length} rows identical; ${hard.length} CORRECT/BROKEN flake(s); ${diff.length - hard.length} other class change(s)`);
for (const r of diff) {
  const o = inB(r.id);
  console.log(`${hard.includes(r) ? "FLAKE " : "change"} ${r.id}: ${r.classification}${r.citedPage ? ` p.${r.citedPage}` : ""} → ${o.classification}${o.citedPage ? ` p.${o.citedPage}` : ""}`);
}
const redA = new Set(a.card.safetyRedLines), redB = new Set(b.card.safetyRedLines);
const redDiff = [...redA].filter((x) => !redB.has(x)).concat([...redB].filter((x) => !redA.has(x)));
console.log(`safety red lines: A ${redA.size}, B ${redB.size}${redDiff.length ? `; differ: ${redDiff.join(", ")}` : "; identical"}`);
process.exit(hard.length ? 1 : 0);

import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

// The ordinary conversation route's compressed JavaScript budget (plan global
// constraint): every emitted JS asset in dist/, gzipped, summed, ≤ 300 KB.
const BUDGET = 300 * 1024;
const dist = resolve(import.meta.dir, "../dist");

let total = 0;
const rows: string[] = [];
for (const name of readdirSync(dist).sort()) {
  const path = resolve(dist, name);
  if (!statSync(path).isFile() || !name.endsWith(".js")) continue;
  const raw = readFileSync(path);
  const gz = gzipSync(raw, { level: 9 }).byteLength;
  total += gz;
  rows.push(`${name}\t${raw.byteLength} B raw\t${gz} B gzip`);
}

if (rows.length === 0) {
  console.error("check-build-budget: no JavaScript assets in dist/ — run `bun run build` first.");
  process.exit(1);
}
console.log(rows.join("\n"));
console.log(`total gzip JS: ${total} B (budget ${BUDGET} B)`);
if (total > BUDGET) {
  console.error(`check-build-budget: OVER BUDGET by ${total - BUDGET} B`);
  process.exit(1);
}

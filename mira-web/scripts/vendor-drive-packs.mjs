// Vendors committed drive packs INTO mira-web so the web service never reaches
// across service boundaries at runtime (the pack of record lives in
// mira-bots/shared/drive_packs/packs/<id>/pack.json — Python package data;
// mira-web's container does not COPY that tree).
//
// Run:  bun run scripts/vendor-drive-packs.mjs   (or: npm run vendor:packs)
// Then COMMIT the produced JSON under src/data/drive-packs/. The renderer imports
// the committed copy — no runtime cross-service file read.
//
// Re-run whenever a source pack.json is updated on origin/main.
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dir, "..");
const repoRoot = join(webRoot, ".."); // monorepo root (worktree or main checkout)
const SRC = join(repoRoot, "mira-bots", "shared", "drive_packs", "packs");
const OUT = join(webRoot, "src", "data", "drive-packs");

// AB-1: PowerFlex 525 only. Add pack ids here as more packs are promoted.
const PACKS = ["powerflex_525"];

mkdirSync(OUT, { recursive: true });
let ok = 0;
for (const id of PACKS) {
  const src = join(SRC, id, "pack.json");
  const out = join(OUT, `${id}.json`);
  const raw = readFileSync(src, "utf-8");
  JSON.parse(raw); // fail loudly if the source pack is not valid JSON
  copyFileSync(src, out); // byte-for-byte copy preserves UTF-8 exactly
  console.log(`vendored ${id} -> src/data/drive-packs/${id}.json`);
  ok++;
}
console.log(`done: ${ok}/${PACKS.length} pack(s) vendored`);

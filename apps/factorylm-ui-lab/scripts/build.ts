import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// Static bundle of the disconnected lab. Removes only the explicit local
// `dist/` directory, then emits index.html + hashed assets via Bun's HTML
// bundler. No dev server, no network, no environment lookups.
const root = resolve(import.meta.dir, "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [resolve(root, "index.html")],
  outdir: dist,
  target: "browser",
  minify: true,
  sourcemap: "none",
});

if (!result.success) {
  for (const log of result.logs) console.error(String(log));
  process.exit(1);
}

for (const output of result.outputs) {
  console.log(`${output.path.slice(root.length + 1)}\t${output.size} bytes`);
}

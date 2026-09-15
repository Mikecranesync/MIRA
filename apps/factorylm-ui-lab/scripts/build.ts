import { rm } from "node:fs/promises";
import { resolve } from "node:path";

// Static bundle of the lab. Removes only the explicit local `dist/` directory,
// then emits the entry HTML + hashed assets via Bun's HTML bundler. No dev
// server, no environment lookups.
//
// Two HTML shells, ONE bundle. index.html is the disconnected fixture lab
// (`connect-src 'none'`); demo.html is the same app under a connect policy that
// names the local SimLab and Hub. Making demo.html a second Bun entrypoint was
// the obvious route and the build-budget guard correctly rejected it: it
// duplicated the entire 214 kB bundle to change one meta tag. So demo.html is
// generated from the built index.html with its CSP swapped in, and the policy
// itself stays in the source demo.html where a reviewer would look for it.
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

// --- demo.html: the same bundle under the demo's own connect policy ---------
const CSP_META = /content="(default-src[^"]*)"/;
const demoSource = await Bun.file(resolve(root, "demo.html")).text();
const demoPolicy = demoSource.match(CSP_META)?.[1];
if (!demoPolicy) {
  console.error("demo.html has no Content-Security-Policy meta to copy.");
  process.exit(1);
}
const builtIndex = await Bun.file(resolve(dist, "index.html")).text();
if (!CSP_META.test(builtIndex)) {
  console.error("dist/index.html has no Content-Security-Policy meta to replace.");
  process.exit(1);
}
const demoHtml = builtIndex
  .replace(CSP_META, `content="${demoPolicy}"`)
  .replace(/<title>[^<]*<\/title>/, "<title>FactoryLM — public demo</title>");
await Bun.write(resolve(dist, "demo.html"), demoHtml);
console.log(`dist/demo.html\t${demoHtml.length} bytes (same bundle, demo CSP)`);

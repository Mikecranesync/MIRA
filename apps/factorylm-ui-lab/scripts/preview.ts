import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

// Static preview of the built lab. `bun ./dist/index.html` would start Bun's
// DEV server, which injects an inline HMR script and a websocket — both of
// which the lab's CSP correctly blocks. This serves dist/ as plain files so
// the preview exercises exactly what a static host would ship.
const dist = resolve(import.meta.dir, "../dist");
if (!existsSync(resolve(dist, "index.html"))) {
  console.error("dist/index.html is missing — run `bun run build` first.");
  process.exit(1);
}

const port = Number(process.env.PORT ?? 4173);
Bun.serve({
  port,
  fetch(request) {
    const path = new URL(request.url).pathname;
    const candidate = resolve(dist, `.${path}`);
    const inside = candidate.startsWith(dist);
    const file = inside && existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(dist, "index.html");
    return new Response(Bun.file(file));
  },
});
console.log(`FactoryLM UI Lab preview: http://localhost:${port}/ (static dist/, no HMR)`);

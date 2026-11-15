// Local browser proof: actual Hub adapter and authenticated-route-shaped PDF
// response, without user data, identity credentials, or inference calls.
import { resolve } from "node:path";
import { SAMPLE_PDF_BASE64 } from "../../../../apps/factorylm-ui-lab/src/evidence-sample-pdf";
const root = resolve(import.meta.dir, "../../..");
const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "main.tsx")], target: "browser", outdir: "/tmp/mira-evidence-browser-fixture", splitting: true,
  define: { "process.env": "{}", "process.env.NEXT_PUBLIC_BASE_PATH": JSON.stringify("/hub"), "process.env.NODE_ENV": JSON.stringify("development") },
  plugins: [{ name: "single-react", setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: require.resolve(path, { paths: [root] }) })); } }],
});
if (!build.success) throw new Error(build.logs.join("\n"));
const assets = new Map(build.outputs.map(asset => ["/" + asset.path.split("/").pop(), asset]));
Bun.serve({ hostname: "127.0.0.1", port: 4176, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/hub/api/namespace/files/11111111-1111-4111-8111-111111111111/") return new Response(Buffer.from(SAMPLE_PDF_BASE64, "base64"), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="synthetic-manual.pdf"' } });
  if (assets.has(path)) return new Response(assets.get(path));
  return new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/main.css"></head><body><div id="root"></div><script type="module" src="/main.js"></script></body></html>', { headers: { "Content-Type": "text/html" } });
} });
console.log("Evidence adapter fixture on http://127.0.0.1:4176");

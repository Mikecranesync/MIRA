/** Standalone real-history proof for #5069: bun e2e/back-closes-layers.browser.ts. Exits 1 on any failure.
 *  Proves browser history semantics (async popstate), not the Next.js router integration. */
import { chromium, type Page } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const outdir = await mkdtemp(join(tmpdir(), "mira-back-proof-"));
// The hook lives under mira-hub, which has its own React install; bundle one React (the lab's).
const oneReact = { name: "one-react", setup(build: Bun.PluginBuilder) {
  build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, (args) => ({ path: Bun.resolveSync(args.path, process.cwd()) }));
} };
const built = await Bun.build({ entrypoints: ["e2e/fixtures/back-closes-layers.tsx"], outdir, target: "browser", plugins: [oneReact] });
if (!built.success) throw new Error(String(built.logs));
const beforePage = new Response("<!doctype html><title>before</title><p>previous page</p>", { headers: { "Content-Type": "text/html" } });
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const name = new URL(request.url).pathname.slice(1);
  if (name === "before") return beforePage.clone();
  if (name === "back-closes-layers.js" || name === "back-closes-layers.css") return new Response(Bun.file(join(outdir, name)));
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="back-closes-layers.css"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="back-closes-layers.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
} });
const browser = await chromium.launch();
let failures = 0;
const check = (ok: boolean, what: string) => { if (!ok) failures += 1; console.log(`${ok ? "PASS" : "FAIL"} ${what}`); };
const drawerOpen = (page: Page) => page.getByRole("button", { name: "Close navigation" }).isVisible();
const settle = (page: Page) => page.waitForTimeout(250);
try {
  const base = `http://127.0.0.1:${server.port}`;
  // 1. Back with the drawer open closes it and stays on the page.
  let page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await page.goto(`${base}/before`);
  await page.goto(`${base}/v3`);
  await page.getByRole("button", { name: "Close navigation" }).waitFor();
  check(await drawerOpen(page), "phone profile opens the drawer at mount");
  await page.goBack(); await settle(page);
  check(!(await drawerOpen(page)), "Back closes the open drawer");
  check(page.url() === `${base}/v3`, `Back stays on the page (url=${page.url()})`);
  // 2. With nothing open, Back is ordinary navigation and leaves.
  await page.goBack(); await settle(page);
  check(page.url() === `${base}/before`, `second Back leaves the page (url=${page.url()})`);
  await page.close();
  // 3. A drawer closed in the UI leaves no dead entry: one Back leaves.
  page = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await page.goto(`${base}/before`);
  await page.goto(`${base}/v3?thread=a`);
  await page.getByRole("button", { name: "Close navigation" }).click(); await settle(page);
  check(!(await drawerOpen(page)) && page.url() === `${base}/v3?thread=a`, `UI close keeps the address (url=${page.url()})`);
  await page.goBack(); await settle(page);
  check(page.url() === `${base}/before`, `one Back after a UI close leaves the page (url=${page.url()})`);
  await page.close();
} finally { await browser.close(); server.stop(); }
console.log(failures ? `${failures} check(s) failed` : "Back closes layers in a real browser");
process.exit(failures ? 1 : 0);

/** Standalone real-history proof for #5069: bun e2e/back-closes-layers.browser.ts. Exits 1 on any failure.
 *  Proves browser history semantics (async popstate), not the Next.js router integration. */
import { chromium, type Page } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
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
const documentCases: unknown[] = [];
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
  // #4668: use the real source viewer, CSS and document link in the same runner.
  for (const thread of ["classic", "assistant"]) {
    for (const [width, height] of [[390, 844], [844, 390], [1280, 900]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.route("https://example.test/**", (route) => route.fulfill({
        contentType: "text/html", body: "<!doctype html><title>Intercepted manual</title><p>Manual page 42</p>",
      }));
      const sourcePage = await context.newPage();
      const label = `${thread} ${width}x${height}`;
      try {
        await sourcePage.goto(`${base}/v3?document=1&surface=hub&thread=${thread}`);
        if (width < 768) {
          await sourcePage.getByRole("button", { name: "Close navigation" }).click();
          await sourcePage.waitForFunction(() =>
            document.querySelector<HTMLElement>(".fl-shell__sidebar")!.getBoundingClientRect().right <= 0);
        }
        await sourcePage.locator('button[data-part-type="source"]').first().click();
        const viewer = sourcePage.getByRole("dialog", { name: "Source viewer" });
        const link = viewer.getByRole("link", { name: "Open document in a new tab", exact: true });
        await link.scrollIntoViewIfNeeded();
        const geometry = await link.evaluate((element) => {
          const target = element.getBoundingClientRect();
          const viewer = element.closest<HTMLElement>(".fl-source-viewer")!;
          const style = getComputedStyle(viewer);
          return {
            x: target.x, y: target.y, width: target.width, height: target.height,
            contentWidth: viewer.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            href: element.getAttribute("href"), target: element.getAttribute("target"), rel: element.getAttribute("rel"),
          };
        });
        const record: Record<string, unknown> = { thread, viewportWidth: width, viewportHeight: height, ...geometry };
        documentCases.push(record);
        console.log(`GEOMETRY ${label} ${JSON.stringify(geometry)}`);
        await sourcePage.screenshot({ path: join(outdir, `document-${thread}-${width}x${height}.png`) });
        check(geometry.height >= 44, `${label} document target height ${geometry.height}px >= 44px`);
        check(Math.abs(geometry.width - geometry.contentWidth) <= 1, `${label} document target width ${geometry.width}px fills ${geometry.contentWidth}px content`);
        check(geometry.href === "https://example.test/manual.pdf#page=42" && geometry.target === "_blank" &&
          !!geometry.rel?.includes("noopener") && !!geometry.rel?.includes("noreferrer"), `${label} retains cited URL and safe new-tab attributes`);
        // A short target is already meaningful RED; do not wait for a popup from an outside click.
        if (geometry.height < 44) continue;
        const point = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height - 2 };
        const hit = await sourcePage.evaluate(({ x, y }) =>
          Boolean(document.elementFromPoint(x, y)?.closest("a.fl-source-viewer__open")), point);
        check(hit, `${label} the near-bottom touch point hits the document link`);
        if (!hit) continue;
        const [popup] = await Promise.all([
          context.waitForEvent("page", { timeout: 3000 }),
          sourcePage.mouse.click(point.x, point.y),
        ]);
        await popup.waitForURL("https://example.test/manual.pdf#page=42", { timeout: 3000 });
        record.openedUrl = popup.url();
        record.openerIsNull = await popup.evaluate(() => window.opener === null);
        check(popup.url() === "https://example.test/manual.pdf#page=42", `${label} bottom-edge activation opens the exact cited page in a new tab`);
        check(record.openerIsNull === true, `${label} the new tab has no opener`);
        check(sourcePage.url() === `${base}/v3?document=1&surface=hub&thread=${thread}`, `${label} the source page stays in place`);
      } finally { await context.close(); }
    }
  }
} finally { await browser.close(); server.stop(); }
await writeFile(join(outdir, "document-geometry.json"), JSON.stringify(documentCases, null, 2));
console.log(`Evidence: ${outdir}`);
console.log(failures ? `${failures} check(s) failed` : "Back closes layers in a real browser");
process.exit(failures ? 1 : 0);

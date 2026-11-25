/** Standalone geometry proof for #5572: bun e2e/send-error-visible.browser.ts (no production lab changes). */
import { chromium } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const outdir = await mkdtemp(join(tmpdir(), "mira-send-error-proof-"));
const built = await Bun.build({ entrypoints: ["e2e/fixtures/send-error-visible.tsx"], outdir, target: "browser" });
if (!built.success) throw new Error(String(built.logs));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const name = new URL(request.url).pathname.slice(1);
  if (name === "send-error-visible.js" || name === "send-error-visible.css") return new Response(Bun.file(join(outdir, name)));
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="send-error-visible.css"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="send-error-visible.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
} });
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
let failures = 0;
try {
  // Tablet portrait, tablet landscape with the keyboard open (visual height 648 → layout 314 measured on device), phone, desktop.
  for (const renderer of ["classic", "assistant"]) for (const [width, height] of [[823, 1142], [1316, 648], [1316, 314], [412, 915], [1440, 900]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:${server.port}/?renderer=${renderer}`);
    await page.waitForSelector(".fl-send-error");
    await page.waitForTimeout(200);
    // While following, the latest turn ends above the WHOLE pinned dock (banner +
    // composer), at first and after the turn grows with the banner still up.
    for (const step of ["followed", "grown"]) {
      if (step === "grown") { await page.evaluate(() => (window as any).proof.grow()); }
      await page.waitForTimeout(300);
      const f = await page.evaluate(() => {
        const last = [...document.querySelectorAll<HTMLElement>("[data-turn-id]")].at(-1)!.getBoundingClientRect();
        const dock = document.querySelector<HTMLElement>(".fl-shell__dock")!.getBoundingClientRect();
        return { lastBottom: Math.round(last.bottom), dockTop: Math.round(dock.top) };
      });
      const ok = f.lastBottom <= f.dockTop + 1;
      if (!ok) failures += 1;
      console.log(`${ok ? "PASS" : "FAIL"} ${renderer} ${width}x${height} ${step} ${JSON.stringify(f)}`);
    }
    // The banner must be readable wherever the page is scrolled: top, middle, end.
    for (const at of ["top", "middle", "end"]) {
      await page.evaluate((at) => { const el = document.scrollingElement!; el.scrollTop = at === "top" ? 0 : at === "end" ? el.scrollHeight : el.scrollHeight / 2; }, at);
      await page.waitForTimeout(100);
      const g = await page.evaluate(() => {
        const r = (s: string) => document.querySelector<HTMLElement>(s)!.getBoundingClientRect();
        const banner = r(".fl-send-error"), composer = r(".fl-composer");
        return { bannerTop: Math.round(banner.top), bannerBottom: Math.round(banner.bottom), composerTop: Math.round(composer.top), composerBottom: Math.round(composer.bottom), vh: innerHeight };
      });
      const ok = g.bannerBottom <= g.composerTop + 1 && g.bannerTop >= 0 && g.composerBottom <= g.vh + 1;
      if (!ok) failures += 1;
      console.log(`${ok ? "PASS" : "FAIL"} ${renderer} ${width}x${height} ${at} ${JSON.stringify(g)}`);
    }
    await page.close();
  }
} finally { await browser.close(); server.stop(); }
console.log(failures ? `${failures} FAILED` : "ALL PASS");
process.exit(failures ? 1 : 0);

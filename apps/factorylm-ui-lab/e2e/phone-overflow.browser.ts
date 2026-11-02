/** Standalone geometry proof for #5068: bun e2e/phone-overflow.browser.ts (no production lab changes).
 *  A thread carrying a long manual URL must stay at screen width on a phone. Exits 1 on any overflow. */
import { chromium } from "playwright";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const outdir = await mkdtemp(join(tmpdir(), "mira-overflow-proof-"));
const built = await Bun.build({ entrypoints: ["e2e/fixtures/phone-overflow.tsx"], outdir, target: "browser" });
if (!built.success) throw new Error(String(built.logs));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const name = new URL(request.url).pathname.slice(1);
  if (name === "phone-overflow.js" || name === "phone-overflow.css") return new Response(Bun.file(join(outdir, name)));
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="phone-overflow.css"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="phone-overflow.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
} });
const browser = await chromium.launch();
const shots = process.env.SHOTS_DIR;
let failures = 0;
try {
  // 412 = Pixel 9a CSS width; 360 = small Android.
  for (const renderer of ["classic", "assistant"]) for (const width of [412, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 915 } });
    await page.goto(`http://127.0.0.1:${server.port}/?renderer=${renderer}`);
    // The phone profile opens the drawer at mount; close it so the thread is what's on screen.
    await page.getByRole("button", { name: "Close navigation" }).click();
    await page.getByRole("button", { name: "Close navigation" }).waitFor({ state: "hidden" });
    const m = await page.evaluate(() => {
      const status = document.querySelector<HTMLElement>('[data-part-type="manual_search_status"]');
      const widest = [...document.querySelectorAll<HTMLElement>(".fl-shell *")].reduce((max, el) => Math.max(max, el.getBoundingClientRect().right), 0);
      return { scrollWidth: document.scrollingElement!.scrollWidth, innerWidth, statusRight: status?.getBoundingClientRect().right ?? -1, widest: Math.round(widest) };
    });
    const ok = m.statusRight > 0 && m.scrollWidth <= m.innerWidth && m.statusRight <= m.innerWidth + 0.5;
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"} renderer=${renderer} width=${width} ${JSON.stringify(m)}`);
    if (shots && width === 412) await page.screenshot({ path: join(shots, `phone-overflow-${renderer}.png`) });
    await page.close();
  }
} finally { await browser.close(); server.stop(); }
console.log(failures ? `${failures} layout(s) overflow` : "all layouts at screen width");
process.exit(failures ? 1 : 0);

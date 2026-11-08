/** Standalone geometry proof for #5068: bun e2e/phone-overflow.browser.ts (no production lab changes).
 *  A thread carrying a long manual URL must stay at screen width on a phone. Exits 1 on any overflow. */
import { chromium } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
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
const fontRecords: unknown[] = [];
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
  // #4629: editable controls under actual 14px/16px Hub host inheritance.
  for (const renderer of ["classic", "assistant"]) for (const hostSize of [14, 16]) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${server.port}/?renderer=${renderer}&surface=hub&hostFont=${hostSize}`);
    const textarea = page.getByRole("textbox", { name: "Ask MIRA", exact: true });
    const noAutofocus = !(await textarea.evaluate(element => document.activeElement === element));
    if (!noAutofocus) failures += 1;
    console.log(`${noAutofocus ? "PASS" : "FAIL"} ${renderer} host=${hostSize}px mount does not focus composer`);
    const unfiltered = await page.locator(".fl-tree__label").allTextContents();
    const searchText = "Drive A";
    await page.getByRole("searchbox", { name: "Search navigation", exact: true }).fill(searchText);
    const filtered = await page.locator(".fl-tree__label").allTextContents();
    const filterApplied = filtered.length < unfiltered.length;
    if (!filterApplied) failures += 1;
    console.log(`${filterApplied ? "PASS" : "FAIL"} ${renderer} host=${hostSize}px search actually filters navigation`);
    await page.screenshot({ path: join(outdir, `editable-search-${renderer}-${hostSize}.png`) });
    await page.getByRole("button", { name: "Close navigation", exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLElement>(".fl-shell__sidebar")!.getBoundingClientRect().right <= 0);
    const draft = "  Keep this exact draft\nthrough phone rotation  ";
    await textarea.fill(draft);
    for (const [stage, width, height, expectedSize] of [
      ["portrait", 390, 844, 16], ["landscape", 844, 390, hostSize],
      ["portrait-return", 390, 844, 16], ["desktop", 1280, 900, hostSize],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const measured = await page.evaluate(() => {
        const textarea = document.querySelector<HTMLTextAreaElement>(".fl-composer__row textarea")!;
        const search = document.querySelector<HTMLInputElement>(".fl-shell__search input")!;
        const answer = document.querySelector<HTMLElement>('[data-role="assistant"] .fl-part--text')!;
        return {
          composerFont: getComputedStyle(textarea).fontSize, searchFont: getComputedStyle(search).fontSize,
          answerFont: getComputedStyle(answer).fontSize,
          htmlFont: getComputedStyle(document.documentElement).fontSize, bodyFont: getComputedStyle(document.body).fontSize,
          draft: textarea.value, search: search.value, composerFocused: document.activeElement === textarea,
          labels: Array.from(document.querySelectorAll(".fl-tree__label"), element => element.textContent ?? ""),
          documentWidth: document.scrollingElement!.scrollWidth, viewportWidth: innerWidth,
        };
      });
      const fonts = measured.composerFont === `${expectedSize}px` && measured.searchFont === `${expectedSize}px`;
      const preserved = measured.draft === draft && measured.search === searchText && measured.composerFocused &&
        JSON.stringify(measured.labels) === JSON.stringify(filtered);
      const noOverflow = measured.documentWidth <= measured.viewportWidth;
      fontRecords.push({ renderer, hostSize, stage, width, height, expectedSize, noAutofocus, filterApplied, fonts, preserved, noOverflow, ...measured });
      for (const [what, ok] of [["editable fonts", fonts], ["draft/search/filter/focus", preserved], ["no horizontal overflow", noOverflow]] as const) {
        if (!ok) failures += 1;
        console.log(`${ok ? "PASS" : "FAIL"} ${renderer} host=${hostSize}px ${stage} ${width}x${height} ${what}: ${JSON.stringify(measured)}`);
      }
      await page.screenshot({ path: join(outdir, `editable-${renderer}-${hostSize}-${stage}.png`) });
    }
    await page.close();
  }
} finally { await browser.close(); server.stop(); }
await writeFile(join(outdir, "editable-fonts.json"), JSON.stringify(fontRecords, null, 2));
console.log(`Evidence: ${outdir}`);
console.log(failures ? `${failures} check(s) failed` : "all layouts at screen width; editable font checks passed");
process.exit(failures ? 1 : 0);

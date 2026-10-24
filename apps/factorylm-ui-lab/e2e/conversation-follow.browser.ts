/** Standalone geometry proof: bun e2e/conversation-follow.browser.ts (no production lab changes). */
import { chromium } from "playwright";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const outdir = await mkdtemp(join(tmpdir(), "mira-scroll-proof-"));
const built = await Bun.build({ entrypoints: ["e2e/fixtures/conversation-follow.tsx"], outdir, target: "browser" });
if (!built.success) throw new Error(String(built.logs));
const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
  const name = new URL(request.url).pathname.slice(1);
  if (name === "conversation-follow.js" || name === "conversation-follow.css") return new Response(Bun.file(join(outdir, name)));
  return new Response(`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="conversation-follow.css"><style>body{margin:0}body.nested .fl-conversation{max-height:55vh;overflow-y:auto}</style></head><body><div id="root"></div><script type="module" src="conversation-follow.js"></script></body></html>`, { headers: { "Content-Type": "text/html" } });
} });
const browser = await chromium.launch();
const records: unknown[] = [];
let failures = 0;
try {
  for (const renderer of ["classic", "assistant"]) for (const [width, height] of [[390,844],[844,390],[1280,900]]) for (const nested of [false,true]) {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(`http://127.0.0.1:${server.port}/?renderer=${renderer}&nested=${nested}`);
    await page.waitForTimeout(350);
    const geometry = () => page.evaluate(() => {
      const last = [...document.querySelectorAll<HTMLElement>("[data-turn-id]")].at(-1)!;
      const composer = document.querySelector<HTMLElement>(".fl-composer")!;
      const container = document.querySelector<HTMLElement>(".fl-conversation")!;
      const bottom = last.getBoundingClientRect().bottom;
      const composerTop = composer.getBoundingClientRect().top;
      const limit = Math.min(innerHeight, composerTop, document.body.classList.contains("nested") ? container.getBoundingClientRect().bottom : Infinity);
      return { bottom, composerTop, limit, visible: bottom <= limit + 2 && bottom > 0, documentTop: document.scrollingElement!.scrollTop, containerTop: container.scrollTop };
    });
    const stages: Record<string, Awaited<ReturnType<typeof geometry>>> = { mount: await geometry() };
    for (const action of ["append", "grow", "grow", "grow", "switch"]) {
      await page.evaluate((action) => (window as any).proof[action](), action);
      await page.waitForTimeout(150);
      stages[`${action}-${Object.keys(stages).length}`] = await geometry();
    }
    // Late media layout is independent of React thread updates.
    await page.evaluate(() => {
      const media = document.createElement("div"); media.style.height = "1px";
      media.dataset.proofMedia = "true";
      [...document.querySelectorAll("[data-turn-id]")].at(-1)!.append(media);
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => { document.querySelector<HTMLElement>("[data-proof-media]")!.style.height = "400px"; });
    await page.waitForTimeout(200);
    stages.media = await geometry();
    await page.setViewportSize({ width, height: height - 80 });
    await page.waitForTimeout(200);
    stages.resize = await geometry();
    await page.evaluate((nested) => { const node = nested ? document.querySelector(".fl-conversation")! : document.scrollingElement!; node.scrollTop = Math.max(0, node.scrollTop - 300); }, nested);
    await page.waitForTimeout(150);
    const away = await geometry();
    await page.evaluate(() => (window as any).proof.grow());
    await page.waitForTimeout(150);
    const after = await geometry();
    const noYank = Math.abs((nested ? away.containerTop : away.documentTop) - (nested ? after.containerTop : after.documentTop)) < 2;
    const pass = Object.values(stages).every((stage) => stage.visible) && noYank;
    if (!pass) failures += 1;
    records.push({ renderer, width, height, nested, stages, away, after, noYank, pass });
    await page.screenshot({ path: join(outdir, `${renderer}-${width}-${nested}.png`) });
    await page.close();
  }
} finally { await browser.close(); server.stop(); }
await writeFile(join(outdir, "results.json"), JSON.stringify(records, null, 2));
console.log(JSON.stringify({ outdir, cases: records.length, failures }));
process.exitCode = failures ? 1 : 0;

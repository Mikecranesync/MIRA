/** Standalone before/after proof for #4924 / #4798 / stopped Retry.
 *  Run from apps/factorylm-ui-lab:
 *    SHOTS_DIR=../../docs/promo-screenshots bun e2e/composer-send-stop.browser.ts
 *  Optional SOURCE_TREE=before uses the files already in the working tree
 *  (the driver does not checkout). Capture before shots after swapping
 *  Composer.tsx / parts.tsx / conversation.css to origin/main. */
import { chromium } from "playwright";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const outdir = await mkdtemp(join(tmpdir(), "mira-composer-send-stop-"));
const built = await Bun.build({ entrypoints: ["e2e/fixtures/composer-send-stop.tsx"], outdir, target: "browser" });
if (!built.success) throw new Error(String(built.logs));

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const name = new URL(request.url).pathname.slice(1);
    if (name === "composer-send-stop.js" || name === "composer-send-stop.css") {
      return new Response(Bun.file(join(outdir, name)));
    }
    return new Response(
      `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="composer-send-stop.css"><style>body{margin:0}</style></head><body><div id="root"></div><script type="module" src="composer-send-stop.js"></script></body></html>`,
      { headers: { "Content-Type": "text/html" } },
    );
  },
});

const shots = process.env.SHOTS_DIR ? resolve(process.env.SHOTS_DIR) : "";
const artifacts = process.env.ARTIFACTS_DIR ? resolve(process.env.ARTIFACTS_DIR) : "";
const stamp = "2026-11-05";
const tree = process.env.SOURCE_TREE === "before" ? "before" : "after";

const scenes = tree === "before"
  ? [
      { scene: "busy-draft", name: "composer-send-stop-busy" },
      { scene: "stopped-no-retry", name: "composer-stopped-retry" },
    ]
  : [
      { scene: "busy-draft", name: "composer-send-stop-busy" },
      { scene: "queued", name: "composer-send-stop-queued" },
      { scene: "stopped", name: "composer-stopped-retry" },
    ];

const viewports = [
  { profile: "hub", width: 1440, height: 900, label: "desktop" },
  { profile: "mobile", width: 412, height: 915, label: "mobile" },
] as const;

const browser = await chromium.launch({ channel: "chrome" });
try {
  if (shots) await mkdir(shots, { recursive: true });
  if (artifacts) await mkdir(artifacts, { recursive: true });
  for (const { scene, name } of scenes) {
    for (const viewport of viewports) {
      const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      await page.goto(`http://127.0.0.1:${server.port}/?scene=${scene}&profile=${viewport.profile}`);
      const closer = page.getByRole("button", { name: "Close navigation" });
      if (await closer.isVisible().catch(() => false)) {
        await closer.click();
        await closer.waitFor({ state: "hidden" });
      }
      if (scene === "queued") {
        await page.getByLabel("Ask MIRA").press("Enter");
        await page.getByText("Will send after this answer").waitFor();
      }
      if (scene === "busy-draft") {
        await page.getByLabel("Ask MIRA").waitFor();
      }
      if (scene === "stopped") {
        const retry = page.getByRole("button", { name: "Retry" });
        await retry.waitFor();
        await retry.hover();
      }
      if (scene === "stopped-no-retry") {
        await page.getByText("Stopped before the answer completed.").waitFor();
      }
      const file = `${stamp}_${name}-${tree}_${viewport.label}.png`;
      if (shots) await page.screenshot({ path: join(shots, file), fullPage: false });
      if (artifacts) await page.screenshot({ path: join(artifacts, file), fullPage: false });
      console.log(`wrote ${file}`);
      await page.close();
    }
  }
} finally {
  await browser.close();
  server.stop();
}

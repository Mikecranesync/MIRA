#!/usr/bin/env node
// Render a Work Packet HTML file to PDF (Letter) and, optionally, desktop +
// phone screenshots, with the Playwright/Chromium that mira-web already
// depends on (commodity-before-custom: no hand-rolled PDF layout).
//
//   node tools/work-packet/render_pdf.mjs <in.html> <out.pdf> [--shots DIR --name NAME]
//
// Requires `mira-web/node_modules/playwright` and an installed Chromium
// (`cd mira-web && npx playwright install chromium`). No network access is
// needed to render: the page is loaded from file://.
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, statSync } from "node:fs";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const args = process.argv.slice(2);
const [inHtml, outPdf] = args;
if (!inHtml || !outPdf) {
  console.error("usage: render_pdf.mjs <in.html> <out.pdf> [--shots DIR --name NAME]");
  process.exit(2);
}
const shots = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const name = args.includes("--name") ? args[args.indexOf("--name") + 1] : "work-packet";

const pwPath = path.join(repoRoot, "mira-web", "node_modules", "playwright");
if (!existsSync(pwPath)) {
  console.error(`playwright not found at ${pwPath}; run \`npm install\` in mira-web first`);
  process.exit(3);
}
const { chromium } = require(pwPath);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(path.resolve(inHtml)).href, { waitUntil: "load" });
  await page.pdf({
    path: outPdf,
    format: "Letter",
    printBackground: true,
    margin: { top: "14mm", bottom: "14mm", left: "12mm", right: "12mm" },
  });
  const out = { pdf: outPdf, bytes: statSync(outPdf).size };
  if (shots) {
    await page.setViewportSize({ width: 1440, height: 900 });
    out.desktop = path.join(shots, `${name}_desktop.png`);
    await page.screenshot({ path: out.desktop, fullPage: true });
    await page.setViewportSize({ width: 412, height: 915 });
    out.mobile = path.join(shots, `${name}_mobile.png`);
    await page.screenshot({ path: out.mobile, fullPage: true });
  }
  console.log(JSON.stringify(out));
} finally {
  await browser.close();
}

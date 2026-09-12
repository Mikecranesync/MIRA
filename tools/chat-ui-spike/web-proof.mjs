/**
/**
 * Web-side proof for spike
 * criteria 3/5 over the REAL HTTP probe route.
 * Run: node spike-web-proof.mjs   (hub dev server must be on :3000)
 */
import { chromium } from "../../mira-hub/node_modules/playwright/index.mjs";
import { mkdirSync } from "node:fs";

const BASE = "http://localhost:3000/hub/labs/chat-spike/";
const SHOTS = "../../docs/promo-screenshots";
mkdirSync(SHOTS, { recursive: true });

const log = (...a) => console.log(...a);

const browser = await chromium.launch();
try {
  // ---------- desktop ----------
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`);
  });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.getByTestId("live-toggle").check();

  // Turn 1: full stream — sample text growth + chunk count over time.
  await page.getByPlaceholder("Ask about the machine…").fill("live probe: what does oC mean?");
  await page.getByTestId("send").click();
  const samples = [];
  const t0 = Date.now();
  for (let i = 0; i < 24; i++) {
    const msgs = page.getByTestId("assistant-message");
    const text = (await msgs.last().innerText().catch(() => "")) ?? "";
    const chunks = (await page.getByTestId("chunk-count").innerText().catch(() => "")) ?? "";
    samples.push({ ms: Date.now() - t0, len: text.length, chunks });
    if (/followups|Grounded/.test(text) && i > 8) break;
    await page.waitForTimeout(300);
  }
  log("GROWTH SAMPLES:", JSON.stringify(samples, null, 0));
  await page.waitForTimeout(600);
  const finalChunks = await page.getByTestId("chunk-count").innerText();
  log("FINAL:", finalChunks);
  const status1 = await page.evaluate(async () => {
    const r = await fetch("/hub/labs/chat-spike/stream/");
    return r.json();
  });
  log("SERVER STATUS after complete:", JSON.stringify(status1));
  await page.screenshot({ path: `${SHOTS}/2026-08-30_chat-spike-live-sse-web-incremental_desktop.png` });

  // Turn 2: Stop mid-stream — real abort must reach the server.
  await page.getByPlaceholder("Ask about the machine…").fill("live probe: stop me");
  await page.getByTestId("send").click();
  await page.waitForTimeout(900); // a few frames in
  await page.getByTestId("stop").click({ timeout: 5000 });
  await page.waitForTimeout(700);
  const stoppedCaption = await page.getByTestId("stopped-caption").last().innerText().catch(() => "MISSING");
  const chunksAfterStop = await page.getByTestId("chunk-count").innerText();
  const status2 = await page.evaluate(async () => {
    const r = await fetch("/hub/labs/chat-spike/stream/");
    return r.json();
  });
  log("STOPPED CAPTION:", stoppedCaption);
  log("CHUNKS AT STOP:", chunksAfterStop);
  log("SERVER STATUS after stop:", JSON.stringify(status2));
  await page.screenshot({ path: `${SHOTS}/2026-08-30_chat-spike-live-sse-web-stop-cancelled_desktop.png` });
  log("CONSOLE ISSUES:", errors.length ? errors : "none");
  await page.close();

  // ---------- mobile viewport (screenshot rule) ----------
  const m = await browser.newPage({ viewport: { width: 412, height: 915 } });
  await m.goto(BASE, { waitUntil: "networkidle" });
  await m.getByTestId("live-toggle").check();
  await m.getByPlaceholder("Ask about the machine…").fill("live probe mobile viewport");
  await m.getByTestId("send").click();
  await m.waitForTimeout(4200);
  await m.screenshot({ path: `${SHOTS}/2026-08-30_chat-spike-live-sse-web-incremental_mobile.png` });
  await m.close();
} finally {
  await browser.close();
}
log("DONE");

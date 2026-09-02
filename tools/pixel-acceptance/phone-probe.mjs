// Phone-sized Chromium probe — priorities 4 (client-side latency) and 5 (layout).
//
// Test-only, throwaway. Drives the REAL mira-mobile UI in Chromium at phone
// viewports with the API stubbed, so every number below is CLIENT rendering
// cost with model/network latency removed by construction.
//
// Run:  node tools/pixel-acceptance/phone-probe.mjs
import { chromium } from "playwright";
import fs from "node:fs";

const BASE = process.env.BASE || "http://localhost:5199";
const OUT = "pixel-evidence/phone-probe";
fs.mkdirSync(OUT, { recursive: true });

const CIT = (i) => ({
  citationId: String(i),
  sourceTitle: `GS10 service manual — section ${i}`,
  page: 40 + i,
  quote: "Overload trips at 115% FLA for 60 s.",
  docId: `d${i}`,
  fileId: `f${i}`,
  originFileId: null,
});

const LONG = Array.from({ length: 40 }, (_, i) =>
  `Step ${i + 1}. Verify terminal ${i + 1} is de-energised before touching it, then confirm the reading against the nameplate value [${(i % 8) + 1}].`,
).join("\n\n");

const NOTEBOOK = {
  notebook: { id: "nb1", displayName: "CV-101 conveyor drive", manufacturer: "Durapulse", model: "GS10" },
  sources: [{ docId: "d1", filename: "GS10.pdf", enabledByDefault: true, status: "ready" }],
  turns: Array.from({ length: 24 }, (_, i) => ({
    id: `t${i}`,
    question: `Question ${i + 1}: what should I check on the drive at stage ${i + 1}?`,
    answerStatus: "answered",
    answerText: `Answer ${i + 1}. ${LONG.slice(0, 600)} [1]`,
    evidence: [CIT(1), CIT(2), CIT(3), CIT(4), CIT(5), CIT(6), CIT(7), CIT(8)],
    basis: "oem_documentation",
  })),
};

const results = [];
const record = (viewport, name, value, unit = "ms") => {
  results.push({ viewport, name, value, unit });
  console.log(`  ${name}: ${typeof value === "number" ? value.toFixed(1) : value}${typeof value === "number" ? unit : ""}`);
};

async function stub(page) {
  // Narrow: only intercept real API paths, never a module script (a broad
  // matcher returned JSON for a <script type=module> and blanked the app).
  await page.route(/\/api\/(?!.*\.(?:js|mjs|ts|tsx|css)$)/, async (route) => {
    const url = route.request().url();
    if (/\/api\/me\/?($|\?)/.test(url))
      return route.fulfill({
        json: { id: "u1", email: "tech@example.com", name: "Tech", role: "technician", tenantId: "t1", capabilities: [] },
      });
    if (/equipment-notebooks\/[^/]+$/.test(url.split("?")[0])) return route.fulfill({ json: NOTEBOOK });
    if (url.includes("equipment-notebooks") && url.includes("/chat")) {
      // Stream a realistic answer: content* -> sources -> evidence -> status.
      const frames = [
        ...Array.from({ length: 30 }, (_, i) => `data: ${JSON.stringify({ kind: "content", content: `token ${i} of a long grounded answer. ` })}\n\n`),
        `data: ${JSON.stringify({ kind: "sources", citations: [CIT(1), CIT(2), CIT(3), CIT(4), CIT(5), CIT(6), CIT(7), CIT(8)], sourceSnapshot: ["d1"] })}\n\n`,
        `data: ${JSON.stringify({ kind: "evidence", basis: "oem_documentation", label: "From the manual" })}\n\n`,
        `data: ${JSON.stringify({ kind: "status", status: "answered" })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return route.fulfill({ status: 200, headers: { "content-type": "text/event-stream" }, body: frames });
    }
    if (url.includes("equipment-notebooks")) return route.fulfill({ json: { notebooks: [NOTEBOOK.notebook] } });
    return route.fulfill({ json: {} });
  });
}

async function openNotebook(page) {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  // Navigate to the notebook if a list is shown.
  const card = page.locator("text=CV-101").first();
  if (await card.count()) {
    await card.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
}

async function run(width, height, label) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  await stub(page);
  console.log(`\n== ${label} (${width}x${height}) ==`);
  await openNotebook(page);
  await page.screenshot({ path: `${OUT}/${label}-01-thread.png`, fullPage: false });

  // ---- P5: horizontal overflow (the classic phone defect) ----
  const overflow = await page.evaluate(() => {
    const de = document.documentElement;
    const offenders = [];
    document.querySelectorAll("*").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.right > de.clientWidth + 1) {
        offenders.push(`${el.tagName.toLowerCase()}.${(el.className || "").toString().slice(0, 40)} right=${Math.round(r.right)}`);
      }
    });
    return { docWidth: de.clientWidth, scrollWidth: de.scrollWidth, offenders: offenders.slice(0, 6) };
  });
  record(label, "h-overflow px", overflow.scrollWidth - overflow.docWidth, "px");
  if (overflow.offenders.length) console.log("    offenders:", overflow.offenders);

  // ---- P5: tap-target sizes ----
  const taps = await page.evaluate(() => {
    const small = [];
    document.querySelectorAll("button, [role=button], a").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && (r.height < 32 || r.width < 32)) {
        small.push(`${(el.textContent || el.getAttribute("aria-label") || "?").trim().slice(0, 28)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    });
    return small.slice(0, 10);
  });
  record(label, "tap targets <32px", taps.length, "");
  if (taps.length) console.log("    small:", taps);

  // ---- P4: composer typing latency (client only) ----
  const box = page.getByRole("textbox").first();
  if (await box.count()) {
    const typing = await page.evaluate(async () => {
      const ta = document.querySelector("textarea");
      if (!ta) return null;
      const t0 = performance.now();
      for (let i = 0; i < 60; i++) {
        ta.value += "a";
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      await new Promise((r) => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    });
    if (typing !== null) record(label, "60 composer input events", typing);

    // multiline growth + does it cover content?
    await box.fill("line one\nline two\nline three\nline four\nline five\nline six");
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${OUT}/${label}-02-multiline-composer.png` });
    const cover = await page.evaluate(() => {
      const ta = document.querySelector("textarea");
      if (!ta) return null;
      const r = ta.getBoundingClientRect();
      return { composerTop: Math.round(r.top), composerH: Math.round(r.height), viewportH: window.innerHeight };
    });
    if (cover) record(label, "composer height", cover.composerH, "px");
    await box.fill("");
  }

  // ---- P4: long-thread scroll cost ----
  const scroll = await page.evaluate(async () => {
    const sc = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 200);
    if (!sc) return null;
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) {
      sc.scrollTop = (i / 40) * (sc.scrollHeight - sc.clientHeight);
      await new Promise((r) => requestAnimationFrame(() => r()));
    }
    return performance.now() - t0;
  });
  if (scroll !== null) record(label, "40 scroll steps", scroll);

  // ---- P4/P5: send -> streaming render, and stick-to-bottom ----
  if (await box.count()) {
    await box.fill("what is the overload trip point?");
    const t0 = Date.now();
    await page.keyboard.press("Enter").catch(() => {});
    await page.waitForTimeout(120);
    const uiChanged = await page.evaluate(() => !!document.querySelector('button[aria-label="Working"], button[aria-label="Stop generating"]'));
    record(label, "send->UI state change within 120ms", uiChanged ? "YES" : "NO");
    await page.waitForTimeout(2500);
    record(label, "streamed turn settle", Date.now() - t0);
    await page.screenshot({ path: `${OUT}/${label}-03-after-stream.png` });

    const stuck = await page.evaluate(() => {
      const sc = [...document.querySelectorAll("*")].find((e) => e.scrollHeight > e.clientHeight + 200);
      if (!sc) return null;
      return sc.scrollHeight - sc.clientHeight - sc.scrollTop;
    });
    if (stuck !== null) record(label, "distance from bottom after stream", Math.round(stuck), "px");
  }

  // ---- keyboard-sized viewport reduction ----
  await page.setViewportSize({ width, height: Math.round(height * 0.55) });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${label}-04-keyboard-open.png` });
  const kb = await page.evaluate(() => {
    const ta = document.querySelector("textarea");
    if (!ta) return null;
    const r = ta.getBoundingClientRect();
    return { visible: r.top >= 0 && r.bottom <= window.innerHeight + 1, top: Math.round(r.top), bottom: Math.round(r.bottom), vh: window.innerHeight };
  });
  if (kb) record(label, "composer fully visible w/ keyboard", kb.visible ? "YES" : `NO (${kb.top}-${kb.bottom} of ${kb.vh})`);

  record(label, "console errors", consoleErrors.length, "");
  if (consoleErrors.length) console.log("    ", consoleErrors.slice(0, 4));
  await browser.close();
}

await run(360, 800, "w360");
await run(412, 915, "w412");
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
console.log(`\nartifacts -> ${OUT}`);

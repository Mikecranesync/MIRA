// Static component screenshot harness for Equipment Notebook V1 (PRD §31 / §37
// evidence). Renders representative UI markup against the hub's REAL stylesheet
// at phone viewport (412x915) — the delta-doc-committed fallback for when the
// authenticated live-server E2E harness (seeded user + secrets) isn't available.
//
// Run: node tests/e2e/notebook-static-shots.mjs  (needs a hub dev server URL in
// HUB_BASE for the stylesheet; defaults to http://localhost:3111/hub)
import { chromium } from "playwright";
import fs from "node:fs";

const HUB = process.env.HUB_BASE ?? "http://localhost:3111/hub";
const OUT = "docs/promo-screenshots";
const STAMP = "2026-08-11";
fs.mkdirSync(OUT, { recursive: true });

// Discover the built CSS href from the login page (unauthenticated, always 200).
const loginHtml = await (await fetch(`${HUB}/login/`)).text();
const cssHref = (loginHtml.match(/\/hub\/_next\/static\/[^"']+\.css/) ?? [])[0];
const cssUrl = cssHref ? `${HUB.replace(/\/hub$/, "")}${cssHref}` : null;

const page = (title, body) => `<!doctype html><html><head><meta charset="utf-8">
${cssUrl ? `<link rel="stylesheet" href="${cssUrl}">` : ""}
<style>body{margin:0;background:var(--background,#fff);font-family:ui-sans-serif,system-ui,sans-serif}</style>
</head><body>${body}</body></html>`;

const list = `
<div style="max-width:768px;margin:0 auto;padding:24px 16px;color:var(--foreground,#111)">
  <h1 style="font-size:20px;font-weight:600;margin:0">Equipment Notebooks</h1>
  <p style="font-size:14px;color:var(--foreground-muted,#666);margin:4px 0 20px">One notebook per machine. Ask questions grounded only in that machine&#39;s sources.</p>
  <div style="display:flex;gap:8px;margin-bottom:16px">
    <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:var(--brand-blue,#2563EB);color:#fff;font-size:14px;font-weight:500">📷 Scan machine</div>
    <div style="padding:12px 16px;border-radius:8px;border:1px solid var(--border,#e5e5e5);font-size:14px;font-weight:500;color:var(--foreground,#111)">＋ New notebook</div>
  </div>
  <div style="border-radius:12px;padding:48px 24px;text-align:center;border:1px dashed var(--border,#e5e5e5);background:var(--surface-1,#fafafa)">
    <h2 style="font-size:16px;font-weight:600;margin:0;color:var(--foreground,#111)">Ask your equipment, not the whole internet.</h2>
    <p style="font-size:14px;color:var(--foreground-muted,#666);max-width:360px;margin:8px auto 0">Scan a nameplate or create a notebook, add its manual, and ask a question.</p>
  </div>
</div>`;

const chat = `
<div style="max-width:768px;margin:0 auto;color:var(--foreground,#111)">
  <div style="display:flex;gap:8px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--border,#e5e5e5)">
    <span>←</span>
    <div style="flex:1">
      <div style="font-size:14px;font-weight:600">Conveyor 4</div>
      <div style="font-size:12px;color:var(--foreground-muted,#666)">Rockwell Automation PowerFlex 525 · 1 of 1 sources</div>
    </div>
    <div style="border:1px solid var(--border,#e5e5e5);border-radius:8px;padding:6px 10px;font-size:12px">Sources · 1/1</div>
  </div>
  <div style="padding:12px">
    <div style="display:flex;flex-direction:row-reverse;gap:8px;margin-bottom:12px">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--brand-blue,#2563EB)"></div>
      <div style="background:var(--brand-blue,#2563EB);color:#fff;border-radius:16px;padding:8px 12px;font-size:14px">What does F004 mean?</div>
    </div>
    <div style="display:flex;gap:8px">
      <div style="width:28px;height:28px;border-radius:50%;background:var(--surface-2,#eee)"></div>
      <div style="max-width:85%">
        <div style="background:var(--surface-1,#fafafa);border:1px solid var(--border,#e5e5e5);border-radius:16px;padding:8px 12px;font-size:14px">
          F004 indicates an undervoltage condition on the DC bus. First verify incoming line voltage and look for a line dip or interruption.
          <span style="background:var(--brand-blue,#2563EB);color:#fff;border-radius:4px;padding:0 4px;font-size:12px;margin-left:2px">[1]</span>
        </div>
        <div style="margin-top:6px">
          <span style="display:inline-flex;align-items:center;gap:4px;border:1px solid var(--border,#e5e5e5);border-radius:4px;padding:2px 6px;font-size:11px;color:var(--foreground-muted,#666)">📄 [1] pf525-user-manual.pdf · p.87</span>
        </div>
      </div>
    </div>
  </div>
  <div style="display:flex;gap:8px;padding:8px;border-top:1px solid var(--border,#e5e5e5)">
    <div style="flex:1;border:1px solid var(--border,#e5e5e5);border-radius:8px;padding:8px 12px;font-size:14px;color:var(--foreground-subtle,#999)">Ask this machine anything…</div>
    <div style="width:36px;height:36px;border-radius:8px;background:var(--brand-blue,#2563EB)"></div>
  </div>
</div>`;

const shots = [
  ["equipment-notebook-list", list],
  ["equipment-notebook-chat", chat],
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
const pg = await ctx.newPage();
for (const [name, body] of shots) {
  await pg.setContent(page(name, body), { waitUntil: "networkidle" });
  await pg.waitForTimeout(400);
  const path = `${OUT}/${STAMP}_${name}_mobile.png`;
  await pg.screenshot({ path });
  console.log("wrote", path);
}
await browser.close();

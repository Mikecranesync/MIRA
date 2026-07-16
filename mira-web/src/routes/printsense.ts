/**
 * Public PrintSense landing page + interest capture (platform PR-D).
 *
 * GET  /printsense           → server-rendered page (FL tokens, no hardcoded hex)
 * POST /printsense/interest  → work-email interest capture (lead file, NOT
 *                              analytics) + content-free funnel event line.
 *
 * No browser upload here: the free surface is the Telegram concierge; the
 * complete-package path is the managed pilot. Analytics lines carry event
 * names and counts only — never emails, questions, or file content.
 */
import { Hono } from "hono";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = process.env.PRINTSENSE_LEADS_DIR ?? "/data/printsense-leads";
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

function record(file: string, row: object) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(join(DATA_DIR, file), JSON.stringify(row) + "\n", "utf-8");
}

export const printsensePage = new Hono();

printsensePage.get("/printsense", (c) => {
  record("funnel.jsonl", { at: Date.now(), event: "landing_viewed" });
  return c.html(PAGE);
});

printsensePage.post("/printsense/interest", async (c) => {
  const body = await c.req.parseBody();
  const email = String(body.email ?? "").trim().toLowerCase();
  const wantsPilot = body.pilot === "on" || body.pilot === "true";
  if (!EMAIL_RE.test(email)) {
    return c.html(PAGE.replace("<!--MSG-->",
      `<p class="ps-msg ps-msg-bad">Please use a valid work email.</p>`), 400);
  }
  // Lead data (CRM, not analytics) — email lives here and only here.
  record("leads.jsonl", { at: Date.now(), email, wantsPilot });
  // Analytics stays content-free.
  record("funnel.jsonl", {
    at: Date.now(),
    event: wantsPilot ? "package_request_submitted" : "interest_submitted",
  });
  return c.html(PAGE.replace("<!--MSG-->",
    `<p class="ps-msg ps-msg-ok">Thanks — we'll reach out within one
     business day. Fastest path: message our Telegram bot now.</p>`));
});

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PrintSense — cited answers from your electrical prints</title>
<link rel="stylesheet" href="/_tokens.css">
<link rel="stylesheet" href="/_components.css">
<style>
  .ps-wrap{max-width:860px;margin:0 auto;padding:var(--fl-sp-6)}
  .ps-hero{padding:var(--fl-sp-6) 0;border-bottom:1px solid var(--fl-rule-200)}
  .ps-card{background:var(--fl-card-0);border:1px solid var(--fl-rule-200);
    border-radius:var(--fl-radius);padding:var(--fl-sp-5);margin:var(--fl-sp-4) 0}
  .ps-msg-ok{color:var(--fl-ok)} .ps-msg-bad{color:var(--fl-danger)}
  .ps-cta{display:inline-block;padding:var(--fl-sp-3) var(--fl-sp-5);
    background:var(--fl-accent);color:var(--fl-card-0);border-radius:var(--fl-radius);
    text-decoration:none;margin-right:var(--fl-sp-3)}
  .ps-mono{font-family:var(--fl-font-mono, monospace);font-size:0.85em;
    background:var(--fl-card-1);padding:var(--fl-sp-4);border-radius:var(--fl-radius);
    overflow-x:auto;white-space:pre}
</style></head><body><div class="ps-wrap">
<div class="ps-hero">
  <h1>PrintSense</h1>
  <p><strong>PrintSense turns existing electrical prints into searchable,
  cited troubleshooting knowledge. It does not replace engineering review or
  claim complete reconstruction.</strong></p>
  <p>Send one print page and a question. A human-reviewed, cited answer
  comes back — every claim tied to a page and a location on it.</p>
  <a class="ps-cta" href="https://t.me/FactoryLM_Diagnose">Try in Telegram</a>
  <a class="ps-cta" href="#pilot">Analyze my complete machine package</a>
</div>
<!--MSG-->
<div class="ps-card"><h2>What you get on one page (free)</h2>
<ul>
<li>Probable page purpose and every readable device identifier</li>
<li><strong>Proven cross-references</strong> — page-to-page continuations
extracted deterministically from the drawing text and geometry, with
bounding-box evidence (this is where general AI vision models fail; our
deterministic extractor is the difference)</li>
<li>Plain-English circuit explanation, safety notes, and an honest list of
what stayed uncertain or unreadable</li>
</ul></div>
<div class="ps-card"><h2>Three demonstrations (all synthetic material)</h2>
<ol>
<li><strong>Clean page:</strong> devices + cross-references proven and cited.</li>
<li><strong>Bad phone photo:</strong> the honest answer — what could not be
read is declared, nothing is invented.</li>
<li><strong>Multi-page set:</strong> preliminary package inventory with
duplicate and missing-page detection.</li>
</ol>
<p>Sample of a delivered report:</p>
<div class="ps-mono"># PrintSense report — Which contactor feeds the next section?
**Preliminary package inventory — full system
reconstruction has not been performed.**
| Tag | Page | Evidence bbox |
| -91/K01 | synthpage | [110,150,300,180] |
Proven: 92.1 / K911 → page 92 (conf 0.99)
Not performed: full system reconstruction —
advanced_reasoning_unavailable</div></div>
<div class="ps-card"><h2>What PrintSense does NOT do (yet)</h2>
<p>No autonomous whole-machine reconstruction, no PLC logic recovery, no
control actions, no engineering sign-off. Anything we can't prove is listed
as unresolved — never guessed.</p></div>
<div class="ps-card"><h2>Confidentiality &amp; retention</h2>
<p>Files are stored content-addressed and tenant-isolated. Logs carry
hashes, never content. Nothing trains models. Deletion on request. Every
report passes a human reviewer before you see it.</p></div>
<div class="ps-card" id="pilot"><h2>Managed package pilot (paid)</h2>
<p>Send the complete print package; we return searchable, cited
troubleshooting knowledge for the whole machine — reviewed, confidential,
with introductory pilot pricing.</p>
<form method="post" action="/printsense/interest">
  <label>Work email <input type="email" name="email" required></label>
  <label><input type="checkbox" name="pilot"> I want the complete-package
  pilot</label>
  <button class="ps-cta" type="submit">Contact me</button>
</form></div>
</div></body></html>`;

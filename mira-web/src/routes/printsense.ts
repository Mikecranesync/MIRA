/**
 * Public PrintSense landing page + interest capture (platform PR-D).
 *
 * GET  /printsense           → server-rendered page (FL dark-datasheet tokens,
 *                              no hardcoded hex; icons are inline SVG, never emoji)
 * POST /printsense/interest  → work-email interest capture (lead file, NOT
 *                              analytics) + content-free funnel event line.
 *
 * 2026-07-17 rebuild (de-slop plan PR3): the page keeps this route's HONEST
 * claims — human-reviewed, "does not replace engineering review", synthetic
 * demos, confidentiality — and adopts the showcase *structure* from the
 * landing exploration (cited-answer card as hero, HELD + STOP examples,
 * generic-AI comparison, product ladder). No invented stats, no emoji, no
 * glows. Every fault fact shown matches the vendored drive packs (F004 =
 * UnderVoltage on a PowerFlex 525 — the exploration draft's "F5 = DC bus
 * undervoltage" was itself a misread and died here).
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

// Inline SVG micro-icons (stroke:currentColor) — never emoji.
const I_DOC =
  '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-1px"><path d="M4 1.5h5.5L13 5v9.5H4z"/><path d="M9.5 1.5V5H13"/></svg>';
const I_SHIELD =
  '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-1px"><path d="M8 1.5l5.5 2v4c0 3.4-2.3 5.9-5.5 7-3.2-1.1-5.5-3.6-5.5-7v-4z"/></svg>';
const I_CHECK =
  '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M3 8.5l3.5 3.5L13 5"/></svg>';
const I_PAUSE =
  '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-1px"><path d="M5.5 3.5v9M10.5 3.5v9"/></svg>';
const I_STOP =
  '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" style="vertical-align:-1px"><path d="M8 2L14.5 13.5H1.5z"/><path d="M8 6.5V10"/><path d="M8 11.8v.4"/></svg>';

const PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PrintSense — cited answers from your electrical prints</title>
<meta name="description" content="Send one print page and a question. A human-reviewed, cited answer comes back — every claim tied to a page and a location on it. PrintSense does not replace engineering review.">
<link rel="stylesheet" href="/_tokens.css">
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{background:var(--fl-dark-bg);color:var(--fl-dark-ink);font-family:var(--fl-dark-font);
    font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
  a{color:inherit}
  .ps-wrap{max-width:1080px;margin:0 auto;padding:0 32px}
  .ps-mono-f{font-family:var(--fl-dark-mono)}
  nav.ps-nav{position:sticky;top:0;z-index:50;background:var(--fl-dark-bg-glass);
    backdrop-filter:blur(12px);border-bottom:1px solid var(--fl-dark-line)}
  .ps-nav-in{max-width:1080px;margin:0 auto;padding:16px 32px;display:flex;align-items:center;justify-content:space-between}
  .ps-logo{color:var(--fl-dark-accent);font-weight:600;text-decoration:none;font-size:15px}
  .ps-logo small{color:var(--fl-dark-faint);font-weight:400;margin-left:8px}
  .ps-nav-cta{font-size:13.5px;color:var(--fl-dark-muted);text-decoration:none}
  .ps-nav-cta:hover{color:var(--fl-dark-ink)}
  .ps-hero{padding:52px 0 44px;border-bottom:1px solid var(--fl-dark-line);display:grid;
    grid-template-columns:1fr 1fr;gap:40px;align-items:center}
  @media(max-width:900px){.ps-hero{grid-template-columns:1fr}}
  .ps-label{font-family:var(--fl-dark-mono);font-size:11px;letter-spacing:0.12em;
    color:var(--fl-dark-accent);text-transform:uppercase;margin-bottom:16px;display:inline-block}
  h1{font-size:clamp(30px,4.6vw,46px);line-height:1.1;font-weight:600;letter-spacing:-0.02em;margin-bottom:16px}
  .ps-lede{font-size:17px;color:var(--fl-dark-muted);max-width:560px;margin-bottom:22px}
  .ps-lede strong{color:var(--fl-dark-ink);font-weight:600}
  .ps-cta{display:inline-block;padding:12px 22px;background:var(--fl-dark-accent);
    color:var(--fl-dark-bg);border:1px solid var(--fl-dark-accent-line);border-radius:8px;
    text-decoration:none;font-weight:700;margin-right:12px;margin-top:4px}
  .ps-cta:hover{background:var(--fl-dark-accent-hover)}
  .ps-cta-ghost{display:inline-block;padding:12px 22px;border:1px solid var(--fl-dark-line-hi);
    border-radius:8px;color:var(--fl-dark-ink);text-decoration:none;font-weight:600;margin-top:4px}
  .ps-cta-ghost:hover{border-color:var(--fl-dark-accent-line);color:var(--fl-dark-accent)}
  .ps-note{font-family:var(--fl-dark-mono);font-size:12px;color:var(--fl-dark-faint);margin-top:14px}
  section.ps-block{padding:48px 0;border-top:1px solid var(--fl-dark-line)}
  h2{font-size:24px;font-weight:600;letter-spacing:-0.02em;margin-bottom:10px}
  .ps-sub{color:var(--fl-dark-muted);font-size:15px;max-width:640px;margin-bottom:26px}
  /* answer cards */
  .ps-gallery{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:860px){.ps-gallery{grid-template-columns:1fr}}
  .ps-answer{background:var(--fl-dark-surface);border:1px solid var(--fl-dark-line-hi);
    border-radius:10px;overflow:hidden}
  .ps-answer .q{padding:14px 18px;border-bottom:1px solid var(--fl-dark-line);
    background:var(--fl-dark-surface-hi);font-size:14.5px;font-weight:600;line-height:1.45}
  .ps-answer .q small{display:block;font-family:var(--fl-dark-mono);font-size:10.5px;
    color:var(--fl-dark-faint);font-weight:400;margin-top:4px}
  .ps-answer .a{padding:16px 18px;font-size:14px;color:var(--fl-dark-ink);line-height:1.7}
  .ps-cites{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 14px}
  .ps-cite{display:inline-flex;align-items:center;gap:6px;font-family:var(--fl-dark-mono);
    font-size:11px;color:var(--fl-dark-ok);border-left:2px solid var(--fl-dark-ok-line);
    background:var(--fl-dark-ok-tint);padding:6px 10px;border-radius:4px}
  .ps-foot{display:flex;align-items:center;gap:10px;padding:11px 18px;
    border-top:1px solid var(--fl-dark-line);background:var(--fl-dark-surface-hi);
    font-family:var(--fl-dark-mono);font-size:11px;color:var(--fl-dark-muted)}
  .ps-badge{font-family:var(--fl-dark-mono);font-weight:700;font-size:10.5px;
    padding:3px 9px;border-radius:5px;display:inline-flex;align-items:center;gap:6px}
  .ps-badge.ok{background:var(--fl-dark-ok-tint);color:var(--fl-dark-ok);border:1px solid var(--fl-dark-ok-line)}
  .ps-badge.held{background:var(--fl-dark-warn-tint);color:var(--fl-dark-warn);border:1px solid var(--fl-dark-warn-line)}
  .ps-badge.stop{background:var(--fl-dark-fault-tint);color:var(--fl-dark-fault);border:1px solid var(--fl-dark-fault-line)}
  /* comparison */
  .ps-cmp{display:grid;grid-template-columns:1fr 1fr;gap:18px}
  @media(max-width:860px){.ps-cmp{grid-template-columns:1fr}}
  .ps-cmp-card{border-radius:10px;padding:20px 22px;border:1px solid var(--fl-dark-line)}
  .ps-cmp-card.bad{border-color:var(--fl-dark-fault-line);background:var(--fl-dark-fault-tint)}
  .ps-cmp-card.good{border-color:var(--fl-dark-ok-line);background:var(--fl-dark-ok-tint)}
  .ps-cmp-hd{font-family:var(--fl-dark-mono);font-size:11.5px;letter-spacing:0.08em;
    text-transform:uppercase;margin-bottom:12px;font-weight:700}
  .bad .ps-cmp-hd{color:var(--fl-dark-fault)} .good .ps-cmp-hd{color:var(--fl-dark-ok)}
  .ps-cmp-card blockquote{font-size:14px;border-left:2px solid var(--fl-dark-line-hi);
    padding-left:12px;font-style:italic;color:var(--fl-dark-ink)}
  .ps-cmp-note{margin-top:12px;font-size:12.5px;color:var(--fl-dark-muted);font-family:var(--fl-dark-mono)}
  /* cards + report */
  .ps-card{background:var(--fl-dark-surface);border:1px solid var(--fl-dark-line);
    border-radius:10px;padding:20px 22px;margin:14px 0}
  .ps-card h3{font-size:16.5px;font-weight:600;margin-bottom:10px}
  .ps-card ul,.ps-card ol{margin:8px 0 8px 20px;color:var(--fl-dark-muted);font-size:14.5px}
  .ps-card li{margin-bottom:6px}
  .ps-card li strong{color:var(--fl-dark-ink)}
  .ps-card p{color:var(--fl-dark-muted);font-size:14.5px}
  .ps-mono{font-family:var(--fl-dark-mono);font-size:12.5px;color:var(--fl-dark-muted);
    background:var(--fl-dark-surface-hi);border:1px solid var(--fl-dark-line);
    padding:14px 16px;border-radius:8px;overflow-x:auto;white-space:pre;margin-top:10px}
  /* ladder */
  .ps-ladder{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border:1px solid var(--fl-dark-line);
    border-radius:10px;overflow:hidden}
  @media(max-width:860px){.ps-ladder{grid-template-columns:1fr}}
  .ps-rung{padding:22px;border-right:1px solid var(--fl-dark-line);background:var(--fl-dark-surface)}
  .ps-rung:last-child{border-right:none}
  @media(max-width:860px){.ps-rung{border-right:none;border-bottom:1px solid var(--fl-dark-line)}}
  .ps-rung.here{background:var(--fl-dark-accent-tint)}
  .ps-rung .lvl{font-family:var(--fl-dark-mono);font-size:10.5px;letter-spacing:0.1em;
    text-transform:uppercase;color:var(--fl-dark-faint)}
  .ps-rung h3{font-size:18px;font-weight:700;margin:6px 0 2px}
  .ps-rung .who{font-family:var(--fl-dark-mono);font-size:11px;color:var(--fl-dark-accent);margin-bottom:8px}
  .ps-rung p{font-size:13px;color:var(--fl-dark-muted)}
  .ps-here{display:inline-block;margin-top:10px;font-family:var(--fl-dark-mono);font-size:10.5px;
    background:var(--fl-dark-accent);color:var(--fl-dark-bg);padding:2px 8px;border-radius:5px;font-weight:700}
  /* form */
  .ps-msg{margin:14px 0;font-size:14.5px}
  .ps-msg-ok{color:var(--fl-dark-ok)} .ps-msg-bad{color:var(--fl-dark-fault)}
  form.ps-form label{display:block;margin:12px 0;color:var(--fl-dark-muted);font-size:14px}
  form.ps-form input[type=email]{display:block;width:100%;max-width:380px;margin-top:6px;
    background:var(--fl-dark-surface-hi);border:1px solid var(--fl-dark-line-hi);border-radius:8px;
    padding:11px 14px;color:var(--fl-dark-ink);font-size:15px;font-family:var(--fl-dark-font)}
  form.ps-form input[type=email]:focus{outline:none;border-color:var(--fl-dark-accent)}
  form.ps-form button{margin-top:8px}
  footer.ps-footer{padding:34px 0;border-top:1px solid var(--fl-dark-line);color:var(--fl-dark-faint);font-size:13px}
</style></head><body>
<nav class="ps-nav"><div class="ps-nav-in">
  <a href="/" class="ps-logo">PrintSense <small>by FactoryLM</small></a>
  <a class="ps-nav-cta" href="https://t.me/FactoryLM_Diagnose">Try in Telegram</a>
</div></nav>
<div class="ps-wrap">

<div class="ps-hero">
  <div>
    <span class="ps-label">Cited print intelligence &middot; human-reviewed</span>
    <h1>Ask about a print. Get the answer and its source.</h1>
    <p class="ps-lede"><strong>PrintSense turns existing electrical prints into searchable,
    cited troubleshooting knowledge. It does not replace engineering review or claim complete
    reconstruction.</strong> Send one print page and a question &mdash; a human-reviewed, cited
    answer comes back, every claim tied to a page and a location on it.</p>
    <a class="ps-cta" href="https://t.me/FactoryLM_Diagnose">Try in Telegram</a>
    <a class="ps-cta-ghost" href="#pilot">Analyze my complete machine package</a>
    <p class="ps-note">Read-only &middot; anything we can't prove is listed as unresolved, never guessed</p>
  </div>

  <div class="ps-answer">
    <div class="q">&ldquo;PowerFlex 525 keeps tripping F004 overnight &mdash; what do I check first?&rdquo;
      <small>Sample of a delivered answer &middot; synthetic material</small></div>
    <div class="a">F004 on this drive is an <strong>UnderVoltage</strong> trip. The manual&rsquo;s
      fault list points at DC bus voltage falling below the minimum &mdash; on an overnight-only
      pattern, check the incoming supply for off-shift sag before touching drive parameters.
      What we couldn&rsquo;t read from your print is listed as unresolved below the answer.</div>
    <div class="ps-cites">
      <span class="ps-cite">${I_DOC} PowerFlex 525 User Manual &middot; fault list</span>
      <span class="ps-cite">${I_DOC} your print &middot; page + location</span>
    </div>
    <div class="ps-foot"><span class="ps-badge ok">${I_CHECK} CITED &middot; HUMAN-REVIEWED</span>
      <span>every claim carries its source</span></div>
  </div>
</div>

<section class="ps-block">
  <h2>The same rigor, in three shapes.</h2>
  <p class="ps-sub">All demonstrations use synthetic material. The point is the behavior:
  cited when we can prove it, held when something is off, stopped when safety is involved.</p>
  <div class="ps-gallery">
    <div class="ps-answer">
      <div class="q">&ldquo;Read this ATV340 print and import the device list.&rdquo;
        <small>Multi-page set &middot; synthetic material</small></div>
      <div class="a">Read complete: devices and wires typed, duplicates checked. But the import
        is <strong>held</strong> &mdash; tag <span class="ps-mono-f">-K1</span> appears twice on
        one sheet and must be resolved before it&rsquo;s safe to bring in. A great read is still
        not an import until the duplicate is fixed.</div>
      <div class="ps-cites"><span class="ps-cite">${I_SHIELD} duplicate-identifier check</span></div>
      <div class="ps-foot"><span class="ps-badge held">${I_PAUSE} IMPORT HELD</span>
        <span>the gate caught it &mdash; nothing shipped</span></div>
    </div>
    <div class="ps-answer">
      <div class="q">&ldquo;Photo of the panel &mdash; can I energize this 240V branch?&rdquo;
        <small>Photo upload &middot; synthetic material</small></div>
      <div class="a"><strong>Stop &mdash; do not energize.</strong> The photo shows a meter reading
        480&nbsp;V on a branch labeled 240&nbsp;V. That mismatch is outside anything PrintSense
        will advise on. Verify with a meter and confirm the source with a qualified person.
        PrintSense won&rsquo;t clear this &mdash; a human has to.</div>
      <div class="ps-cites"><span class="ps-cite">${I_SHIELD} safety rule &middot; voltage mismatch</span></div>
      <div class="ps-foot"><span class="ps-badge stop">${I_STOP} STOP &middot; ESCALATE</span>
        <span>PrintSense escalates &mdash; it never acts</span></div>
    </div>
  </div>
</section>

<section class="ps-block">
  <h2>Same question. Two very different answers.</h2>
  <div class="ps-cmp">
    <div class="ps-cmp-card bad">
      <div class="ps-cmp-hd">Generic AI</div>
      <blockquote>&ldquo;F004 usually means undervoltage. Check your incoming line voltage and
        your PLC tag mapping. You should be good to proceed.&rdquo;</blockquote>
      <div class="ps-cmp-note">No manual reference. No print. No idea what it couldn&rsquo;t
        read. Confident &mdash; and unverifiable on the floor.</div>
    </div>
    <div class="ps-cmp-card good">
      <div class="ps-cmp-hd">PrintSense</div>
      <blockquote>&ldquo;F004 = UnderVoltage per the drive manual&rsquo;s fault list. Your print
        shows the branch feeding it on page 12, location C4. Two devices on that sheet were
        unreadable &mdash; listed as unresolved, not guessed.&rdquo;</blockquote>
      <div class="ps-cmp-note">Every claim cited. Every gap declared. Reviewed by a human
        before you see it.</div>
    </div>
  </div>
</section>

<section class="ps-block">
  <h2>What you get on one page (free)</h2>
  <div class="ps-card"><ul>
    <li>Probable page purpose and every readable device identifier</li>
    <li><strong>Proven cross-references</strong> &mdash; page-to-page continuations extracted
      deterministically from the drawing text and geometry, with bounding-box evidence (this is
      where general AI vision models fail; our deterministic extractor is the difference)</li>
    <li>Plain-English circuit explanation, safety notes, and an honest list of what stayed
      uncertain or unreadable</li>
  </ul>
  <p>Sample of a delivered report:</p>
  <div class="ps-mono"># PrintSense report — Which contactor feeds the next section?
**Preliminary package inventory — full system
reconstruction has not been performed.**
| Tag | Page | Evidence bbox |
| -91/K01 | synthpage | [110,150,300,180] |
Proven: 92.1 / K911 → page 92 (conf 0.99)
Not performed: full system reconstruction —
advanced_reasoning_unavailable</div></div>
</section>

<section class="ps-block">
  <h2>What PrintSense does NOT do (yet)</h2>
  <div class="ps-card"><p>No autonomous whole-machine reconstruction, no PLC logic recovery, no
  control actions, no engineering sign-off. PrintSense <strong>does not replace engineering
  review</strong>. Anything we can&rsquo;t prove is listed as unresolved &mdash; never guessed.</p></div>
  <h2 style="margin-top:34px">Confidentiality &amp; retention</h2>
  <div class="ps-card"><p>Files are stored content-addressed and tenant-isolated. Logs carry
  hashes, never content. Nothing trains models. Deletion on request. Every report passes a
  human reviewer before you see it.</p></div>
</section>

<section class="ps-block">
  <h2>Where PrintSense fits</h2>
  <p class="ps-sub">Every print you read becomes structured asset context &mdash; the foundation
  FactoryLM&rsquo;s namespace is built on. Lead with context, not a copilot.</p>
  <div class="ps-ladder">
    <div class="ps-rung here"><div class="lvl">Start here</div><h3>PrintSense</h3>
      <div class="who">for the technician</div>
      <p>One print page, one question, one cited answer. Read-only, zero infrastructure.</p>
      <span class="ps-here">You are here</span></div>
    <div class="ps-rung"><div class="lvl">Then</div><h3>MIRA</h3>
      <div class="who">for the maintenance team</div>
      <p>Grounded troubleshooting that cites its sources &mdash; Telegram, web, and the CMMS.</p></div>
    <div class="ps-rung"><div class="lvl">Finally</div><h3>FactoryLM</h3>
      <div class="who">for the plant</div>
      <p>The maintenance-context layer: manuals, PLC tags, and fault history structured into
      AI-ready context.</p></div>
  </div>
</section>

<!--MSG-->
<section class="ps-block" id="pilot">
  <h2>Managed package pilot (paid)</h2>
  <div class="ps-card"><p>Send the complete print package; we return searchable, cited
  troubleshooting knowledge for the whole machine &mdash; reviewed, confidential, with
  introductory pilot pricing.</p>
  <form method="post" action="/printsense/interest" class="ps-form">
    <label>Work email <input type="email" name="email" required></label>
    <label><input type="checkbox" name="pilot"> I want the complete-package pilot</label>
    <button class="ps-cta" type="submit">Contact me</button>
  </form></div>
</section>

</div>
<footer class="ps-footer"><div class="ps-wrap">
  PrintSense is read-only print intelligence from FactoryLM, grounded by the MIRA knowledge
  layer. It escalates to humans &mdash; it never acts. &middot;
  <a href="https://t.me/FactoryLM_Diagnose">Try in Telegram</a> &middot;
  <a href="mailto:mike@factorylm.com">Talk to Mike</a>
</div></footer>
</body></html>`;

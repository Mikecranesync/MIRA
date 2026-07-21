/**
 * Public PrintSense standalone-product page + interest capture.
 *
 * GET  /printsense          -> product page
 * POST /printsense/interest -> complete-package / reviewed-analysis interest
 *
 * Product truth:
 *   - immediate self-serve entry is Telegram;
 *   - one page, multiple photos, and print packages are the same product motion;
 *   - human review is optional assurance, not the identity of PrintSense;
 *   - answers remain read-only, cited, and explicit about uncertainty.
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
  const wantsPackage = body.package === "on" || body.package === "true";
  const wantsReview = body.review === "on" || body.review === "true";

  if (!EMAIL_RE.test(email)) {
    return c.html(
      PAGE.replace(
        "<!--MSG-->",
        `<p class="ps-msg ps-msg-bad">Please use a valid work email.</p>`
      ),
      400
    );
  }

  record("leads.jsonl", {
    at: Date.now(),
    email,
    wantsPackage,
    wantsReview,
  });
  record("funnel.jsonl", {
    at: Date.now(),
    event: wantsPackage ? "package_request_submitted" : "interest_submitted",
  });

  return c.html(
    PAGE.replace(
      "<!--MSG-->",
      `<p class="ps-msg ps-msg-ok">Request received. You can start using PrintSense in Telegram now; we will follow up about package access or reviewed assurance.</p>`
    )
  );
});

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PrintSense — chat with electrical prints</title>
<meta name="description" content="Send an electrical print page, photo set, or package and ask questions about it. PrintSense returns cited explanations, traces, and declared uncertainty.">
<link rel="canonical" href="https://factorylm.com/printsense">
<link rel="stylesheet" href="/_tokens.css">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{background:var(--fl-dark-bg);color:var(--fl-dark-ink);font-family:var(--fl-dark-font);font-size:15px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:inherit}
.ps-wrap{max-width:1080px;margin:0 auto;padding:0 32px}
.ps-nav{position:sticky;top:0;z-index:50;background:var(--fl-dark-bg-glass);backdrop-filter:blur(12px);border-bottom:1px solid var(--fl-dark-line)}
.ps-nav-in{max-width:1080px;margin:0 auto;padding:16px 32px;display:flex;align-items:center;justify-content:space-between;gap:24px}
.ps-logo{color:var(--fl-dark-accent);font-weight:700;text-decoration:none}
.ps-logo small{color:var(--fl-dark-faint);font-weight:400;margin-left:8px}
.ps-links{display:flex;gap:20px;align-items:center}
.ps-links a{font-size:13px;color:var(--fl-dark-muted);text-decoration:none}
.ps-links a:hover{color:var(--fl-dark-ink)}
.ps-hero{padding:68px 0 54px;display:grid;grid-template-columns:1.05fr .95fr;gap:42px;align-items:center}
.ps-label,.ps-kicker{font-family:var(--fl-dark-mono);font-size:11px;letter-spacing:.12em;color:var(--fl-dark-accent);text-transform:uppercase;margin-bottom:15px;display:block}
h1{font-size:clamp(34px,5vw,56px);line-height:1.06;font-weight:650;letter-spacing:-.03em;margin-bottom:18px}
.ps-lede{font-size:18px;color:var(--fl-dark-muted);max-width:650px;margin-bottom:24px}
.ps-lede strong{color:var(--fl-dark-ink)}
.ps-actions{display:flex;gap:12px;flex-wrap:wrap}
.ps-cta,.ps-cta-ghost{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700}
.ps-cta{background:var(--fl-dark-accent);color:var(--fl-dark-bg);border:1px solid var(--fl-dark-accent-line)}
.ps-cta:hover{background:var(--fl-dark-accent-hover)}
.ps-cta-ghost{border:1px solid var(--fl-dark-line-hi);color:var(--fl-dark-ink);background:transparent}
.ps-note{font-family:var(--fl-dark-mono);font-size:12px;color:var(--fl-dark-faint);margin-top:14px}
.ps-demo{background:var(--fl-dark-surface);border:1px solid var(--fl-dark-line-hi);border-radius:12px;overflow:hidden}
.ps-demo-q{padding:16px 18px;background:var(--fl-dark-surface-hi);border-bottom:1px solid var(--fl-dark-line);font-weight:650}
.ps-demo-a{padding:18px;color:var(--fl-dark-muted)}
.ps-demo-a strong{color:var(--fl-dark-ink)}
.ps-cites{display:flex;gap:8px;flex-wrap:wrap;padding:0 18px 16px}
.ps-cite{font-family:var(--fl-dark-mono);font-size:11px;color:var(--fl-dark-ok);border-left:2px solid var(--fl-dark-ok-line);background:var(--fl-dark-ok-tint);padding:6px 10px;border-radius:4px}
.ps-demo-foot{padding:12px 18px;border-top:1px solid var(--fl-dark-line);font-family:var(--fl-dark-mono);font-size:11px;color:var(--fl-dark-muted)}
.ps-block{padding:52px 0;border-top:1px solid var(--fl-dark-line)}
h2{font-size:clamp(25px,3vw,34px);line-height:1.15;letter-spacing:-.02em;margin-bottom:12px}
.ps-sub{color:var(--fl-dark-muted);font-size:16px;max-width:700px;margin-bottom:28px}
.ps-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.ps-card{background:var(--fl-dark-surface);border:1px solid var(--fl-dark-line);border-radius:10px;padding:22px}
.ps-card h3{font-size:18px;margin-bottom:10px}
.ps-card p,.ps-card li{color:var(--fl-dark-muted)}
.ps-card ul{padding-left:20px;display:grid;gap:8px}
.ps-step{font-family:var(--fl-dark-mono);font-size:11px;color:var(--fl-dark-accent);margin-bottom:8px}
.ps-promise{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.ps-answer{background:var(--fl-dark-ok-tint);border:1px solid var(--fl-dark-ok-line)}
.ps-honesty{background:var(--fl-dark-warn-tint);border:1px solid var(--fl-dark-warn-line)}
.ps-safety{background:var(--fl-dark-fault-tint);border:1px solid var(--fl-dark-fault-line)}
.ps-ladder{display:grid;grid-template-columns:repeat(3,1fr);border:1px solid var(--fl-dark-line);border-radius:10px;overflow:hidden}
.ps-rung{padding:22px;background:var(--fl-dark-surface);border-right:1px solid var(--fl-dark-line)}
.ps-rung:last-child{border-right:none}
.ps-rung strong{display:block;font-size:18px;margin:6px 0}
.ps-rung p{color:var(--fl-dark-muted)}
.ps-rung.here{background:var(--fl-dark-accent-tint)}
.ps-form{display:grid;gap:14px;max-width:620px}
.ps-form label{color:var(--fl-dark-muted)}
.ps-form input[type=email]{display:block;width:100%;margin-top:6px;background:var(--fl-dark-surface-hi);border:1px solid var(--fl-dark-line-hi);border-radius:8px;padding:12px 14px;color:var(--fl-dark-ink);font-size:15px}
.ps-checks{display:grid;gap:8px}
.ps-msg{margin-bottom:18px}.ps-msg-ok{color:var(--fl-dark-ok)}.ps-msg-bad{color:var(--fl-dark-fault)}
.ps-footer{padding:34px 0;border-top:1px solid var(--fl-dark-line);color:var(--fl-dark-faint);font-size:13px}
@media(max-width:900px){.ps-hero{grid-template-columns:1fr}.ps-grid,.ps-promise,.ps-ladder{grid-template-columns:1fr}.ps-rung{border-right:none;border-bottom:1px solid var(--fl-dark-line)}}
@media(max-width:680px){.ps-wrap,.ps-nav-in{padding-left:20px;padding-right:20px}.ps-links a:not(.ps-primary-link){display:none}.ps-hero{padding-top:46px}}
</style>
</head>
<body>
<nav class="ps-nav"><div class="ps-nav-in">
  <a href="/" class="ps-logo">PrintSense <small>by FactoryLM</small></a>
  <div class="ps-links">
    <a class="ps-primary-link" href="https://t.me/FactoryLM_Diagnose">Open PrintSense</a>
    <a href="/drive-commander/siemens-g120">Drive Commander</a>
    <a href="/pricing">Pricing</a>
  </div>
</div></nav>

<main class="ps-wrap">
<section class="ps-hero">
  <div>
    <span class="ps-label">Standalone electrical-print intelligence</span>
    <h1>Upload an electrical print. Ask how the machine works.</h1>
    <p class="ps-lede"><strong>PrintSense is built so a technician can send almost any reasonably legible electrical print, begin chatting immediately, and get explanations grounded in the drawing.</strong> Start with one photo, continue with multiple pages, or bring the complete print package into the same machine workspace.</p>
    <div class="ps-actions">
      <a class="ps-cta" href="https://t.me/FactoryLM_Diagnose">Start in Telegram</a>
      <a class="ps-cta-ghost" href="#package">Bring a complete print package</a>
    </div>
    <p class="ps-note">Read-only &middot; cited &middot; uncertainty stays visible &middot; human review available when needed</p>
  </div>

  <article class="ps-demo">
    <div class="ps-demo-q">&ldquo;Trace this safety relay output. What has to be true before K21 can energize?&rdquo;</div>
    <div class="ps-demo-a">PrintSense identifies the output path, follows the page continuation, and explains the permissives in sequence. <strong>Two terminal labels are unreadable, so they remain unresolved instead of being invented.</strong></div>
    <div class="ps-cites">
      <span class="ps-cite">page 18 &middot; region D4</span>
      <span class="ps-cite">continuation to page 21 &middot; B2</span>
      <span class="ps-cite">device -K21</span>
    </div>
    <div class="ps-demo-foot">ANSWER &middot; SOURCE &middot; CONFIDENCE &middot; UNRESOLVED ITEMS</div>
  </article>
</section>

<section class="ps-block">
  <span class="ps-kicker">One product, three input sizes</span>
  <h2>Start with what you have.</h2>
  <p class="ps-sub">PrintSense should not require a perfect document package before it becomes useful. The conversation grows as the evidence grows.</p>
  <div class="ps-grid">
    <article class="ps-card"><div class="ps-step">ONE PAGE</div><h3>Photo or print snippet</h3><p>Ask what a circuit does, identify devices, trace a conductor, or understand an unfamiliar symbol.</p></article>
    <article class="ps-card"><div class="ps-step">MULTI-PHOTO</div><h3>A section of the machine</h3><p>Send consecutive pages or phone photos and keep asking questions while PrintSense builds page relationships.</p></article>
    <article class="ps-card"><div class="ps-step">COMPLETE PACKAGE</div><h3>The machine's print book</h3><p>Index a PDF or large photo set once, then chat with the machine across pages, devices, and cross-references.</p></article>
  </div>
</section>

<section class="ps-block">
  <span class="ps-kicker">What the technician can ask</span>
  <h2>A conversation, not a one-time report.</h2>
  <div class="ps-grid">
    <article class="ps-card"><h3>Explain</h3><ul><li>What does this circuit do?</li><li>What is the theory of operation?</li><li>Why are these contacts arranged this way?</li></ul></article>
    <article class="ps-card"><h3>Trace</h3><ul><li>Where does this signal go?</li><li>What feeds this contactor or drive?</li><li>Which pages complete this circuit?</li></ul></article>
    <article class="ps-card"><h3>Troubleshoot</h3><ul><li>What conditions prevent this output?</li><li>What should I verify first?</li><li>Which conclusions are proven versus uncertain?</li></ul></article>
  </div>
</section>

<section class="ps-block">
  <span class="ps-kicker">Trust contract</span>
  <h2>Useful immediately. Honest at the edge cases.</h2>
  <div class="ps-promise">
    <article class="ps-card ps-answer"><h3>Cited when proven</h3><p>Answers point back to pages, locations, identifiers, manual sections, and stored evidence.</p></article>
    <article class="ps-card ps-honesty"><h3>Unresolved when unclear</h3><p>Blurry labels, missing pages, conflicting tags, and ambiguous conventions remain visible.</p></article>
    <article class="ps-card ps-safety"><h3>Stopped when safety-critical</h3><p>PrintSense explains and escalates. It never authorizes energization or replaces qualified verification.</p></article>
    <article class="ps-card"><h3>Review when warranted</h3><p>Human-reviewed assurance is available for complex packages and critical deliverables, but it is not required for every ordinary chat.</p></article>
  </div>
</section>

<section class="ps-block">
  <span class="ps-kicker">Expansion path</span>
  <h2>PrintSense stands alone. FactoryLM expands it.</h2>
  <div class="ps-ladder">
    <div class="ps-rung here"><span class="ps-step">START HERE</span><strong>PrintSense</strong><p>Chat with electrical prints and machine packages without rebuilding your maintenance systems.</p></div>
    <div class="ps-rung"><span class="ps-step">TEAM MEMORY</span><strong>MIRA</strong><p>Carry print knowledge into Telegram, Slack, web, manuals, fault history, and team workflows.</p></div>
    <div class="ps-rung"><span class="ps-step">PLANT EXPANSION</span><strong>FactoryLM platform</strong><p>Connect assets, PLC context, telemetry, CMMS records, and maintenance operations.</p></div>
  </div>
</section>

<!--MSG-->
<section class="ps-block" id="package">
  <span class="ps-kicker">Complete-package access</span>
  <h2>Bring the whole machine print book.</h2>
  <p class="ps-sub">Use PrintSense immediately in Telegram. Submit your work email when you need a large-package workspace, reviewed deliverable, or help handling an unusually large or difficult print set.</p>
  <form method="post" action="/printsense/interest" class="ps-form">
    <label>Work email <input type="email" name="email" required></label>
    <div class="ps-checks">
      <label><input type="checkbox" name="package"> I need complete-package access</label>
      <label><input type="checkbox" name="review"> I need human-reviewed assurance</label>
    </div>
    <button class="ps-cta" type="submit">Request package access</button>
  </form>
</section>
</main>

<footer class="ps-footer"><div class="ps-wrap">
  PrintSense is read-only electrical-print intelligence from FactoryLM. &middot;
  <a href="https://t.me/FactoryLM_Diagnose">Start now</a> &middot;
  <a href="/pricing">Pricing</a> &middot;
  <a href="mailto:mike@factorylm.com">Talk to Mike</a>
</div></footer>
</body>
</html>`;

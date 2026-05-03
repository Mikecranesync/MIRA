import { head } from "../lib/head.js";
import {
  btnPrimary,
  btnGhost,
  stateBadge,
  compareBlock,
} from "../lib/components.js";

const PAGE_STYLES = `
.fl-topbar {
  display: flex; align-items: center; justify-content: space-between;
  padding: var(--fl-sp-4) var(--fl-sp-6);
  background: var(--fl-card-0);
  border-bottom: 1px solid var(--fl-rule-200);
  gap: var(--fl-sp-6);
}
.fl-topbar-brand {
  font-weight: 600; color: var(--fl-navy-900); text-decoration: none;
  font-size: var(--fl-type-lg); letter-spacing: var(--fl-ls-tight);
}
.fl-topbar-nav { display: flex; gap: var(--fl-sp-6); }
.fl-topbar-nav a {
  color: var(--fl-ink-900); text-decoration: none;
  font-size: var(--fl-type-base);
}
.fl-topbar-nav a:hover { color: var(--fl-navy-900); text-decoration: underline; }

.fl-cmms-hero {
  padding: var(--fl-sp-10) var(--fl-sp-6) var(--fl-sp-8);
  background: linear-gradient(180deg, var(--fl-sky-100) 0%, var(--fl-bg-50) 100%);
}
.fl-cmms-hero-inner { max-width: 560px; margin: 0 auto; text-align: center; }
.fl-cmms-eyebrow {
  text-transform: uppercase;
  letter-spacing: var(--fl-ls-caps);
  font-size: var(--fl-type-xs);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-3);
}
.fl-cmms-h1 {
  font-size: var(--fl-type-3xl);
  letter-spacing: var(--fl-ls-tight);
  color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-3);
}
.fl-cmms-sub {
  font-size: var(--fl-type-md);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-6);
  line-height: 1.55;
}

.fl-magic-form {
  display: flex; flex-direction: column; gap: var(--fl-sp-3);
  max-width: 420px; margin: 0 auto var(--fl-sp-3);
}
.fl-magic-form label {
  position: absolute; left: -9999px; width: 1px; height: 1px;
}
.fl-magic-form input[type="email"] {
  font-family: inherit;
  font-size: var(--fl-type-md);
  padding: 12px 14px;
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-lg);
  background: var(--fl-card-0);
  color: var(--fl-ink-900);
  outline: none;
  transition: box-shadow .12s ease, border-color .12s ease;
}
.fl-magic-form input[type="email"]:focus {
  border-color: var(--fl-navy-900);
  box-shadow: 0 0 0 3px rgba(27,54,93,.10);
}
.fl-magic-form .fl-btn-primary {
  font-size: var(--fl-type-md);
  padding: 12px 14px;
}
.fl-form-error {
  color: var(--fl-bad);
  font-size: var(--fl-type-sm);
  text-align: left;
  margin: 0;
  min-height: 1.4em;
}
.fl-form-success {
  color: var(--fl-good);
  font-size: var(--fl-type-sm);
  background: var(--fl-state-indexed-bg);
  padding: var(--fl-sp-3);
  border-radius: var(--fl-radius-md);
  margin: 0 auto;
  max-width: 420px;
}
.fl-reassurance {
  font-size: var(--fl-type-sm);
  color: var(--fl-muted-600);
  margin: var(--fl-sp-3) 0 0;
}

.fl-section {
  max-width: 880px; margin: 0 auto;
  padding: var(--fl-sp-10) var(--fl-sp-6);
}
.fl-section-h {
  font-size: var(--fl-type-2xl);
  color: var(--fl-navy-900);
  text-align: center;
  margin-bottom: var(--fl-sp-2);
}
.fl-section-sub {
  text-align: center; color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-8); font-size: var(--fl-type-md);
}

.fl-steps {
  display: grid; gap: var(--fl-sp-5);
  grid-template-columns: 1fr;
}
@media (min-width: 720px) {
  .fl-steps { grid-template-columns: repeat(3, 1fr); }
}
.fl-step {
  background: var(--fl-card-0);
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-lg);
  padding: var(--fl-sp-5);
  box-shadow: var(--fl-shadow-sm);
}
.fl-step-marker {
  margin-bottom: var(--fl-sp-3);
}
.fl-step-h {
  font-size: var(--fl-type-lg);
  color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-2);
}
.fl-step-body {
  color: var(--fl-muted-600);
  line-height: 1.5;
  font-size: var(--fl-type-base);
}

.fl-footer {
  border-top: 1px solid var(--fl-rule-200);
  background: var(--fl-card-0);
  padding: var(--fl-sp-8) var(--fl-sp-6);
}
.fl-footer-inner {
  max-width: 1080px; margin: 0 auto;
  display: flex; flex-wrap: wrap; gap: var(--fl-sp-5);
  align-items: center; justify-content: space-between;
}
.fl-footer-brand { color: var(--fl-muted-600); font-size: var(--fl-type-sm); }
.fl-footer-links { display: flex; gap: var(--fl-sp-5); list-style: none; }
.fl-footer-links a {
  color: var(--fl-ink-900); text-decoration: none; font-size: var(--fl-type-sm);
}
.fl-footer-links a:hover { color: var(--fl-navy-900); text-decoration: underline; }
.fl-sun-toggle {
  background: transparent;
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-pill);
  padding: var(--fl-sp-2) var(--fl-sp-4);
  font-size: var(--fl-type-sm);
  cursor: pointer;
  color: var(--fl-ink-900);
}
.fl-sun-toggle:hover { border-color: var(--fl-navy-900); }
`;

const FORM_SCRIPT = `
(function(){
  var form = document.getElementById('fl-magic-form');
  if (!form) return;
  var input = document.getElementById('cmms-email');
  var err = document.getElementById('fl-form-error');
  var success = document.getElementById('fl-form-success');
  var submit = document.getElementById('fl-magic-submit');
  var planInput = document.getElementById('cmms-plan');

  function setError(msg) {
    err.textContent = msg || '';
    if (msg) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  form.addEventListener('submit', async function(e) {
    e.preventDefault();
    setError('');
    var email = (input.value || '').trim();
    if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
      setError("That email doesn't look right — check it and try again");
      input.focus();
      return;
    }
    submit.disabled = true;
    var original = submit.textContent;
    submit.textContent = 'Sending…';
    var plan = planInput ? planInput.value : '';
    try {
      var r = await fetch('/api/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, plan: plan || undefined })
      });
      if (r.status === 429) {
        setError('You requested a link recently. Check your inbox or try again in a minute.');
      } else if (!r.ok) {
        var body = await r.json().catch(function(){return{};});
        setError(body.error || 'Something went wrong. Please try again.');
      } else {
        form.style.display = 'none';
        success.style.display = 'block';
      }
    } catch (_) {
      setError("Network error — please try again.");
    } finally {
      submit.disabled = false;
      submit.textContent = original;
    }
  });
})();
`;

function navbar(): string {
  return `<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    <a href="/" data-cta="cmms-nav-home">Home</a>
    <a href="/pricing" data-cta="cmms-nav-pricing">Pricing</a>
    <a href="/limitations" data-cta="cmms-nav-limitations">Limitations</a>
    <a href="/security" data-cta="cmms-nav-security">Security</a>
  </nav>
  <div></div>
</header>`;
}

const PLAN_LABELS: Record<string, { eyebrow: string; h1: string; sub: string }> = {
  mira: {
    eyebrow: "MIRA Troubleshooter — $97/mo",
    h1: "One workspace per asset. Cited answers at 2 AM.",
    sub: "You're signing up for MIRA Troubleshooter. Send yourself a magic link — no password, no demo call, no credit card.",
  },
  integrated: {
    eyebrow: "MIRA Integrated — $297/mo",
    h1: "MIRA + your CMMS. Work orders flow automatically.",
    sub: "You're signing up for MIRA Integrated. Send yourself a magic link — no password, no demo call, no credit card.",
  },
};

function hero(plan?: string): string {
  const copy = (plan ? PLAN_LABELS[plan] : undefined) ?? {
    eyebrow: "FactoryLM CMMS",
    h1: "One workspace per asset. Cited answers at 2 AM.",
    sub: "Send yourself a magic link. No password, no demo call, no credit card.",
  };
  const planHidden = plan
    ? `<input type="hidden" id="cmms-plan" name="plan" value="${plan}">`
    : `<input type="hidden" id="cmms-plan" name="plan" value="">`;
  return `<section class="fl-cmms-hero" aria-labelledby="fl-cmms-h1">
  <div class="fl-cmms-hero-inner">
    <p class="fl-cmms-eyebrow">${copy.eyebrow}</p>
    <h1 id="fl-cmms-h1" class="fl-cmms-h1">${copy.h1}</h1>
    <p class="fl-cmms-sub">${copy.sub}</p>

    <form id="fl-magic-form" class="fl-magic-form" novalidate>
      ${planHidden}
      <label for="cmms-email">Work email</label>
      <input
        id="cmms-email"
        name="email"
        type="email"
        required
        autocomplete="email"
        autofocus
        placeholder="you@yourcompany.com"
        aria-describedby="fl-form-error">
      ${btnPrimary("Send magic link", { type: "submit", cta: "cmms-magic-link-submit" })
        .replace("<button type=\"submit\"", "<button id=\"fl-magic-submit\" type=\"submit\"")}
      <p id="fl-form-error" class="fl-form-error" role="alert" aria-live="polite"></p>
    </form>

    <div id="fl-form-success" class="fl-form-success" role="status" style="display:none;">
      ✓ Check your inbox — your magic link is on its way (it expires in 10 minutes).
    </div>

    <p class="fl-reassurance">No credit card. No call. No demo.</p>
  </div>
</section>`;
}

function whatHappensNext(): string {
  return `<section class="fl-section" aria-labelledby="fl-steps-h">
  <h2 id="fl-steps-h" class="fl-section-h">What happens next.</h2>
  <p class="fl-section-sub">Three steps, all under five minutes.</p>
  <ol class="fl-steps" aria-label="Onboarding steps">
    <li class="fl-step">
      <div class="fl-step-marker">${stateBadge("indexed", "1 · Email arrives")}</div>
      <h3 class="fl-step-h">Click the magic link</h3>
      <p class="fl-step-body">A one-time link lands in your inbox in seconds. Single-use, expires in 10 minutes — so it's safe to forward to your phone.</p>
    </li>
    <li class="fl-step">
      <div class="fl-step-marker">${stateBadge("partial", "2 · Upload a manual")}</div>
      <h3 class="fl-step-h">Drop your first PDF</h3>
      <p class="fl-step-body">MIRA OCRs and indexes the manual. Document state goes from <em>partial</em> to <em>indexed</em>. You'll see the chunks counted live.</p>
    </li>
    <li class="fl-step">
      <div class="fl-step-marker">${stateBadge("indexed", "3 · Ask a question")}</div>
      <h3 class="fl-step-h">Get the cited answer</h3>
      <p class="fl-step-body">Type a fault code or symptom. MIRA answers from your manual with section citations — not generic web text.</p>
    </li>
  </ol>
</section>`;
}

function compareSection(): string {
  return `<section class="fl-section" aria-labelledby="fl-compare-h">
  <h2 id="fl-compare-h" class="fl-section-h">Why MIRA, not ChatGPT Projects.</h2>
  <p class="fl-section-sub">One real prompt. Two answers. You decide.</p>
  ${compareBlock(
    "Why is the Powerflex 755 tripping F005 at 1,200 RPM?",
    "ChatGPT Projects",
    "F005 is typically caused by undervoltage at the input or a brownout condition. Check incoming line voltage and confirm your PLC tag mapping.",
    "Generic — no plant context, no manual citation, no history.",
    "MIRA",
    "F005 on this drive (Asset POW-755-A12) means DC bus undervoltage. Last 7 days show 4 trips at the same RPM band, all overnight. Manual §6.2 says to check the bus capacitor bank — your 2024-12-14 PM noted bulging on cap 3.",
    ["Manual §6.2 (PowerFlex 755)", "PM 2024-12-14", "Trips: last 7 d"]
  )}
</section>`;
}

function footer(): string {
  return `<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM &middot; Built for industrial maintenance.</p>
    <ul class="fl-footer-links">
      <!-- TODO: /limitations page not yet built; link disabled until page exists -->
      <li><a href="/limitations" data-cta="cmms-footer-limitations">Limitations</a></li>
      <li><a href="/trust" data-cta="cmms-footer-trust">Trust</a></li>
      <li><a href="/privacy" data-cta="cmms-footer-privacy">Privacy</a></li>
      <li><a href="/terms" data-cta="cmms-footer-terms">Terms</a></li>
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle" aria-pressed="false" aria-label="Toggle high-contrast outdoor mode" data-cta="cmms-sun-toggle">☀ Sun-readable</button>
  </div>
</footer>`;
}

export function renderCmms(reqUrl?: string): string {
  const plan = reqUrl
    ? (new URL(reqUrl).searchParams.get("plan") ?? undefined)
    : undefined;
  const validPlan = plan && PLAN_LABELS[plan] ? plan : undefined;

  const headHtml = head(
    {
      title: "FactoryLM CMMS — sign in with a magic link",
      description:
        "Send yourself a one-time sign-in link. No password, no demo call, no credit card. Upload your first manual and ask MIRA a question.",
      canonical: "https://factorylm.com/cmms",
    },
    reqUrl
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${headHtml}
  <style>${PAGE_STYLES}</style>
</head>
<body>
  ${navbar()}
  <main>
    ${hero(validPlan)}
    ${whatHappensNext()}
    ${compareSection()}
  </main>
  ${footer()}
  <script>${FORM_SCRIPT}</script>
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

export function renderSamplePlaceholder(): string {
  const headHtml = head({
    title: "Your sample workspace — FactoryLM",
    description: "You're signed in. Upload your first manual to get started.",
    canonical: "https://factorylm.com/sample",
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${headHtml}
  <style>${PAGE_STYLES}
.fl-sample-card {
  max-width: 640px; margin: var(--fl-sp-10) auto;
  background: var(--fl-card-0); border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-lg); padding: var(--fl-sp-8);
  box-shadow: var(--fl-shadow-md); text-align: center;
}
.fl-sample-card h1 { color: var(--fl-navy-900); margin-bottom: var(--fl-sp-3); font-size: var(--fl-type-2xl); }
.fl-sample-card p  { color: var(--fl-muted-600); line-height: 1.55; margin-bottom: var(--fl-sp-5); }
.fl-sample-cta { display: flex; gap: var(--fl-sp-3); justify-content: center; flex-wrap: wrap; }
</style>
</head>
<body>
  ${navbar()}
  <main>
    <div class="fl-sample-card">
      <h1>You're signed in.</h1>
      <p>Your sample workspace will appear here once Phase 1 ships. For now, the fastest way to feel the product is to upload your first manual — MIRA will OCR it, chunk it, and let you ask questions with citations.</p>
      <div class="fl-sample-cta">
        ${btnPrimary("Upload your first manual", { href: "/activated", cta: "sample-upload" })}
        ${btnGhost("Back to home", { href: "/", cta: "sample-home" })}
      </div>
    </div>
  </main>
  ${footer()}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

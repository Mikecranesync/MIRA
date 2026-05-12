import { head } from "../lib/head.js";
import {
  btnPrimary,
  btnGhost,
  stateBadge,
  compareBlock,
} from "../lib/components.js";
import { navbar, footer } from "./_topbar.js";

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

const PLAN_LABELS: Record<string, { eyebrow: string; h1: string; sub: string }> = {
  mira: {
    eyebrow: "Operating Layer — $499/mo per plant",
    h1: "MIRA in production. On a structured namespace.",
    sub: "You're signing in to the Maintenance Operating Layer. Send yourself a magic link — no password, no demo call.",
  },
  integrated: {
    eyebrow: "Operating Layer + CMMS write-back",
    h1: "MIRA + your CMMS. Diagnostics become work orders.",
    sub: "You're signing in to the Operating Layer with CMMS sync. Send yourself a magic link — no password, no demo call.",
  },
};

function hero(plan?: string): string {
  const copy = (plan ? PLAN_LABELS[plan] : undefined) ?? {
    eyebrow: "Maintenance Operating Layer",
    h1: "Sign in to your Operating Layer.",
    sub: "One component of your maintenance transformation. Send yourself a magic link — no password, no demo call.",
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

    <p class="fl-cmms-buy-cta" style="margin-top:1.5rem;font-size:0.9rem;color:var(--text-dim,#888);">
      Ready to buy? ${btnGhost("View plans →", { href: "/buy", cta: "cmms-hero-buy" })}
    </p>

    <p class="fl-reassurance">No credit card. No call. No demo.</p>
  </div>
</section>`;
}

function whatHappensNext(): string {
  return `<section class="fl-section" aria-labelledby="fl-steps-h">
  <h2 id="fl-steps-h" class="fl-section-h">The Operating Layer is one component.</h2>
  <p class="fl-section-sub">It's where MIRA runs after we've structured your maintenance namespace. Most plants start with an Assessment, not here.</p>
  <ol class="fl-steps" aria-label="What the Operating Layer includes">
    <li class="fl-step">
      <div class="fl-step-marker">${stateBadge("indexed", "Asset registry")}</div>
      <h3 class="fl-step-h">Asset hierarchy + nameplates</h3>
      <p class="fl-step-body">Machines, sub-components, and the manuals bound to each. Captured during your pilot, maintained continuously.</p>
    </li>
    <li class="fl-step">
      <div class="fl-step-marker">${stateBadge("indexed", "Work orders + PMs")}</div>
      <h3 class="fl-step-h">CMMS write-back</h3>
      <p class="fl-step-body">PM schedules extracted from OEM manuals. Diagnostics from MIRA become work orders — synced to MaintainX, Limble, UpKeep, or Atlas.</p>
    </li>
    <li class="fl-step">
      <div class="fl-step-marker">${stateBadge("indexed", "Grounded AI")}</div>
      <h3 class="fl-step-h">MIRA on the floor</h3>
      <p class="fl-step-body">Telegram, Slack, web. Every answer cites your manuals, your fault history, your assets. No hallucinations because the namespace exists.</p>
    </li>
  </ol>
  <p style="text-align:center; margin-top: var(--fl-sp-6); color: var(--fl-muted-600); font-size: var(--fl-type-base);">
    New to FactoryLM? <a href="/buy" style="color: var(--fl-navy-900);">Start with a $500 Assessment →</a>
  </p>
</section>`;
}

function compareSection(): string {
  return `<section class="fl-section" aria-labelledby="fl-compare-h">
  <h2 id="fl-compare-h" class="fl-section-h">The namespace is the difference.</h2>
  <p class="fl-section-sub">Same prompt. Generic AI vs. AI running on a structured Maintenance Intelligence Namespace.</p>
  ${compareBlock(
    "Why is the Powerflex 755 tripping F005 at 1,200 RPM?",
    "Generic AI (no namespace)",
    "F005 is typically caused by undervoltage at the input or a brownout condition. Check incoming line voltage and confirm your PLC tag mapping.",
    "No plant context. No manual citation. No history. Hallucination risk.",
    "MIRA on your namespace",
    "F005 on this drive (Asset POW-755-A12) means DC bus undervoltage. Last 7 days show 4 trips at the same RPM band, all overnight. Manual §6.2 says to check the bus capacitor bank — your 2024-12-14 PM noted bulging on cap 3.",
    ["Manual §6.2 (PowerFlex 755)", "PM 2024-12-14", "Trips: last 7 d"]
  )}
</section>`;
}

export function renderCmms(reqUrl?: string): string {
  const plan = reqUrl
    ? (new URL(reqUrl).searchParams.get("plan") ?? undefined)
    : undefined;
  const validPlan = plan && PLAN_LABELS[plan] ? plan : undefined;

  const headHtml = head(
    {
      title: "Maintenance Operating Layer — FactoryLM",
      description:
        "Sign in to the Operating Layer where MIRA runs on your structured Maintenance Intelligence Namespace. One component of the broader transformation.",
      canonical: "https://factorylm.com/cmms",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "@id": "https://factorylm.com/cmms#app",
        name: "FactoryLM Maintenance Operating Layer",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: "https://factorylm.com/cmms",
        description: "The Operating Layer is where MIRA — FactoryLM's AI execution layer — runs on a structured Maintenance Intelligence Namespace. Asset registry, work orders, PM scheduling, and grounded AI answers from cited OEM documentation.",
        offers: {
          "@type": "Offer",
          name: "Operating Layer",
          price: "499",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", unitText: "per plant per month" },
          url: "https://factorylm.com/buy",
        },
        publisher: { "@id": "https://factorylm.com/#org" },
      },
    },
    reqUrl
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${headHtml}
  <link rel="stylesheet" href="/_dark-theme.css">
  <style>${PAGE_STYLES}</style>
</head>
<body>
  ${navbar({ currentPath: "/cmms", ctaPrefix: "cmms" })}
  <main>
    ${hero(validPlan)}
    ${whatHappensNext()}
    ${compareSection()}
  </main>
  ${footer({ ctaPrefix: "cmms" })}
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
  <link rel="stylesheet" href="/_dark-theme.css">
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
  ${navbar({ currentPath: "/sample", ctaPrefix: "sample" })}
  <main>
    <div class="fl-sample-card">
      <h1>You're signed in.</h1>
      <p>Your sample workspace will appear here once Phase 1 ships. For now, the fastest way to feel the product is to upload your first manual — MIRA will OCR it, chunk it, and let you ask questions with citations.</p>
      <div class="fl-sample-cta">
        <a id="cmms-btn" href="#" class="fl-btn fl-btn-primary" data-cta="sample-cmms" style="display:none">Open CMMS</a>
        ${btnPrimary("Upload your first manual", { href: "/activated", cta: "sample-upload" })}
        ${btnGhost("Back to home", { href: "/", cta: "sample-home" })}
      </div>
    </div>
  </main>
  ${footer({ ctaPrefix: "sample" })}
  <script src="/sun-toggle.js"></script>
  <script>
    (function () {
      var params = new URLSearchParams(location.search);
      var token = params.get('token');
      if (token) {
        sessionStorage.setItem('flm_token', token);
        history.replaceState(null, '', '/sample');
      } else {
        token = sessionStorage.getItem('flm_token');
      }
      if (token) {
        var btn = document.getElementById('cmms-btn');
        if (btn) {
          btn.href = '/api/cmms/login?token=' + encodeURIComponent(token);
          btn.style.display = '';
        }
      }
    })();
  </script>
</body>
</html>`;
}

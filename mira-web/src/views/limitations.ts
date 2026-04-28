import { head } from "../lib/head.js";
import { btnPrimary, btnGhost } from "../lib/components.js";

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
.fl-topbar-nav a[aria-current="page"] { color: var(--fl-navy-900); font-weight: 600; }
.fl-topbar-nav a:hover { color: var(--fl-navy-900); text-decoration: underline; }

.fl-lim-hero {
  padding: var(--fl-sp-10) var(--fl-sp-6) var(--fl-sp-8);
  background: linear-gradient(180deg, var(--fl-sky-100) 0%, var(--fl-bg-50) 100%);
  text-align: center;
}
.fl-lim-hero-inner { max-width: 720px; margin: 0 auto; }
.fl-lim-eyebrow {
  text-transform: uppercase;
  letter-spacing: var(--fl-ls-caps);
  font-size: var(--fl-type-xs);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-3);
}
.fl-lim-h1 {
  font-size: var(--fl-type-3xl);
  letter-spacing: var(--fl-ls-tight);
  color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-3);
  line-height: 1.2;
}
.fl-lim-sub {
  font-size: var(--fl-type-md);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-2);
  line-height: 1.6;
}

.fl-lim-section {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--fl-sp-8) var(--fl-sp-6);
}
.fl-lim-section + .fl-lim-section {
  border-top: 1px solid var(--fl-rule-200);
}
.fl-lim-section-h2 {
  font-size: var(--fl-type-xl);
  color: var(--fl-navy-900);
  letter-spacing: var(--fl-ls-tight);
  margin-bottom: var(--fl-sp-5);
}

.fl-limits-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--fl-sp-5);
}
.fl-limits-list li {
  line-height: 1.6;
  font-size: var(--fl-type-base);
  color: var(--fl-ink-900);
}
.fl-limits-list strong {
  color: var(--fl-navy-900);
}
.fl-limits-list .fl-roadmap-pill {
  display: inline-block;
  font-size: var(--fl-type-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: var(--fl-ls-caps);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--fl-sky-100);
  color: var(--fl-navy-900);
  margin-left: var(--fl-sp-2);
  vertical-align: middle;
}

.fl-lim-cta {
  text-align: center;
  padding: var(--fl-sp-8) var(--fl-sp-6);
  background: var(--fl-bg-50);
  border-top: 1px solid var(--fl-rule-200);
}
.fl-lim-cta p {
  font-size: var(--fl-type-sm);
  color: var(--fl-muted-600);
  margin-top: var(--fl-sp-4);
  line-height: 1.6;
}
.fl-lim-cta a {
  color: var(--fl-navy-900);
  text-decoration: underline;
}

.fl-footer {
  background: var(--fl-card-0);
  border-top: 1px solid var(--fl-rule-200);
  padding: var(--fl-sp-5) var(--fl-sp-6);
}
.fl-footer-inner {
  max-width: 720px; margin: 0 auto;
  display: flex; flex-wrap: wrap; align-items: center;
  justify-content: space-between; gap: var(--fl-sp-4);
}
.fl-footer-brand { color: var(--fl-muted-600); font-size: var(--fl-type-sm); }
.fl-footer-links { display: flex; gap: var(--fl-sp-5); list-style: none; }
.fl-footer-links a {
  color: var(--fl-muted-600); text-decoration: none; font-size: var(--fl-type-sm);
}
.fl-footer-links a:hover { color: var(--fl-navy-900); text-decoration: underline; }
.fl-sun-toggle {
  font-size: var(--fl-type-xs); padding: 4px 10px;
  border: 1px solid var(--fl-rule-200); border-radius: var(--fl-radius-md);
  background: transparent; color: var(--fl-muted-600); cursor: pointer;
}
.fl-sun-toggle:hover { border-color: var(--fl-navy-900); }

@media (max-width: 640px) {
  .fl-topbar-nav { display: none; }
  .fl-lim-h1 { font-size: var(--fl-type-2xl); }
}
`;

function navbar(): string {
  return `<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    <a href="/cmms" data-cta="lim-nav-cmms">CMMS</a>
    <a href="/pricing" data-cta="lim-nav-pricing">Pricing</a>
    <a href="/blog" data-cta="lim-nav-blog">Blog</a>
    <a href="/limitations" data-cta="lim-nav-limitations" aria-current="page">Limitations</a>
  </nav>
  <div class="fl-topbar-cta">
    ${btnGhost("Sign in", { href: "/cmms", cta: "lim-nav-signin" })}
  </div>
</header>`;
}

function footer(): string {
  return `<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM &middot; Built for industrial maintenance.</p>
    <ul class="fl-footer-links">
      <li><a href="/limitations" data-cta="lim-footer-limitations">Limitations</a></li>
      <li><a href="/trust" data-cta="lim-footer-trust">Trust</a></li>
      <li><a href="/privacy" data-cta="lim-footer-privacy">Privacy</a></li>
      <li><a href="/terms" data-cta="lim-footer-terms">Terms</a></li>
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle" aria-pressed="false" aria-label="Toggle high-contrast outdoor mode" data-cta="sun-toggle">☀ Sun-readable</button>
  </div>
</footer>`;
}

const LIMITS = [
  {
    lead: "Not a CMMS replacement.",
    body: "MIRA sits on top of your existing work order system. It reads context and suggests actions — it does not replace MaintainX, Limble, UpKeep, or your in-house CMMS. Atlas (our own CMMS) is included if you have nothing, not as a mandate.",
  },
  {
    lead: "MIRA cannot diagnose what it doesn't know.",
    body: "If you haven't uploaded an OEM manual, fault history, or equipment notes for an asset, MIRA has no context to reason from. Answers improve linearly with what you feed it. \"I don't have enough context\" is an honest answer, not a bug.",
  },
  {
    lead: "Answer quality depends on document quality.",
    body: "Hand-drawn diagrams, severely degraded scans, and machine-translated PDFs reduce accuracy. We tell you when OCR confidence is low. Properly structured OEM manuals in English produce the best results.",
  },
  {
    lead: "Safety-critical questions escalate — they don't get a chat answer.",
    body: "LOTO, arc flash, confined space, and similar high-consequence procedures trigger an immediate escalation to your designated safety contact. MIRA does not replace professional engineering judgment where lives are at risk.",
  },
  {
    lead: "No PLC tag streaming yet.",
    body: "Modbus TCP, OPC UA, and EtherNet-IP integration is on the post-MVP roadmap (Config 4). Today, MIRA works from uploaded documents and typed context — not live sensor feeds.",
    roadmap: true,
  },
  {
    lead: "No native mobile apps.",
    body: "The progressive web app (PWA) and Telegram/Slack bots cover the vast majority of plant-floor use today. A native iOS/Android app is planned but not yet available.",
    roadmap: true,
  },
  {
    lead: "English-language manuals only.",
    body: "We don't translate manuals between languages yet. OCR and RAG pipelines are optimized for English. Multi-language support is on the roadmap.",
    roadmap: true,
  },
  {
    lead: "Multi-tenant isolation is enforced in code — not yet SOC 2 audited.",
    body: "Row-level security via PostgreSQL RLS isolates tenant data. We have not yet had a third-party SOC 2 audit. We are pre-revenue and pre-audit. Enterprise compliance packages are planned for 2026 Q3.",
  },
  {
    lead: "Knowledge Cooperative data is anonymized — but requires Community tier.",
    body: "Participating in the shared fault pattern network requires opt-in on Community tier or above. Data is anonymized before contribution. Free-tier tenants benefit from the cooperative but do not contribute.",
  },
  {
    lead: "RCA workflow is in private alpha.",
    body: "FactoryLM Investigations (root cause analysis timelines) exists in design and private alpha as of April 2026. It is not available in the standard product yet.",
    roadmap: true,
  },
  {
    lead: "Voice input degrades in high-noise environments.",
    body: "Voice capture works via phone microphone. Quality drops significantly above 100 dB. Typed input is always available as a fallback.",
  },
  {
    lead: "Dashboards are limited.",
    body: "Today MIRA surfaces chat answers, cited documents, and work-order summaries. Full analytics dashboards, trend charts, and KPI reporting are on the product roadmap but not yet shipped.",
    roadmap: true,
  },
];

export function renderLimitations(reqUrl?: string): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "AboutPage",
    "name": "What FactoryLM doesn't do (yet)",
    "description": "An honest list of what's missing from FactoryLM — current as of 2026-04. We'd rather you know upfront.",
    "url": "https://factorylm.com/limitations",
    "publisher": {
      "@type": "Organization",
      "name": "FactoryLM",
      "url": "https://factorylm.com",
    },
  };

  const limitItems = LIMITS.map(({ lead, body, roadmap }) => `
    <li>
      <strong>${lead}</strong>${roadmap ? ' <span class="fl-roadmap-pill">On roadmap</span>' : ''} ${body}
    </li>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${head(
    {
      title: "What FactoryLM doesn't do (yet) — Limitations",
      description: "An honest list of what's missing from FactoryLM — current as of 2026-04. We'd rather you know upfront.",
      canonical: "https://factorylm.com/limitations",
      ogTitle: "What FactoryLM doesn't do (yet)",
      ogDescription: "An honest list of what's missing — we'd rather you know upfront than be surprised on day 7.",
      jsonLd,
    },
    reqUrl,
  )}
  <style>${PAGE_STYLES}</style>
</head>
<body>
  ${navbar()}

  <section class="fl-lim-hero">
    <div class="fl-lim-hero-inner">
      <p class="fl-lim-eyebrow">Honest by design</p>
      <h1 class="fl-lim-h1">What FactoryLM doesn't do (yet)</h1>
      <p class="fl-lim-sub">We'd rather you know upfront than be surprised on day 7.</p>
    </div>
  </section>

  <div class="fl-lim-section">
    <h2 class="fl-lim-section-h2">Current limitations</h2>
    <ul class="fl-limits-list">
      ${limitItems}
    </ul>
  </div>

  <div class="fl-lim-cta">
    ${btnPrimary("Try it free — no credit card", { href: "/cmms", cta: "lim-cta-try" })}
    <p>
      Spotted something we're not honest about?
      <a href="mailto:mike@factorylm.com">Email mike@factorylm.com</a> — we'll add it.
    </p>
  </div>

  ${footer()}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

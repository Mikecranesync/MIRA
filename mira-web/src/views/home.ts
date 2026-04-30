import { head } from "../lib/head.js";
import {
  btnPrimary,
  btnGhost,
  trustBand,
  compareBlock,
  stateBadge,
  stopCard,
} from "../lib/components.js";

const OEMS = [
  "Allen-Bradley",
  "Siemens",
  "ABB",
  "Schneider Electric",
  "Yaskawa",
  "Mitsubishi",
  "Rockwell",
  "Honeywell",
];

const ORG_AND_SITE_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://factorylm.com/#org",
      name: "FactoryLM",
      url: "https://factorylm.com/",
      logo: "https://factorylm.com/icons/favicon.svg",
      sameAs: [
        "https://github.com/Mikecranesync",
        "https://www.linkedin.com/company/factorylm",
      ],
      founder: {
        "@type": "Person",
        "@id": "https://factorylm.com/#mike",
        name: "Mike Harper",
        jobTitle: "Founder",
        worksFor: { "@id": "https://factorylm.com/#org" },
      },
    },
    {
      "@type": "WebSite",
      "@id": "https://factorylm.com/#website",
      url: "https://factorylm.com/",
      name: "FactoryLM",
      publisher: { "@id": "https://factorylm.com/#org" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://factorylm.com/#app",
      name: "MIRA — Maintenance Intelligence & Resource Assistant",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Telegram, Slack",
      url: "https://factorylm.com/",
      description: "AI-native workspace for industrial maintenance. Answers fault-code questions with cited sources from 68,000+ OEM documentation chunks. Safety keywords escalate to humans. No per-seat fees.",
      offers: [
        {
          "@type": "Offer",
          name: "MIRA Troubleshooter",
          price: "97",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", unitText: "per plant per month" },
          url: "https://factorylm.com/pricing",
        },
        {
          "@type": "Offer",
          name: "MIRA Integrated",
          price: "297",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", unitText: "per plant per month" },
          url: "https://factorylm.com/pricing",
        },
      ],
      publisher: { "@id": "https://factorylm.com/#org" },
    },
  ],
};

function hero(): string {
  return `<section class="fl-hero" aria-labelledby="fl-hero-h1">
  <div class="fl-hero-inner">
    <p class="fl-hero-eyebrow">Industrial Maintenance, AI-native</p>
    <h1 id="fl-hero-h1" class="fl-hero-h1">FactoryLM</h1>
    <h2 class="fl-hero-h2">The AI workspace for industrial maintenance.</h2>
    <h3 class="fl-hero-h3">Meet <strong>MIRA</strong> — your agent on the floor.</h3>
    <p class="fl-hero-sub">Manuals, sensors, photos, work orders, investigations — organized into Projects. MIRA answers from cited sources at 2&nbsp;AM, when you scan the QR sticker on a broken machine.</p>
    <div class="fl-hero-cta">
      ${btnPrimary("Start Free — magic link", { href: "/cmms", cta: "hero-primary" })}
      ${btnGhost("See pricing →", { href: "/pricing", cta: "hero-secondary" })}
    </div>
    <div class="fl-hero-screenshot" aria-hidden="true">
      <img
        src="/images/app-screenshot-desktop.png"
        alt="MIRA work orders screen showing auto-generated maintenance tasks"
        class="fl-hero-screenshot-img"
        width="1280"
        height="800"
        loading="lazy"
        decoding="async"
      >
    </div>
  </div>
</section>`;
}

function projectCardRow(): string {
  const cards = [
    {
      kind: "Asset",
      title: "Asset Project",
      body: "One workspace per machine. Manuals, fault history, photos, sensor curves — all cited.",
      glyph: "🛠",
    },
    {
      kind: "Crew",
      title: "Crew Project",
      body: "Daily standups, hand-offs, training notes. The shift's brain, persistent across people.",
      glyph: "👷",
    },
    {
      kind: "Investigation",
      title: "Investigation Project",
      body: "RCA threads with timeline, evidence, signed PDF. Closes when the story holds up.",
      glyph: "🔬",
    },
  ];
  const cardsHtml = cards
    .map(
      (c) => `<article class="fl-project-card" aria-label="${c.kind} Project">
    <div class="fl-project-card-glyph" aria-hidden="true">${c.glyph}</div>
    <h3 class="fl-project-card-h">${c.title}</h3>
    <p class="fl-project-card-body">${c.body}</p>
  </article>`
    )
    .join("\n  ");
  return `<section class="fl-section" aria-labelledby="fl-projects-h">
  <h2 id="fl-projects-h" class="fl-section-h">Three kinds of Projects.</h2>
  <p class="fl-section-sub">Pick what fits the work. Mix and match across plants.</p>
  <div class="fl-project-row">
  ${cardsHtml}
  </div>
</section>`;
}

function compareSection(): string {
  return `<section class="fl-section" aria-labelledby="fl-compare-h">
  <h2 id="fl-compare-h" class="fl-section-h">MIRA vs. ChatGPT Projects.</h2>
  <p class="fl-section-sub">Same question. Different ground truth.</p>
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

function featureStrip(): string {
  const stopHtml = stopCard(
    "Voltage above safe range",
    "MIRA detected 480 V on a 240 V branch via the photo you sent at 02:14. Do not energize. Verify with a meter before any next step.",
    [
      { label: "Acknowledge", href: "#" },
      { label: "Call supervisor", href: "#" },
    ]
  );
  return `<section class="fl-section fl-feature-strip" aria-labelledby="fl-feature-h">
  <h2 id="fl-feature-h" class="fl-section-h">Built for the floor.</h2>
  <p class="fl-section-sub">Every document gets a state. Every safety signal gets a stop.</p>
  <div class="fl-feature-grid">
    <div class="fl-state-row" role="group" aria-label="Document states">
      ${stateBadge("indexed")}
      ${stateBadge("partial")}
      ${stateBadge("failed")}
      ${stateBadge("superseded")}
    </div>
    <div class="fl-feature-stop">
      ${stopHtml}
    </div>
  </div>
</section>`;
}

function pricingTeaser(): string {
  return `<section class="fl-section fl-pricing-teaser" aria-labelledby="fl-pricing-h">
  <h2 id="fl-pricing-h" class="fl-section-h">Site license. Not per-seat.</h2>
  <p class="fl-section-sub">$97/mo per plant. $497/mo with auto-RCA + signed PDF.</p>
  <div class="fl-hero-cta">
    ${btnPrimary("See pricing", { href: "/pricing", cta: "pricing-teaser-primary" })}
    ${btnGhost("Talk to Mike", { href: "mailto:mike@factorylm.com", cta: "pricing-teaser-secondary" })}
  </div>
</section>`;
}

function navbar(): string {
  return `<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    <a href="/cmms" data-cta="nav-cmms">CMMS</a>
    <a href="/pricing" data-cta="nav-pricing">Pricing</a>
    <a href="/blog" data-cta="nav-blog">Blog</a>
    <a href="/limitations" data-cta="nav-limitations">Limitations</a>
    <a href="/security" data-cta="nav-security">Security</a>
  </nav>
  <div class="fl-topbar-cta">
    ${btnGhost("Sign in", { href: "/cmms", cta: "nav-signin" })}
  </div>
</header>`;
}

function footer(): string {
  return `<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM &middot; Built for industrial maintenance.</p>
    <ul class="fl-footer-links">
      <li><a href="/limitations" data-cta="footer-limitations">Limitations</a></li>
      <li><a href="/trust" data-cta="footer-trust">Trust</a></li>
      <li><a href="/privacy" data-cta="footer-privacy">Privacy</a></li>
      <li><a href="/terms" data-cta="footer-terms">Terms</a></li>
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle" aria-pressed="false" aria-label="Toggle high-contrast outdoor mode" data-cta="sun-toggle">☀ Sun-readable</button>
  </div>
</footer>`;
}

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

.fl-hero {
  padding: var(--fl-sp-10) var(--fl-sp-6);
  background: linear-gradient(180deg, var(--fl-sky-100) 0%, var(--fl-bg-50) 100%);
  text-align: center;
}
.fl-hero-inner { max-width: 880px; margin: 0 auto; }
.fl-hero-eyebrow {
  text-transform: uppercase;
  letter-spacing: var(--fl-ls-caps);
  font-size: var(--fl-type-xs);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-4);
}
.fl-hero-h1 {
  font-size: var(--fl-type-4xl);
  letter-spacing: var(--fl-ls-tight);
  color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-2);
}
.fl-hero-h2 {
  font-size: var(--fl-type-3xl);
  letter-spacing: var(--fl-ls-tight);
  color: var(--fl-ink-900);
  font-weight: 500;
  margin-bottom: var(--fl-sp-2);
}
.fl-hero-h3 {
  font-size: var(--fl-type-xl);
  color: var(--fl-orange-600);
  font-weight: 500;
  margin-bottom: var(--fl-sp-5);
}
.fl-hero-sub {
  font-size: var(--fl-type-md);
  color: var(--fl-muted-600);
  max-width: 720px;
  margin: 0 auto var(--fl-sp-8);
  line-height: 1.55;
}
.fl-hero-cta {
  display: flex; gap: var(--fl-sp-4); justify-content: center; flex-wrap: wrap;
}

.fl-section {
  max-width: 1080px; margin: 0 auto;
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

.fl-project-row {
  display: grid; gap: var(--fl-sp-5);
  grid-template-columns: 1fr;
}
@media (min-width: 720px) {
  .fl-project-row { grid-template-columns: repeat(3, 1fr); }
}
.fl-project-card {
  background: var(--fl-card-0);
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-lg);
  padding: var(--fl-sp-6);
  box-shadow: var(--fl-shadow-sm);
}
.fl-project-card-glyph { font-size: var(--fl-type-3xl); margin-bottom: var(--fl-sp-3); }
.fl-project-card-h {
  font-size: var(--fl-type-lg); color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-2);
}
.fl-project-card-body { color: var(--fl-muted-600); line-height: 1.5; }

.fl-feature-grid {
  display: grid; gap: var(--fl-sp-6);
  grid-template-columns: 1fr;
}
@media (min-width: 880px) {
  .fl-feature-grid { grid-template-columns: 1fr 1fr; align-items: center; }
}
.fl-state-row {
  display: flex; flex-wrap: wrap; gap: var(--fl-sp-3);
  justify-content: center;
}

.fl-hero-screenshot {
  margin-top: var(--fl-sp-10);
  border-radius: var(--fl-radius-lg);
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.18), 0 4px 16px rgba(0,0,0,0.10);
  border: 1px solid var(--fl-rule-200);
  max-width: 960px;
  margin-left: auto;
  margin-right: auto;
}
.fl-hero-screenshot-img {
  display: block;
  width: 100%;
  height: auto;
}

.fl-pricing-teaser { text-align: center; }

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

export function renderHome(reqUrl?: string): string {
  const headHtml = head(
    {
      title: "FactoryLM — AI Workspace for Industrial Maintenance",
      description:
        "Manuals, sensors, photos, work orders — one workspace per asset. MIRA answers at 2 AM with cited sources. Free trial.",
      canonical: "https://factorylm.com/",
      ogImage: "https://factorylm.com/og-image.png",
      jsonLd: ORG_AND_SITE_LD,
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
    ${hero()}
    ${trustBand("68,000+ chunks of OEM documentation indexed", OEMS)}
    ${projectCardRow()}
    ${compareSection()}
    ${featureStrip()}
    ${pricingTeaser()}
  </main>
  ${footer()}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

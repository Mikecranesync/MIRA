import { head } from "../lib/head.js";
import {
  btnPrimary,
  btnGhost,
  trustBand,
  compareBlock,
  stateBadge,
  stopCard,
} from "../lib/components.js";
import { navbar, footer } from "./_topbar.js";

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
      description: "FactoryLM is a maintenance digital transformation firm. We map your assets, manuals, PLC context, and technician knowledge into a structured Maintenance Intelligence Namespace. MIRA — our AI execution layer — runs on top.",
      offers: [
        {
          "@type": "Offer",
          name: "Maintenance Assessment",
          price: "500",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", unitText: "one-time" },
          url: "https://factorylm.com/buy",
        },
        {
          "@type": "Offer",
          name: "Pilot — One-Line Transformation",
          price: "2000",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", unitText: "per month, 3-month minimum" },
          url: "https://factorylm.com/buy",
        },
        {
          "@type": "Offer",
          name: "Operating Layer",
          price: "499",
          priceCurrency: "USD",
          priceSpecification: { "@type": "UnitPriceSpecification", unitText: "per plant per month" },
          url: "https://factorylm.com/buy",
        },
      ],
      publisher: { "@id": "https://factorylm.com/#org" },
    },
  ],
};

function hero(): string {
  return `<section class="fl-hero" aria-labelledby="fl-hero-h1">
  <div class="fl-hero-inner">
    <p class="fl-hero-eyebrow">Maintenance Digital Transformation</p>
    <h1 id="fl-hero-h1" class="fl-hero-h1">FactoryLM</h1>
    <h2 class="fl-hero-h2">Turn your maintenance reality into AI-ready infrastructure.</h2>
    <h3 class="fl-hero-h3">Then <strong>MIRA</strong> makes it actionable.</h3>
    <p class="fl-hero-sub">Your manuals are in filing cabinets. Your fault history is in someone's head. Your PLC tags don't match your asset names. AI can't help until that's structured. We do the structuring — then MIRA runs on top.</p>
    <div class="fl-hero-cta">
      ${btnPrimary("Try MIRA Free →", { href: "/signup", cta: "hero-signup" })}
      ${btnGhost("Book a demo", { href: "/buy", cta: "hero-buy-secondary" })}
    </div>
    <p class="fl-hero-cta-foot">7-day free trial, no credit card. Or book a $500 in-person assessment and skip the trial.</p>
    <div class="fl-hero-screenshot" aria-hidden="true">
      <img
        src="/images/hero-fault-lookup-cartoon.jpg"
        alt="Comic split-panel: on the left, a plant's maintenance world is chaos — manuals in filing cabinets, mismatched PLC tags, tribal knowledge on a whiteboard. On the right, the same plant after structuring — assets named, manuals indexed, MIRA answering a question with citations."
        class="fl-hero-screenshot-img"
        width="1400"
        height="800"
        loading="eager"
        fetchpriority="high"
        decoding="async"
      >
    </div>
  </div>
</section>`;
}

function projectCardRow(): string {
  const cards = [
    {
      kind: "Assessment",
      title: "1. Assessment — $500",
      body: "We walk your floor (in person or remote). Score your Maintenance AI Readiness. Deliver a written gap report and a namespace blueprint. Takes 1 day.",
      glyph: "📋",
    },
    {
      kind: "Pilot",
      title: "2. Pilot — $2–5K/mo",
      body: "We structure one line: nameplates scanned, manuals indexed, PLC tags mapped, PMs extracted, fault history captured. MIRA goes live on that scope. 3-month minimum.",
      glyph: "🛠",
    },
    {
      kind: "Operating Layer",
      title: "3. Operating Layer — $499/mo",
      body: "MIRA in production across the plant. Telegram + web + CMMS write-back. Quarterly namespace audits. Continuous structuring as new assets come online.",
      glyph: "⚙️",
    },
  ];
  const cardsHtml = cards
    .map(
      (c) => `<article class="fl-project-card" aria-label="${c.kind}">
    <div class="fl-project-card-glyph" aria-hidden="true">${c.glyph}</div>
    <h3 class="fl-project-card-h">${c.title}</h3>
    <p class="fl-project-card-body">${c.body}</p>
  </article>`
    )
    .join("\n  ");
  return `<section class="fl-section" aria-labelledby="fl-projects-h">
  <h2 id="fl-projects-h" class="fl-section-h">Three ways we work with you.</h2>
  <p class="fl-section-sub">Start with the assessment. Most plants don't need everything at once.</p>
  <div class="fl-project-row">
  ${cardsHtml}
  </div>
</section>`;
}

function compareSection(): string {
  return `<section class="fl-section" aria-labelledby="fl-compare-h">
  <h2 id="fl-compare-h" class="fl-section-h">Why generic AI fails on the floor.</h2>
  <p class="fl-section-sub">Same question. The difference is whether your maintenance world has been structured.</p>
  ${compareBlock(
    "Why is the Powerflex 755 tripping F005 at 1,200 RPM?",
    "Generic AI (no namespace)",
    "F005 is typically caused by undervoltage at the input or a brownout condition. Check incoming line voltage and confirm your PLC tag mapping.",
    "No plant context. No manual citation. No history. Hallucination risk.",
    "MIRA (on a structured namespace)",
    "F005 on this drive (Asset POW-755-A12) means DC bus undervoltage. Last 7 days show 4 trips at the same RPM band, all overnight. Manual §6.2 says to check the bus capacitor bank — your 2024-12-14 PM noted bulging on cap 3.",
    ["Manual §6.2 (PowerFlex 755)", "PM 2024-12-14", "Trips: last 7 d"]
  )}
</section>`;
}

function cartoonRow(): string {
  // Three placeholder divs that feature-cartoons.js mounts SVG demos into.
  // The script self-installs styles for `.cartoon-demo` and child classes.
  // Lede copy is intentionally short — the cartoons carry the storytelling.
  const cells = [
    {
      id: "cartoon-fd",
      heading: "Structured asset hierarchy",
      lede: "Machine → sub-component → motor → relay. Every nameplate scanned, every manual bound to the asset it serves.",
      label: "Asset hierarchy demonstration",
    },
    {
      id: "cartoon-cmms",
      heading: "PLC tags reconciled to assets",
      lede: "LINE3_VFD1_CURRENT now knows it lives on Asset POW-755-A12. AI can finally cross the IT/OT gap.",
      label: "PLC tag reconciliation demonstration",
    },
    {
      id: "cartoon-vv",
      heading: "Tribal knowledge captured",
      lede: "Senior tech's voice notes become structured RCA records. The 30-year fault history doesn't retire with them.",
      label: "Tribal knowledge capture demonstration",
    },
  ];
  const cellsHtml = cells
    .map(
      (c) => `<div class="fl-cartoon-cell">
    <h3 class="fl-cartoon-h">${c.heading}</h3>
    <p class="fl-cartoon-lede">${c.lede}</p>
    <div id="${c.id}" class="cartoon-demo" role="region" aria-label="${c.label}" tabindex="0"></div>
  </div>`
    )
    .join("\n  ");
  return `<section class="fl-section fl-cartoons" aria-labelledby="fl-cartoons-h">
  <h2 id="fl-cartoons-h" class="fl-section-h">What we structure during a pilot.</h2>
  <p class="fl-section-sub">The Maintenance Intelligence Namespace — the foundation AI needs.</p>
  <div class="fl-cartoon-row">
  ${cellsHtml}
  </div>
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
  <h2 id="fl-pricing-h" class="fl-section-h">Start with a $500 assessment.</h2>
  <p class="fl-section-sub">We come to your floor. You leave with a gap report and a namespace blueprint. No software demo. No AI hype.</p>
  <div class="fl-hero-cta">
    ${btnPrimary("Book Your Assessment", { href: "/buy", cta: "pricing-teaser-primary" })}
    ${btnGhost("Talk to Mike", { href: "mailto:mike@factorylm.com", cta: "pricing-teaser-secondary" })}
  </div>
</section>`;
}

const PAGE_STYLES = `
/* Page-specific styles for the home view. Dark theme tokens are
   inherited from /_dark-theme.css (linked from <head>) so this block
   only carries layout and typography rules unique to the home page. */

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
.fl-hero-cta-foot {
  text-align: center;
  font-size: var(--fl-type-xs);
  color: var(--fl-muted-600);
  margin-top: var(--fl-sp-3);
}

/* Mobile sticky CTA — visible only ≤720px so it doesn't double up with the
   above-the-fold buttons on desktop. Bottom-anchored, full-width minus a
   small inset, large tap target. Hidden when JS isn't present is fine —
   it's a plain anchor, no script required. */
.fl-mobile-cta {
  display: none;
}
@media (max-width: 720px) {
  .fl-mobile-cta {
    display: block;
    position: fixed;
    left: var(--fl-sp-4);
    right: var(--fl-sp-4);
    bottom: var(--fl-sp-4);
    z-index: 50;
    background: var(--fl-orange-600);
    color: #fff;
    text-align: center;
    text-decoration: none;
    font-weight: 600;
    font-size: var(--fl-type-base);
    padding: var(--fl-sp-4) var(--fl-sp-5);
    border-radius: var(--fl-radius-pill);
    box-shadow: 0 8px 24px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.10);
  }
  .fl-mobile-cta:active { transform: translateY(1px); }
  /* Bottom-page padding so the sticky CTA doesn't sit on top of the footer */
  body { padding-bottom: 72px; }
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

.fl-cartoon-row {
  display: grid; gap: var(--fl-sp-6);
  grid-template-columns: 1fr;
}
@media (min-width: 880px) {
  .fl-cartoon-row { grid-template-columns: repeat(3, 1fr); }
}
.fl-cartoon-cell {
  display: flex; flex-direction: column; gap: var(--fl-sp-2);
}
.fl-cartoon-h {
  font-size: var(--fl-type-lg);
  color: var(--fl-navy-900);
  margin: 0;
}
.fl-cartoon-lede {
  color: var(--fl-muted-600);
  font-size: var(--fl-type-base);
  line-height: 1.5;
  margin: 0 0 var(--fl-sp-2);
}
@media (min-width: 880px) {
  /* Keep cartoon top edges aligned even when ledes wrap differently */
  .fl-cartoon-lede { min-height: 3.5em; }
}

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
      title: "FactoryLM — Maintenance Digital Transformation",
      description:
        "We turn messy maintenance reality — manuals in filing cabinets, mismatched PLC tags, tribal knowledge — into a structured Maintenance Intelligence Namespace. Then MIRA, our AI execution layer, makes it actionable. $500 assessment to start.",
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
  <link rel="stylesheet" href="/_dark-theme.css">
  <style>${PAGE_STYLES}</style>
</head>
<body>
  ${navbar({ currentPath: "/" })}
  <main>
    ${hero()}
    ${trustBand("68,000+ chunks of OEM documentation indexed", OEMS)}
    ${projectCardRow()}
    ${compareSection()}
    ${cartoonRow()}
    ${featureStrip()}
    ${pricingTeaser()}
  </main>
  ${footer()}
  <a href="/signup" class="fl-mobile-cta" data-cta="mobile-sticky-signup">Try MIRA Free →</a>
  <script src="/sun-toggle.js"></script>
  <script src="/feature-cartoons.js" defer></script>
</body>
</html>`;
}

import { head } from "../lib/head.js";
import { btnPrimary } from "../lib/components.js";
import { navbar, footer, TALK_TO_MIKE_HREF } from "./_topbar.js";

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
      operatingSystem: "Web",
      url: "https://factorylm.com/",
      description: "FactoryLM is not a CMMS and does not replace yours. There is nothing to switch.",
      publisher: { "@id": "https://factorylm.com/#org" },
    },
  ],
};

function hero(): string {
  return `<section class="fl-hero" aria-labelledby="fl-hero-h1">
  <div class="fl-hero-inner">
    <h1 id="fl-hero-h1" class="fl-hero-h1">FactoryLM</h1>
    <h2 class="fl-hero-h2">It's not a CMMS and doesn't replace yours.</h2>
    <h3 class="fl-hero-h3">There's nothing to switch.</h3>
    <p class="fl-hero-sub">It doesn't connect to PLCs, doesn't use work-order history, and doesn't write work orders.</p>
    <div class="fl-hero-cta">
      ${btnPrimary("Talk to Mike", { href: TALK_TO_MIKE_HREF, cta: "hero-talk" })}
    </div>
    <p class="fl-hero-cta-foot">Already using FactoryLM? <a href="/cmms" data-cta="hero-signin">Sign in</a>.</p>
  </div>
</section>`;
}

function honestLimits(): string {
  return `<section class="fl-section" aria-labelledby="fl-limits-h">
  <h2 id="fl-limits-h" class="fl-section-h">What it does not do.</h2>
  <p class="fl-section-sub">For lockout, arc flash and confined space, follow your site procedure. Don't use any AI tool for those.</p>
  <p class="fl-section-sub">We've tested Rockwell and Festo manuals so far, and we'll post our misses too.</p>
</section>`;
}

function buyerFit(): string {
  const forList = [
    "Maintenance managers",
    "Plant managers",
    "Reliability engineers",
    "Controls engineers &amp; integrators",
  ];
  const notList = [
    "Looking for a CMMS? It's not a CMMS and doesn't replace yours.",
    "Need PLC data or work-order automation? It doesn't connect to PLCs, doesn't use work-order history, and doesn't write work orders.",
  ];
  const li = (items: string[]) => items.map((i) => `<li>${i}</li>`).join("\n      ");
  return `<section class="fl-section" aria-labelledby="fl-fit-h">
  <h2 id="fl-fit-h" class="fl-section-h">Who it's for.</h2>
  <p class="fl-section-sub">We'd rather tell you up front. See the full list on <a href="/limitations" data-cta="fit-limitations">Limitations</a>.</p>
  <div class="fl-fit-grid">
    <div class="fl-fit-col fl-fit-for">
      <h3 class="fl-fit-h3">Built for</h3>
      <ul class="fl-fit-list">
      ${li(forList)}
      </ul>
    </div>
    <div class="fl-fit-col fl-fit-not">
      <h3 class="fl-fit-h3">Not the right fit (yet)</h3>
      <ul class="fl-fit-list">
      ${li(notList)}
      </ul>
    </div>
  </div>
</section>`;
}

function aboutMike(): string {
  return `<section class="fl-section fl-pricing-teaser" aria-labelledby="fl-about-h">
  <h2 id="fl-about-h" class="fl-section-h">I'm Mike, I build FactoryLM, and I'm in Central Florida.</h2>
  <div class="fl-hero-cta">
    ${btnPrimary("Talk to Mike", { href: TALK_TO_MIKE_HREF, cta: "about-talk" })}
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

.fl-fit-grid {
  display: grid; gap: var(--fl-sp-5);
  grid-template-columns: 1fr;
}
@media (min-width: 720px) {
  .fl-fit-grid { grid-template-columns: 1fr 1fr; }
}
.fl-fit-col {
  background: var(--fl-card-0);
  border: 1px solid var(--fl-rule-200);
  border-radius: var(--fl-radius-lg);
  padding: var(--fl-sp-6);
  box-shadow: var(--fl-shadow-sm);
}
.fl-fit-h3 {
  font-size: var(--fl-type-lg); color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-4);
}
.fl-fit-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--fl-sp-3); }
.fl-fit-list li { color: var(--fl-muted-600); line-height: 1.5; padding-left: var(--fl-sp-5); position: relative; }
.fl-fit-for .fl-fit-list li::before { content: "✓"; position: absolute; left: 0; color: var(--fl-good, var(--fl-navy-900)); font-weight: 700; }
.fl-fit-not .fl-fit-list li::before { content: "—"; position: absolute; left: 0; color: var(--fl-muted-600); font-weight: 700; }

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
      title: "FactoryLM",
      description:
        "It's not a CMMS and doesn't replace yours. There's nothing to switch. Talk to Mike — FactoryLM, Central Florida.",
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
    ${honestLimits()}
    ${buyerFit()}
    ${aboutMike()}
  </main>
  ${footer()}
  <a href="${TALK_TO_MIKE_HREF}" class="fl-mobile-cta" data-cta="mobile-sticky-talk">Talk to Mike</a>
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

import { head } from "../lib/head.js";
import { btnPrimary } from "../lib/components.js";
import { escHtml } from "../lib/html.js";
import {
  effectiveHeadline,
  effectiveMetaDescription,
  effectiveSubhead,
  effectiveTitle,
  generateJsonLd,
  loadCapabilities,
  provenByKind,
  provenClaims,
  provenText,
  type CapabilitiesFile,
} from "../capabilities/marketing-claims/index.js";
import { navbar, footer } from "./_topbar.js";

function hero(data: CapabilitiesFile): string {
  const headline = effectiveHeadline(data) || "FactoryLM";
  const subhead = effectiveSubhead(data);
  const capabilities = provenByKind("capability", data);
  const body = capabilities.map((c) => c.text).join(" ");
  const sub = subhead
    ? `<h2 class="fl-hero-h2">${escHtml(subhead)}</h2>`
    : "";
  const para = body
    ? `<p class="fl-hero-sub">${escHtml(body)}</p>`
    : "";
  return `<section class="fl-hero" aria-labelledby="fl-hero-h1">
  <div class="fl-hero-inner">
    <p class="fl-hero-eyebrow">FactoryLM</p>
    <h1 id="fl-hero-h1" class="fl-hero-h1">${escHtml(headline)}</h1>
    ${sub}
    ${para}
    <div class="fl-hero-cta">
      ${btnPrimary(escHtml(data.contact.cta), { href: escHtml(data.contact.href), cta: "hero-talk" })}
    </div>
    <p class="fl-hero-cta-foot">Already using FactoryLM? <a href="/cmms" data-cta="hero-signin">Sign in</a>.</p>
  </div>
</section>`;
}

function honestLimits(data: CapabilitiesFile): string {
  const limits = provenByKind("limit", data).filter(
    (c) => c.id !== "mike-central-florida"
  );
  const paras = limits
    .map((c) => `<p class="fl-section-sub">${escHtml(c.text)}</p>`)
    .join("\n  ");
  return `<section class="fl-section" aria-labelledby="fl-limits-h">
  <h2 id="fl-limits-h" class="fl-section-h">What it does not do.</h2>
  ${paras}
</section>`;
}

function buyerFit(data: CapabilitiesFile): string {
  const notACmms = provenText("not-a-cmms", data);
  const noPlc = provenText("no-plc-or-work-order-write", data);
  const notList = [notACmms, noPlc].filter((text): text is string => Boolean(text));
  if (notList.length === 0) return "";
  const li = (items: string[]) => items.map((i) => `<li>${escHtml(i)}</li>`).join("\n      ");
  return `<section class="fl-section" aria-labelledby="fl-fit-h">
  <h2 id="fl-fit-h" class="fl-section-h">Who it's for.</h2>
  <p class="fl-section-sub">See the full list on <a href="/limitations" data-cta="fit-limitations">Limitations</a>.</p>
  <div class="fl-fit-grid">
    <div class="fl-fit-col fl-fit-not">
      <h3 class="fl-fit-h3">Not the right fit (yet)</h3>
      <ul class="fl-fit-list">
      ${li(notList)}
      </ul>
    </div>
  </div>
</section>`;
}

function aboutMike(data: CapabilitiesFile): string {
  const mike = provenText("mike-central-florida", data);
  if (!mike) return "";
  return `<section class="fl-section fl-pricing-teaser" aria-labelledby="fl-about-h">
  <h2 id="fl-about-h" class="fl-section-h">${escHtml(mike)}</h2>
  <div class="fl-hero-cta">
    ${btnPrimary(escHtml(data.contact.cta), { href: escHtml(data.contact.href), cta: "about-talk" })}
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

export function renderHome(
  reqUrl?: string,
  data: CapabilitiesFile = loadCapabilities()
): string {
  // Touch the proven list so a future empty-filter cannot silently ship.
  if (provenClaims(data).length === 0) {
    throw new Error("homepage refuses to render without proven claims");
  }
  const headHtml = head(
    {
      title: escHtml(effectiveTitle(data)),
      description: escHtml(effectiveMetaDescription(data)),
      canonical: "https://factorylm.com/",
      ogImage: "https://factorylm.com/og-image.png",
      jsonLd: generateJsonLd(data),
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
    ${hero(data)}
    ${honestLimits(data)}
    ${buyerFit(data)}
    ${aboutMike(data)}
  </main>
  ${footer()}
  <a href="${escHtml(data.contact.href)}" class="fl-mobile-cta" data-cta="mobile-sticky-talk">${escHtml(data.contact.cta)}</a>
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

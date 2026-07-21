import { head } from "../lib/head.js";
import { btnGhost, btnPrimary, trustBand } from "../lib/components.js";
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

const ORG_AND_PRODUCTS_LD = {
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
      "@id": "https://factorylm.com/#printsense",
      name: "PrintSense",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Telegram, Slack",
      url: "https://factorylm.com/printsense",
      description:
        "Electrical-print intelligence that lets technicians send a print page or package, ask questions, and receive cited explanations with declared uncertainty.",
      publisher: { "@id": "https://factorylm.com/#org" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://factorylm.com/#drive-commander",
      name: "Drive Commander",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://factorylm.com/drive-commander/siemens-g120",
      description:
        "Cited drive fault, parameter, keypad, and troubleshooting intelligence for supported VFD families.",
      offers: {
        "@type": "Offer",
        price: "29",
        priceCurrency: "USD",
        priceSpecification: {
          "@type": "UnitPriceSpecification",
          unitText: "MONTH",
        },
      },
      publisher: { "@id": "https://factorylm.com/#org" },
    },
  ],
};

function hero(): string {
  return `<section class="fl-hero" aria-labelledby="fl-hero-h1">
  <div class="fl-hero-inner">
    <p class="fl-hero-eyebrow">Industrial troubleshooting intelligence</p>
    <h1 id="fl-hero-h1" class="fl-hero-h1">Understand drive faults and electrical prints faster.</h1>
    <p class="fl-hero-sub">FactoryLM gives technicians two direct products: <strong>PrintSense</strong> for chatting with electrical prints and <strong>Drive Commander</strong> for cited drive fault and parameter answers. Start with the problem in front of you. Expand into MIRA when your team needs a plant-wide knowledge layer.</p>
    <div class="fl-hero-cta">
      ${btnPrimary("Open PrintSense", { href: "/printsense", cta: "hero-printsense" })}
      ${btnGhost("Open Drive Commander", { href: "/drive-commander/siemens-g120", cta: "hero-drive-commander" })}
    </div>
    <p class="fl-hero-cta-foot">No assessment required to try the products. FactoryLM services are available when you need package review, integrations, or plant-wide rollout.</p>
  </div>
</section>`;
}

function productCards(): string {
  return `<section class="fl-section" aria-labelledby="fl-products-h">
  <p class="fl-kicker">Two products. One clear front door.</p>
  <h2 id="fl-products-h" class="fl-section-h">Start with the technician's question.</h2>
  <div class="fl-product-grid">
    <article class="fl-product-card fl-product-card-primary" aria-label="PrintSense">
      <p class="fl-product-label">Electrical prints</p>
      <h3>PrintSense</h3>
      <p class="fl-product-promise">Send a print page, photo set, or package. Ask how the circuit works, where a signal goes, or what to check next.</p>
      <ul>
        <li>Plain-English circuit and system explanations</li>
        <li>Page, location, device, wire, and cross-reference evidence</li>
        <li>Continuing conversation about the same machine</li>
        <li>Unreadable or uncertain areas declared instead of guessed</li>
      </ul>
      <div class="fl-card-actions">
        ${btnPrimary("Try PrintSense", { href: "/printsense", cta: "product-printsense" })}
        <span>Self-serve entry through Telegram today; web workspace is the product direction.</span>
      </div>
    </article>
    <article class="fl-product-card" aria-label="Drive Commander">
      <p class="fl-product-label">Variable-frequency drives</p>
      <h3>Drive Commander</h3>
      <p class="fl-product-promise">Look up a supported drive fault and get the meaning, related parameters, reset workflow, and manual evidence.</p>
      <ul>
        <li>Free cited fault pages for supported drive families</li>
        <li>Pro troubleshooting, wiring, commissioning, and keypad guidance</li>
        <li>Manufacturer-pack evidence instead of generic AI answers</li>
        <li>$29/month or $197/year</li>
      </ul>
      <div class="fl-card-actions">
        ${btnPrimary("See Siemens G120", { href: "/drive-commander/siemens-g120", cta: "product-drive-commander" })}
        <span>Buy Pro from the live Drive Commander checkout.</span>
      </div>
    </article>
  </div>
</section>`;
}

function productFlow(): string {
  return `<section class="fl-section fl-flow" aria-labelledby="fl-flow-h">
  <p class="fl-kicker">Product hierarchy</p>
  <h2 id="fl-flow-h" class="fl-section-h">Solve one problem first. Expand only when it earns trust.</h2>
  <div class="fl-flow-grid">
    <article><span>1</span><h3>PrintSense or Drive Commander</h3><p>Immediate technician value from the print or drive in front of them.</p></article>
    <article><span>2</span><h3>MIRA</h3><p>Persistent team memory across manuals, prints, assets, fault history, Telegram, Slack, and web.</p></article>
    <article><span>3</span><h3>FactoryLM platform</h3><p>Plant-wide integrations, namespace structuring, CMMS workflows, telemetry, and rollout support.</p></article>
  </div>
</section>`;
}

function trustSection(): string {
  return `<section class="fl-section" aria-labelledby="fl-trust-h">
  <p class="fl-kicker">Grounded by design</p>
  <h2 id="fl-trust-h" class="fl-section-h">Answers should show their work.</h2>
  <div class="fl-proof-grid">
    <article><h3>Cited</h3><p>Claims point back to a manual, print page, region, parameter, or stored evidence record.</p></article>
    <article><h3>Honest</h3><p>Unreadable text, missing pages, conflicting identifiers, and unsupported conclusions remain visible.</p></article>
    <article><h3>Read-only</h3><p>The products explain and escalate. They do not energize equipment, change parameters, or replace qualified review.</p></article>
  </div>
</section>`;
}

function expansionCta(): string {
  return `<section class="fl-section fl-expansion" aria-labelledby="fl-expansion-h">
  <p class="fl-kicker">Need more than a standalone product?</p>
  <h2 id="fl-expansion-h" class="fl-section-h">Bring the proven workflow into your plant.</h2>
  <p>FactoryLM can connect PrintSense and Drive Commander to your manuals, equipment records, PLC context, telemetry, CMMS, and technician channels. An assessment is optional sales assistance—not the front door.</p>
  <div class="fl-hero-cta">
    ${btnPrimary("View product pricing", { href: "/pricing", cta: "expansion-pricing" })}
    ${btnGhost("Talk about a plant rollout", { href: "mailto:mike@factorylm.com?subject=FactoryLM%20plant%20rollout", cta: "expansion-contact" })}
  </div>
</section>`;
}

const PAGE_STYLES = `
.fl-topbar{display:flex;align-items:center;justify-content:space-between;padding:var(--fl-sp-4) var(--fl-sp-6);background:var(--fl-card-0);border-bottom:1px solid var(--fl-rule-200);gap:var(--fl-sp-5)}
.fl-topbar-brand{font-weight:700;color:var(--fl-navy-900);text-decoration:none;font-size:var(--fl-type-lg)}
.fl-topbar-nav{display:flex;gap:var(--fl-sp-5);align-items:center}
.fl-topbar-nav a{color:var(--fl-ink-900);text-decoration:none;font-size:var(--fl-type-sm)}
.fl-topbar-nav a:hover{color:var(--fl-orange-600);text-decoration:underline}
.fl-topbar-cta{display:flex;gap:var(--fl-sp-3);align-items:center}
.fl-hero{padding:var(--fl-sp-10) var(--fl-sp-6);background:linear-gradient(180deg,var(--fl-sky-100),var(--fl-bg-50));text-align:center}
.fl-hero-inner{max-width:900px;margin:0 auto}
.fl-hero-eyebrow,.fl-kicker{text-transform:uppercase;letter-spacing:var(--fl-ls-caps);font-size:var(--fl-type-xs);color:var(--fl-orange-600);font-weight:700;margin-bottom:var(--fl-sp-3)}
.fl-hero-h1{font-size:clamp(2.2rem,6vw,4.5rem);line-height:1.02;letter-spacing:var(--fl-ls-tight);color:var(--fl-navy-900);margin-bottom:var(--fl-sp-5)}
.fl-hero-sub{font-size:var(--fl-type-md);color:var(--fl-muted-600);max-width:760px;margin:0 auto var(--fl-sp-7);line-height:1.65}
.fl-hero-cta{display:flex;gap:var(--fl-sp-4);justify-content:center;flex-wrap:wrap}
.fl-hero-cta-foot{font-size:var(--fl-type-xs);color:var(--fl-muted-600);margin-top:var(--fl-sp-4)}
.fl-section{max-width:1080px;margin:0 auto;padding:var(--fl-sp-10) var(--fl-sp-6)}
.fl-section-h{font-size:var(--fl-type-2xl);color:var(--fl-navy-900);margin-bottom:var(--fl-sp-6);max-width:760px}
.fl-product-grid{display:grid;grid-template-columns:1fr 1fr;gap:var(--fl-sp-6)}
.fl-product-card,.fl-proof-grid article,.fl-flow-grid article{background:var(--fl-card-0);border:1px solid var(--fl-rule-200);border-radius:var(--fl-radius-lg);padding:var(--fl-sp-6);box-shadow:var(--fl-shadow-sm)}
.fl-product-card-primary{border-color:var(--fl-orange-600)}
.fl-product-label{font-size:var(--fl-type-xs);text-transform:uppercase;letter-spacing:var(--fl-ls-caps);color:var(--fl-orange-600);font-weight:700}
.fl-product-card h3{font-size:var(--fl-type-2xl);color:var(--fl-navy-900);margin:var(--fl-sp-2) 0 var(--fl-sp-3)}
.fl-product-promise{font-size:var(--fl-type-md);color:var(--fl-ink-900);line-height:1.55}
.fl-product-card ul{margin:var(--fl-sp-5) 0;padding-left:var(--fl-sp-5);color:var(--fl-muted-600);display:grid;gap:var(--fl-sp-2)}
.fl-card-actions{display:flex;flex-direction:column;align-items:flex-start;gap:var(--fl-sp-3)}
.fl-card-actions span{font-size:var(--fl-type-xs);color:var(--fl-muted-600)}
.fl-flow{border-top:1px solid var(--fl-rule-200);border-bottom:1px solid var(--fl-rule-200)}
.fl-flow-grid,.fl-proof-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:var(--fl-sp-5)}
.fl-flow-grid span{display:inline-flex;width:32px;height:32px;border-radius:50%;align-items:center;justify-content:center;background:var(--fl-sky-100);color:var(--fl-navy-900);font-weight:700}
.fl-flow-grid h3,.fl-proof-grid h3{font-size:var(--fl-type-lg);color:var(--fl-navy-900);margin:var(--fl-sp-3) 0 var(--fl-sp-2)}
.fl-flow-grid p,.fl-proof-grid p,.fl-expansion p{color:var(--fl-muted-600);line-height:1.6}
.fl-expansion{text-align:center}
.fl-expansion .fl-section-h{margin-left:auto;margin-right:auto}
.fl-expansion>p{max-width:720px;margin:0 auto var(--fl-sp-6)}
.fl-footer{border-top:1px solid var(--fl-rule-200);background:var(--fl-card-0);padding:var(--fl-sp-8) var(--fl-sp-6)}
.fl-footer-inner{max-width:1080px;margin:0 auto;display:flex;flex-wrap:wrap;gap:var(--fl-sp-5);align-items:center;justify-content:space-between}
.fl-footer-brand{color:var(--fl-muted-600);font-size:var(--fl-type-sm)}
.fl-footer-links{display:flex;gap:var(--fl-sp-5);list-style:none}
.fl-footer-links a{color:var(--fl-ink-900);text-decoration:none;font-size:var(--fl-type-sm)}
.fl-sun-toggle{background:transparent;border:1px solid var(--fl-rule-200);border-radius:var(--fl-radius-pill);padding:var(--fl-sp-2) var(--fl-sp-4);font-size:var(--fl-type-sm);cursor:pointer;color:var(--fl-ink-900)}
@media(max-width:900px){.fl-product-grid,.fl-flow-grid,.fl-proof-grid{grid-template-columns:1fr}.fl-topbar-nav{display:none}}
@media(max-width:640px){.fl-topbar{padding:var(--fl-sp-3) var(--fl-sp-4)}.fl-topbar-cta .fl-btn-ghost{display:none}.fl-hero,.fl-section{padding-left:var(--fl-sp-4);padding-right:var(--fl-sp-4)}}
`;

export function renderHome(reqUrl?: string): string {
  const headHtml = head(
    {
      title: "FactoryLM — PrintSense and Drive Commander",
      description:
        "Chat with electrical prints using PrintSense, or get cited drive fault and parameter answers with Drive Commander. FactoryLM is the expansion platform behind both products.",
      canonical: "https://factorylm.com/",
      ogImage: "https://factorylm.com/og-image.png",
      jsonLd: ORG_AND_PRODUCTS_LD,
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
    ${trustBand("Industrial documentation and drive intelligence across leading OEMs", OEMS)}
    ${productCards()}
    ${productFlow()}
    ${trustSection()}
    ${expansionCta()}
  </main>
  ${footer()}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

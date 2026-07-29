/**
 * Server-side HTML renderer for the public Drive Commander surface.
 *
 *   GET /drive-commander/:model                 -> renderDriveLandingPage
 *   GET /drive-commander/:model/faults/:code    -> renderFaultPage / renderFaultNotFound
 *
 * Product framing (keep distinct):
 *   FactoryLM      = the company / platform (footer).
 *   MIRA           = the assistant / knowledge layer that grounds the answers.
 *   Drive Commander= the technician-facing product being sold here.
 *   PowerFlex pack = the value atom powering these pages.
 *
 * Aesthetic: the FactoryLM DARK DATASHEET theme. All colors come from the
 * shared --fl-dark-* design tokens (public/_tokens.css, canonical copy in
 * docs/design/factorylm-tokens.css) — no raw hex anywhere in this file. The
 * local :root aliases below only REMAP token names for brevity (the sanctioned
 * re-skin pattern in .claude/skills/factorylm-ui-style). Accent = brand orange
 * (actions only); green/amber/red are STATE colors (cited=ok, held=warn,
 * fault=fault) — never decoration. Icons are inline SVG, never emoji.
 *
 * FREE tier renders only: fault name + its cited related parameters (name, purpose,
 * and the manual citation shown as visible grounding proof). PRO content (full value
 * tables, wiring/commissioning, reset workflow, Ask-MIRA) is a locked teaser only —
 * NO Pro pack data is emitted into the free DOM. Every claim is cited from the pack;
 * nothing is generic-AI-generated.
 */
import type { DrivePackDisplay, FaultView, ParameterCard } from "./drive-pack-data.js";
import {
  getParametersForFault,
  getFaultsForParameter,
  listFaults,
  listParameters,
} from "./drive-pack-data.js";

const BASE_URL = "https://factorylm.com";
// Live checkout: /api/checkout/session dispatches on ?product= and falls back
// to /pricing?product=drive-commander-pro until STRIPE_DRIVE_COMMANDER_PRICE_ID
// is provisioned in Doppler factorylm/prd.
const PRICING_HREF = "/api/checkout/session?product=drive-commander-pro";
const WAITLIST_HREF =
  "mailto:hello@factorylm.com?subject=Drive%20Commander%20Pro%20interest";

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const escAttr = escHtml;

// Inline SVG micro-icons (stroke:currentColor) — never emoji (de-slop rule).
const ICON_LOCK =
  '<svg aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-1px"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></svg>';
const ICON_CITE =
  '<svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" style="vertical-align:-1px"><path d="M6.5 9.5l3-3"/><path d="M7.6 4.4l1-1a2.55 2.55 0 0 1 3.6 3.6l-1 1"/><path d="M8.4 11.6l-1 1a2.55 2.55 0 0 1-3.6-3.6l1-1"/></svg>';
const ICON_CHECK =
  '<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px"><path d="M3 8.5l3.5 3.5L13 5"/></svg>';

function productName(pack: DrivePackDisplay): string {
  return `${pack.family.manufacturer} ${pack.family.series}`.trim();
}

// ── Shared chrome ────────────────────────────────────────────────────────

const STYLE = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    /* aliases → shared FL dark-datasheet tokens (see /_tokens.css) */
    --page-bg:var(--fl-dark-bg); --surface:var(--fl-dark-surface); --surface-hi:var(--fl-dark-surface-hi);
    --border:var(--fl-dark-line); --border-hi:var(--fl-dark-line-hi);
    --text:var(--fl-dark-ink); --text-dim:var(--fl-dark-muted); --text-faint:var(--fl-dark-faint);
    --accent:var(--fl-dark-accent); --accent-hover:var(--fl-dark-accent-hover);
    --accent-line:var(--fl-dark-accent-line);
    --ok:var(--fl-dark-ok); --ok-line:var(--fl-dark-ok-line); --ok-tint:var(--fl-dark-ok-tint);
    --font:var(--fl-dark-font);
    --font-mono:var(--fl-dark-mono);
    --max-w:1080px; --ease:cubic-bezier(0.16,1,0.3,1);
  }
  html { scroll-behavior:smooth; }
  body { background:var(--page-bg); color:var(--text); font-family:var(--font);
    font-size:15px; line-height:1.65; -webkit-font-smoothing:antialiased; overflow-x:hidden; }
  .inner { max-width:var(--max-w); margin:0 auto; padding:0 32px; }
  a { color:inherit; }
  nav#main-nav { position:sticky; top:0; z-index:50; background:var(--fl-dark-bg-glass);
    backdrop-filter:blur(12px); border-bottom:1px solid var(--border); }
  .nav-inner { max-width:var(--max-w); margin:0 auto; padding:16px 32px; display:flex;
    align-items:center; justify-content:space-between; }
  .nav-logo { display:flex; align-items:center; gap:10px; color:var(--accent);
    text-decoration:none; font-weight:600; font-size:15px; }
  .nav-links { display:flex; gap:24px; list-style:none; font-size:13.5px; }
  .nav-links a { color:var(--text-dim); text-decoration:none; }
  .nav-links a:hover { color:var(--text); }
  @media (max-width:720px){ .nav-links{ display:none; } }
  .breadcrumb { font-family:var(--font-mono); font-size:11.5px; color:var(--text-faint);
    letter-spacing:0.04em; margin-bottom:22px; text-transform:uppercase; padding-top:28px; }
  .breadcrumb a { color:var(--text-dim); text-decoration:none; }
  .breadcrumb a:hover { color:var(--accent); }
  .breadcrumb span { color:var(--text-faint); margin:0 6px; }
  .section-label { font-family:var(--font-mono); font-size:11px; letter-spacing:0.12em;
    color:var(--accent); text-transform:uppercase; margin-bottom:16px; display:inline-block; }
  h1.dc-h1 { font-size:clamp(30px,5vw,50px); line-height:1.08; font-weight:600;
    letter-spacing:-0.03em; margin-bottom:18px; max-width:820px; }
  .dc-lede { font-size:18px; line-height:1.55; color:var(--text-dim); max-width:660px;
    margin-bottom:24px; font-weight:300; }
  .hero { padding:8px 0 40px; border-bottom:1px solid var(--border); }
  .prov { display:inline-flex; align-items:center; gap:8px; font-family:var(--font-mono);
    font-size:11px; letter-spacing:0.06em; text-transform:uppercase; color:var(--ok);
    border:1px solid var(--ok-line); background:var(--ok-tint);
    padding:6px 12px; border-radius:4px; }
  .prov b { color:var(--text); font-weight:500; text-transform:none; letter-spacing:0; }
  section.block { padding:48px 0; border-top:1px solid var(--border); }
  h2.dc-h2 { font-size:24px; font-weight:600; letter-spacing:-0.02em; margin-bottom:24px; }
  /* fault list */
  .fault-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:10px; }
  .fault-chip { display:flex; flex-direction:column; gap:4px; padding:14px 16px;
    background:var(--surface); border:1px solid var(--border); border-radius:8px;
    text-decoration:none; transition:border-color 160ms var(--ease); }
  .fault-chip:hover { border-color:var(--accent-line); }
  .fault-chip .code { font-family:var(--font-mono); font-size:12px; color:var(--accent);
    letter-spacing:0.06em; }
  .fault-chip .name { color:var(--text); font-size:14.5px; }
  .fault-chip .tag { font-family:var(--font-mono); font-size:9.5px; color:var(--ok);
    text-transform:uppercase; letter-spacing:0.08em; }
  .fault-chip .tag-plain { color:var(--text-faint); }
  /* payment-return states (state colors: paid = ok) */
  .checkout-ok { display:flex; gap:12px; align-items:flex-start; margin-top:24px;
    padding:16px 18px; border:1px solid var(--fl-dark-ok-line); background:var(--fl-dark-ok-tint);
    border-radius:8px; color:var(--text); font-size:14.5px; line-height:1.6; }
  .checkout-ok svg { color:var(--ok); flex-shrink:0; margin-top:3px; }
  .checkout-ok a { color:var(--ok); }
  .checkout-note { margin-top:24px; padding:12px 16px; border:1px solid var(--border);
    background:var(--surface); border-radius:8px; color:var(--text-dim); font-size:13.5px; }
  /* param card (cited, free tier) */
  .param-card { background:var(--surface); border:1px solid var(--border);
    border-radius:8px; padding:20px 22px; margin-bottom:14px; }
  .param-card .p-id { font-family:var(--font-mono); font-size:11px; color:var(--accent);
    letter-spacing:0.08em; }
  .param-card .p-name { font-size:16px; font-weight:600; margin:4px 0 8px; }
  .param-card .p-purpose { color:var(--text-dim); font-size:14.5px; line-height:1.6;
    font-weight:300; margin-bottom:14px; }
  .cite { border-left:2px solid var(--ok-line); padding:8px 0 8px 14px;
    background:var(--ok-tint); }
  .cite .cite-src { font-family:var(--font-mono); font-size:11px; color:var(--ok);
    letter-spacing:0.04em; }
  .cite .cite-ex { color:var(--text-faint); font-size:13px; font-style:italic; margin-top:4px; }
  /* locked Pro */
  .pro-lock { position:relative; background:var(--surface-hi); border:1px dashed var(--border-hi);
    border-radius:10px; padding:28px 26px; margin-top:8px; }
  .pro-lock .lock-badge { font-family:var(--font-mono); font-size:10px; letter-spacing:0.14em;
    text-transform:uppercase; color:var(--accent); margin-bottom:12px; display:inline-flex; gap:8px; }
  .pro-lock h3 { font-size:18px; font-weight:600; margin-bottom:10px; }
  .pro-lock ul { list-style:none; display:grid; gap:8px; margin:12px 0 20px; }
  .pro-lock li { color:var(--text-dim); font-size:14px; padding-left:20px; position:relative; }
  .pro-lock li::before { content:'\\25AA'; position:absolute; left:0; color:var(--text-faint); }
  .cta { display:inline-flex; flex-direction:column; text-decoration:none; color:var(--page-bg);
    background:var(--accent); border:1px solid var(--accent-line); border-radius:8px;
    padding:12px 22px; font-weight:700; line-height:1.15; }
  .cta small { font-size:10px; text-transform:uppercase; letter-spacing:0.14em; opacity:0.75;
    font-weight:600; }
  .cta:hover { background:var(--accent-hover); }
  .price-note { font-family:var(--font-mono); font-size:12px; color:var(--text-faint);
    margin-top:12px; letter-spacing:0.03em; }
  .callout { color:var(--text-dim); font-size:14px; background:var(--surface);
    border:1px solid var(--border); border-radius:8px; padding:16px 18px; }
  footer { padding:40px 0; border-top:1px solid var(--border); margin-top:24px; }
  .footer-inner { display:flex; flex-wrap:wrap; gap:14px; justify-content:space-between;
    align-items:center; }
  .footer-links { display:flex; gap:20px; list-style:none; font-size:13px; }
  .footer-links a { color:var(--text-dim); text-decoration:none; }
  .footer-links a:hover { color:var(--accent); }
  .muted { color:var(--text-faint); font-size:13px; }
`;

function pageHead(title: string, description: string, canonical: string, jsonLd?: object): string {
  const jl = jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
    : "";
  return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escHtml(title)}</title>
  <meta name="description" content="${escAttr(description)}">
  <link rel="canonical" href="${escAttr(canonical)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="FactoryLM">
  <meta property="og:title" content="${escAttr(title)}">
  <meta property="og:description" content="${escAttr(description)}">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="theme-color" content="#0d0e11">
  <link rel="icon" href="/public/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
  ${jl}
  <link rel="stylesheet" href="/_tokens.css">
  <style>${STYLE}</style>`;
}

const NAV = `<nav id="main-nav" role="navigation" aria-label="Main navigation">
    <div class="nav-inner">
      <a href="/" class="nav-logo" aria-label="FactoryLM home">FactoryLM</a>
      <ul class="nav-links" role="list">
        <li><a href="/drive-commander/powerflex-525">Drive Commander</a></li>
        <li><a href="/blog">Blog</a></li>
        <li><a href="/cmms">CMMS</a></li>
      </ul>
    </div>
  </nav>`;

const FOOTER = `<footer role="contentinfo"><div class="inner"><div class="footer-inner">
    <a href="/" class="nav-logo" aria-label="FactoryLM home">FactoryLM</a>
    <ul class="footer-links" role="list">
      <li><a href="/drive-commander/powerflex-525">Drive Commander</a></li>
      <li><a href="/">Home</a></li>
      <li><a href="mailto:hello@factorylm.com">Contact</a></li>
    </ul>
  </div>
  <p class="muted" style="margin-top:16px">Drive Commander is a read-only diagnostic product from FactoryLM, grounded by the MIRA knowledge layer. Answers are cited from OEM manuals — not generic AI.</p>
  </div></footer>`;

function provBadge(pack: DrivePackDisplay): string {
  return `<span class="prov" title="${escAttr(pack.manualDoc)}">Grounded &middot; <b>${escHtml(
    pack.manualDoc,
  )}</b> &middot; ${escHtml(pack.provenanceLabel)}</span>`;
}

function waitlistCTA(): string {
  return `<a class="cta" href="${PRICING_HREF}"><small>Individual technician license</small>Unlock Drive Commander Pro &mdash; $29/mo or $197/yr &rarr;</a>
    <p class="price-note">Cancel anytime &middot; 30-day money-back guarantee</p>`;
}

// The Pro teaser. IMPORTANT: no real pack data (no value tables, no full param
// list) is rendered here — only the list of what unlocking provides.
function proLock(): string {
  return `<div class="pro-lock">
    <div class="lock-badge">${ICON_LOCK} Drive Commander Pro</div>
    <h3>The full cited pack</h3>
    <ul>
      <li>Every parameter reference with value/setting tables</li>
      <li>Wiring, terminal, and I/O checks</li>
      <li>Control-source setup &amp; reset / recovery workflow</li>
      <li>Ask-MIRA follow-up questions on this exact drive</li>
      <li>Saved troubleshooting history &amp; pack updates</li>
    </ul>
    ${waitlistCTA()}
  </div>`;
}

function citeBlock(p: ParameterCard): string {
  return p.source_citation
    ? `<div class="cite"><div class="cite-src">${ICON_CITE} ${escHtml(p.source_citation.doc)}, p.${escHtml(
        p.source_citation.page,
      )}</div>${
        p.source_citation.excerpt
          ? `<div class="cite-ex">&ldquo;${escHtml(p.source_citation.excerpt)}&rdquo;</div>`
          : ""
      }</div>`
    : `<div class="cite"><div class="cite-src">Cited in the pack (manual-cited)</div></div>`;
}

function paramCardFree(p: ParameterCard, modelSlug: string): string {
  return `<div class="param-card">
    <div class="p-id">${escHtml(p.parameter_id)}</div>
    <div class="p-name">${escHtml(p.name)}</div>
    ${p.purpose ? `<div class="p-purpose">${escHtml(p.purpose)}</div>` : ""}
    ${citeBlock(p)}
    <p style="margin-top:12px"><a class="muted" href="/drive-commander/${escAttr(
      modelSlug,
    )}/parameters/${escAttr(p.parameter_id)}">Full ${escHtml(
      p.parameter_id,
    )} reference &rarr;</a></p>
  </div>`;
}

// ── Pages ────────────────────────────────────────────────────────────────

export function renderDriveLandingPage(
  pack: DrivePackDisplay,
  opts?: { checkout?: string },
): string {
  const canonical = `${BASE_URL}/drive-commander/${pack.modelSlug}`;
  const product = productName(pack);
  const faults = listFaults(pack);
  // ONE fault list, cited-detail first — never render the same chips twice.
  const sortedFaults = [...faults].sort(
    (a, b) => Number(b.hasDetail) - Number(a.hasDetail),
  );
  const detailCount = faults.filter((f) => f.hasDetail).length;
  const title = `${product} Fault Codes & Troubleshooting | Drive Commander`;
  const description = `Look up any ${product} fault code and get the meaning plus the cited parameters to check — straight from the OEM manual, not generic AI. Free fault lookup from Drive Commander.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: title,
    about: `${product} VFD fault codes`,
    description,
    url: canonical,
    isPartOf: { "@type": "WebSite", name: "FactoryLM" },
  };

  // Every chip carries a consistent tag — no empty trailing spans.
  const chip = (f: FaultView) =>
    `<a class="fault-chip" href="/drive-commander/${pack.modelSlug}/faults/${escAttr(f.display)}">
      <span class="code">${escHtml(f.display)}</span>
      <span class="name">${escHtml(f.name)}</span>
      <span class="tag${f.hasDetail ? "" : " tag-plain"}">${
        f.hasDetail ? "cited detail" : "in pack"
      }</span>
    </a>`;

  // Payment return states (Stripe redirects back with ?checkout=…).
  const checkoutBanner =
    opts?.checkout === "success"
      ? `<div class="checkout-ok" role="status">${ICON_CHECK}
          <div><strong>Payment confirmed &mdash; Drive Commander Pro is active.</strong>
          Your receipt is on its way from Stripe. Pro unlocks the full cited pack for this
          drive: value/setting tables, wiring &amp; I/O checks, reset workflow, and
          Ask-MIRA follow-ups. Reply to the receipt email or write
          <a href="mailto:hello@factorylm.com">hello@factorylm.com</a> and we'll finish
          your account setup within one business day.</div></div>`
      : opts?.checkout === "cancelled"
        ? `<div class="checkout-note" role="status">Checkout cancelled &mdash; no charge was made.
            The free cited lookups below stay free.</div>`
        : "";
  const paid = opts?.checkout === "success";

  return `<!DOCTYPE html>
<html lang="en"><head>${pageHead(title, description, canonical, jsonLd)}</head>
<body>
  ${NAV}
  <main id="main-content"><div class="inner">
    <div class="breadcrumb"><a href="/">Home</a> <span>&rsaquo;</span> Drive Commander <span>&rsaquo;</span> ${escHtml(product)}</div>
    ${checkoutBanner}
    <section class="hero">
      <div class="section-label">Drive Commander &middot; ${escHtml(product)}</div>
      <h1 class="dc-h1">${escHtml(product)} fault codes, decoded for the technician in front of the drive.</h1>
      <p class="dc-lede">Search a fault code. Get what it means and the exact parameters to check &mdash; every answer cited to the ${escHtml(
        pack.family.series,
      )} manual. No PDF hunting, no generic AI guesses.</p>
      <div style="margin-bottom:8px">${provBadge(pack)}</div>
    </section>

    <section class="block">
      <h2 class="dc-h2">${faults.length} ${escHtml(
        pack.family.series,
      )} faults in this pack${detailCount ? ` &middot; ${detailCount} with cited troubleshooting detail` : ""}</h2>
      <p class="callout" style="margin-bottom:18px">Each code below is decoded from the ${escHtml(
        pack.manualDoc,
      )} &mdash; the full manual covers more; we only publish what we can cite. Click a code for the cited meaning and the parameters to check.</p>
      <div class="fault-grid">${sortedFaults.map(chip).join("")}</div>
    </section>

    <section class="block">
      <h2 class="dc-h2">Parameter reference (${listParameters(pack).length})</h2>
      <p class="callout" style="margin-bottom:18px">Cited ${escHtml(
        pack.family.series,
      )} parameters &mdash; click one for its manual reference.</p>
      <div class="fault-grid">${listParameters(pack)
        .map(
          (p) => `<a class="fault-chip" href="/drive-commander/${pack.modelSlug}/parameters/${escAttr(
            p.parameter_id,
          )}"><span class="code">${escHtml(p.parameter_id)}</span><span class="name">${escHtml(
            p.name,
          )}</span></a>`,
        )
        .join("")}</div>
    </section>

    ${
      paid
        ? ""
        : `<section class="block">
      <h2 class="dc-h2">Go deeper with Drive Commander Pro</h2>
      ${proLock()}
    </section>`
    }
  </div></main>
  ${FOOTER}
</body></html>`;
}

export function renderFaultPage(pack: DrivePackDisplay, fault: FaultView): string {
  const canonical = `${BASE_URL}/drive-commander/${pack.modelSlug}/faults/${fault.display}`;
  const product = productName(pack);
  const params = getParametersForFault(pack, fault.key);
  const title = `${product} Fault ${fault.display} — ${fault.name} | Drive Commander`;
  const description = `${product} fault ${fault.display} means "${fault.name}". See the cited parameters to check, straight from the ${pack.family.series} manual. Free lookup from Drive Commander.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `${product} Fault ${fault.display} — ${fault.name}`,
    description,
    url: canonical,
    citation: pack.manualDoc,
    isPartOf: { "@type": "WebSite", name: "FactoryLM" },
  };

  const free = params.length
    ? `<h2 class="dc-h2">Parameters to check</h2>
       ${params.map((p) => paramCardFree(p, pack.modelSlug)).join("")}`
    : `<div class="callout">This fault is decoded from the ${escHtml(
        pack.manualDoc,
      )} (manual-cited). Cited parameter-level troubleshooting for <strong>${escHtml(
        fault.display,
      )}</strong> isn't in the free pack yet &mdash; it's part of the Pro pack below. We never invent steps we can't cite.</div>`;

  return `<!DOCTYPE html>
<html lang="en"><head>${pageHead(title, description, canonical, jsonLd)}</head>
<body>
  ${NAV}
  <main id="main-content"><div class="inner">
    <div class="breadcrumb"><a href="/">Home</a> <span>&rsaquo;</span> <a href="/drive-commander/${pack.modelSlug}">${escHtml(
      product,
    )}</a> <span>&rsaquo;</span> ${escHtml(fault.display)}</div>
    <section class="hero">
      <div class="section-label">${escHtml(product)} &middot; Fault ${escHtml(fault.display)}</div>
      <h1 class="dc-h1">${escHtml(fault.display)} &mdash; ${escHtml(fault.name)}</h1>
      <p class="dc-lede">On a ${escHtml(product)}, fault <strong>${escHtml(
        fault.display,
      )}</strong> reads <strong>&ldquo;${escHtml(
        fault.name,
      )}&rdquo;</strong>. Here's what to check &mdash; cited to the manual.</p>
      <div style="margin-bottom:8px">${provBadge(pack)}</div>
    </section>

    <section class="block">
      ${free}
    </section>

    <section class="block">
      <h2 class="dc-h2">Full troubleshooting &amp; live diagnosis</h2>
      ${proLock()}
    </section>
  </div></main>
  ${FOOTER}
</body></html>`;
}

export function renderFaultNotFound(pack: DrivePackDisplay, code: string): string {
  const product = productName(pack);
  const title = `Fault "${escHtml(code)}" not found — ${product} | Drive Commander`;
  const canonical = `${BASE_URL}/drive-commander/${pack.modelSlug}`;
  return `<!DOCTYPE html>
<html lang="en"><head>${pageHead(
    title,
    `That fault code isn't in the ${product} pack.`,
    canonical,
  )}<meta name="robots" content="noindex"></head>
<body>
  ${NAV}
  <main id="main-content"><div class="inner">
    <div class="breadcrumb"><a href="/">Home</a> <span>&rsaquo;</span> <a href="/drive-commander/${pack.modelSlug}">${escHtml(
      product,
    )}</a> <span>&rsaquo;</span> Not found</div>
    <section class="hero">
      <div class="section-label">${escHtml(product)}</div>
      <h1 class="dc-h1">We don't have &ldquo;${escHtml(code)}&rdquo; in this pack.</h1>
      <p class="dc-lede">That fault code isn't in the ${escHtml(
        pack.family.series,
      )} pack. We only show codes we can cite to the manual &mdash; no guesses.</p>
      <p><a class="cta" href="/drive-commander/${pack.modelSlug}"><small>Drive Commander</small>See all ${escHtml(
        product,
      )} fault codes &rarr;</a></p>
    </section>
  </div></main>
  ${FOOTER}
</body></html>`;
}

export function renderParameterPage(pack: DrivePackDisplay, param: ParameterCard): string {
  const canonical = `${BASE_URL}/drive-commander/${pack.modelSlug}/parameters/${param.parameter_id}`;
  const product = productName(pack);
  const relFaults = getFaultsForParameter(pack, param);
  const title = `${product} Parameter ${param.parameter_id} — ${param.name} | Drive Commander`;
  const description = `${product} parameter ${param.parameter_id} (${param.name}): what it does, cited to the ${pack.family.series} manual. Free reference from Drive Commander.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: `${product} Parameter ${param.parameter_id} — ${param.name}`,
    description,
    url: canonical,
    citation: pack.manualDoc,
    isPartOf: { "@type": "WebSite", name: "FactoryLM" },
  };

  const faultsBlock = relFaults.length
    ? `<section class="block"><h2 class="dc-h2">Related faults</h2><div class="fault-grid">${relFaults
        .map(
          (f) => `<a class="fault-chip" href="/drive-commander/${pack.modelSlug}/faults/${escAttr(
            f.display,
          )}"><span class="code">${escHtml(f.display)}</span><span class="name">${escHtml(
            f.name,
          )}</span></a>`,
        )
        .join("")}</div></section>`
    : "";

  // FREE = id + name + purpose + citation only. Value/setting tables, range, default
  // and wiring are PRO — never emitted here (see proLock, which lists but doesn't show them).
  return `<!DOCTYPE html>
<html lang="en"><head>${pageHead(title, description, canonical, jsonLd)}</head>
<body>
  ${NAV}
  <main id="main-content"><div class="inner">
    <div class="breadcrumb"><a href="/">Home</a> <span>&rsaquo;</span> <a href="/drive-commander/${pack.modelSlug}">${escHtml(
      product,
    )}</a> <span>&rsaquo;</span> ${escHtml(param.parameter_id)}</div>
    <section class="hero">
      <div class="section-label">${escHtml(product)} &middot; Parameter ${escHtml(
        param.parameter_id,
      )}</div>
      <h1 class="dc-h1">${escHtml(param.parameter_id)} &mdash; ${escHtml(param.name)}</h1>
      ${param.purpose ? `<p class="dc-lede">${escHtml(param.purpose)}</p>` : ""}
      <div style="margin-bottom:8px">${provBadge(pack)}</div>
    </section>

    <section class="block">
      <h2 class="dc-h2">Cited reference</h2>
      <div class="param-card">
        <div class="p-id">${escHtml(param.parameter_id)}</div>
        <div class="p-name">${escHtml(param.name)}</div>
        ${param.purpose ? `<div class="p-purpose">${escHtml(param.purpose)}</div>` : ""}
        ${citeBlock(param)}
      </div>
    </section>

    ${faultsBlock}

    <section class="block">
      <h2 class="dc-h2">Full settings &amp; value table</h2>
      ${proLock()}
    </section>
  </div></main>
  ${FOOTER}
</body></html>`;
}

export function renderParameterNotFound(pack: DrivePackDisplay, pid: string): string {
  const product = productName(pack);
  const title = `Parameter "${escHtml(pid)}" not found — ${product} | Drive Commander`;
  const canonical = `${BASE_URL}/drive-commander/${pack.modelSlug}`;
  return `<!DOCTYPE html>
<html lang="en"><head>${pageHead(
    title,
    `That parameter isn't in the ${product} pack.`,
    canonical,
  )}<meta name="robots" content="noindex"></head>
<body>
  ${NAV}
  <main id="main-content"><div class="inner">
    <div class="breadcrumb"><a href="/">Home</a> <span>&rsaquo;</span> <a href="/drive-commander/${pack.modelSlug}">${escHtml(
      product,
    )}</a> <span>&rsaquo;</span> Not found</div>
    <section class="hero">
      <div class="section-label">${escHtml(product)}</div>
      <h1 class="dc-h1">We don't have &ldquo;${escHtml(pid)}&rdquo; in this pack.</h1>
      <p class="dc-lede">That parameter isn't in the ${escHtml(
        pack.family.series,
      )} pack. We only show what we can cite to the manual.</p>
      <p><a class="cta" href="/drive-commander/${pack.modelSlug}"><small>Drive Commander</small>Back to ${escHtml(
        product,
      )} &rarr;</a></p>
    </section>
  </div></main>
  ${FOOTER}
</body></html>`;
}

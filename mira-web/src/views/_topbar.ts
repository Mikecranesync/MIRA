/**
 * Shared topbar + footer partials for FactoryLM marketing pages.
 *
 * Single source of truth for the four TS-rendered marketing views
 * (home, cmms, limitations, security). Replaces four hand-rolled
 * navbar() / footer() functions that drifted in link set and CTA copy
 * — see tools/web-review-runs/2026-05-03-style-audit/AUDIT.md.
 *
 * Static HTML pages (pricing, privacy, terms, trust, dpa) and the
 * blog renderer are still on the older M-icon nav. Bringing them onto
 * this partial is tracked as Phase 2 in the audit; that work is
 * larger because it requires moving HTML into TS views.
 *
 * The link set, ordering, and primary CTA are the home-page
 * standard. Per-page differences are limited to:
 *   - aria-current="page" on the matching link
 *   - data-cta attribute prefix for analytics
 */

import { btnGhost, btnPrimary } from "../lib/components.js";

export interface TopbarOpts {
  /** Path of the current page, used to set aria-current="page". */
  currentPath?: string;
  /** Prefix for data-cta analytics attributes (e.g., "lim", "sec"). */
  ctaPrefix?: string;
}

interface NavLink {
  href: string;
  label: string;
  ctaSlug: string;
}

const APEX = "https://factorylm.com";

const NAV_LINKS: NavLink[] = [
  { href: `${APEX}/cmms`, label: "CMMS", ctaSlug: "cmms" },
  { href: `${APEX}/pricing`, label: "Pricing", ctaSlug: "pricing" },
  { href: `${APEX}/blog`, label: "Blog", ctaSlug: "blog" },
  { href: `${APEX}/limitations`, label: "Limitations", ctaSlug: "limitations" },
  { href: `${APEX}/security`, label: "Security", ctaSlug: "security" },
];

function ctaName(prefix: string | undefined, slug: string): string {
  return prefix ? `${prefix}-nav-${slug}` : `nav-${slug}`;
}

function renderLink(link: NavLink, opts: TopbarOpts): string {
  // link.href is absolute; compare path suffix for aria-current
  const linkPath = link.href.replace(APEX, "");
  const current = opts.currentPath === linkPath ? ` aria-current="page"` : "";
  const cta = ctaName(opts.ctaPrefix, link.ctaSlug);
  return `<a href="${link.href}" data-cta="${cta}"${current}>${link.label}</a>`;
}

export function navbar(opts: TopbarOpts = {}): string {
  const links = NAV_LINKS.map((l) => renderLink(l, opts)).join("\n    ");
  const signinCta = ctaName(opts.ctaPrefix, "signin");
  const buyCta = ctaName(opts.ctaPrefix, "buy");
  return `<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="${APEX}/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    ${links}
  </nav>
  <div class="fl-topbar-cta">
    ${btnGhost("Sign in", { href: `${APEX}/cmms`, cta: signinCta })}
    ${btnPrimary("Get Started", { href: `${APEX}/buy`, cta: buyCta })}
  </div>
</header>`;
}

const FOOTER_LINKS = [
  { href: `${APEX}/assess`, label: "Assessment", slug: "assess" },
  { href: `${APEX}/limitations`, label: "Limitations", slug: "limitations" },
  { href: `${APEX}/trust`, label: "Trust", slug: "trust" },
  { href: `${APEX}/privacy`, label: "Privacy", slug: "privacy" },
  { href: `${APEX}/terms`, label: "Terms", slug: "terms" },
  { href: `${APEX}/status`, label: "Status", slug: "status" },
];

export function footer(opts: TopbarOpts = {}): string {
  const items = FOOTER_LINKS.map((l) => {
    const cta = opts.ctaPrefix
      ? `${opts.ctaPrefix}-footer-${l.slug}`
      : `footer-${l.slug}`;
    return `      <li><a href="${l.href}" data-cta="${cta}">${l.label}</a></li>`;
  }).join("\n");
  return `<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM &middot; Built for industrial maintenance.</p>
    <ul class="fl-footer-links">
${items}
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle" aria-pressed="false" aria-label="&#9728; Sun-readable" data-cta="sun-toggle">&#9728; Sun-readable</button>
  </div>
</footer>`;
}

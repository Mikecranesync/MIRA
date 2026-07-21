/**
 * Shared topbar + footer partials for FactoryLM marketing pages.
 *
 * Product alignment:
 *   PrintSense + Drive Commander are the two standalone front-door products.
 *   MIRA / CMMS is the team and plant expansion layer.
 *   Assessments remain available in the footer, not as the primary CTA.
 */

import { btnGhost, btnPrimary } from "../lib/components.js";

export interface TopbarOpts {
  currentPath?: string;
  ctaPrefix?: string;
}

interface NavLink {
  href: string;
  label: string;
  ctaSlug: string;
}

const APEX = "https://factorylm.com";

const NAV_LINKS: NavLink[] = [
  { href: `${APEX}/printsense`, label: "PrintSense", ctaSlug: "printsense" },
  {
    href: `${APEX}/drive-commander/siemens-g120`,
    label: "Drive Commander",
    ctaSlug: "drive-commander",
  },
  { href: `${APEX}/pricing`, label: "Pricing", ctaSlug: "pricing" },
  { href: `${APEX}/cmms`, label: "Platform", ctaSlug: "platform" },
  { href: `${APEX}/security`, label: "Security", ctaSlug: "security" },
];

function ctaName(prefix: string | undefined, slug: string): string {
  return prefix ? `${prefix}-nav-${slug}` : `nav-${slug}`;
}

function renderLink(link: NavLink, opts: TopbarOpts): string {
  const linkPath = link.href.replace(APEX, "");
  const current = opts.currentPath === linkPath ? ` aria-current="page"` : "";
  return `<a href="${link.href}" data-cta="${ctaName(opts.ctaPrefix, link.ctaSlug)}"${current}>${link.label}</a>`;
}

export function navbar(opts: TopbarOpts = {}): string {
  const links = NAV_LINKS.map((link) => renderLink(link, opts)).join("\n    ");
  return `<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="${APEX}/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    ${links}
  </nav>
  <div class="fl-topbar-cta">
    ${btnGhost("Sign in", {
      href: `${APEX}/cmms`,
      cta: ctaName(opts.ctaPrefix, "signin"),
    })}
    ${btnPrimary("Try PrintSense", {
      href: `${APEX}/printsense`,
      cta: ctaName(opts.ctaPrefix, "try-printsense"),
    })}
  </div>
</header>`;
}

const FOOTER_LINKS = [
  { href: `${APEX}/printsense`, label: "PrintSense", slug: "printsense" },
  {
    href: `${APEX}/drive-commander/siemens-g120`,
    label: "Drive Commander",
    slug: "drive-commander",
  },
  { href: `${APEX}/assess`, label: "Optional assessment", slug: "assess" },
  { href: `${APEX}/limitations`, label: "Limitations", slug: "limitations" },
  { href: `${APEX}/trust`, label: "Trust", slug: "trust" },
  { href: `${APEX}/privacy`, label: "Privacy", slug: "privacy" },
  { href: `${APEX}/terms`, label: "Terms", slug: "terms" },
  { href: `${APEX}/status`, label: "Status", slug: "status" },
];

export function footer(opts: TopbarOpts = {}): string {
  const items = FOOTER_LINKS.map((link) => {
    const cta = opts.ctaPrefix
      ? `${opts.ctaPrefix}-footer-${link.slug}`
      : `footer-${link.slug}`;
    return `      <li><a href="${link.href}" data-cta="${cta}">${link.label}</a></li>`;
  }).join("\n");

  return `<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM &middot; Print intelligence, drive intelligence, and the platform behind them.</p>
    <ul class="fl-footer-links">
${items}
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle" aria-pressed="false" aria-label="Switch to sun-readable high-contrast mode" data-cta="sun-toggle">&#9728; Sun-readable</button>
  </div>
</footer>`;
}

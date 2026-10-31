import { head } from "../lib/head.js";
import { btnPrimary } from "../lib/components.js";
import { escHtml } from "../lib/html.js";
import { navbar, footer, TALK_TO_MIKE_HREF } from "./_topbar.js";
import {
  effectiveLimitations,
  loadCapabilities,
  type CapabilitiesFile,
} from "../capabilities/marketing-claims/index.js";

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

export function renderLimitations(
  reqUrl?: string,
  data: CapabilitiesFile = loadCapabilities()
): string {
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

  const limitItems = effectiveLimitations(data)
    .map(
      (text) => `
    <li>
      ${escHtml(text)}
    </li>`
    )
    .join("");

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
  <link rel="stylesheet" href="/_dark-theme.css">
  <style>${PAGE_STYLES}</style>
</head>
<body>
  ${navbar({ currentPath: "/limitations", ctaPrefix: "lim" })}

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
    ${btnPrimary("Talk to Mike", { href: TALK_TO_MIKE_HREF, cta: "lim-cta-talk" })}
    <p>
      Spotted something we're not honest about?
      <a href="mailto:mike@factorylm.com">Email mike@factorylm.com</a> — we'll add it.
    </p>
  </div>

  ${footer({ ctaPrefix: "lim" })}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

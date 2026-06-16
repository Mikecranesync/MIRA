/**
 * Server-side HTML renderers for blog pages.
 * Uses external blog.css (mirrors the index.html design system).
 * No templating engine — TypeScript template literals only.
 */

import type { FaultCode } from "../data/fault-codes.js";
import type { BlogPost, BlogSection } from "../data/blog-posts.js";

const BASE_URL = "https://factorylm.com";

// Stable fallback date for content that has no per-entry publish/update date
// (the fault-code library). Using the render date here made every page report
// datePublished/dateModified === "today" on each crawl — a churn/freshness
// anti-signal. Bump this only when the library is substantively rewritten;
// prefer setting a per-entry `updated` field for incremental edits.
const CONTENT_EPOCH = "2026-04-28";

// SVG logo (exact copy from index.html)
const LOGO_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="24" height="24" rx="5" fill="#f0a000"/><path d="M6 17V8l3.5 5 2.5-3.5L14.5 13 18 8v9" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const ARROW_SVG = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// ── Structured-data helpers ──

/** Builds a schema.org BreadcrumbList node for the page's position in the
 *  Home › Blog › … hierarchy. Returned as a plain object for inclusion in a
 *  JSON-LD `@graph`. */
function breadcrumbLd(trail: { name: string; url: string }[]): object {
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

// ── Shared HTML head ──

function htmlHead(opts: {
  title: string;
  description: string;
  canonical: string;
  ogType?: string;
  jsonLd?: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>${escHtml(opts.title)}</title>
  <meta name="description" content="${escAttr(opts.description)}">
  <link rel="canonical" href="${escAttr(opts.canonical)}">
  <meta name="theme-color" content="#f0a000">
  <meta property="og:title" content="${escAttr(opts.title)}">
  <meta property="og:description" content="${escAttr(opts.description)}">
  <meta property="og:type" content="${opts.ogType ?? "article"}">
  <meta property="og:url" content="${escAttr(opts.canonical)}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="FactoryLM">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(opts.title)}">
  <meta name="twitter:description" content="${escAttr(opts.description)}">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">
  <link rel="icon" href="/public/icons/favicon.svg" type="image/svg+xml">
  <link rel="manifest" href="/manifest.json">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/public/blog.css">
  ${opts.jsonLd ?? ""}
</head>`;
}

// ── Shared nav + footer ──
//
// The blog uses its own CSS world (blog.css) but the topbar markup is now
// the same standardized 5-link nav + "Sign in" CTA used by the marketing
// pages. Drops the M-icon, uses the wordmark only — matches the post-v0.5.0
// site standard. blog.css's `.nav-*` classes still provide the visual style.

interface BlogNavOpts {
  /** Path of the current page, used for aria-current="page". */
  currentPath?: string;
}

function navLink(href: string, label: string, currentPath?: string): string {
  const current = currentPath === href ? ` aria-current="page"` : "";
  return `<li><a href="${href}"${current}>${label}</a></li>`;
}

function nav(opts: BlogNavOpts = {}): string {
  return `<nav id="main-nav" role="navigation" aria-label="Main navigation">
  <div class="nav-inner">
    <a href="/" class="nav-logo" aria-label="FactoryLM home">FactoryLM</a>
    <ul class="nav-links" role="list">
      ${navLink("/cmms", "CMMS", opts.currentPath)}
      ${navLink("/pricing", "Pricing", opts.currentPath)}
      ${navLink("/blog", "Blog", opts.currentPath)}
      ${navLink("/limitations", "Limitations", opts.currentPath)}
      ${navLink("/security", "Security", opts.currentPath)}
    </ul>
    <a href="/cmms" class="nav-cta">Sign in</a>
  </div>
</nav>`;
}

function siteFooter(): string {
  return `<footer role="contentinfo">
  <div class="inner">
    <div class="footer-inner">
      <a href="/" class="footer-logo" aria-label="FactoryLM home">FactoryLM</a>
      <ul class="footer-links" role="list">
        <li><a href="/limitations">Limitations</a></li>
        <li><a href="/trust">Trust</a></li>
        <li><a href="/privacy">Privacy</a></li>
        <li><a href="/terms">Terms</a></li>
      </ul>
    </div>
  </div>
</footer>`;
}

// ── Scroll + fade-in scripts (matches index.html) ──
//
// The Mira chat FAB used to live here, but it lazy-loaded /public/mira-chat.js
// which calls POST /api/mira/session — an endpoint that was never implemented
// on mira-web. Every blog visitor that opened the widget got a 404. The CTA
// cards on each blog page already point readers at /cmms (the authenticated
// chat). Removed the FAB until /api/mira/session has a real backend.
// See CRA-60 / GitHub #992.

function scripts(): string {
  return `<script>
  (function(){var n=document.getElementById('main-nav');function u(){n.classList.toggle('scrolled',window.scrollY>10)}window.addEventListener('scroll',u,{passive:true});u()})();
  (function(){if(!window.IntersectionObserver)return;var o=new IntersectionObserver(function(e){e.forEach(function(x){if(x.isIntersecting)x.target.classList.add('visible')})},{threshold:0.08});document.querySelectorAll('.fade-in').forEach(function(el){o.observe(el)})})();
</script>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Blog post page
// ═══════════════════════════════════════════════════════════════════════════

export function renderBlogPost(
  post: BlogPost,
  allPosts: BlogPost[],
  allCodes: FaultCode[],
): string {
  const canonical = `${BASE_URL}/blog/${post.slug}`;

  const related = post.relatedPosts
    .map((slug) => allPosts.find((p) => p.slug === slug))
    .filter(Boolean) as BlogPost[];
  const relatedCodes = post.relatedFaultCodes
    .map((slug) => allCodes.find((c) => c.slug === slug))
    .filter(Boolean) as FaultCode[];

  const jsonLd = `<script type="application/ld+json">
  ${JSON.stringify(
    {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "Article",
          headline: post.title,
          description: post.description,
          url: canonical,
          datePublished: post.date,
          // Stable: actual last-edit date, NOT the render date. Falls back to
          // the publish date when the post hasn't been revised.
          dateModified: post.updated ?? post.date,
          author: { "@type": "Organization", name: "FactoryLM" },
          publisher: {
            "@type": "Organization",
            name: "FactoryLM",
            logo: { "@type": "ImageObject", url: `${BASE_URL}/public/icons/mira-512.png` },
          },
          mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
        },
        breadcrumbLd([
          { name: "Home", url: `${BASE_URL}/` },
          { name: "Blog", url: `${BASE_URL}/blog` },
          { name: post.title, url: canonical },
        ]),
      ],
    },
    null,
    2,
  )}
  </script>`;

  return `${htmlHead({ title: `${post.title} | FactoryLM`, description: post.description, canonical, jsonLd })}
<body>
${nav({ currentPath: "/blog" })}

<main>
<article class="article-wrap">
  <div class="breadcrumb">
    <a href="/">Home</a> &rsaquo; <a href="/blog">Blog</a> &rsaquo; ${escHtml(post.category)}
  </div>

  <h1>${escHtml(post.title)}</h1>
  <div class="meta-line">
    <span class="meta-tag">${escHtml(post.category)}</span>
    <span>${escHtml(post.date)}</span>
    <span>${escHtml(post.readingTime)}</span>
  </div>

  ${post.sections.map(renderSection).join("\n\n  ")}

  ${buildRelatedHtml(related, relatedCodes)}

  <div class="cta-card fade-in">
    <h3>Try Mira — AI that reads your equipment manuals</h3>
    <p>Type a fault code, describe a symptom, or upload a photo. Get the diagnostic answer in seconds.</p>
    <a href="/cmms" class="btn-primary">Try free ${ARROW_SVG}</a>
  </div>
</article>

</main>

${siteFooter()}
${scripts()}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fault code article page
// ═══════════════════════════════════════════════════════════════════════════

export function renderFaultCodePage(
  fc: FaultCode,
  allCodes: FaultCode[],
): string {
  const canonical = `${BASE_URL}/blog/${fc.slug}`;
  const causes = fc.commonCauses.map((c) => `      <li>${escHtml(c)}</li>`).join("\n");
  const fixSteps = fc.recommendedFix
    .split("\n")
    .map((s) => s.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .map((s) => `      <li>${escHtml(s)}</li>`)
    .join("\n");

  const related = fc.relatedCodes
    .map((slug) => allCodes.find((c) => c.slug === slug))
    .filter(Boolean) as FaultCode[];

  const relatedHtml =
    related.length > 0
      ? `<div class="related">
    <h2>Related Fault Codes</h2>
    <ul>
${related.map((r) => `      <li><a href="/blog/${r.slug}">${escHtml(r.title)}</a></li>`).join("\n")}
    </ul>
  </div>`
      : "";

  const fixStepsLd = fc.recommendedFix
    .split("\n")
    .map((s) => s.replace(/^\d+\.\s*/, "").trim())
    .filter(Boolean)
    .map((text, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: text.split(".")[0] ?? text,
      text,
    }));

  const jsonLd = `<script type="application/ld+json">
  ${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "TroubleshootingGuide",
        "@id": `${canonical}#guide`,
        name: fc.title,
        description: fc.metaDescription,
        url: canonical,
        // Stable dates — see CONTENT_EPOCH. Previously the render date, which
        // made every fault-code page look modified on every crawl.
        datePublished: CONTENT_EPOCH,
        dateModified: fc.updated ?? CONTENT_EPOCH,
        author: { "@type": "Organization", name: "FactoryLM", url: BASE_URL },
        publisher: {
          "@type": "Organization",
          name: "FactoryLM",
          logo: { "@type": "ImageObject", url: `${BASE_URL}/public/icons/mira-512.png` },
        },
        about: {
          "@type": "Product",
          name: fc.equipment,
          manufacturer: { "@type": "Organization", name: fc.manufacturer },
        },
        step: fixStepsLd,
        mainEntity: {
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: `What does ${fc.faultCode} mean on ${fc.equipment}?`,
              acceptedAnswer: { "@type": "Answer", text: fc.description },
            },
            {
              "@type": "Question",
              name: `What causes ${fc.faultCode} on ${fc.equipment}?`,
              acceptedAnswer: {
                "@type": "Answer",
                text: fc.commonCauses.join(" "),
              },
            },
            {
              "@type": "Question",
              name: `How do I fix ${fc.faultCode} on ${fc.equipment}?`,
              acceptedAnswer: { "@type": "Answer", text: fc.recommendedFix },
            },
          ],
        },
      },
      breadcrumbLd([
        { name: "Home", url: `${BASE_URL}/` },
        { name: "Blog", url: `${BASE_URL}/blog` },
        { name: "Fault Codes", url: `${BASE_URL}/blog/fault-codes` },
        { name: fc.faultCode, url: canonical },
      ]),
    ],
  }, null, 2)}
  </script>`;

  return `${htmlHead({ title: `${fc.title} | FactoryLM`, description: fc.metaDescription, canonical, jsonLd })}
<body>
${nav({ currentPath: "/blog" })}

<main>
<article class="article-wrap">
  <div class="breadcrumb">
    <a href="/">Home</a> &rsaquo; <a href="/blog">Blog</a> &rsaquo; <a href="/blog/fault-codes">Fault Codes</a> &rsaquo; ${escHtml(fc.faultCode)}
  </div>

  <h1>${escHtml(fc.title)}</h1>
  <div class="meta-line">
    <span class="meta-tag">Fault Code</span>
    <span>${escHtml(fc.equipment)}</span>
    <span>${escHtml(fc.manufacturer)}</span>
  </div>

  <h2>What This Fault Means</h2>
  <p>${escHtml(fc.description)}</p>

  <h2>Common Causes</h2>
  <ul>
${causes}
  </ul>

  <h2>Recommended Fix</h2>
  <ol>
${fixSteps}
  </ol>

  ${relatedHtml}

  <div class="cta-card fade-in">
    <h3>Still stuck? Ask Mira.</h3>
    <p>Paste your fault code into Mira and get an answer from your actual equipment manuals in seconds.</p>
    <a href="/cmms" class="btn-primary">Try free ${ARROW_SVG}</a>
  </div>
</article>

</main>

${siteFooter()}
${scripts()}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Blog index (articles + fault code library link)
// ═══════════════════════════════════════════════════════════════════════════

export function renderBlogIndex(
  posts: BlogPost[],
  faultCodeCount: number,
): string {
  const canonical = `${BASE_URL}/blog`;
  const sorted = [...posts].sort((a, b) => b.date.localeCompare(a.date));

  const postCards = sorted
    .map(
      (p) => `      <a href="/blog/${p.slug}" class="post-card fade-in">
        <div class="post-hero">${escHtml(p.heroEmoji)}</div>
        <div class="post-meta">
          <span class="meta-tag">${escHtml(p.category)}</span>
          <span>${escHtml(p.readingTime)}</span>
        </div>
        <div class="post-title">${escHtml(p.title)}</div>
        <div class="post-desc">${escHtml(p.description.slice(0, 140))}${p.description.length > 140 ? "\u2026" : ""}</div>
      </a>`,
    )
    .join("\n");

  const jsonLd = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Blog",
    "name": "FactoryLM Blog",
    "description": "Maintenance guides, fault code troubleshooting, and industrial AI insights for field technicians.",
    "url": ${JSON.stringify(canonical)},
    "publisher": { "@type": "Organization", "name": "FactoryLM" }
  }
  </script>`;

  return `${htmlHead({
    title: "FactoryLM Blog \u2014 Maintenance Guides & Fault Code Troubleshooting",
    description: "Practical maintenance guides, VFD troubleshooting, PLC fault fixes, and industrial AI insights. Written by engineers for field technicians.",
    canonical,
    ogType: "website",
    jsonLd,
  })}
<body>
${nav({ currentPath: "/blog" })}

<main>
<div class="blog-hero">
  <div class="section-label fade-in">Blog</div>
  <h1 class="fade-in">Maintenance guides from<br>the factory floor</h1>
  <p class="fade-in">Practical troubleshooting, diagnostic techniques, and industry insights. Written by engineers for field technicians.</p>
</div>

<div class="inner">
  <section class="blog-section">
    <h2>Latest Articles</h2>
    <div class="post-grid">
${postCards}
    </div>
  </section>

  <section class="blog-section">
    <h2>Reference</h2>
    <a href="/blog/fault-codes" class="fc-library-card fade-in">
      <div class="fc-lib-text">
        <h3>Equipment Fault Code Library</h3>
        <p>${faultCodeCount} free troubleshooting guides \u2014 Allen-Bradley, PowerFlex, ABB, Yaskawa, Siemens, FANUC, and more.</p>
      </div>
      <span class="btn-ghost">Browse ${ARROW_SVG}</span>
    </a>
  </section>
</div>

<div class="inner" style="padding-bottom: 48px;">
  <div class="cta-card fade-in">
    <h3>Get answers faster with MIRA AI</h3>
    <p>Type a fault code and get the fix from your equipment manuals in seconds.</p>
    <a href="/cmms" class="btn-primary">Try free ${ARROW_SVG}</a>
  </div>
</div>

</main>

${siteFooter()}
${scripts()}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Fault code library index
// ═══════════════════════════════════════════════════════════════════════════

export function renderFaultCodeIndex(faultCodes: FaultCode[]): string {
  const canonical = `${BASE_URL}/blog/fault-codes`;

  const grouped = new Map<string, FaultCode[]>();
  for (const fc of faultCodes) {
    const list = grouped.get(fc.manufacturer) ?? [];
    list.push(fc);
    grouped.set(fc.manufacturer, list);
  }

  const sections = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([mfr, codes]) => `  <section class="mfr-section fade-in">
    <h2>${escHtml(mfr)}</h2>
    <div class="card-grid">
${codes
  .map(
    (fc) => `      <a href="/blog/${fc.slug}" class="fc-card">
        <div class="code">${escHtml(fc.faultCode)}</div>
        <div class="card-title">${escHtml(fc.title.replace(/^.*?\u2014\s*/, ""))}</div>
        <div class="card-desc">${escHtml(fc.metaDescription.slice(0, 120))}${fc.metaDescription.length > 120 ? "\u2026" : ""}</div>
      </a>`,
  )
  .join("\n")}
    </div>
  </section>`,
    )
    .join("\n\n");

  const jsonLd = `<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    "name": "Equipment Fault Code Library",
    "description": "Troubleshooting guides for industrial fault codes \u2014 Allen-Bradley, PowerFlex, GS20, FANUC, Siemens, ABB, Yaskawa, and more.",
    "url": ${JSON.stringify(canonical)},
    "publisher": { "@type": "Organization", "name": "FactoryLM" }
  }
  </script>`;

  return `${htmlHead({
    title: "Equipment Fault Code Library \u2014 Troubleshooting Guides | FactoryLM",
    description: "Free troubleshooting guides for Allen-Bradley, PowerFlex, GS20, FANUC, Siemens, ABB, and Yaskawa fault codes. Common causes and step-by-step fixes.",
    canonical,
    ogType: "website",
    jsonLd,
  })}
<body>
${nav({ currentPath: "/blog" })}

<main>
<div class="blog-hero">
  <div class="section-label fade-in">Reference</div>
  <h1 class="fade-in">Equipment Fault Code Library</h1>
  <p class="fade-in">Free troubleshooting guides written by maintenance engineers. Common causes, step-by-step fixes, and when to call for help.</p>
</div>

<div class="inner">
${sections}

  <div class="cta-card fade-in" style="margin-bottom: 48px;">
    <h3>Can\u2019t find your fault code?</h3>
    <p>Ask Mira \u2014 AI that reads your equipment manuals and gives you the answer in seconds.</p>
    <a href="/cmms" class="btn-primary">Try free ${ARROW_SVG}</a>
  </div>
</div>

</main>

${siteFooter()}
${scripts()}
</body>
</html>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Section renderer
// ═══════════════════════════════════════════════════════════════════════════

function renderSection(s: BlogSection): string {
  switch (s.type) {
    case "heading":
      return `<h2>${escHtml(s.text!)}</h2>`;
    case "paragraph":
      return `<p>${escHtml(s.text!)}</p>`;
    case "list": {
      const tag = s.ordered ? "ol" : "ul";
      const items = (s.items ?? []).map((i) => `      <li>${escHtml(i)}</li>`).join("\n");
      return `<${tag}>\n${items}\n    </${tag}>`;
    }
    case "callout": {
      const label =
        s.variant === "tip" ? "Tip" : s.variant === "warning" ? "Warning" : "Note";
      return `<div class="callout ${s.variant ?? "info"}">
      <div class="callout-label">${label}</div>
      <p>${escHtml(s.text!)}</p>
    </div>`;
    }
    case "quote":
      return `<blockquote>
      <p>${escHtml(s.text!)}</p>
      ${s.attribution ? `<cite>\u2014 ${escHtml(s.attribution)}</cite>` : ""}
    </blockquote>`;
    default:
      return "";
  }
}

// ── Related section ──

function buildRelatedHtml(posts: BlogPost[], codes: FaultCode[]): string {
  if (posts.length === 0 && codes.length === 0) return "";
  const parts: string[] = [];

  if (posts.length > 0) {
    parts.push(`<h2>Related Articles</h2>
    <ul>
${posts.map((p) => `      <li><a href="/blog/${p.slug}">${escHtml(p.title)}</a></li>`).join("\n")}
    </ul>`);
  }
  if (codes.length > 0) {
    parts.push(`<h2>Related Fault Codes</h2>
    <ul>
${codes.map((c) => `      <li><a href="/blog/${c.slug}">${escHtml(c.title)}</a></li>`).join("\n")}
    </ul>`);
  }

  return `<div class="related">\n    ${parts.join("\n\n    ")}\n  </div>`;
}

// ── Helpers ──

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

export interface HeadOpts {
  title: string;
  description: string;
  canonical?: string;
  ogImage?: string;
  ogTitle?: string;
  ogDescription?: string;
  jsonLd?: object;
}

const DEFAULT_OG_IMAGE = "https://factorylm.com/og-default.png";
const SITE_NAME = "FactoryLM";

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function head(opts: HeadOpts, reqUrl?: string): string {
  const desc = truncate(opts.description, 160);
  const canonical = opts.canonical ?? (reqUrl ? new URL(reqUrl).href : "https://factorylm.com/");
  const ogTitle = opts.ogTitle ?? opts.title;
  const ogDesc = opts.ogDescription ?? desc;
  const ogImage = opts.ogImage ?? DEFAULT_OG_IMAGE;

  const jsonLdBlock = opts.jsonLd
    ? `<script type="application/ld+json">${JSON.stringify(opts.jsonLd)}</script>`
    : "";

  return `<meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${opts.title}</title>
  <meta name="description" content="${desc}">
  <link rel="canonical" href="${canonical}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${SITE_NAME}">
  <meta property="og:title" content="${ogTitle}">
  <meta property="og:description" content="${ogDesc}">
  <meta property="og:image" content="${ogImage}">
  <meta property="og:url" content="${canonical}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${ogTitle}">
  <meta name="twitter:description" content="${ogDesc}">
  <meta name="twitter:image" content="${ogImage}">
  <link rel="stylesheet" href="/_tokens.css">
  <link rel="stylesheet" href="/_components.css">
  <link rel="manifest" href="/manifest.json">
  <meta name="theme-color" content="#1B365D">
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
  <script src="/posthog-init.js"></script>
  <script>(function(){try{if(localStorage.getItem('fl_sun_mode')==='1')document.documentElement.classList.add('sun-pre');}catch(e){}})()</script>
  ${jsonLdBlock}`;
}

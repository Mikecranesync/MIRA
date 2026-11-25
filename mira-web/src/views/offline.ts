/**
 * /offline — MIRA running on a tablet with no network connection.
 *
 * "MIRA works offline" is the owner's statement (Mike, 2026-11-16). The
 * specifics below trace to the edge-profile work under #5265 (#5266, #5301,
 * #5303, #5306) and its Galaxy Tab S9 FE field runs. Do not add a duration
 * (e.g. 180 days), a determinism claim or a network-isolation guarantee
 * until the owner confirms it with a receipt; those stay under "Next".
 */
import { head } from "../lib/head.js";
import { btnPrimary } from "../lib/components.js";
import { navbar, footer, TALK_TO_MIKE_HREF } from "./_topbar.js";
import { SECURITY_PAGE_STYLES } from "./security.js";

const SUMMARY =
  "MIRA runs on a tablet with no internet connection. Your manuals live on the device, and answers come straight from them with the page cited.";

const WORKS = [
  {
    lead: "No connection needed.",
    body: "Manuals, search and answers all run on the tablet. Nothing waits on a cloud service.",
  },
  {
    lead: "Answers are the manual's own words.",
    body: "Offline, MIRA quotes the matching manual passages with their page numbers. No AI model writes or rewrites the answer.",
  },
  {
    lead: "Cloud services are locked out.",
    body: "The offline build refuses to start if a cloud AI key or other listed service key is set, or if a listed service address points off the device.",
  },
  {
    lead: "Manual cautions stay with the answer.",
    body: "A WARNING or CAUTION printed on a cited page is shown with the passage. A report that sounds unsafe gets a safety notice instead of passages.",
  },
  {
    lead: "Runs on a standard Android tablet.",
    body: "Demonstrated on a Samsung Galaxy Tab S9 FE.",
  },
];

const NEXT = [
  {
    lead: "Independent network verification.",
    body: "A monitored, network-blocked run to show what the tablet sends, if anything.",
  },
  {
    lead: "Long disconnected deployments.",
    body: "Validating extended periods off the network, and how manual updates reach a tablet that stays offline.",
  },
  {
    lead: "Managed install, update, backup and restore.",
    body: "Scripts and a runbook are written and moving to field testing.",
  },
  {
    lead: "Security authorization.",
    body: "No government security authorization yet. See the <a href=\"/trust#compliance\">compliance status</a>.",
  },
];

function list(items: Array<{ lead: string; body: string }>): string {
  return items.map(({ lead, body }) => `<li><strong>${lead}</strong> ${body}</li>`).join("\n      ");
}

export function renderOffline(reqUrl?: string): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "MIRA offline — FactoryLM",
    "description": SUMMARY,
    "url": "https://factorylm.com/offline",
    "publisher": {
      "@type": "Organization",
      "name": "FactoryLM",
      "url": "https://factorylm.com",
    },
  };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  ${head(
    {
      title: "MIRA offline — FactoryLM",
      description: SUMMARY,
      canonical: "https://factorylm.com/offline",
      ogTitle: "MIRA works offline",
      ogDescription: SUMMARY,
      jsonLd,
    },
    reqUrl,
  )}
  <link rel="stylesheet" href="/_dark-theme.css">
  <style>${SECURITY_PAGE_STYLES}</style>
</head>
<body>
  ${navbar({ ctaPrefix: "offline" })}

  <section class="fl-sec-hero">
    <div class="fl-sec-hero-inner">
      <p class="fl-sec-eyebrow">Offline</p>
      <h1 class="fl-sec-h1">MIRA works offline</h1>
      <p class="fl-sec-sub">${SUMMARY}</p>
    </div>
  </section>

  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">How it works without a network</h2>
    <ul class="fl-sec-list">
      ${list(WORKS)}
    </ul>
  </div>

  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">What's next</h2>
    <ul class="fl-sec-list">
      ${list(NEXT)}
    </ul>
  </div>

  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">Offline and web, side by side</h2>
    <ul class="fl-sec-list">
      <li><strong>Offline tablet:</strong> no AI model and no cloud service. The answer is the manual's own text with its page.</li>
      <li><strong>Web version:</strong> cloud AI providers (OpenAI, then OpenRouter) write answers from your uploaded manuals, and data is hosted as listed on the <a href="/trust">trust page</a>.</li>
    </ul>
  </div>

  <div class="fl-sec-cta">
    ${btnPrimary("See it offline", { href: TALK_TO_MIKE_HREF, cta: "offline-cta-talk" })}
    <p>
      Want a demonstration on a disconnected tablet? Talk to Mike at
      <a href="mailto:mike@factorylm.com">mike@factorylm.com</a>.
    </p>
  </div>

  ${footer({ ctaPrefix: "offline" })}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

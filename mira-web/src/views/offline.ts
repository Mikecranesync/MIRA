/**
 * /offline — where the disconnected (edge) tablet build stands.
 *
 * Every line here is backed by the edge-profile work tracked in #5265
 * (draft PRs #5266, #5300, #5301, #5303, #5304, #5306, #5317 as of
 * 2026-11-16). None of it is merged or shipped, so the page leads with that.
 * Do not add a capability here until it is merged and field-tested; move a
 * line from "not proven" to "does" only with a receipt.
 */
import { head } from "../lib/head.js";
import { btnPrimary } from "../lib/components.js";
import { navbar, footer, TALK_TO_MIKE_HREF } from "./_topbar.js";
import { SECURITY_PAGE_STYLES } from "./security.js";

const STATUS =
  "A test build on one tablet. It is not available to customers yet, and nothing on this page is a delivery commitment.";

const DOES = [
  {
    lead: "Answers come from manuals stored on the tablet.",
    body: "The test build quotes the matching manual passages with their page numbers. No AI model writes the answer.",
  },
  {
    lead: "It refuses to start with cloud keys configured.",
    body: "If a cloud AI key or other listed service key is set, or a listed service address points off the device, the build stops at start-up and names the setting.",
  },
  {
    lead: "Manual cautions stay with the answer.",
    body: "A WARNING or CAUTION printed on a cited page is shown with the passage. When a report sounds unsafe and can't be checked, the build gives a safety notice instead of passages.",
  },
  {
    lead: "Tested on a Samsung Galaxy Tab S9 FE.",
    body: "Run with no AI model process on the tablet, against a public-domain technical manual.",
  },
];

const NOT_PROVEN = [
  {
    lead: "That no data leaves the device.",
    body: "The start-up check covers configuration only. A few features that take a web address from the user are not blocked yet, and we have not run a monitored network-blocked test.",
  },
  {
    lead: "Long disconnected operation.",
    body: "We have not tested weeks or months without a network, or how manuals and updates reach a tablet that stays offline.",
  },
  {
    lead: "Answer quality on the tablet.",
    body: "For some \"how do I\" questions the passages come from a glossary or preface page instead of the procedure.",
  },
  {
    lead: "Install, update, backup and restore.",
    body: "Scripts and a runbook are written and not yet field-tested.",
  },
  {
    lead: "Security authorization.",
    body: "The tablet build has no government security authorization. See the <a href=\"/trust#compliance\">compliance status</a>.",
  },
];

function list(items: Array<{ lead: string; body: string }>): string {
  return items.map(({ lead, body }) => `<li><strong>${lead}</strong> ${body}</li>`).join("\n      ");
}

export function renderOffline(reqUrl?: string): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Offline use — FactoryLM",
    "description": STATUS,
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
      title: "Offline use — FactoryLM",
      description: "Where FactoryLM's offline tablet build stands: what it does in testing and what isn't proven yet.",
      canonical: "https://factorylm.com/offline",
      ogTitle: "Running MIRA without a network",
      ogDescription: STATUS,
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
      <p class="fl-sec-eyebrow">In testing</p>
      <h1 class="fl-sec-h1">Running MIRA without a network</h1>
      <p class="fl-sec-sub">${STATUS}</p>
    </div>
  </section>

  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">What the test build does</h2>
    <ul class="fl-sec-list">
      ${list(DOES)}
    </ul>
  </div>

  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">What we have not proven yet</h2>
    <ul class="fl-sec-list">
      ${list(NOT_PROVEN)}
    </ul>
  </div>

  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">How it differs from the web version</h2>
    <ul class="fl-sec-list">
      <li><strong>Web version:</strong> answers are written by cloud AI providers (OpenAI, then OpenRouter) from your uploaded manuals, and data is hosted as listed on the <a href="/trust">trust page</a>.</li>
      <li><strong>Tablet test build:</strong> no AI model and no cloud service. The answer is the manual's own text with its page.</li>
    </ul>
  </div>

  <div class="fl-sec-cta">
    ${btnPrimary("Talk to Mike", { href: TALK_TO_MIKE_HREF, cta: "offline-cta-talk" })}
    <p>
      Need disconnected use for your site? Tell us what you need it to do.
      <a href="mailto:mike@factorylm.com">mike@factorylm.com</a>
    </p>
  </div>

  ${footer({ ctaPrefix: "offline" })}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

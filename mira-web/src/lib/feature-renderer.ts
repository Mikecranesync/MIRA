/**
 * Server-side HTML renderer for /feature/:slug pages.
 *
 * Each feature has a hero, an optional Loom video, a long-form description,
 * a benefits grid, and a Talk to Mike contact link from the capabilities
 * registry. Feature copy is proven claims only. No pilot/credit offer here:
 * new offers belong in the canonical FactoryLM shell (Codex iteration 3 F1).
 *
 * Aesthetic: industrial HMI / telemetry overlay. Matches index.html's dark
 * gray + amber + Inter vocabulary but pushes HMI details harder (corner
 * registration marks, telemetry row numbers, LED status dots, pulse rings).
 *
 * Video URLs come from env vars — each feature has a dedicated env var name.
 * If unset, a "coming soon" placeholder renders. No redeploy needed to swap
 * in real Loom URLs: just update Doppler and restart mira-web.
 */

import {
  loadCapabilities,
  provenText,
  type CapabilitiesFile,
} from "../capabilities/marketing-claims/index.js";
import { serializeJsonLd } from "./html.js";

const BASE_URL = "https://factorylm.com";

function provenOrThrow(id: string, data: CapabilitiesFile): string {
  const text = provenText(id, data);
  if (!text) throw new Error(`feature copy requires proven claim ${id}`);
  return text;
}

export interface FeatureSlide {
  header: string;
  badge?: { label: string; tone: "green" | "amber" | "red" };
  rows: Array<{ label: string; value: string; accent?: "amber" | "teal" | "red" }>;
}

export interface FeatureScreenshot {
  src: string;
  alt: string;
  caption: string;
  description: string;
}

export interface FeatureBenefit {
  label: string;
  title: string;
  body: string;
}

export interface Feature {
  slug: string;
  category: string;
  title: string;
  tagline: string[];
  lede: string;
  longBody: string[];
  slides: FeatureSlide[];
  screenshots: FeatureScreenshot[];
  benefits: FeatureBenefit[];
  videoEnvVar: string;
  videoCaption: string;
}

export function featuresFromRegistry(
  data: CapabilitiesFile = loadCapabilities(),
): Record<string, Feature> {
  const cited = provenOrThrow("notebook-cited-answer", data);
  const notebook = provenOrThrow("equipment-notebook-not-cmms", data);
  const notCmms = provenOrThrow("not-a-cmms", data);
  const noWrite = provenOrThrow("no-plc-or-work-order-write", data);
  const manuals = provenOrThrow("qualified-manuals-only", data);
  const saysNo = provenOrThrow("says-when-not-covered", data);
  const desktop = provenOrThrow("desktop-citation-opens-page", data);
  const continuity = provenOrThrow("web-android-continuity", data);
  const faultPage = provenOrThrow("fault-code-right-page", data);
  const connectors = data.chrome.connectors_note;

  return {
  "fault-diagnosis": {
    slug: "fault-diagnosis",
    category: "Fault Diagnosis",
    title: "Fault Diagnosis | FactoryLM",
    tagline: ["Cited answers from", "your manuals"],
    lede: cited,
    longBody: [
      cited,
      saysNo,
      faultPage,
      manuals,
    ],
    slides: [
      {
        header: "INCOMING — FAULT CODE",
        badge: { label: "SIGNAL", tone: "green" },
        rows: [
          { label: "User", value: "Line 3 tech — iPhone" },
          { label: "Input", value: "F004 on PowerFlex 525" },
          { label: "Context", value: "Second trip today, same fault" },
          { label: "Mode", value: "Voice + typed" },
        ],
      },
      {
        header: "MIRA — SEARCHING",
        badge: { label: "PROCESSING", tone: "amber" },
        rows: [
          { label: "Matched", value: "PowerFlex 525 manual" },
          { label: "Cited page", value: "When the manual covers it" },
          { label: "If missing", value: "Says it can't find it" },
          { label: "Guessing", value: "None" },
        ],
      },
      {
        header: "CITED ANSWER",
        badge: { label: "DELIVERED", tone: "green" },
        rows: [
          { label: "Fault", value: "F004 — UnderVoltage" },
          { label: "From", value: "Uploaded OEM manual" },
          { label: "Citation", value: "Opens the cited page on desktop" },
          { label: "Source", value: "PowerFlex 525 manual", accent: "teal" },
        ],
      },
      {
        header: "LIMIT — NO WRITE",
        badge: { label: "PROVEN", tone: "green" },
        rows: [
          { label: "Work order", value: "Not written" },
          { label: "PLC data", value: "Not ingested" },
          { label: "CMMS", value: "Optional, not yet available" },
          { label: "Stands", value: "MIRA stands alone", accent: "teal" },
        ],
      },
    ],
    screenshots: [
      { src: "/public/screenshots/fault-diagnosis-01.webp", alt: "User asks MIRA about a PowerFlex 525 fault code", caption: "Ask a fault code", description: cited },
      { src: "/public/screenshots/fault-diagnosis-02.webp", alt: "MIRA streaming a diagnostic response with manual citations", caption: "Cited diagnosis", description: saysNo },
      { src: "/public/screenshots/fault-diagnosis-03.webp", alt: "Full diagnostic response with a manual citation", caption: "Cited answer", description: desktop },
      { src: "/public/screenshots/fault-diagnosis-04.webp", alt: "Conversation showing MIRA does not write work orders", caption: "MIRA stands alone", description: noWrite },
    ],
    benefits: [
      {
        label: "CITED",
        title: "Answers from your manuals show the page",
        body: cited,
      },
      {
        label: "HONEST",
        title: "No guess when the manual doesn't cover it",
        body: saysNo,
      },
      {
        label: "TESTED",
        title: "Rockwell, Festo, and ABB so far",
        body: manuals,
      },
    ],
    videoEnvVar: "LOOM_FEATURE_FAULT_DIAGNOSIS_URL",
    videoCaption: "MIRA cites the page from an uploaded OEM manual",
  },

  "cmms-integration": {
    slug: "cmms-integration",
    category: "CMMS (optional)",
    title: "MIRA is not a CMMS | FactoryLM",
    tagline: ["Not a CMMS.", "MIRA stands alone."],
    lede: `${notCmms} ${connectors}`,
    longBody: [
      notCmms,
      noWrite,
      connectors,
      notebook,
    ],
    slides: [
      {
        header: "WHAT MIRA IS",
        badge: { label: "PROVEN", tone: "green" },
        rows: [
          { label: "Product", value: "Equipment notebook" },
          { label: "Answers", value: "From uploaded OEM manuals" },
          { label: "Citation", value: "Page when covered" },
          { label: "CMMS", value: "Not required", accent: "teal" },
        ],
      },
      {
        header: "WHAT IT DOES NOT DO",
        badge: { label: "LIMIT", tone: "amber" },
        rows: [
          { label: "Replace yours", value: "No — nothing to switch" },
          { label: "PLC data", value: "Not taken" },
          { label: "Work orders", value: "Not written" },
          { label: "Connectors", value: "Optional, not yet available", accent: "amber" },
        ],
      },
      {
        header: "STANDS ALONE",
        badge: { label: "READY", tone: "green" },
        rows: [
          { label: "Manuals", value: "Your OEM PDFs" },
          { label: "CMMS", value: "Keep yours" },
          { label: "Required", value: "No connector needed", accent: "teal" },
        ],
      },
      {
        header: "NOT YET",
        badge: { label: "HOLD", tone: "amber" },
        rows: [
          { label: "Vendor sync", value: "Not shipped" },
          { label: "Auto work orders", value: "Not claimed" },
          { label: "Write path", value: "Closed" },
          { label: "Status", value: connectors, accent: "amber" },
        ],
      },
    ],
    screenshots: [
      { src: "/public/screenshots/cmms-integration-01.webp", alt: "MIRA notebook standing alone without a CMMS", caption: "MIRA stands alone", description: notCmms },
      { src: "/public/screenshots/cmms-integration-02.webp", alt: "Cited answer from an uploaded manual", caption: "Cited from manuals", description: cited },
      { src: "/public/screenshots/cmms-integration-03.webp", alt: "Limitations: no PLC data, no work-order writes", caption: "No writes", description: noWrite },
      { src: "/public/screenshots/cmms-integration-04.webp", alt: "CMMS connectors marked optional and not yet available", caption: "Connectors later", description: connectors },
    ],
    benefits: [
      {
        label: "ALONE",
        title: "Nothing to switch",
        body: notCmms,
      },
      {
        label: "NO WRITE",
        title: "No PLC, no work-order records",
        body: noWrite,
      },
      {
        label: "OPTIONAL",
        title: "Connectors are not required",
        body: connectors,
      },
    ],
    videoEnvVar: "LOOM_FEATURE_CMMS_URL",
    videoCaption: "MIRA stands alone — it is not a CMMS and does not write work orders",
  },

  "voice-vision": {
    slug: "voice-vision",
    category: "Web + Android",
    title: "Web and Android continuity | FactoryLM",
    tagline: ["Ask on the web.", "Continue on Android."],
    lede: continuity,
    longBody: [
      continuity,
      cited,
      desktop,
      saysNo,
    ],
    slides: [
      {
        header: "WEB — ASK",
        badge: { label: "PROVEN", tone: "green" },
        rows: [
          { label: "Surface", value: "Equipment notebook" },
          { label: "Input", value: "Question + uploaded manual" },
          { label: "Output", value: "Cited page when covered" },
          { label: "Guess", value: "None", accent: "teal" },
        ],
      },
      {
        header: "ANDROID — CONTINUE",
        badge: { label: "EMULATOR", tone: "amber" },
        rows: [
          { label: "Start", value: "Web conversation" },
          { label: "Continue", value: "Android app and back" },
          { label: "Tested", value: "Emulator, not a physical phone" },
          { label: "APK", value: "Real Pixel build", accent: "teal" },
        ],
      },
      {
        header: "CITATION",
        badge: { label: "DESKTOP", tone: "green" },
        rows: [
          { label: "Tap", value: "Opens the cited page" },
          { label: "Where", value: "Desktop proven" },
          { label: "Phone view", value: "Not proven" },
          { label: "Manual", value: "Your upload", accent: "teal" },
        ],
      },
      {
        header: "NOT CLAIMED",
        badge: { label: "HOLD", tone: "amber" },
        rows: [
          { label: "Photo ID", value: "Not a proven capability" },
          { label: "Spoken RCA", value: "Not a proven path" },
          { label: "Work order", value: "Not written" },
          { label: "Connectors", value: "Optional, not yet available", accent: "amber" },
        ],
      },
    ],
    screenshots: [
      { src: "/public/screenshots/voice-vision-01.webp", alt: "Ask a question in the equipment notebook on the web", caption: "Ask on the web", description: cited },
      { src: "/public/screenshots/voice-vision-02.webp", alt: "Conversation continuing in the Android app", caption: "Continue on Android", description: continuity },
      { src: "/public/screenshots/voice-vision-03.webp", alt: "Desktop citation opening the cited manual page", caption: "Citation opens the page", description: desktop },
      { src: "/public/screenshots/voice-vision-04.webp", alt: "MIRA saying it cannot find the answer in the attached manual", caption: "No guess", description: saysNo },
    ],
    benefits: [
      {
        label: "WEB",
        title: "Cited answers in the notebook",
        body: cited,
      },
      {
        label: "ANDROID",
        title: "The conversation continues",
        body: continuity,
      },
      {
        label: "DESKTOP",
        title: "Tap a citation, open the page",
        body: desktop,
      },
    ],
    videoEnvVar: "LOOM_FEATURE_VOICE_VISION_URL",
    videoCaption: "A conversation started on the web continues in the Android app",
  },
  };
}

export const FEATURES = featuresFromRegistry();

// ───────────────────────────────────────────────────────────────────────
// Template rendering
// ───────────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escAttr(s: string): string {
  return escHtml(s);
}

function isValidLoomUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.hostname === "www.loom.com" || u.hostname === "loom.com";
  } catch {
    return false;
  }
}

function normaliseLoomUrl(url: string): string {
  // Accept /share/ URLs and rewrite to /embed/ since share URLs set
  // X-Frame-Options=deny and cannot be iframed.
  return url.replace(/\/share\//, "/embed/");
}

function renderVideo(feature: Feature): string {
  const raw = process.env[feature.videoEnvVar];
  if (isValidLoomUrl(raw)) {
    const embed = normaliseLoomUrl(raw!);
    return `
    <div class="video-frame" role="region" aria-label="${escAttr(feature.videoCaption)}">
      <div class="video-frame-bar">
        <div class="video-frame-dot"></div>
        <div class="video-frame-dot"></div>
        <div class="video-frame-dot"></div>
        <div class="video-frame-label">LOOM // ${escHtml(feature.category.toUpperCase())}</div>
      </div>
      <div class="video-frame-body">
        <iframe
          src="${escAttr(embed)}"
          frameborder="0"
          allow="autoplay; fullscreen; picture-in-picture"
          allowfullscreen
          title="${escAttr(feature.videoCaption)}"
          loading="lazy"
        ></iframe>
      </div>
      <p class="video-caption">${escHtml(feature.videoCaption)}</p>
    </div>`;
  }
  // Placeholder
  return `
    <div class="video-frame video-placeholder" role="region" aria-label="Video walkthrough — coming soon">
      <div class="video-frame-bar">
        <div class="video-frame-dot"></div>
        <div class="video-frame-dot"></div>
        <div class="video-frame-dot"></div>
        <div class="video-frame-label">LOOM // ${escHtml(feature.category.toUpperCase())} — PENDING</div>
      </div>
      <div class="video-frame-body video-placeholder-body">
        <div class="placeholder-status">
          <span class="placeholder-led"></span>
          <span class="placeholder-label">AWAITING SIGNAL</span>
        </div>
        <div class="placeholder-title">Video walkthrough — coming soon</div>
        <div class="placeholder-desc">
          ${escHtml(feature.videoCaption)}.
        </div>
        <a href="${escAttr(loadCapabilities().contact.href)}" class="placeholder-cta">${escHtml(loadCapabilities().contact.cta)} &rarr;</a>
      </div>
    </div>`;
}

function renderScreenshotGallery(screenshots: FeatureScreenshot[], featureSlug: string): string {
  if (!screenshots.length) return "";
  const items = screenshots
    .map(
      (s) => `
      <div class="sg-item"
           data-description="${escAttr(s.description)}"
           data-feature-url="/feature/${escAttr(featureSlug)}">
        <img src="${escAttr(s.src)}" alt="${escAttr(s.alt)}"
             loading="lazy" width="640" height="400">
        <div class="sg-overlay">${escHtml(s.caption)}</div>
        <span class="sg-caption">${escHtml(s.caption)}</span>
      </div>`,
    )
    .join("");
  return `<div class="sg-gallery" aria-label="${escAttr(featureSlug)} screenshots">${items}</div>`;
}

function renderSlide(slide: FeatureSlide, index: number, total: number): string {
  const badgeClass = slide.badge ? `fc-badge fc-badge-${slide.badge.tone}` : "";
  const badgeHtml = slide.badge
    ? `<span class="${badgeClass}">${escHtml(slide.badge.label)}</span>`
    : "";
  const rowsHtml = slide.rows
    .map((r) => {
      const accent = r.accent ? ` style="color:var(--${r.accent})"` : "";
      return `
      <div class="fc-row">
        <span class="fc-label">${escHtml(r.label)}</span>
        <span class="fc-value"${accent}>${escHtml(r.value)}</span>
      </div>`;
    })
    .join("");
  const pad = (n: number) => String(n).padStart(2, "0");
  return `
  <div class="feature-detail-slide">
    <div class="feature-detail-header">
      <span class="feature-detail-step">STEP ${pad(index + 1)} / ${pad(total)}</span>
      <span class="feature-detail-title">${escHtml(slide.header)}</span>
      ${badgeHtml}
    </div>
    ${rowsHtml}
  </div>`;
}

function renderBenefit(b: FeatureBenefit): string {
  return `
    <div class="benefit-card fade-in">
      <div class="benefit-corner benefit-corner-tl"></div>
      <div class="benefit-corner benefit-corner-tr"></div>
      <div class="benefit-corner benefit-corner-bl"></div>
      <div class="benefit-corner benefit-corner-br"></div>
      <div class="benefit-label">${escHtml(b.label)}</div>
      <h3 class="benefit-title">${escHtml(b.title)}</h3>
      <p class="benefit-body">${escHtml(b.body)}</p>
    </div>`;
}

export function renderFeaturePage(
  feature: Feature,
  data: CapabilitiesFile = loadCapabilities(),
): string {
  const canonical = `${BASE_URL}/feature/${feature.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `FactoryLM — ${feature.category}`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: feature.lede,
    url: canonical,
  };

  const galleryHtml = renderScreenshotGallery(feature.screenshots, feature.slug);
  const benefitsHtml = feature.benefits.map(renderBenefit).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <meta name="description" content="${escAttr(feature.lede)}">
  <meta name="theme-color" content="#f0a000">
  <link rel="canonical" href="${escAttr(canonical)}">

  <meta property="og:title" content="${escAttr(feature.title)}">
  <meta property="og:description" content="${escAttr(feature.lede)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escAttr(canonical)}">
  <meta property="og:image" content="${BASE_URL}/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="FactoryLM">

  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escAttr(feature.title)}">
  <meta name="twitter:description" content="${escAttr(feature.lede)}">
  <meta name="twitter:image" content="${BASE_URL}/og-image.png">

  <title>${escHtml(feature.title)}</title>

  <script type="application/ld+json">${serializeJsonLd(jsonLd)}</script>

  <link rel="manifest" href="/manifest.json">
  <link rel="icon" href="/public/icons/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=IBM+Plex+Serif:ital,wght@1,400;1,500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">

  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --page-bg:      #0d0e11;
      --surface:      #13141a;
      --surface-hi:   #181a22;
      --border:       rgba(255,255,255,0.07);
      --border-hi:    rgba(255,255,255,0.12);
      --text:         #e8eaf0;
      --text-dim:     rgba(255,255,255,0.62);
      --text-faint:   rgba(255,255,255,0.40);
      --text-label:   rgba(255,255,255,0.45);
      --amber:        #f0a000;
      --amber-hot:    #f5c542;
      --teal:         #00d4aa;
      --red:          #ff5d5d;
      --font:         'Inter', 'Helvetica Neue', sans-serif;
      --font-mono:    'IBM Plex Mono', ui-monospace, 'Cascadia Mono', monospace;
      --font-serif:   'IBM Plex Serif', Georgia, serif;
      --max-w:        1080px;
      --ease-out:     cubic-bezier(0.16,1,0.3,1);
    }

    html { scroll-behavior: smooth; }

    body {
      background: var(--page-bg);
      color: var(--text);
      font-family: var(--font);
      font-size: 15px;
      line-height: 1.65;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background: radial-gradient(ellipse 80% 50% at 50% -10%, rgba(240,160,0,0.08) 0%, transparent 60%);
      pointer-events: none;
      z-index: 0;
    }

    .inner { max-width: var(--max-w); margin: 0 auto; padding: 0 32px; }

    /* ── Nav ── */
    nav#main-nav {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(13,14,17,0.88);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--border);
      transition: border-color 200ms var(--ease-out);
    }
    .nav-inner {
      max-width: var(--max-w);
      margin: 0 auto;
      padding: 16px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .nav-logo {
      display: flex;
      align-items: center;
      gap: 10px;
      color: var(--amber);
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      letter-spacing: -0.01em;
    }
    .nav-links {
      display: flex;
      gap: 28px;
      list-style: none;
      font-size: 13.5px;
      font-weight: 400;
    }
    .nav-links a {
      color: var(--text-dim);
      text-decoration: none;
      transition: color 160ms var(--ease-out);
    }
    .nav-links a:hover { color: var(--text); }
    .nav-cta {
      color: var(--amber);
      text-decoration: none;
      font-weight: 500;
      font-size: 13.5px;
      padding: 8px 16px;
      border: 1px solid rgba(240,160,0,0.35);
      border-radius: 6px;
      transition: all 200ms var(--ease-out);
    }
    .nav-cta:hover {
      background: rgba(240,160,0,0.08);
      border-color: var(--amber);
    }
    @media (max-width: 720px) { .nav-links { display: none; } }

    /* ── Breadcrumb ── */
    .breadcrumb {
      font-family: var(--font-mono);
      font-size: 11.5px;
      color: var(--text-faint);
      letter-spacing: 0.04em;
      margin-bottom: 24px;
      text-transform: uppercase;
    }
    .breadcrumb a { color: var(--text-dim); text-decoration: none; }
    .breadcrumb a:hover { color: var(--amber); }
    .breadcrumb span { color: var(--text-faint); margin: 0 6px; }

    /* ── Hero ── */
    .feature-hero {
      position: relative;
      padding: 72px 0 56px;
      border-bottom: 1px solid var(--border);
    }
    .feature-hero::before {
      content: '';
      position: absolute;
      top: 16px;
      left: 32px;
      width: 14px;
      height: 14px;
      border-top: 1.5px solid var(--amber);
      border-left: 1.5px solid var(--amber);
      opacity: 0.6;
    }
    .feature-hero::after {
      content: '';
      position: absolute;
      top: 16px;
      right: 32px;
      width: 14px;
      height: 14px;
      border-top: 1.5px solid var(--amber);
      border-right: 1.5px solid var(--amber);
      opacity: 0.6;
    }
    .section-label {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.12em;
      color: var(--amber);
      text-transform: uppercase;
      margin-bottom: 20px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .section-label::before {
      content: '';
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 10px rgba(240,160,0,0.8);
      animation: pulse 2.6s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.55; transform: scale(0.82); }
    }
    @media (prefers-reduced-motion: reduce) {
      .section-label::before { animation: none; }
    }
    .feature-h1 {
      font-size: clamp(36px, 5.6vw, 60px);
      line-height: 1.05;
      font-weight: 600;
      letter-spacing: -0.035em;
      margin-bottom: 24px;
      max-width: 820px;
    }
    .feature-h1 em {
      font-family: var(--font-serif);
      font-style: italic;
      font-weight: 400;
      color: var(--amber);
    }
    .feature-lede {
      font-size: 18px;
      line-height: 1.55;
      color: var(--text-dim);
      max-width: 640px;
      margin-bottom: 36px;
      font-weight: 300;
    }
    .hero-actions {
      display: flex;
      gap: 16px;
      flex-wrap: wrap;
      align-items: center;
    }

    /* ── CTA button (cta-start) — same style as index.html ── */
    .cta-start {
      position: relative;
      display: inline-flex;
      align-items: stretch;
      text-decoration: none;
      color: #0b0c0f;
      background: linear-gradient(180deg, #f5c542 0%, #f0a000 50%, #c47e00 100%);
      border: 1px solid rgba(0,0,0,0.5);
      border-radius: 8px;
      overflow: hidden;
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.35),
        inset 0 -2px 0 rgba(0,0,0,0.45),
        0 2px 0 rgba(0,0,0,0.45),
        0 12px 28px rgba(240,160,0,0.25);
      transition: all 160ms var(--ease-out);
      font-weight: 600;
      letter-spacing: -0.005em;
    }
    .cta-start:hover {
      transform: translateY(-1px);
      box-shadow:
        inset 0 1px 0 rgba(255,255,255,0.4),
        inset 0 -2px 0 rgba(0,0,0,0.45),
        0 3px 0 rgba(0,0,0,0.45),
        0 16px 36px rgba(240,160,0,0.35);
    }
    .cta-start:active {
      transform: translateY(1px);
      box-shadow:
        inset 0 2px 4px rgba(0,0,0,0.35),
        0 0 0 rgba(0,0,0,0.45),
        0 4px 12px rgba(240,160,0,0.2);
    }
    .cta-start-pulse {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #1a1a1a;
      box-shadow: 0 0 6px rgba(0,0,0,0.4);
      align-self: center;
      margin: 0 12px;
      position: relative;
    }
    .cta-start-pulse::after {
      content: '';
      position: absolute;
      inset: -2px;
      border-radius: 50%;
      border: 1.5px solid #1a1a1a;
      opacity: 0.5;
      animation: ring 2.2s cubic-bezier(0.16,1,0.3,1) infinite;
    }
    @keyframes ring {
      0% { transform: scale(1); opacity: 0.6; }
      100% { transform: scale(2.2); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .cta-start-pulse::after { animation: none; }
    }
    .cta-start-text {
      display: flex;
      flex-direction: column;
      justify-content: center;
      padding: 12px 22px 12px 8px;
      line-height: 1.1;
    }
    .cta-start-label {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      opacity: 0.75;
    }
    .cta-start-action { font-size: 15px; font-weight: 700; }

    .btn-ghost {
      display: inline-flex;
      align-items: center;
      padding: 12px 20px;
      border: 1px solid var(--border-hi);
      border-radius: 8px;
      color: var(--text-dim);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      transition: all 200ms var(--ease-out);
    }
    .btn-ghost:hover {
      border-color: var(--amber);
      color: var(--amber);
    }

    /* ── Video frame ── */
    .feature-video { padding: 48px 0; }
    .video-frame {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 24px 64px rgba(0,0,0,0.4);
    }
    .video-frame-bar {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 10px 16px;
      background: linear-gradient(180deg, #1a1c24 0%, #13151b 100%);
      border-bottom: 1px solid var(--border);
    }
    .video-frame-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: rgba(255,255,255,0.1);
    }
    .video-frame-dot:nth-child(1) { background: #ff5f57; opacity: 0.7; }
    .video-frame-dot:nth-child(2) { background: #febc2e; opacity: 0.7; }
    .video-frame-dot:nth-child(3) { background: #28c840; opacity: 0.7; }
    .video-frame-label {
      margin-left: 18px;
      font-family: var(--font-mono);
      font-size: 10.5px;
      letter-spacing: 0.08em;
      color: var(--text-faint);
    }
    .video-frame-body {
      position: relative;
      aspect-ratio: 16 / 9;
      background: #000;
    }
    .video-frame-body iframe {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
    .video-caption {
      padding: 14px 20px;
      font-size: 12.5px;
      color: var(--text-faint);
      font-family: var(--font-mono);
      border-top: 1px solid var(--border);
      text-align: center;
    }

    /* ── Placeholder video ── */
    .video-placeholder-body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      text-align: center;
      padding: 56px 40px;
      background:
        radial-gradient(ellipse 60% 40% at 50% 40%, rgba(240,160,0,0.08) 0%, transparent 70%),
        repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 40px),
        repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 40px),
        #080a0d;
    }
    .placeholder-status {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.14em;
      color: var(--amber);
      text-transform: uppercase;
      padding: 6px 12px;
      border: 1px solid rgba(240,160,0,0.25);
      border-radius: 4px;
      background: rgba(240,160,0,0.04);
      margin-bottom: 18px;
    }
    .placeholder-led {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--amber);
      box-shadow: 0 0 8px rgba(240,160,0,0.8);
      animation: pulse 2.2s ease-in-out infinite;
    }
    .placeholder-title {
      font-family: var(--font-serif);
      font-style: italic;
      font-size: 24px;
      color: var(--text);
      margin-bottom: 12px;
    }
    .placeholder-desc {
      font-size: 14px;
      color: var(--text-dim);
      max-width: 480px;
      line-height: 1.6;
      margin-bottom: 24px;
      font-weight: 300;
    }
    .placeholder-cta {
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--amber);
      text-decoration: none;
      padding: 10px 20px;
      border: 1px solid rgba(240,160,0,0.4);
      border-radius: 6px;
      transition: all 200ms var(--ease-out);
    }
    .placeholder-cta:hover {
      background: rgba(240,160,0,0.1);
      border-color: var(--amber);
      color: var(--amber-hot);
    }

    /* ── Long body ── */
    .feature-body-section { padding: 64px 0; border-top: 1px solid var(--border); }
    .feature-body-section h2 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 32px;
      max-width: 720px;
    }
    .feature-long p {
      font-size: 16.5px;
      line-height: 1.72;
      color: var(--text-dim);
      font-weight: 300;
      max-width: 680px;
      margin-bottom: 22px;
    }
    .feature-long p:last-child { margin-bottom: 0; }

    /* ── Slides walkthrough on feature page ── */
    .feature-detail-slides {
      margin-top: 40px;
      display: grid;
      gap: 18px;
    }
    .feature-detail-slide {
      position: relative;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 22px 26px 18px;
      transition: border-color 200ms var(--ease-out);
    }
    .feature-detail-slide:hover { border-color: rgba(240,160,0,0.22); }
    .feature-detail-header {
      display: flex;
      align-items: center;
      gap: 14px;
      padding-bottom: 12px;
      margin-bottom: 14px;
      border-bottom: 1px dashed var(--border);
      flex-wrap: wrap;
    }
    .feature-detail-step {
      font-family: var(--font-mono);
      font-size: 10.5px;
      letter-spacing: 0.12em;
      color: var(--amber);
      text-transform: uppercase;
    }
    .feature-detail-title {
      font-family: var(--font-mono);
      font-size: 11.5px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--text);
      flex: 1;
    }
    .fc-badge {
      font-family: var(--font-mono);
      font-size: 9.5px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      padding: 3px 8px;
      border-radius: 3px;
    }
    .fc-badge-green { background: rgba(0,212,170,0.1); color: var(--teal); border: 1px solid rgba(0,212,170,0.3); }
    .fc-badge-amber { background: rgba(240,160,0,0.1); color: var(--amber); border: 1px solid rgba(240,160,0,0.3); }
    .fc-badge-red { background: rgba(255,93,93,0.1); color: var(--red); border: 1px solid rgba(255,93,93,0.3); }
    .fc-row {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      padding: 6px 0;
      font-size: 13.5px;
    }
    .fc-row + .fc-row { border-top: 1px solid rgba(255,255,255,0.035); }
    .fc-label {
      font-family: var(--font-mono);
      font-size: 10.5px;
      letter-spacing: 0.08em;
      color: var(--text-label);
      text-transform: uppercase;
      white-space: nowrap;
      padding-top: 2px;
    }
    .fc-value {
      color: var(--text);
      text-align: right;
      font-weight: 400;
      font-size: 13.5px;
    }

    /* ── Screenshot gallery ── */
    .sg-gallery { display: flex; gap: 8px; overflow: hidden; height: 280px; }
    .sg-item { flex: 1; min-width: 0; transition: flex 0.3s cubic-bezier(0.16,1,0.3,1); cursor: pointer; position: relative; border-radius: 8px; overflow: hidden; border: 1px solid rgba(255,255,255,0.07); }
    .sg-item:hover { flex: 3; box-shadow: 0 0 24px rgba(240,160,0,0.15); border-color: rgba(240,160,0,0.3); }
    .sg-item img { width: 100%; height: 280px; object-fit: cover; display: block; }
    .sg-caption { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: rgba(255,255,255,0.35); margin-top: 8px; font-family: var(--font-mono); }
    .sg-overlay { position: absolute; bottom: 0; left: 0; right: 0; padding: 16px; background: linear-gradient(transparent, rgba(0,0,0,0.8)); color: var(--text); font-size: 13px; line-height: 1.4; opacity: 0; transition: opacity 0.3s ease; pointer-events: none; }
    .sg-item:hover .sg-overlay { opacity: 1; }
    .sg-lightbox { position: fixed; inset: 0; z-index: 200; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,0.85); backdrop-filter: blur(8px); opacity: 0; transition: opacity 0.2s ease; pointer-events: none; }
    .sg-lightbox.active { opacity: 1; pointer-events: auto; }
    .sg-lightbox-inner { max-width: 960px; width: 90vw; position: relative; }
    .sg-lightbox-img { width: 100%; border-radius: 10px; display: block; }
    .sg-lightbox-desc { color: rgba(255,255,255,0.8); font-size: 15px; line-height: 1.6; margin-top: 16px; }
    .sg-lightbox-cta { display: inline-flex; align-items: center; gap: 6px; margin-top: 16px; padding: 9px 18px; background: linear-gradient(180deg, #f0a030 0%, #d4880a 100%); color: #0a0a08; font-size: 14px; font-weight: 500; border-radius: 6px; text-decoration: none; border: 1px solid rgba(255,255,255,0.12); }
    .sg-lightbox-close { position: absolute; top: -40px; right: 0; background: none; border: none; color: rgba(255,255,255,0.6); font-size: 24px; cursor: pointer; padding: 8px; }
    @media (max-width: 768px) {
      .sg-gallery { overflow-x: auto; scroll-snap-type: x mandatory; gap: 12px; height: auto; }
      .sg-item { flex: none; width: 75vw; scroll-snap-align: start; }
      .sg-item img { height: 200px; }
      .sg-lightbox-inner { width: 95vw; }
    }

    /* ── Benefits grid ── */
    .feature-benefits { padding: 64px 0; border-top: 1px solid var(--border); }
    .feature-benefits h2 {
      font-size: 28px;
      font-weight: 600;
      letter-spacing: -0.02em;
      margin-bottom: 40px;
    }
    .benefits-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }
    .benefit-card {
      position: relative;
      padding: 32px 28px 28px;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      transition: all 240ms var(--ease-out);
    }
    .benefit-card:hover {
      border-color: rgba(240,160,0,0.25);
      transform: translateY(-2px);
    }
    /* Corner registration marks — HMI detail */
    .benefit-corner {
      position: absolute;
      width: 10px;
      height: 10px;
      opacity: 0.35;
    }
    .benefit-corner-tl { top: 8px; left: 8px;    border-top: 1.5px solid var(--amber); border-left: 1.5px solid var(--amber); }
    .benefit-corner-tr { top: 8px; right: 8px;   border-top: 1.5px solid var(--amber); border-right: 1.5px solid var(--amber); }
    .benefit-corner-bl { bottom: 8px; left: 8px; border-bottom: 1.5px solid var(--amber); border-left: 1.5px solid var(--amber); }
    .benefit-corner-br { bottom: 8px; right: 8px; border-bottom: 1.5px solid var(--amber); border-right: 1.5px solid var(--amber); }
    .benefit-label {
      font-family: var(--font-mono);
      font-size: 10px;
      letter-spacing: 0.14em;
      color: var(--amber);
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    .benefit-title {
      font-size: 17px;
      font-weight: 600;
      letter-spacing: -0.01em;
      margin-bottom: 12px;
      line-height: 1.3;
    }
    .benefit-body {
      font-size: 14px;
      color: var(--text-dim);
      line-height: 1.6;
      font-weight: 300;
    }

    /* ── CTA section ── */
    .cta-section {
      padding: 96px 0;
      border-top: 1px solid var(--border);
      text-align: center;
      position: relative;
    }
    .cta-section::before {
      content: '';
      position: absolute;
      inset: 0;
      background: radial-gradient(ellipse 50% 40% at 50% 50%, rgba(240,160,0,0.06) 0%, transparent 70%);
      pointer-events: none;
    }
    .cta-inner { position: relative; max-width: 680px; margin: 0 auto; }
    .cta-h2 {
      font-size: clamp(30px, 4.5vw, 46px);
      line-height: 1.08;
      font-weight: 600;
      letter-spacing: -0.03em;
      margin: 16px 0 18px;
    }
    .cta-h2 em {
      font-family: var(--font-serif);
      font-style: italic;
      font-weight: 400;
      color: var(--amber);
    }
    .cta-sub {
      font-size: 16px;
      color: var(--text-dim);
      line-height: 1.6;
      margin-bottom: 32px;
      font-weight: 300;
    }
    .cta-note {
      font-size: 12px;
      color: var(--text-faint);
      margin-top: 14px;
      font-family: var(--font-mono);
      letter-spacing: 0.04em;
    }

    /* ── Footer ── */
    footer {
      padding: 40px 0;
      border-top: 1px solid var(--border);
    }
    .footer-inner {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }
    .footer-logo {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      color: var(--amber);
      text-decoration: none;
      font-weight: 600;
      font-size: 14px;
    }
    .footer-links {
      display: flex;
      gap: 24px;
      list-style: none;
      font-size: 13px;
    }
    .footer-links a {
      color: var(--text-dim);
      text-decoration: none;
      transition: color 150ms var(--ease-out);
    }
    .footer-links a:hover { color: var(--amber); }

    /* ── Fade-in ── */
    .fade-in {
      opacity: 0;
      transform: translateY(14px);
      transition: opacity 700ms var(--ease-out), transform 700ms var(--ease-out);
    }
    .fade-in.visible { opacity: 1; transform: none; }
    @media (prefers-reduced-motion: reduce) {
      .fade-in { opacity: 1; transform: none; transition: none; }
    }
  </style>
</head>

<body>

  <!-- ── Navigation ── -->
  <nav id="main-nav" role="navigation" aria-label="Main navigation">
    <div class="nav-inner">
      <a href="/" class="nav-logo" aria-label="FactoryLM home">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="20" height="20">
          <rect width="24" height="24" rx="5" fill="#f0a000"/>
          <path d="M6 17V8l3.5 5 2.5-3.5L14.5 13 18 8v9" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        FactoryLM
      </a>
      <ul class="nav-links" role="list">
        <li><a href="/pricing">Talk to Mike</a></li>
        <li><a href="/blog">Blog</a></li>
        <li><a href="/limitations">Limitations</a></li>
      </ul>
      <a href="${escAttr(data.contact.href)}" class="nav-cta">${escHtml(data.contact.cta)}</a>
    </div>
  </nav>

  <main id="main-content">

    <!-- ── Hero ── -->
    <section class="feature-hero" aria-labelledby="feature-heading">
      <div class="inner">
        <div class="breadcrumb fade-in">
          <a href="/">Home</a> <span>&rsaquo;</span> <a href="/#features">Features</a> <span>&rsaquo;</span> ${escHtml(feature.category)}
        </div>
        <div class="section-label fade-in">${escHtml(feature.category)}</div>
        <h1 class="feature-h1 fade-in" id="feature-heading">
          ${escHtml(feature.tagline[0])}<br>
          <em>${escHtml(feature.tagline[1])}</em>
        </h1>
        <p class="feature-lede fade-in">${escHtml(feature.lede)}</p>
        <div class="hero-actions fade-in">
          <a href="/#features" class="btn-ghost">&larr; All features</a>
        </div>
      </div>
    </section>

    <!-- ── Video ── -->
    <section class="feature-video">
      <div class="inner">
        <div class="fade-in">${renderVideo(feature)}</div>
      </div>
    </section>

    <!-- ── Long body with step-by-step walkthrough ── -->
    <section class="feature-body-section">
      <div class="inner">
        <h2 class="fade-in">How it works</h2>
        <div class="feature-long fade-in">
          ${feature.longBody.map((p) => `<p>${escHtml(p)}</p>`).join("")}
        </div>
        <div class="feature-detail-slides fade-in">
          ${galleryHtml}
        </div>
      </div>
    </section>

    <!-- ── Benefits grid ── -->
    <section class="feature-benefits">
      <div class="inner">
        <h2 class="fade-in">What you get</h2>
        <div class="benefits-grid">
          ${benefitsHtml}
        </div>
      </div>
    </section>

    <!-- ── CTA ── -->
    <section class="cta-section" aria-label="Contact">
      <div class="cta-inner">
        <p class="cta-sub fade-in">
          ${escHtml(data.chrome.connectors_note)}
        </p>
        <div class="fade-in">
          <p class="cta-note"><a href="${escAttr(data.contact.href)}" style="color:var(--amber)">${escHtml(data.contact.cta)}</a> — FactoryLM, Central Florida.</p>
        </div>
      </div>
    </section>

  </main>

  <!-- ── Footer ── -->
  <footer role="contentinfo">
    <div class="inner">
      <div class="footer-inner">
        <a href="/" class="footer-logo" aria-label="FactoryLM home">
          <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" width="18" height="18">
            <rect width="24" height="24" rx="5" fill="#f0a000"/>
            <path d="M6 17V8l3.5 5 2.5-3.5L14.5 13 18 8v9" stroke="#000" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          FactoryLM
        </a>
        <ul class="footer-links" role="list">
          <li><a href="/">Home</a></li>
          <li><a href="/#features">Features</a></li>
          <li><a href="/blog">Blog</a></li>
          <li><a href="/limitations">Limitations</a></li>
          <li><a href="${escAttr(data.contact.href)}">${escHtml(data.contact.cta)}</a></li>
        </ul>
      </div>
    </div>
  </footer>

  <script>
    // Fade-in observer
    (function () {
      if (!window.IntersectionObserver) {
        document.querySelectorAll('.fade-in').forEach(el => el.classList.add('visible'));
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); }),
        { threshold: 0.08 }
      );
      document.querySelectorAll('.fade-in').forEach(el => observer.observe(el));
    })();

    // CMMS CTA swap for active tenants
    (function () {
      var token = sessionStorage.getItem('flm_token');
      if (!token) return;
      document.querySelectorAll('a.nav-cta').forEach(function (el) {
        el.href = '/api/cmms/login?token=' + encodeURIComponent(token);
        el.textContent = 'Open notebook';
      });
    })();

    // Screenshot gallery lightbox
    (function () {
      var lightbox = null;
      function openLightbox(item) {
        if (lightbox) closeLightbox();
        var img = item.querySelector('img');
        var desc = item.dataset.description || '';
        var url = item.dataset.featureUrl || '';
        lightbox = document.createElement('div');
        lightbox.className = 'sg-lightbox active';
        lightbox.innerHTML =
          '<div class="sg-lightbox-inner">' +
            '<button class="sg-lightbox-close" aria-label="Close">&times;</button>' +
            '<img class="sg-lightbox-img" src="' + img.src + '" alt="' + img.alt + '">' +
            '<p class="sg-lightbox-desc">' + desc + '</p>' +
            (url ? '<a class="sg-lightbox-cta" href="' + url + '">See full feature &rarr;</a>' : '') +
          '</div>';
        document.body.appendChild(lightbox);
        document.body.style.overflow = 'hidden';
        lightbox.querySelector('.sg-lightbox-close').addEventListener('click', closeLightbox);
        lightbox.addEventListener('click', function (e) { if (e.target === lightbox) closeLightbox(); });
      }
      function closeLightbox() {
        if (!lightbox) return;
        document.body.style.overflow = '';
        lightbox.remove();
        lightbox = null;
      }
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLightbox(); });
      document.querySelectorAll('.sg-item').forEach(function (item) {
        item.addEventListener('click', function () { openLightbox(item); });
      });
    })();
  </script>

</body>
</html>`;
}

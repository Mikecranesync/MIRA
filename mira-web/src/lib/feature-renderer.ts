/**
 * Server-side HTML renderer for /feature/:slug pages.
 *
 * Each feature has a hero, an optional Loom video, a long-form description,
 * a benefits grid, and a primary CTA back to the beta signup at /cmms.
 *
 * Aesthetic: industrial HMI / telemetry overlay. Matches index.html's dark
 * gray + amber + Inter vocabulary but pushes HMI details harder (corner
 * registration marks, telemetry row numbers, LED status dots, pulse rings).
 *
 * Video URLs come from env vars — each feature has a dedicated env var name.
 * If unset, a "coming soon" placeholder renders. No redeploy needed to swap
 * in real Loom URLs: just update Doppler and restart mira-web.
 */

const BASE_URL = "https://factorylm.com";

export interface FeatureSlide {
  header: string;
  badge?: { label: string; tone: "green" | "amber" | "red" };
  rows: Array<{ label: string; value: string; accent?: "amber" | "teal" | "red" }>;
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
  benefits: FeatureBenefit[];
  videoEnvVar: string;
  videoCaption: string;
}

export const FEATURES: Record<string, Feature> = {
  "fault-diagnosis": {
    slug: "fault-diagnosis",
    category: "Fault Diagnosis",
    title: "Fault Diagnosis | FactoryLM",
    tagline: ["Answers in seconds,", "not hours"],
    lede:
      "Mira knows your equipment. Send a fault code, describe a symptom, or upload a photo — and get a cited, actionable answer straight from your specific OEM documentation and field history.",
    longBody: [
      "Every minute of VFD or PLC downtime costs money. The average maintenance technician wastes 20–40 minutes per fault code searching through PDFs, forum posts, and manufacturer websites — and the answer is still a guess.",
      "Mira closes that gap to seconds. Paste a fault code into chat. Mira pulls the matching section from your PowerFlex, GS20, ACS880, or Siemens manual, ranks the candidates by confidence, and returns a root cause plus the exact corrective action — with a page-level citation you can verify.",
      "No hallucinations. No generic LLM answers. Every claim points at a page number in a manual you uploaded. If Mira isn't confident, it says so and asks for more detail instead of making something up.",
      "Works on phone, tablet, and desktop. Speaks every OEM dialect: Allen-Bradley, Yaskawa, ABB, Siemens, Delta, FANUC, and any other equipment manual you drop into the system.",
    ],
    slides: [
      {
        header: "INCOMING — FAULT CODE",
        badge: { label: "SIGNAL", tone: "green" },
        rows: [
          { label: "User", value: "Line 3 tech — iPhone" },
          { label: "Input", value: "F-012 on PowerFlex 753" },
          { label: "Context", value: "Second trip today, same fault" },
          { label: "Mode", value: "Voice + typed" },
        ],
      },
      {
        header: "MIRA — SEARCHING",
        badge: { label: "PROCESSING", tone: "amber" },
        rows: [
          { label: "Matched", value: "PF753 Manual §6.2" },
          { label: "Candidates", value: "4 → 1 ranked" },
          { label: "Confidence", value: "94% — high" },
          { label: "Latency", value: "612 ms to first token" },
        ],
      },
      {
        header: "CITED ANSWER",
        badge: { label: "DELIVERED", tone: "green" },
        rows: [
          { label: "Fault", value: "VFD Fault F-012 — Overcurrent" },
          { label: "Root cause", value: "Mechanical load spike at startup" },
          { label: "Action", value: "Increase accel ramp P042 → 4.5s" },
          { label: "Source", value: "[§6.2 PF753 Manual p.81]", accent: "teal" },
        ],
      },
      {
        header: "WORK ORDER — CREATED",
        badge: { label: "AUTO", tone: "amber" },
        rows: [
          { label: "Asset", value: "Line 3 PowerFlex 753" },
          { label: "Priority", value: "MEDIUM", accent: "amber" },
          { label: "Assigned", value: "On-call technician" },
          { label: "Logged", value: "14:02 · atlas-cmms", accent: "teal" },
        ],
      },
    ],
    benefits: [
      {
        label: "SPEED",
        title: "Under one second to first token",
        body: "Mira responds before you finish typing. The average fault code goes from input to cited answer in under four seconds end-to-end.",
      },
      {
        label: "TRUTH",
        title: "Every answer cites a manual page",
        body: "No hallucinations. Every root cause and corrective action links back to a specific OEM section. Verify or ignore — the citation is always there.",
      },
      {
        label: "COVERAGE",
        title: "Every OEM dialect you run",
        body: "Allen-Bradley, PowerFlex, Yaskawa, ABB, Siemens, FANUC, Delta. Drop in your equipment manuals and Mira speaks each one natively.",
      },
    ],
    videoEnvVar: "LOOM_FEATURE_FAULT_DIAGNOSIS_URL",
    videoCaption: "Mira diagnoses a real PowerFlex F-012 fault from the OEM manual",
  },

  "cmms-integration": {
    slug: "cmms-integration",
    category: "CMMS Integration",
    title: "CMMS Integration | FactoryLM",
    tagline: ["Work orders that", "write themselves"],
    lede:
      "When Mira identifies a maintenance action, it creates the work order directly in your CMMS — with the asset, fault description, part numbers, and estimated time already filled in.",
    longBody: [
      "Half of every maintenance hour is admin: finding the asset, typing the description, looking up the part number, assigning the technician. Mira skips that whole loop.",
      "When your team resolves a fault in chat, Mira drafts the work order as a side effect. Asset ID is matched from the equipment manual metadata. Parts are auto-filled from the cited manual section. Priority is inferred from the fault severity. Estimated time comes from similar past work orders in your history.",
      "Ships with Atlas CMMS built in — the open-source CMMS designed for this workflow. Atlas tracks assets, schedules PMs, handles work orders, and syncs with Mira in real time over a shared Postgres. If you already run Maintenance Connection, eMaint, MaintainX, or Fiix, the pluggable adapter layer gives you the same flow through those systems.",
      "The best work order is the one your technicians don't have to type.",
    ],
    slides: [
      {
        header: "MAINTENANCE ACTION DETECTED",
        badge: { label: "SIGNAL", tone: "green" },
        rows: [
          { label: "Source", value: "Mira chat — Line 3 tech" },
          { label: "Trigger", value: "\"Replace J2 encoder cable\"" },
          { label: "Context", value: "Photo + fault cited" },
          { label: "Severity", value: "HIGH — downtime risk", accent: "red" },
        ],
      },
      {
        header: "ASSET LOOKUP",
        badge: { label: "MATCHED", tone: "green" },
        rows: [
          { label: "Asset", value: "Conveyor Drive #3 — Motor" },
          { label: "Last service", value: "47 days ago" },
          { label: "Uptime", value: "94.2% YTD", accent: "teal" },
          { label: "PM due", value: "In 11 days" },
        ],
      },
      {
        header: "WORK ORDER — DRAFTED",
        badge: { label: "READY", tone: "amber" },
        rows: [
          { label: "Parts", value: "A06B-6117-K003 encoder cable" },
          { label: "Est. time", value: "45 minutes" },
          { label: "Tools", value: "M4 hex, zip ties, meter" },
          { label: "Priority", value: "HIGH", accent: "amber" },
        ],
      },
      {
        header: "ATLAS CMMS — OPEN",
        badge: { label: "LIVE", tone: "green" },
        rows: [
          { label: "Status", value: "HIGH PRIORITY", accent: "amber" },
          { label: "Kanban", value: "Today's Queue" },
          { label: "Assigned", value: "Mike H. — first available" },
          { label: "Notified", value: "iMessage + Atlas push", accent: "teal" },
        ],
      },
    ],
    benefits: [
      {
        label: "AUTO",
        title: "Zero typing between fault and work order",
        body: "Mira drafts the work order as a byproduct of resolving the fault. Your techs approve it with one tap.",
      },
      {
        label: "PLUG IN",
        title: "Works with your CMMS or ours",
        body: "Atlas CMMS is built in. If you already run MaintainX, Fiix, or Limble, the pluggable adapter layer gives you the same flow through your existing system.",
      },
      {
        label: "MEMORY",
        title: "Every fix becomes training data",
        body: "Mira learns from closed work orders. Next time the same fault hits, she proposes the fix your tech used last time — faster and more confident.",
      },
    ],
    videoEnvVar: "LOOM_FEATURE_CMMS_URL",
    videoCaption: "Mira drafts a work order in Atlas CMMS from a chat conversation",
  },

  "voice-vision": {
    slug: "voice-vision",
    category: "Voice + Vision",
    title: "Voice + Vision | FactoryLM",
    tagline: ["Hands-free on the", "shop floor"],
    lede:
      "Talk to Mira hands-free with voice input. Upload a photo of the fault — Mira identifies the component, cross-references your equipment history, and reads the answer back to you out loud.",
    longBody: [
      "Maintenance work happens with your hands full and your phone on a bracket. Typing isn't an option. Mira is built voice-first: say the fault code, describe what you're seeing, or hold up your phone camera and Mira identifies the part for you.",
      "Voice input works offline on iPhone and Android — no internet required for the speech-to-text layer. The diagnostic query itself syncs when you're back in range, and Mira reads the answer out loud while you keep working.",
      "Photo analysis handles the hard cases: you see a burnt contactor, a broken encoder cable, or a cryptic nameplate. Snap it, send it. Mira identifies the component, cross-references the manufacturer and part number from your equipment history, and returns a cited fix.",
      "Runs on any modern phone browser. No app install. No account setup beyond the beta signup. Bookmark it on your home screen and it behaves like a native app.",
    ],
    slides: [
      {
        header: "VOICE INPUT — FIELD",
        badge: { label: "MIC LIVE", tone: "green" },
        rows: [
          { label: "User", value: "\"Hey Mira — E-731 on axis 2\"" },
          { label: "Language", value: "en-US · offline STT" },
          { label: "Noise", value: "72 dBA — shop floor" },
          { label: "Confidence", value: "98% transcription", accent: "teal" },
        ],
      },
      {
        header: "PHOTO — UPLOADED",
        badge: { label: "COMPRESSED", tone: "amber" },
        rows: [
          { label: "File", value: "encoder_cable_j2.jpg" },
          { label: "Size", value: "2.1 MB → 380 KB" },
          { label: "Camera", value: "iPhone 15 · back lens" },
          { label: "Upload", value: "3 seconds over LTE" },
        ],
      },
      {
        header: "IDENTIFIED",
        badge: { label: "MATCHED", tone: "green" },
        rows: [
          { label: "Component", value: "FANUC J2 encoder cable" },
          { label: "Series", value: "A06B-6117 family" },
          { label: "Issue", value: "Bend radius failure", accent: "amber" },
          { label: "Location", value: "At cable clamp — CN2 side" },
        ],
      },
      {
        header: "ANSWER — READ BACK",
        badge: { label: "SPEAKING", tone: "green" },
        rows: [
          { label: "Voice", value: "Kokoro TTS · 180 wpm" },
          { label: "Script", value: "\"Replace cable, reroute 4× dia...\"" },
          { label: "Duration", value: "11 seconds" },
          { label: "Work order", value: "Auto-created", accent: "teal" },
        ],
      },
    ],
    benefits: [
      {
        label: "HANDS-FREE",
        title: "Voice-first, hands-last",
        body: "Talk to Mira while your hands are full of tools, schematics, or a multimeter. Mira reads the answer back out loud so you never put anything down.",
      },
      {
        label: "OFFLINE",
        title: "Works where cell signal doesn't",
        body: "On-device speech-to-text means voice input works in basements, vaults, and dead zones. The query syncs when you're back in range.",
      },
      {
        label: "NO APP",
        title: "Any phone, any browser",
        body: "Bookmark it on your home screen. Behaves like a native app — no install, no update friction, no account beyond the beta.",
      },
    ],
    videoEnvVar: "LOOM_FEATURE_VOICE_VISION_URL",
    videoCaption: "Mira identifies a failed encoder cable from a phone photo and reads the fix out loud",
  },
};

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
          ${escHtml(feature.videoCaption)}. Join the beta and you'll get the walkthrough in your welcome email within 24 hours.
        </div>
        <a href="/cmms" class="placeholder-cta">Join the Beta &rarr;</a>
      </div>
    </div>`;
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

export function renderFeaturePage(feature: Feature): string {
  const canonical = `${BASE_URL}/feature/${feature.slug}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: `FactoryLM — ${feature.category}`,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web, iOS, Android",
    description: feature.lede,
    url: canonical,
    offers: {
      "@type": "Offer",
      price: "97",
      priceCurrency: "USD",
      priceSpecification: {
        "@type": "UnitPriceSpecification",
        price: "97",
        priceCurrency: "USD",
        referenceQuantity: { "@type": "QuantitativeValue", value: "1", unitCode: "MON" },
      },
    },
  };

  const slidesHtml = feature.slides
    .map((s, i) => renderSlide(s, i, feature.slides.length))
    .join("");
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

  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>

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
        <li><a href="/#features">Product</a></li>
        <li><a href="/blog">Blog</a></li>
        <li><a href="/cmms">CMMS Demo</a></li>
      </ul>
      <a href="/cmms" class="nav-cta">Join the Beta</a>
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
          <a href="/cmms" class="cta-start">
            <span class="cta-start-pulse" aria-hidden="true"></span>
            <span class="cta-start-text">
              <span class="cta-start-label">Beta Access — 50 Spots</span>
              <span class="cta-start-action">Start Here &rarr;</span>
            </span>
          </a>
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
          ${slidesHtml}
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
    <section class="cta-section" aria-labelledby="cta-heading">
      <div class="cta-inner">
        <div class="section-label fade-in">Beta Access</div>
        <h2 class="cta-h2 fade-in" id="cta-heading">
          Put Mira on your<br>
          <em>shop floor</em>
        </h2>
        <p class="cta-sub fade-in">
          See how ${escHtml(feature.category.toLowerCase())} works on your equipment through a 7-day video walkthrough. Then decide.
        </p>
        <div class="fade-in">
          <a href="/cmms" class="cta-start">
            <span class="cta-start-pulse" aria-hidden="true"></span>
            <span class="cta-start-text">
              <span class="cta-start-label">Beta Access — 50 Spots</span>
              <span class="cta-start-action">Start Here &rarr;</span>
            </span>
          </a>
          <p class="cta-note">No credit card to sign up. $97/mo after the walkthrough.</p>
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
          <li><a href="/blog/fault-codes">Fault Codes</a></li>
          <li><a href="/cmms">CMMS</a></li>
          <li><a href="mailto:contact@factorylm.com">Contact</a></li>
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
        el.textContent = 'Open CMMS';
      });
    })();
  </script>

</body>
</html>`;
}

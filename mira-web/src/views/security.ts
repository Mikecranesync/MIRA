import { head } from "../lib/head.js";
import { btnPrimary, btnGhost } from "../lib/components.js";

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

.fl-sec-hero {
  padding: var(--fl-sp-10) var(--fl-sp-6) var(--fl-sp-8);
  background: linear-gradient(180deg, var(--fl-sky-100) 0%, var(--fl-bg-50) 100%);
  text-align: center;
}
.fl-sec-hero-inner { max-width: 720px; margin: 0 auto; }
.fl-sec-eyebrow {
  text-transform: uppercase;
  letter-spacing: var(--fl-ls-caps);
  font-size: var(--fl-type-xs);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-3);
}
.fl-sec-h1 {
  font-size: var(--fl-type-3xl);
  letter-spacing: var(--fl-ls-tight);
  color: var(--fl-navy-900);
  margin-bottom: var(--fl-sp-3);
  line-height: 1.2;
}
.fl-sec-sub {
  font-size: var(--fl-type-md);
  color: var(--fl-muted-600);
  margin-bottom: var(--fl-sp-2);
  line-height: 1.6;
}

.fl-sec-section {
  max-width: 720px;
  margin: 0 auto;
  padding: var(--fl-sp-8) var(--fl-sp-6);
}
.fl-sec-section + .fl-sec-section {
  border-top: 1px solid var(--fl-rule-200);
}
.fl-sec-section-h2 {
  font-size: var(--fl-type-xl);
  color: var(--fl-navy-900);
  letter-spacing: var(--fl-ls-tight);
  margin-bottom: var(--fl-sp-5);
}

.fl-sec-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--fl-sp-5);
}
.fl-sec-list li {
  line-height: 1.6;
  font-size: var(--fl-type-base);
  color: var(--fl-ink-900);
  padding-left: var(--fl-sp-5);
  position: relative;
}
.fl-sec-list li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--fl-navy-900);
  font-weight: 700;
}
.fl-sec-list strong {
  color: var(--fl-navy-900);
}
.fl-sec-pill {
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
.fl-sec-pill-planned {
  background: var(--fl-bg-50);
  border: 1px solid var(--fl-rule-200);
  color: var(--fl-muted-600);
}

.fl-sec-cta {
  text-align: center;
  padding: var(--fl-sp-8) var(--fl-sp-6);
  background: var(--fl-bg-50);
  border-top: 1px solid var(--fl-rule-200);
}
.fl-sec-cta p {
  font-size: var(--fl-type-sm);
  color: var(--fl-muted-600);
  margin-top: var(--fl-sp-4);
  line-height: 1.6;
}
.fl-sec-cta a {
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
  .fl-sec-h1 { font-size: var(--fl-type-2xl); }
}
`;

function navbar(): string {
  return `<header class="fl-topbar" role="banner">
  <a class="fl-topbar-brand" href="/" aria-label="FactoryLM home">FactoryLM</a>
  <nav class="fl-topbar-nav" aria-label="Primary">
    <a href="/cmms" data-cta="sec-nav-cmms">CMMS</a>
    <a href="/pricing" data-cta="sec-nav-pricing">Pricing</a>
    <a href="/blog" data-cta="sec-nav-blog">Blog</a>
    <a href="/limitations" data-cta="sec-nav-limitations">Limitations</a>
    <a href="/security" data-cta="sec-nav-security" aria-current="page">Security</a>
  </nav>
  <div class="fl-topbar-cta">
    ${btnGhost("Sign in", { href: "/cmms", cta: "sec-nav-signin" })}
  </div>
</header>`;
}

function footer(): string {
  return `<footer class="fl-footer" role="contentinfo">
  <div class="fl-footer-inner">
    <p class="fl-footer-brand">FactoryLM &middot; Built for industrial maintenance.</p>
    <ul class="fl-footer-links">
      <li><a href="/security" data-cta="sec-footer-security">Security</a></li>
      <li><a href="/limitations" data-cta="sec-footer-limitations">Limitations</a></li>
      <li><a href="/privacy" data-cta="sec-footer-privacy">Privacy</a></li>
      <li><a href="/terms" data-cta="sec-footer-terms">Terms</a></li>
    </ul>
    <button type="button" id="fl-sun-toggle" class="fl-sun-toggle" aria-pressed="false" aria-label="Toggle high-contrast outdoor mode" data-cta="sun-toggle">&#9728; Sun-readable</button>
  </div>
</footer>`;
}

interface SecurityItem {
  lead: string;
  body: string;
  planned?: boolean;
}

const INFRASTRUCTURE: SecurityItem[] = [
  {
    lead: "Containerized, isolated workloads.",
    body: "Every service runs in its own Docker container with a pinned image version, named networks, and no host networking. Containers cannot reach each other unless explicitly bridged.",
  },
  {
    lead: "NeonDB on AWS us-east-1.",
    body: "Tenant data lives in NeonDB (Postgres 16), hosted on AWS us-east-1. Connections require SSL (sslmode=require). NeonDB handles automated backups with point-in-time restore.",
  },
  {
    lead: "Secrets via Doppler — never in git.",
    body: "All credentials, API keys, and signing secrets are stored in Doppler and injected at runtime. No secrets in .env files, Dockerfiles, or source code.",
  },
  {
    lead: "Principle of least privilege.",
    body: "Service accounts hold only the permissions they need. The application DB role (factorylm_app) cannot bypass row-level security. neondb_owner is never used from application code.",
  },
];

const DATA_PROTECTION: SecurityItem[] = [
  {
    lead: "Encryption in transit — TLS everywhere.",
    body: "All external traffic is encrypted via TLS 1.2+. Internal service-to-service traffic uses named Docker networks (not exposed to the public internet).",
  },
  {
    lead: "Encryption at rest.",
    body: "NeonDB encrypts data at rest using AES-256. Uploaded documents (OEM manuals, images) stored in the knowledge base are encrypted at the object level.",
  },
  {
    lead: "PII is sanitized before every LLM call.",
    body: "The inference router automatically strips IPv4 addresses, MAC addresses, and serial numbers before sending any message to an external AI provider. This runs by default on every request — no opt-in required.",
  },
  {
    lead: "Your data is never used to train external models.",
    body: "MIRA uses Groq, Cerebras, and Gemini via inference-only API endpoints. We do not consent to training-data usage in any of these agreements. Your diagnostic conversations and OEM documents stay yours.",
  },
  {
    lead: "Data export on request.",
    body: "Active tenants can download a full export of their work orders, assets, schedules, and knowledge base at any time from the Hub dashboard.",
  },
];

const AUTH_ACCESS: SecurityItem[] = [
  {
    lead: "Magic-link authentication — no passwords to steal.",
    body: "Sign-in is handled via time-limited, single-use email tokens. There are no passwords stored in our database. Magic links expire in 15 minutes and are consumed on first use.",
  },
  {
    lead: "Row-level security enforces tenant isolation.",
    body: "PostgreSQL RLS policies enforce that every query returns only the requesting tenant's data. Application code cannot disable this — the DB role used by the app has BYPASSRLS=false.",
  },
  {
    lead: "Short-lived JWTs with tenant claim.",
    body: "Session tokens are JWTs signed with a rotating secret (PLG_JWT_SECRET). Every token contains a tenant_id claim. Tokens expire in 7 days and are not refreshable without re-authentication.",
  },
  {
    lead: "Admin endpoints require a separate bearer token.",
    body: "Operational endpoints (activation health, queue management) are gated behind a separate PLG_ADMIN_TOKEN header — not the user JWT. Admin access is not derivable from a user session.",
  },
];

const AI_SAFETY: SecurityItem[] = [
  {
    lead: "Safety-critical queries escalate — they never get an AI answer.",
    body: "LOTO procedures, arc flash, confined space entry, and 18 other high-consequence keywords trigger an immediate escalation to your designated safety contact. MIRA does not produce step-by-step answers for life-safety scenarios.",
  },
  {
    lead: "No autonomous actions — MIRA asks before it acts.",
    body: "MIRA creates work order drafts and PM suggestions, but always requires explicit human confirmation before writing anything to your CMMS. There are no automated write-backs.",
  },
  {
    lead: "Inference cascade is deterministic and auditable.",
    body: "The provider cascade (Groq → Cerebras → Gemini) is configured in code, not learned. Every LLM call logs the provider used, token count, and latency to structured logs.",
  },
  {
    lead: "Source citations are required on every diagnostic answer.",
    body: "MIRA's RAG pipeline must cite the source chunk (OEM manual section, fault history entry) that grounds each claim. Uncited speculative answers are blocked at the guardrail layer.",
  },
];

const COMPLIANCE: SecurityItem[] = [
  {
    lead: "Multi-tenant RLS isolation — implemented and active.",
    body: "PostgreSQL row-level security is live in production. Tenants cannot read each other's data even if application-level bugs exist.",
  },
  {
    lead: "Vulnerability disclosure.",
    body: "Found a security issue? Email security@factorylm.com. We commit to acknowledging reports within 48 hours and disclosing fixes publicly after a 90-day window.",
  },
  {
    lead: "SOC 2 Type II audit — planned Q3 2026.",
    body: "We are pre-revenue and pre-audit. SOC 2 Type II readiness work is in progress (access controls, logging, change management). We do not claim SOC 2 compliance today.",
    planned: true,
  },
  {
    lead: "GDPR Data Processing Agreement available.",
    body: "A standard DPA is available at factorylm.com/legal/dpa for EU customers.",
  },
  {
    lead: "Annual penetration test — planned Q3 2026.",
    body: "Third-party penetration testing is planned to coincide with the SOC 2 audit window.",
    planned: true,
  },
];

function renderSection(title: string, items: SecurityItem[]): string {
  const listItems = items
    .map(
      ({ lead, body, planned }) => `
    <li>
      <strong>${lead}</strong>${planned ? ' <span class="fl-sec-pill fl-sec-pill-planned">Planned</span>' : ''} ${body}
    </li>`,
    )
    .join("");
  return `
  <div class="fl-sec-section">
    <h2 class="fl-sec-section-h2">${title}</h2>
    <ul class="fl-sec-list">
      ${listItems}
    </ul>
  </div>`;
}

export function renderSecurity(reqUrl?: string): string {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    "name": "Security — FactoryLM",
    "description": "How FactoryLM protects your industrial maintenance data: infrastructure, encryption, tenant isolation, AI safety guardrails, and compliance roadmap.",
    "url": "https://factorylm.com/security",
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
      title: "Security — FactoryLM",
      description: "How FactoryLM protects your industrial maintenance data: infrastructure, encryption, tenant isolation, AI safety guardrails, and compliance roadmap.",
      canonical: "https://factorylm.com/security",
      ogTitle: "Security at FactoryLM",
      ogDescription: "Tenant isolation, encryption, magic-link auth, AI safety guardrails, and our SOC 2 roadmap.",
      jsonLd,
    },
    reqUrl,
  )}
  <style>${PAGE_STYLES}</style>
</head>
<body>
  ${navbar()}

  <section class="fl-sec-hero">
    <div class="fl-sec-hero-inner">
      <p class="fl-sec-eyebrow">Built for plant-floor trust</p>
      <h1 class="fl-sec-h1">Security at FactoryLM</h1>
      <p class="fl-sec-sub">How we protect your maintenance data, your team's conversations, and your OEM knowledge base.</p>
    </div>
  </section>

  ${renderSection("Infrastructure", INFRASTRUCTURE)}
  ${renderSection("Data protection", DATA_PROTECTION)}
  ${renderSection("Authentication &amp; access control", AUTH_ACCESS)}
  ${renderSection("AI safety guardrails", AI_SAFETY)}
  ${renderSection("Compliance &amp; certifications", COMPLIANCE)}

  <div class="fl-sec-cta">
    ${btnPrimary("Try it free — no credit card", { href: "/cmms", cta: "sec-cta-try" })}
    <p>
      Security question or vulnerability report?
      <a href="mailto:security@factorylm.com">security@factorylm.com</a>
    </p>
  </div>

  ${footer()}
  <script src="/sun-toggle.js"></script>
</body>
</html>`;
}

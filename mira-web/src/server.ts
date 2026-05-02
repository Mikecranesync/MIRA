/**
 * mira-web — Beta onboarding funnel for FactoryLM.
 *
 * Hono on Bun. Routes:
 *   GET  /                        → Homepage
 *   GET  /cmms                    → Serve CMMS landing / dashboard page
 *   GET  /limitations             → Honest "what we don't do yet" page (#677)
 *   GET  /activated               → Post-payment single-purpose upload page
 *   GET  /blog                    → Blog index (articles + fault codes link)
 *   GET  /blog/fault-codes        → Fault code library index
 *   GET  /blog/:slug              → Individual blog post or fault code article
 *   GET  /sitemap.xml             → Dynamic sitemap
 *   GET  /llms.txt                → LLM/AI-crawler product summary (GEO foundation)
 *   GET  /llms-full.txt           → Extended LLM content disclosure
 *   GET  /api/health              → Liveness probe
 *   POST /api/register            → Create pending tenant + start nurture
 *   GET  /api/checkout            → Stripe Checkout redirect ($97/mo)
 *   POST /api/stripe/webhook      → Stripe webhook handler
 *   GET  /api/billing-portal      → Stripe Customer Portal redirect
 *   GET  /api/me                  → User profile + quota (active only)
 *   GET  /api/quota               → Daily query quota status (active only)
 *   POST /api/ingest/manual       → Proxy PDF upload to mira-mcp (active only)
 *   GET  /demo/work-orders        → Static ticker data (no auth)
 *   POST /api/mira/chat           → SSE AI chat via mira-pipeline (active only)
 *   GET  /demo/tenant-work-orders → Real WOs for authenticated user (active only)
 *   GET  /qr-test                  → Branded QR display page (no auth; ?tenant_id &tenant_name)
 *   GET  /admin/qr-print          → Admin: list assets + select stickers (ADMIN only)
 *   POST /api/admin/qr-print-batch → Admin: UPSERT tags + generate Avery 5163 PDF (ADMIN only)
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { renderHome } from "./views/home.js";
import { renderCmms, renderSamplePlaceholder } from "./views/cmms.js";
import { renderLimitations } from "./views/limitations.js";
import { renderSecurity } from "./views/security.js";
import {
  createMagicLink,
  validateAndConsumeToken,
  buildMagicLinkUrl,
  checkMagicLinkRateLimit,
  neonMagicLinkStorage,
  auditMagicLink,
} from "./lib/magic-link.js";
import { sendMagicLinkEmail } from "./lib/mailer.js";
import { signToken, requireAuth, requireActive, type MiraTokenPayload } from "./lib/auth.js";
import { buildSessionCookie } from "./lib/cookie-session.js";
import {
  createWorkOrder,
  listWorkOrders,
  signupUser,
  signinUser,
} from "./lib/atlas.js";
import { deriveAtlasPassword } from "./lib/crypto.js";
import {
  findTenantByEmail,
  findTenantById,
  createTenant,
  getQuota,
  logQuery,
  hasQuotaRemaining,
  updateTenantTier,
  updateTenantStripe,
  updateTenantAtlas,
  updateTenantEmailStatus,
  updateTenantSeedStatus,
  recordProvisioningAttempt,
  findTenantByStripeCustomerId,
  ensureSchema,
} from "./lib/quota.js";
import { finalizeActivation } from "./lib/activation.js";
import {
  queryMira,
  buildSSEStream,
  parseWORecommendation,
} from "./lib/mira-chat.js";
import { seedDemoData } from "./seed/demo-data.js";
import { seedAssetFromNameplate } from "./seed/knowledge-seed.js";
import { importCSV } from "./lib/csv-import.js";
import { sendBetaWelcomeEmail, sendActivatedEmail } from "./lib/mailer.js";
import { startDripScheduler } from "./lib/drip.js";
import { recordAuditEvent, requestMetadata } from "./lib/audit.js";
import {
  requestSoftDelete,
  purgePendingDeletions,
} from "./lib/account-deletion.js";
import { getMfaState } from "./lib/quota.js";
import { decryptSecret, verifyTotp, findRecoveryCodeIndex } from "./lib/mfa.js";
import {
  createCheckoutSession,
  createDirectCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
} from "./lib/stripe.js";
import { FAULT_CODES } from "./data/fault-codes.js";
import { BLOG_POSTS } from "./data/blog-posts.js";
import {
  renderBlogPost,
  renderFaultCodePage,
  renderBlogIndex,
  renderFaultCodeIndex,
} from "./lib/blog-renderer.js";
import {
  createActivationCode,
  validateAndActivate,
  getConnectionStatus,
  ensureConnectSchema,
} from "./lib/connect.js";
import { FEATURES, renderFeaturePage } from "./lib/feature-renderer.js";
import {
  getLiveFaultCodes,
  getLiveBlogPosts,
  invalidateCache,
} from "./lib/blog-db.js";
import { m } from "./routes/m.js";
import { mChooser } from "./routes/m-chooser.js";
import { mReport, mReportApi } from "./routes/m-report.js";
import { mRegister, mRegisterApi } from "./routes/m-register.js";
import { adminPages, adminApi } from "./routes/admin/qr-print.js";
import { qrAnalytics } from "./routes/admin/qr-analytics.js";
import { adminChannelPages, adminChannelApi } from "./routes/admin/channels.js";
import { qrTest } from "./routes/qr-test.js";
import { inbox } from "./routes/inbox.js";
import { mfa } from "./routes/mfa.js";

// Merged content: static seed + NeonDB live drafts
let allFaultCodes = [...FAULT_CODES];
let allBlogPosts = [...BLOG_POSTS];

async function refreshBlogContent() {
  try {
    const dbCodes = await getLiveFaultCodes();
    const dbPosts = await getLiveBlogPosts();
    const seedSlugs = new Set(FAULT_CODES.map((f) => f.slug));
    const seedPostSlugs = new Set(BLOG_POSTS.map((p) => p.slug));
    allFaultCodes = [
      ...FAULT_CODES,
      ...dbCodes.filter((c) => !seedSlugs.has(c.slug)),
    ];
    allBlogPosts = [
      ...BLOG_POSTS,
      ...dbPosts.filter((p) => !seedPostSlugs.has(p.slug)),
    ];
    console.log(
      "[blog] Refreshed: %d fault codes (%d from DB), %d posts (%d from DB)",
      allFaultCodes.length, dbCodes.length,
      allBlogPosts.length, dbPosts.length,
    );
  } catch (e) {
    console.warn("[blog] Refresh failed, using cached data:", e);
  }
}

// Initial load + refresh every 5 minutes
refreshBlogContent();
setInterval(() => {
  invalidateCache();
  refreshBlogContent();
}, 5 * 60 * 1000);

export const app = new Hono();

// Middleware
//
// CORS — scope to /api/* only with an explicit origin allowlist. Was
// `app.use("*", cors())` before P0.3 (2026-04-30), which set
// Access-Control-Allow-Origin: * on every response including JSON APIs.
// Marketing/HTML routes don't need CORS at all (browsers default to
// same-origin); APIs are the surface that matters. PLG_API_ALLOWED_ORIGINS
// can override in env (comma-separated) — see docs/env-vars.md.
const API_ALLOWED_ORIGINS = (process.env.PLG_API_ALLOWED_ORIGINS ??
  "https://factorylm.com,https://www.factorylm.com,https://app.factorylm.com,http://localhost:3000,http://localhost:3200")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use("/api/*", cors({
  origin: (origin) => (API_ALLOWED_ORIGINS.includes(origin) ? origin : null),
  credentials: true,
  allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Hmac-Signature", "X-Hmac-Timestamp"],
  maxAge: 86400,
}));

// Ensure Content-Length is set on all non-streaming text responses.
// Bun sends HTML/JSON with chunked transfer encoding; nginx cannot synthesize
// Content-Length for HEAD from a chunked body and returns 0 instead — breaking
// LinkedIn/Slack preview unfurls and uptime monitors (issue #617).
// Buffering here sets Content-Length on the GET response; Hono then propagates
// it to HEAD responses automatically (strips body, keeps header).
app.use("*", async (c, next) => {
  await next();
  const ct = c.res.headers.get("content-type") ?? "";
  if (
    !c.res.headers.has("content-length") &&
    !ct.includes("event-stream") &&
    (ct.startsWith("text/") || ct.startsWith("application/json") || ct.startsWith("application/xml"))
  ) {
    const body = await c.res.arrayBuffer();
    c.res = new Response(body, { status: c.res.status, headers: c.res.headers });
    c.res.headers.set("content-length", String(body.byteLength));
  }
});

// QR scan routes — /m/:asset_tag (auth optional), /m/:asset_tag/choose, /m/:asset_tag/report
app.route("/m", mChooser);     // GET /m/:asset_tag/choose[?set_pref=...]
app.route("/m", mReport);      // GET /m/:asset_tag/report
app.route("/m", mRegister);    // GET /m/:asset_tag/register (auto-register form)
app.route("/m", m);            // GET /m/:asset_tag (main entry — must register last so subroutes match first)
app.route("/", mReportApi);    // POST /api/m/report
app.route("/", mRegisterApi);  // POST /api/m/auto-register (#439)

// QR test page — branded asset sheet, no auth required (sales/demo tool)
app.route("/", qrTest);                 // handles GET /qr-test[?tenant_id=&tenant_name=]

// Admin routes — QR print page + batch PDF endpoint + channel config
app.route("/admin", adminPages);        // handles GET /admin/qr-print
app.route("/", adminApi);               // handles POST /api/admin/qr-print-batch
app.route("/admin", qrAnalytics);       // handles GET /admin/qr-analytics
app.route("/admin", adminChannelPages); // handles GET /admin/channels
app.route("/", adminChannelApi);        // handles POST /api/admin/channels

// Magic email inbox (Unit 3): Google Apps Script poller webhook (HMAC-signed)
app.route("/api/v1/inbox", inbox);       // POST /api/v1/inbox/email

// MFA (TOTP) — Tier 1 #9. Free on every plan; SSO is the upsell.
app.route("/api/auth/mfa", mfa);         // setup / enable / disable / status

// Account deletion (Tier 1 #8) — CCPA "right to be forgotten" answer.
// Soft delete now, hard purge after 30 days.
app.delete("/api/v1/account", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const tenant = await findTenantById(user.sub);
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  const body = (await c.req.json().catch(() => null)) as
    | { confirm?: string; code?: string; recovery_code?: string; reason?: string }
    | null;

  // Defensive confirmation phrase — protects against XSRF / accidental
  // clicks. Exact-match required.
  if (body?.confirm !== "DELETE") {
    return c.json(
      { error: "Send {\"confirm\":\"DELETE\"} in the body to proceed." },
      400,
    );
  }

  // If MFA is enabled, require re-auth (TOTP or recovery code) before
  // accepting the deletion. Stops a stolen session from nuking an account.
  const mfaState = await getMfaState(user.sub);
  if (mfaState.enabled && mfaState.secretEnc) {
    const code = (body?.code ?? "").trim();
    const recovery = (body?.recovery_code ?? "").trim();
    let pass = false;
    try {
      const secret = decryptSecret(mfaState.secretEnc);
      if (/^\d{6}$/.test(code) && verifyTotp(secret, code)) pass = true;
    } catch {
      pass = false;
    }
    if (!pass && recovery) {
      const idx = findRecoveryCodeIndex(recovery, mfaState.recoveryCodesHashed);
      if (idx >= 0) pass = true;
    }
    if (!pass) {
      return c.json({ error: "MFA re-auth required (code or recovery_code)" }, 401);
    }
  }

  const meta = requestMetadata(c);
  const result = await requestSoftDelete({
    tenant,
    ip: meta.ip,
    userAgent: meta.userAgent,
    reason: body?.reason,
  });
  return c.json(result, 200);
});

// Daily worker — runs the hard purge for tenants past their 30-day grace.
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
if (process.env.NODE_ENV !== "test" && process.env.MIRA_DISABLE_PURGE_WORKER !== "1") {
  setInterval(() => {
    purgePendingDeletions().catch((err) =>
      console.error("[purge] worker error:", err),
    );
  }, PURGE_INTERVAL_MS);
  // First run on a 60s delay so the server is fully up.
  setTimeout(() => {
    purgePendingDeletions().catch((err) =>
      console.error("[purge] worker error (initial):", err),
    );
  }, 60_000);
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

app.use("/public/*", serveStatic({ root: "./" }));
app.use("/manifest.json", serveStatic({ path: "./public/manifest.json" }));
app.use("/sw.js", serveStatic({ path: "./public/sw.js" }));
app.use("/robots.txt", serveStatic({ path: "./public/robots.txt" }));
app.use("/og-image.png", serveStatic({ path: "./public/og-image.png" }));
// Wave A+B design-system assets — root-served so head() can reference them
// without the /public/ prefix (matches the head() helper's <link> output).
app.use("/_tokens.css", serveStatic({ path: "./public/_tokens.css" }));
app.use("/_components.css", serveStatic({ path: "./public/_components.css" }));
app.use("/sun-toggle.js", serveStatic({ path: "./public/sun-toggle.js" }));
app.use("/posthog-init.js", serveStatic({ path: "./public/posthog-init.js" }));
app.use("/pwa-install.js", serveStatic({ path: "./public/pwa-install.js" }));

// Dynamic sitemap (replaces static file)
app.get("/sitemap.xml", (c) => {
  const baseUrl = "https://factorylm.com";
  const today = new Date().toISOString().split("T")[0];

  const pages = [
    { loc: "/", priority: "1.0", freq: "weekly" },
    { loc: "/cmms", priority: "1.0", freq: "weekly" },
    { loc: "/blog", priority: "0.9", freq: "weekly" },
    { loc: "/blog/fault-codes", priority: "0.8", freq: "weekly" },
    ...allBlogPosts.map((p) => ({
      loc: `/blog/${p.slug}`,
      priority: "0.8",
      freq: "monthly" as const,
    })),
    ...allFaultCodes.map((fc) => ({
      loc: `/blog/${fc.slug}`,
      priority: "0.7",
      freq: "monthly" as const,
    })),
    { loc: "/limitations", priority: "0.5", freq: "monthly" },
    { loc: "/security", priority: "0.5", freq: "monthly" },
    { loc: "/privacy", priority: "0.3", freq: "yearly" },
    { loc: "/terms", priority: "0.3", freq: "yearly" },
    { loc: "/trust", priority: "0.4", freq: "monthly" },
    { loc: "/legal/dpa", priority: "0.3", freq: "yearly" },
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${pages
  .map(
    (p) => `  <url>
    <loc>${baseUrl}${p.loc}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${p.freq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`,
  )
  .join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Homepage — server-rendered via renderHome() (composes head() + Wave-B helpers)
app.get("/", (c) => {
  return c.html(renderHome(c.req.url));
});

// Health probe
app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "mira-web", version: "0.2.1" })
);

// PostHog analytics init (closes #618)
// Public API key is safe in HTML, but we serve it from server env so
// dev/staging/prod can use different projects without source changes.
// If PLG_POSTHOG_KEY is unset, a no-op stub is shipped so calls to
// posthog.capture(...) in HTML never throw — analytics is disabled silently.
const POSTHOG_HOST = (process.env.PLG_POSTHOG_HOST || "https://us.i.posthog.com").trim();
app.get("/posthog-init.js", (c) => {
  const key = (process.env.PLG_POSTHOG_KEY || "").trim();
  c.header("Content-Type", "application/javascript; charset=utf-8");
  // Cache for 5 minutes — same as static assets — but vary by host so a
  // key rotation is picked up quickly without a hard reload.
  c.header("Cache-Control", "public, max-age=300");
  if (!key) {
    return c.body(
      "// PostHog: PLG_POSTHOG_KEY is unset; analytics disabled.\n" +
      "window.posthog={capture:function(){},identify:function(){},init:function(){},reset:function(){}};\n",
    );
  }
  // Stock PostHog snippet, plus a tiny convenience: track clicks on any
  // [data-cta] element so marketing CTAs show up in funnels without the
  // HTML having to call posthog.capture() manually.
  return c.body(
    "!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(\".\");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement(\"script\")).type=\"text/javascript\",p.crossOrigin=\"anonymous\",p.async=!0,p.src=s.api_host.replace(\".i.posthog.com\",\"-assets.i.posthog.com\")+\"/static/array.js\",(r=t.getElementsByTagName(\"script\")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a=\"posthog\",u.people=u.people||[],u.toString=function(t){var e=\"posthog\";return\"posthog\"!==a&&(e+=\".\"+a),t||(e+=\" (stub)\"),e},u.people.toString=function(){return u.toString(1)+\".people (stub)\"},o=\"init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSurveysLoaded onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey canRenderSurveyAsync identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing\".split(\" \"),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);\n" +
    `posthog.init(${JSON.stringify(key)}, { api_host: ${JSON.stringify(POSTHOG_HOST)}, person_profiles: "identified_only", capture_pageview: true });\n` +
    "document.addEventListener('click', function(e){var el=e.target.closest('[data-cta]');if(el){posthog.capture('cta_click',{cta:el.getAttribute('data-cta'),href:el.getAttribute('href')||null,page:location.pathname});}}, {capture:true});\n",
  );
});

// CMMS landing — server-rendered (#SO-070): one-input magic-link form
app.get("/cmms", (c) => {
  return c.html(renderCmms(c.req.url));
});

// Limitations page (#677 / #SO-005) — honest "what we don't do yet"
app.get("/limitations", (c) => {
  return c.html(renderLimitations(c.req.url));
});

// Security page (#893) — infrastructure, data protection, AI safety, compliance roadmap
app.get("/security", (c) => {
  return c.html(renderSecurity(c.req.url));
});

// Sample workspace placeholder (#SO-070 AC4) — Phase-0 destination after sign-in.
app.get("/sample", (c) => {
  return c.html(renderSamplePlaceholder());
});

// Post-payment single-purpose upload page (activation email lands here).
// The "moment of highest motivation" — get a manual uploaded before the
// dashboard is shown. Access-gated client-side (token in ?token= query),
// the /api/ingest/manual proxy handles server-side tier enforcement.
//
// LOOM_UPLOAD_URL normalization: Loom's /share/ URLs set X-Frame-Options=deny
// and cannot be iframed; only /embed/ URLs work. We auto-convert either form
// and fall back to a static placeholder block when the env var is unset.
app.get("/activated", async (c) => {
  const raw = (process.env.LOOM_UPLOAD_URL || "").trim();
  const normalized = raw.replace("/share/", "/embed/");
  const isValidEmbed = /^https:\/\/[^\s"'<>]+$/.test(normalized);
  const loomContent = isValidEmbed
    ? `<iframe src="${normalized}" allowfullscreen title="How to upload your first manual"></iframe>`
    : `<div class="loom-placeholder"><span>Loom feed / awaiting signal</span></div>`;
  const file = Bun.file("./public/activated.html");
  const html = (await file.text()).replaceAll("{{LOOM_CONTENT}}", loomContent);
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.get("/pricing", async (c) => {
  const file = Bun.file("./public/pricing.html");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

// GEO foundation (#681) — llmstxt.org standard for AI-crawler content disclosure
app.get("/llms.txt", async (c) => {
  const file = Bun.file("./public/llms.txt");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
});

app.get("/llms-full.txt", async (c) => {
  const file = Bun.file("./public/llms-full.txt");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=86400" },
  });
});

app.get("/privacy", async (c) => {
  const file = Bun.file("./public/privacy.html");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.get("/terms", async (c) => {
  const file = Bun.file("./public/terms.html");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.get("/trust", async (c) => {
  const file = Bun.file("./public/trust.html");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

app.get("/.well-known/security.txt", async (c) => {
  const file = Bun.file("./public/.well-known/security.txt");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
});

app.get("/legal/dpa", async (c) => {
  const file = Bun.file("./public/legal/dpa.html");
  return new Response(await file.text(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

// ---------------------------------------------------------------------------
// Blog — Articles + Fault Code Library
// ---------------------------------------------------------------------------

// Blog index (articles + fault code library link)
app.get("/blog", (c) =>
  c.html(renderBlogIndex(allBlogPosts, allFaultCodes.length)),
);

// Fault code library index
app.get("/blog/fault-codes", (c) =>
  c.html(renderFaultCodeIndex(allFaultCodes)),
);

// Individual post or fault code article
app.get("/blog/:slug", (c) => {
  const slug = c.req.param("slug");

  // Check blog posts first
  const post = allBlogPosts.find((p) => p.slug === slug);
  if (post) return c.html(renderBlogPost(post, allBlogPosts, allFaultCodes));

  // Then fault codes
  const fc = allFaultCodes.find((f) => f.slug === slug);
  if (fc) return c.html(renderFaultCodePage(fc, allFaultCodes));

  return c.notFound();
});

// ---------------------------------------------------------------------------
// Feature deep-dive pages — /feature/:slug
// ---------------------------------------------------------------------------

app.get("/feature/:slug", (c) => {
  const slug = c.req.param("slug");
  const feature = FEATURES[slug];
  if (!feature) return c.notFound();
  return c.html(renderFeaturePage(feature));
});

// Static demo work orders for unauthenticated hero ticker
app.get("/demo/work-orders", (c) =>
  c.json([
    {
      id: "WO000341",
      title: "VFD overcurrent fault E05 — Pump Station 2",
      priority: "HIGH",
      status: "OPEN",
      ai: true,
      assetName: "GS10 VFD",
      minutesAgo: 4,
    },
    {
      id: "WO000342",
      title: "Conveyor belt tension adjustment — Line 3",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      ai: false,
      assetName: "Conveyor Belt",
      minutesAgo: 22,
    },
    {
      id: "WO000343",
      title: "Air compressor won't build pressure — Shop Floor",
      priority: "HIGH",
      status: "OPEN",
      ai: true,
      assetName: "Air Compressor",
      minutesAgo: 37,
    },
    {
      id: "WO000344",
      title: "Robot joint 3 grease interval overdue — Cell 4",
      priority: "MEDIUM",
      status: "OPEN",
      ai: false,
      assetName: "FANUC R-30iB",
      minutesAgo: 61,
    },
    {
      id: "WO000345",
      title: "Encoder cable replacement — Cell 4",
      priority: "HIGH",
      status: "COMPLETE",
      ai: true,
      assetName: "FANUC R-30iB",
      minutesAgo: 180,
    },
    {
      id: "WO000346",
      title: "Bearing temp high on drive motor — Line 3",
      priority: "HIGH",
      status: "OPEN",
      ai: true,
      assetName: "Drive Motor",
      minutesAgo: 8,
    },
    {
      id: "WO000347",
      title: "Hydraulic pressure drop — Press Station 1",
      priority: "MEDIUM",
      status: "IN_PROGRESS",
      ai: false,
      assetName: "Hydraulic Press",
      minutesAgo: 95,
    },
    {
      id: "WO000348",
      title: "PLC comms loss — Packaging Line 2",
      priority: "HIGH",
      status: "OPEN",
      ai: true,
      assetName: "Allen-Bradley PLC",
      minutesAgo: 12,
    },
  ])
);

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

// Per-IP rate limiter for /api/register.
// Token bucket: 5 requests per minute, 20 per hour. In-memory; single-instance OK.
// Blocks signup-flood / SMTP-bomb attempts while keeping legit signup traffic free.
const REGISTER_RATE_BUCKETS = new Map<string, { minute: number[]; hour: number[] }>();
const REGISTER_LIMIT_PER_MINUTE = 5;
const REGISTER_LIMIT_PER_HOUR = 20;

function checkRegisterRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const minuteAgo = now - 60_000;
  const hourAgo = now - 3_600_000;
  const bucket = REGISTER_RATE_BUCKETS.get(ip) ?? { minute: [], hour: [] };
  bucket.minute = bucket.minute.filter((t) => t > minuteAgo);
  bucket.hour = bucket.hour.filter((t) => t > hourAgo);
  if (bucket.minute.length >= REGISTER_LIMIT_PER_MINUTE) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.minute[0] + 60_000 - now) / 1000) };
  }
  if (bucket.hour.length >= REGISTER_LIMIT_PER_HOUR) {
    return { allowed: false, retryAfterSec: Math.ceil((bucket.hour[0] + 3_600_000 - now) / 1000) };
  }
  bucket.minute.push(now);
  bucket.hour.push(now);
  REGISTER_RATE_BUCKETS.set(ip, bucket);
  return { allowed: true, retryAfterSec: 0 };
}

function getClientIp(headers: Headers, fallback = "unknown"): string {
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || fallback;
}

// Cross-origin guard for /api/register — block browser-driven cross-origin POSTs.
// Empty/null Origin (same-origin or curl) is allowed; any cross-origin Origin must
// be in the allowlist. ALLOWED_ORIGINS env override comma-separated.
const REGISTER_ALLOWED_ORIGINS = (process.env.PLG_REGISTER_ALLOWED_ORIGINS ||
  "https://factorylm.com,https://www.factorylm.com,http://localhost:3000,http://localhost:3200")
  .split(",").map(s => s.trim()).filter(Boolean);

app.post("/api/register", async (c) => {
  const origin = c.req.header("origin");
  if (origin && !REGISTER_ALLOWED_ORIGINS.includes(origin)) {
    return c.json({ error: "Forbidden origin" }, 403);
  }

  const ip = getClientIp(c.req.raw.headers);
  const rl = checkRegisterRateLimit(ip);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json(
      { error: "Too many signup attempts. Please try again in a minute." },
      429,
    );
  }

  const body = await c.req.json();
  const { email, company, firstName } = body;

  if (!email || !company) {
    return c.json({ error: "email and company are required" }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Invalid email address" }, 400);
  }

  try {
    // Check if tenant already exists
    const existing = await findTenantByEmail(email);
    if (existing) {
      // Active user returning — give them a token
      if (existing.tier === "active") {
        const token = await signToken({
          tenantId: existing.id,
          email,
          tier: existing.tier,
          atlasCompanyId: 0,
          atlasUserId: 0,
          atlasRole: "USER",
        });
        c.header("Set-Cookie", buildSessionCookie(token));
        return c.json({ success: true, token, tenantId: existing.id });
      }
      // Pending/churned — still in nurture or needs to resubscribe
      return c.json({ success: true, pending: true, message: "Check your email for next steps" });
    }

    const tenantId = crypto.randomUUID();

    // Create tenant as pending — no product access until payment
    await createTenant({
      id: tenantId,
      email,
      company,
      firstName: firstName || "",
      tier: "pending",
      atlasPassword: "",
      atlasCompanyId: 0,
      atlasUserId: 0,
    });

    const meta = requestMetadata(c);
    void recordAuditEvent({
      tenantId,
      action: "tenant.signup",
      metadata: { email, company },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    // Send beta welcome email (async, don't block response)
    sendBetaWelcomeEmail(
      email,
      firstName || email.split("@")[0],
      company
    ).catch((err) => console.error("[register] Welcome email failed:", err));

    return c.json({ success: true, pending: true, message: "Check your email" });
  } catch (err) {
    console.error("[register] Error:", err);
    return c.json({ error: "Registration failed. Please try again." }, 500);
  }
});

// ---------------------------------------------------------------------------
// Magic-link sign-in (#SO-070)
// ---------------------------------------------------------------------------

app.post("/api/magic-link", async (c) => {
  let email: string;
  let plan: string | undefined;
  try {
    const body = await c.req.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    const rawPlan = String(body?.plan ?? "").trim().toLowerCase();
    plan = rawPlan && /^[a-z]{1,32}$/.test(rawPlan) ? rawPlan : undefined;
  } catch {
    return c.json({ error: "Invalid request body" }, 400);
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json(
      { error: "That email doesn't look right — check it and try again" },
      400
    );
  }

  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  const userAgent = c.req.header("user-agent") ?? "";

  if (!checkMagicLinkRateLimit(email)) {
    auditMagicLink({
      email,
      action: "magic_link.rate_limited",
      ip,
      userAgent,
    }).catch(() => {});
    return c.json(
      { error: "Please wait a minute before requesting another link." },
      429
    );
  }

  try {
    let tenant = await findTenantByEmail(email);
    if (!tenant) {
      const tenantId = crypto.randomUUID();
      await createTenant({
        id: tenantId,
        email,
        company: "",
        firstName: "",
        tier: "pending",
        atlasPassword: "",
        atlasCompanyId: 0,
        atlasUserId: 0,
      });
      tenant = await findTenantByEmail(email);
    }
    if (!tenant) {
      console.error("[magic-link] Tenant lookup failed after create");
      return c.json({ error: "Something went wrong. Please try again." }, 500);
    }

    const storage = neonMagicLinkStorage();
    const created = await createMagicLink(storage, {
      tenantId: tenant.id,
      email,
    });

    const publicUrl = process.env.PUBLIC_URL || "https://factorylm.com";
    const loginUrl = buildMagicLinkUrl(publicUrl, created.token, email);

    auditMagicLink({
      email,
      action: "magic_link.requested",
      tenantId: tenant.id,
      ip,
      userAgent,
      meta: plan ? { plan } : undefined,
    }).catch(() => {});

    sendMagicLinkEmail(email, loginUrl)
      .then((sent) =>
        auditMagicLink({
          email,
          action: sent ? "magic_link.sent" : "magic_link.invalid",
          tenantId: tenant!.id,
          ip,
          userAgent,
          meta: sent ? undefined : { reason: "send_failed" },
        }).catch(() => {})
      )
      .catch((err) => console.error("[magic-link] Send failed:", err));

    return c.json({
      success: true,
      message: "Check your email for the sign-in link.",
    });
  } catch (err) {
    console.error("[magic-link] Error:", err);
    return c.json({ error: "Something went wrong. Please try again." }, 500);
  }
});

app.get("/api/magic/login", async (c) => {
  const token = c.req.query("token") ?? "";
  const queryEmail = c.req.query("email") ?? "";
  if (!token) {
    return c.html(magicLinkErrorPage("Missing token"), 400);
  }

  const ip =
    c.req.header("cf-connecting-ip") ||
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    "";
  const userAgent = c.req.header("user-agent") ?? "";

  try {
    const storage = neonMagicLinkStorage();
    const result = await validateAndConsumeToken(storage, token);
    if (!result.ok) {
      auditMagicLink({
        email: queryEmail,
        action: "magic_link.invalid",
        ip,
        userAgent,
        meta: { reason: result.reason },
      }).catch(() => {});
      const msg =
        result.reason === "expired"
          ? "This sign-in link has expired. Request a new one below."
          : result.reason === "already_consumed"
            ? "This sign-in link has already been used. Request a new one."
            : "We couldn't verify that link. Request a new one below.";
      return c.html(magicLinkErrorPage(msg), 410);
    }

    const tenant = await findTenantById(result.tenantId);
    if (!tenant) {
      return c.html(magicLinkErrorPage("Account not found"), 404);
    }

    const sessionToken = await signToken({
      tenantId: tenant.id,
      email: tenant.email,
      tier: tenant.tier,
      atlasCompanyId: tenant.atlas_company_id || 0,
      atlasUserId: tenant.atlas_user_id || 0,
      atlasRole: "USER",
    });

    auditMagicLink({
      email: tenant.email,
      action: "magic_link.consumed",
      tenantId: tenant.id,
      ip,
      userAgent,
    }).catch(() => {});

    c.header("Set-Cookie", buildSessionCookie(sessionToken));
    return c.redirect("/sample", 302);
  } catch (err) {
    console.error("[magic-link/login] Error:", err);
    return c.html(magicLinkErrorPage("Something went wrong"), 500);
  }
});

function magicLinkErrorPage(msg: string): string {
  const safe = msg.replace(/[<>]/g, "");
  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><title>Sign-in link invalid — FactoryLM</title>
<link rel="stylesheet" href="/_tokens.css">
<style>
  body { font-family: var(--fl-font-sans); padding: 48px 24px; max-width: 560px; margin: 0 auto; }
  .card { background: var(--fl-card-0); border: 1px solid var(--fl-rule-200); border-radius: 12px; padding: 32px; box-shadow: var(--fl-shadow-sm); text-align: center; }
  h1 { color: var(--fl-navy-900); margin: 0 0 16px; }
  p  { color: var(--fl-muted-600); line-height: 1.55; margin: 0 0 24px; }
  a  { color: var(--fl-navy-900); }
</style></head><body>
<div class="card">
  <h1>Sign-in link unavailable</h1>
  <p>${safe}</p>
  <p><a href="/cmms">Request a new sign-in link →</a></p>
</div></body></html>`;
}

// ---------------------------------------------------------------------------
// Stripe — Checkout, Webhook, Billing Portal
// ---------------------------------------------------------------------------

// Direct checkout — no email required, Stripe collects it. Used by pricing page buttons.
app.get("/api/checkout/session", async (c) => {
  try {
    const url = await createDirectCheckoutSession();
    return c.redirect(url, 303);
  } catch (err) {
    console.error("[checkout/session] Error:", err);
    return c.redirect("/pricing?checkout=error", 303);
  }
});

// Checkout redirect (unauthenticated — called from payment email link)
app.get("/api/checkout", async (c) => {
  const tid = c.req.query("tid");
  const email = c.req.query("email");

  if (!tid || !email) {
    return c.json({ error: "Missing tid or email" }, 400);
  }

  try {
    const tenant = await findTenantById(tid);
    if (!tenant) return c.json({ error: "Tenant not found" }, 404);
    if (String(tenant.email) !== email) {
      return c.json({ error: "Email mismatch" }, 400);
    }

    // Already active — redirect to dashboard
    if (tenant.tier === "active") {
      return c.redirect("/cmms?payment=success", 303);
    }

    const checkoutUrl = await createCheckoutSession(tid, email);
    return c.redirect(checkoutUrl, 303);
  } catch (err) {
    console.error("[checkout] Error:", err);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

// Direct checkout from pricing page — finds/creates pending tenant then redirects to Stripe.
// Accepts { email, company? }. Returns { url } for JS redirect or redirects directly.
app.post("/api/checkout/start", async (c) => {
  const ip = getClientIp(c.req.raw.headers);
  const rl = checkRegisterRateLimit(ip);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json({ error: "Too many attempts. Try again shortly." }, 429);
  }

  let body: { email?: string; company?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }

  const { email, company } = body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return c.json({ error: "Valid email required" }, 400);
  }

  try {
    let tenantId: string;
    const existing = await findTenantByEmail(email);
    if (existing) {
      tenantId = existing.id;
      if (existing.tier === "active") {
        return c.json({ url: "/cmms?payment=success" });
      }
    } else {
      tenantId = crypto.randomUUID();
      await createTenant({
        id: tenantId,
        email,
        company: company || email.split("@")[1] || "unknown",
        firstName: "",
        tier: "pending",
        atlasPassword: "",
        atlasCompanyId: 0,
        atlasUserId: 0,
      });
    }

    const checkoutUrl = await createCheckoutSession(tenantId, email);
    return c.json({ url: checkoutUrl });
  } catch (err) {
    console.error("[checkout/start] Error:", err);
    return c.json({ error: "Failed to create checkout session" }, 500);
  }
});

// Stripe webhook (unauthenticated — Stripe sends events here)
app.post("/api/stripe/webhook", async (c) => {
  const signature = c.req.header("stripe-signature");
  if (!signature) return c.json({ error: "Missing signature" }, 400);

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: "Failed to read body" }, 400);
  }

  let event;
  try {
    event = await constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  console.log("[stripe-webhook] Event:", event.type, event.id);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;

      const customerId = typeof session.customer === "string"
        ? session.customer
        : session.customer?.id || "";
      const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id || "";

      let tenantId = session.metadata?.tenant_id;

      // No tenant_id — direct checkout from pricing page. Find or create by email.
      if (!tenantId) {
        const email = session.customer_details?.email;
        if (!email) {
          console.error("[stripe-webhook] No tenant_id and no email in session");
          break;
        }
        let t = await findTenantByEmail(email);
        if (!t) {
          const newId = crypto.randomUUID();
          await createTenant({
            id: newId,
            email,
            company: email.split("@")[1] || "unknown",
            firstName: "",
            tier: "pending",
            atlasPassword: "",
            atlasCompanyId: 0,
            atlasUserId: 0,
          });
          t = await findTenantById(newId);
        }
        if (!t) {
          console.error("[stripe-webhook] Could not find/create tenant for", email);
          break;
        }
        tenantId = t.id;
        console.log("[stripe-webhook] Matched tenant via email:", tenantId, email);
      }

      await updateTenantStripe(tenantId, customerId, subscriptionId);
      await updateTenantTier(tenantId, "active");
      console.log("[stripe-webhook] Tenant activated:", tenantId);

      void recordAuditEvent({
        tenantId,
        actorType: "system",
        actorId: "stripe.webhook",
        action: "tenant.activated",
        resource: subscriptionId,
        metadata: { customer_id: customerId, subscription_id: subscriptionId },
      });

      const tenant = await findTenantById(tenantId);
      if (!tenant) {
        console.error("[stripe-webhook] Tenant not found after activation:", tenantId);
        break;
      }

      const result = await finalizeActivation(tenant, {
        signupUser,
        updateTenantAtlas,
        seedDemoData,
        updateTenantSeedStatus,
        signToken,
        sendActivatedEmail,
        updateTenantEmailStatus,
        recordProvisioningAttempt,
        deriveAtlasPassword,
      });
      console.log("[stripe-webhook] Activation result for %s:", tenantId, result);
      break;
    }

    case "customer.subscription.updated": {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId && (sub.status === "past_due" || sub.status === "unpaid")) {
        console.warn("[stripe-webhook] Subscription %s for tenant %s", sub.status, tenantId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object;
      const tenantId = sub.metadata?.tenant_id;
      if (tenantId) {
        await updateTenantTier(tenantId, "churned");
        console.log("[stripe-webhook] Tenant churned:", tenantId);
        void recordAuditEvent({
          tenantId,
          actorType: "system",
          actorId: "stripe.webhook",
          action: "tenant.churned",
          resource: sub.id,
        });
      } else {
        // Fallback: look up by customer ID
        const customerId = typeof sub.customer === "string"
          ? sub.customer
          : sub.customer?.id || "";
        if (customerId) {
          const tenant = await findTenantByStripeCustomerId(customerId);
          if (tenant) {
            await updateTenantTier(tenant.id, "churned");
            console.log("[stripe-webhook] Tenant churned (by customer):", tenant.id);
            void recordAuditEvent({
              tenantId: tenant.id,
              actorType: "system",
              actorId: "stripe.webhook",
              action: "tenant.churned",
              resource: sub.id,
              metadata: { matched_via: "customer_id" },
            });
          }
        }
      }
      break;
    }
  }

  // Always return 200 quickly
  return c.json({ received: true });
});

// Billing portal (authenticated, any tier — churned users need this to resubscribe)
app.get("/api/billing-portal", requireAuth, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const tenant = await findTenantById(user.sub);

  if (!tenant?.stripe_customer_id) {
    return c.json({ error: "No billing account found" }, 404);
  }

  try {
    const url = await createPortalSession(String(tenant.stripe_customer_id));
    return c.json({ url });
  } catch (err) {
    console.error("[billing-portal] Error:", err);
    return c.json({ error: "Failed to create portal session" }, 500);
  }
});

// CMMS SSO — derive password, sign in to Atlas, redirect with token in fragment
const CMMS_PUBLIC_URL = process.env.CMMS_PUBLIC_URL || "https://cmms.factorylm.com";

app.get("/api/cmms/login", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const tenant = await findTenantById(user.sub);
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  if (tenant.atlas_provisioning_status === "failed" || tenant.atlas_company_id === 0) {
    return c.json({ error: "CMMS account not yet provisioned" }, 503);
  }

  try {
    const password = deriveAtlasPassword(tenant.id);
    const atlas = await signinUser(String(tenant.email), password);
    const target = new URL(CMMS_PUBLIC_URL);
    target.hash = `accessToken=${encodeURIComponent(atlas.accessToken)}&companyId=${atlas.companyId}&userId=${atlas.userId}`;
    return c.redirect(target.toString(), 302);
  } catch (err) {
    console.error("[cmms-login] Atlas signin failed:", err);
    return c.json({ error: "CMMS login failed" }, 502);
  }
});

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

// User profile (active subscribers only)
app.get("/api/me", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const tenant = await findTenantById(user.sub);
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);
  const quota = await getQuota(user.sub, "active");
  const provisioning = {
    atlas: tenant.atlas_provisioning_status,
    demo: tenant.demo_seed_status,
    email: tenant.activation_email_status,
    attempts: tenant.provisioning_attempts,
    last_error: tenant.provisioning_last_error,
    ready: tenant.atlas_provisioning_status === "ok"
        && tenant.activation_email_status !== "pending",
  };
  const inboxDomain = process.env.INBOX_DOMAIN || "inbox.factorylm.com";
  const inboxAddress = tenant.inbox_slug
    ? `kb+${tenant.inbox_slug}@${inboxDomain}`
    : null;
  return c.json({
    tenantId: user.sub,
    email: user.email,
    tier: "active",
    quota,
    provisioning,
    inbox: { slug: tenant.inbox_slug, address: inboxAddress },
  });
});

const RETRY_COOLDOWN_MS = 60_000;
const lastActivationRetry = new Map<string, number>();

app.post("/api/activation/retry", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const now = Date.now();
  const prev = lastActivationRetry.get(user.sub) ?? 0;
  if (now - prev < RETRY_COOLDOWN_MS) {
    return c.json({ error: "Cooldown — try again in a minute" }, 429);
  }
  lastActivationRetry.set(user.sub, now);

  const tenant = await findTenantById(user.sub);
  if (!tenant) return c.json({ error: "Tenant not found" }, 404);

  const result = await finalizeActivation(tenant, {
    signupUser,
    updateTenantAtlas,
    seedDemoData,
    updateTenantSeedStatus,
    signToken,
    sendActivatedEmail,
    updateTenantEmailStatus,
    recordProvisioningAttempt,
    deriveAtlasPassword,
  });
  console.log("[activation-retry] %s:", user.sub, result);
  return c.json({ result });
});

const ADMIN_TOKEN = () => process.env.PLG_ADMIN_TOKEN || "";

app.get("/api/admin/activation-health", async (c) => {
  const token = c.req.header("x-admin-token");
  if (!token || token !== ADMIN_TOKEN()) {
    return c.json({ error: "forbidden" }, 403);
  }
  const { neon } = await import("@neondatabase/serverless");
  const url = process.env.NEON_DATABASE_URL;
  if (!url) return c.json({ error: "DB not configured" }, 500);
  const sql = neon(url);
  const stuck = await sql`
    SELECT id, email, atlas_provisioning_status, activation_email_status,
           demo_seed_status, provisioning_attempts, provisioning_last_error,
           provisioning_last_attempt_at, created_at
      FROM plg_tenants
     WHERE tier = 'active'
       AND (atlas_provisioning_status <> 'ok'
            OR activation_email_status <> 'sent'
            OR demo_seed_status = 'failed')
       AND created_at < NOW() - INTERVAL '10 minutes'
     ORDER BY created_at DESC
     LIMIT 100`;
  return c.json({ count: stuck.length, tenants: stuck });
});

// Query quota (active subscribers only)
app.get("/api/quota", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const quota = await getQuota(user.sub, "active");
  return c.json(quota);
});

// Tenant work orders (active subscribers only)
app.get("/demo/tenant-work-orders", requireActive, async (c) => {
  try {
    const wos = await listWorkOrders(undefined, 50);
    return c.json(wos);
  } catch (err) {
    console.error("[tenant-wos] Error:", err);
    return c.json({ error: "Failed to fetch work orders" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Manual Ingest Proxy — forwards PDF uploads to mira-ingest/ingest/document-kb
//
// This is the production RAG ingest path: PDFs land in Open WebUI KB
// collections (Docling extraction + embedding), which mira-pipeline reads
// from at chat time. The earlier mira-mcp/ingest/pdf endpoint wrote to a
// local openviking store that was never queried by the RAG reader (#337).
// ---------------------------------------------------------------------------

const INGEST_MAX_BYTES = 50 * 1024 * 1024;
const MIRA_INGEST_URL = () =>
  process.env.MIRA_INGEST_URL || "http://mira-ingest:8001";

app.post("/api/ingest/manual", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid multipart body" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'file' field" }, 400);
  }
  if (file.type && file.type !== "application/pdf") {
    return c.json({ error: "Only PDF uploads are accepted" }, 415);
  }
  if (file.size > INGEST_MAX_BYTES) {
    return c.json({ error: "File exceeds 50 MB limit" }, 413);
  }
  if (file.size === 0) {
    return c.json({ error: "Empty file" }, 400);
  }

  const forwarded = new FormData();
  forwarded.append("file", file, file.name || "upload.pdf");
  forwarded.append("tenant_id", user.sub);
  const equipmentType = form.get("equipment_type");
  if (typeof equipmentType === "string" && equipmentType.trim()) {
    forwarded.append("equipment_type", equipmentType.trim());
  }

  const started = Date.now();
  const meta = requestMetadata(c);
  try {
    const resp = await fetch(`${MIRA_INGEST_URL()}/ingest/document-kb`, {
      method: "POST",
      body: forwarded,
    });
    const latencyMs = Date.now() - started;
    const bodyText = await resp.text();
    console.log(
      "[ingest-manual] tenant=%s size=%d status=%d latency_ms=%d",
      user.sub,
      file.size,
      resp.status,
      latencyMs,
    );

    void recordAuditEvent({
      tenantId: user.sub,
      action: "manual.uploaded",
      resource: file.name || "upload.pdf",
      metadata: {
        size_bytes: file.size,
        ingest_status: resp.status,
        latency_ms: latencyMs,
        equipment_type: typeof equipmentType === "string" ? equipmentType : null,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    const contentType = resp.headers.get("content-type") || "application/json";
    return new Response(bodyText, {
      status: resp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    console.error("[ingest-manual] Proxy failed:", err);
    void recordAuditEvent({
      tenantId: user.sub,
      action: "manual.uploaded",
      resource: file.name || "upload.pdf",
      metadata: { size_bytes: file.size, error: "upstream-unreachable" },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return c.json({ error: "Ingest upstream unreachable" }, 502);
  }
});

// ---------------------------------------------------------------------------
// Nameplate Provision — bot adapters call this to seed tenant-scoped knowledge
// from extracted nameplate data. Accepts either a JWT (user) or the shared
// MCP_REST_API_KEY bearer token (service-to-service, mira-bots → mira-web).
// ---------------------------------------------------------------------------

app.post("/api/provision/nameplate", async (c) => {
  const authHeader = c.req.header("Authorization");

  let resolvedTenantId: string | null = null;

  // Service-to-service path: Bearer <MCP_REST_API_KEY>
  const mcpKey = process.env.MCP_REST_API_KEY || "";
  if (mcpKey && authHeader === `Bearer ${mcpKey}`) {
    // Tenant comes from the request body — validated below
    resolvedTenantId = "__service__"; // sentinel; actual value extracted after body parse
  } else {
    // JWT path
    if (!authHeader) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    const raw = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : authHeader;
    const { verifyToken } = await import("./lib/auth.js");
    const payload = await verifyToken(raw);
    if (!payload) {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
    resolvedTenantId = payload.sub;
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id.trim() : "";
  if (!tenantId) {
    return c.json({ error: "tenant_id is required" }, 400);
  }

  // For JWT callers, enforce that the token's tenant matches the body's tenant_id
  if (resolvedTenantId !== "__service__" && resolvedTenantId !== tenantId) {
    return c.json({ error: "Forbidden: tenant_id mismatch" }, 403);
  }

  const nameplate = body.nameplate;
  if (
    typeof nameplate !== "object" ||
    nameplate === null ||
    typeof (nameplate as Record<string, unknown>).manufacturer !== "string" ||
    !(nameplate as Record<string, unknown>).manufacturer ||
    typeof (nameplate as Record<string, unknown>).modelNumber !== "string" ||
    !(nameplate as Record<string, unknown>).modelNumber
  ) {
    return c.json(
      { error: "nameplate.manufacturer and nameplate.modelNumber are required" },
      400,
    );
  }

  try {
    const result = await seedAssetFromNameplate(
      tenantId,
      nameplate as Parameters<typeof seedAssetFromNameplate>[1],
    );
    console.log(
      "[provision-nameplate] tenant=%s manufacturer=%s model=%s linkedChunks=%d inserted=%d",
      tenantId,
      (nameplate as Record<string, unknown>).manufacturer,
      (nameplate as Record<string, unknown>).modelNumber,
      result.linkedChunks,
      result.inserted,
    );
    return c.json({ ok: true, ...result });
  } catch (err) {
    console.error("[provision-nameplate] seedAssetFromNameplate failed:", err);
    return c.json({ error: "Nameplate provision failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// CSV Work Order Import
// ---------------------------------------------------------------------------

const CSV_MAX_BYTES = 5 * 1024 * 1024;

app.post("/api/cmms/import-csv", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Invalid multipart body" }, 400);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return c.json({ error: "Missing 'file' field" }, 400);
  }
  if (file.size > CSV_MAX_BYTES) {
    return c.json({ error: "CSV exceeds 5 MB limit" }, 413);
  }
  if (file.size === 0) {
    return c.json({ error: "Empty file" }, 400);
  }

  const csvText = await file.text();
  console.log(
    "[csv-import] tenant=%s file=%s size=%d",
    user.sub,
    file.name,
    file.size,
  );

  try {
    const result = await importCSV(csvText);
    console.log(
      "[csv-import] tenant=%s imported=%d failed=%d",
      user.sub,
      result.imported,
      result.failed,
    );
    return c.json(result);
  } catch (err) {
    console.error("[csv-import] Failed:", err);
    return c.json({ error: "Import failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Mira AI Chat (SSE)
// ---------------------------------------------------------------------------

app.post("/api/mira/chat", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const body = await c.req.json();
  const query = body.query?.trim();

  if (!query) {
    return c.json({ error: "query is required" }, 400);
  }

  try {
    // Log query and decrement quota
    await logQuery(user.sub, query);

    // Call mira-pipeline
    const response = await queryMira({
      query,
      assetId: body.assetId || "",
    });

    // Check for WO recommendation
    const woRec = parseWORecommendation(response.answer);
    let woCreated = null;

    if (woRec) {
      try {
        const wo = await createWorkOrder({
          title: woRec.title,
          description: `AI-generated from query: ${query}`,
          priority: woRec.priority as "HIGH" | "MEDIUM" | "LOW" | "NONE",
        });
        woCreated = wo;
      } catch (err) {
        console.error("[mira-chat] Auto WO creation failed:", err);
      }
    }

    // Return SSE stream
    const stream = buildSSEStream(response);
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-WO-Created": woCreated ? JSON.stringify(woCreated) : "",
      },
    });
  } catch (err) {
    console.error("[mira-chat] Error:", err);
    return c.json({ error: "Chat request failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// MIRA Connect — factory-to-cloud activation
// ---------------------------------------------------------------------------

app.post("/api/connect/generate-code", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  try {
    const code = await createActivationCode(user.sub);
    return c.json({ code, expires_in: 3600 });
  } catch (err) {
    console.error("[connect] Code generation failed:", err);
    return c.json({ error: "Failed to generate activation code" }, 500);
  }
});

app.post("/api/connect/activate", async (c) => {
  const body = await c.req.json();
  const { code, agent_id, gateway_hostname } = body;

  if (!code) return c.json({ error: "code is required" }, 400);

  try {
    const result = await validateAndActivate(
      code,
      agent_id || "unknown",
      gateway_hostname || "unknown",
    );
    if (!result) {
      return c.json({ error: "Invalid, expired, or already used code" }, 404);
    }
    return c.json({
      status: "activated",
      tenant_id: result.tenant_id,
      relay_url: result.relay_url,
    });
  } catch (err) {
    console.error("[connect] Activation failed:", err);
    return c.json({ error: "Activation failed" }, 500);
  }
});

app.get("/api/connect/status", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  try {
    const status = await getConnectionStatus(user.sub);
    return c.json(status);
  } catch (err) {
    console.error("[connect] Status check failed:", err);
    return c.json({ error: "Status check failed" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

// Run schema migration on startup
Promise.all([ensureSchema(), ensureConnectSchema()])
  .then(() => console.log("[startup] NeonDB schema verified"))
  .catch((err) => console.warn("[startup] Schema migration skipped:", err));

// Start drip email scheduler
startDripScheduler();

console.log(`[mira-web] Starting on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};

/**
 * mira-web — Beta onboarding funnel for FactoryLM.
 *
 * Hono on Bun. Routes:
 *   GET  /                        → Homepage
 *   GET  /cmms                    → Serve CMMS landing / dashboard page
 *   GET  /activated               → Post-payment single-purpose upload page
 *   GET  /blog                    → Blog index (articles + fault codes link)
 *   GET  /blog/fault-codes        → Fault code library index
 *   GET  /blog/:slug              → Individual blog post or fault code article
 *   GET  /sitemap.xml             → Dynamic sitemap
 *   GET  /api/health              → Liveness probe
 *   POST /api/register            → Create pending tenant + start nurture
 *   GET  /api/checkout            → Stripe Checkout redirect ($97/mo)
 *   POST /api/stripe/webhook      → Stripe webhook handler
 *   GET  /api/billing-portal      → Stripe Customer Portal redirect
 *   GET  /api/me                  → User profile + quota (active only)
 *   GET  /api/quota               → Daily query quota status (active only)
 *   POST /api/ingest/manual       → Proxy PDF upload to mira-mcp (active only)
 *   GET  /demo/work-orders        → Static ticker data (no auth)
 *   POST /api/mira/chat           → SSE AI chat via mira-sidecar (active only)
 *   GET  /demo/tenant-work-orders → Real WOs for authenticated user (active only)
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { signToken, requireAuth, requireActive, type MiraTokenPayload } from "./lib/auth.js";
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
  findTenantByStripeCustomerId,
  ensureSchema,
} from "./lib/quota.js";
import {
  queryMira,
  buildSSEStream,
  parseWORecommendation,
} from "./lib/mira-chat.js";
import { seedDemoData } from "./seed/demo-data.js";
import { importCSV } from "./lib/csv-import.js";
import { sendBetaWelcomeEmail, sendActivatedEmail } from "./lib/mailer.js";
import { startDripScheduler } from "./lib/drip.js";
import {
  createCheckoutSession,
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
import { FEATURES, renderFeaturePage } from "./lib/feature-renderer.js";
import {
  getLiveFaultCodes,
  getLiveBlogPosts,
  invalidateCache,
} from "./lib/blog-db.js";

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

const app = new Hono();

// Middleware
app.use("*", cors());

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------

app.use("/public/*", serveStatic({ root: "./" }));
app.use("/manifest.json", serveStatic({ path: "./public/manifest.json" }));
app.use("/sw.js", serveStatic({ path: "./public/sw.js" }));
app.use("/robots.txt", serveStatic({ path: "./public/robots.txt" }));
app.use("/og-image.png", serveStatic({ path: "./public/og-image.png" }));

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

// Homepage
app.get("/", async (c) => {
  const file = Bun.file("./public/index.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
});

// Health probe
app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "mira-web", version: "0.1.0" })
);

// Serve CMMS page
app.get("/cmms", async (c) => {
  const file = Bun.file("./public/cmms.html");
  return new Response(await file.arrayBuffer(), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
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

app.post("/api/register", async (c) => {
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
        });
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
// Stripe — Checkout, Webhook, Billing Portal
// ---------------------------------------------------------------------------

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
    event = constructWebhookEvent(rawBody, signature);
  } catch (err) {
    console.error("[stripe-webhook] Signature verification failed:", err);
    return c.json({ error: "Invalid signature" }, 400);
  }

  console.log("[stripe-webhook] Event:", event.type, event.id);

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const tenantId = session.metadata?.tenant_id;
      if (!tenantId) {
        console.error("[stripe-webhook] No tenant_id in session metadata");
        break;
      }

      const customerId = typeof session.customer === "string"
        ? session.customer
        : session.customer?.id || "";
      const subscriptionId = typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id || "";

      // Update tenant with Stripe IDs and activate
      await updateTenantStripe(tenantId, customerId, subscriptionId);
      await updateTenantTier(tenantId, "active");
      console.log("[stripe-webhook] Tenant activated:", tenantId);

      const tenant = await findTenantById(tenantId);
      if (!tenant) {
        console.error("[stripe-webhook] Tenant not found after activation:", tenantId);
        break;
      }

      // Provision Atlas CMMS user
      let atlasCompanyId = 0;
      let atlasUserId = 0;
      let atlasToken = "";
      try {
        const password = deriveAtlasPassword(tenantId);
        const atlas = await signupUser(
          String(tenant.email),
          password,
          tenant.first_name || String(tenant.email).split("@")[0],
          "",
          String(tenant.company) || `${String(tenant.email).split("@")[0]}'s Plant`
        );
        atlasCompanyId = atlas.companyId;
        atlasUserId = atlas.userId;
        atlasToken = atlas.accessToken;
        await updateTenantAtlas(tenantId, atlasCompanyId, atlasUserId, "ok");
        console.log("[stripe-webhook] Atlas provisioned: company=%d user=%d", atlasCompanyId, atlasUserId);
      } catch (err) {
        console.error("[stripe-webhook] Atlas provisioning failed:", err);
        await updateTenantAtlas(tenantId, 0, 0, "failed");
      }

      // Seed demo data scoped to the tenant's Atlas company
      seedDemoData(atlasToken || undefined).catch((err) =>
        console.error("[stripe-webhook] Demo seed failed:", err)
      );

      // Send "you're in" email with login link
      const token = await signToken({
        tenantId,
        email: String(tenant.email),
        tier: "active",
        atlasCompanyId,
        atlasUserId,
      });
      sendActivatedEmail(
        String(tenant.email),
        tenant.first_name || String(tenant.email).split("@")[0],
        String(tenant.company),
        token
      ).catch((err) =>
        console.error("[stripe-webhook] Activated email failed:", err)
      );
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
  const quota = await getQuota(user.sub, "active");
  return c.json({
    tenantId: user.sub,
    email: user.email,
    tier: "active",
    quota,
  });
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
// Manual Ingest Proxy — forwards PDF uploads to mira-mcp
// ---------------------------------------------------------------------------

const INGEST_MAX_BYTES = 50 * 1024 * 1024;
const MIRA_MCP_URL = () =>
  process.env.MIRA_MCP_URL || "http://mira-mcp:8001";

app.post("/api/ingest/manual", requireActive, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const mcpKey = process.env.MCP_REST_API_KEY || "";
  if (!mcpKey) {
    console.error("[ingest-manual] MCP_REST_API_KEY not set");
    return c.json({ error: "Ingest service not configured" }, 500);
  }

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
  const equipmentType = form.get("equipment_type");
  if (typeof equipmentType === "string" && equipmentType.trim()) {
    forwarded.append("equipment_type", equipmentType.trim());
  }

  const started = Date.now();
  try {
    // NOTE: mira-mcp currently derives tenant_id from its own MIRA_TENANT_ID
    // env var (global), not from the form. Per-tenant isolation for uploads
    // is a known gap tracked separately from this funnel.
    const resp = await fetch(`${MIRA_MCP_URL()}/ingest/pdf`, {
      method: "POST",
      headers: { Authorization: `Bearer ${mcpKey}` },
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

    const contentType = resp.headers.get("content-type") || "application/json";
    return new Response(bodyText, {
      status: resp.status,
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    console.error("[ingest-manual] Proxy failed:", err);
    return c.json({ error: "Ingest upstream unreachable" }, 502);
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

    // Call mira-sidecar
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
// Startup
// ---------------------------------------------------------------------------

const PORT = parseInt(process.env.PORT || "3000", 10);

// Run schema migration on startup
ensureSchema()
  .then(() => console.log("[startup] NeonDB schema verified"))
  .catch((err) => console.warn("[startup] Schema migration skipped:", err));

// Start drip email scheduler
startDripScheduler();

console.log(`[mira-web] Starting on port ${PORT}`);

export default {
  port: PORT,
  fetch: app.fetch,
};

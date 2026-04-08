/**
 * mira-web — PLG acquisition funnel for FactoryLM.
 *
 * Hono on Bun. Routes:
 *   GET  /cmms                  → Serve gated CMMS landing page
 *   GET  /api/health            → Liveness probe
 *   POST /api/register          → Create tenant + Atlas user + JWT
 *   GET  /api/me                → User profile + quota (auth required)
 *   GET  /api/quota             → Daily query quota status (auth required)
 *   GET  /demo/work-orders      → Static ticker data (no auth)
 *   POST /api/mira/chat         → SSE AI chat via mira-sidecar (auth required)
 *   GET  /demo/tenant-work-orders → Real WOs for authenticated user
 */

import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { cors } from "hono/cors";
import { signToken, requireAuth, type MiraTokenPayload } from "./lib/auth.js";
import {
  createWorkOrder,
  listWorkOrders,
} from "./lib/atlas.js";
import {
  findTenantByEmail,
  createTenant,
  getQuota,
  logQuery,
  hasQuotaRemaining,
  ensureSchema,
} from "./lib/quota.js";
import {
  queryMira,
  buildSSEStream,
  parseWORecommendation,
} from "./lib/mira-chat.js";
import { seedDemoData } from "./seed/demo-data.js";
import { sendWelcomeEmail } from "./lib/mailer.js";
import { startDripScheduler } from "./lib/drip.js";

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
app.use("/sitemap.xml", serveStatic({ path: "./public/sitemap.xml" }));

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

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
  const { email, company, firstName, lastName, role } = body;

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
      const token = await signToken({
        tenantId: existing.id,
        email,
        tier: existing.tier,
        atlasCompanyId: 0,
        atlasUserId: 0,
      });
      return c.json({ success: true, token, tenantId: existing.id });
    }

    const tenantId = crypto.randomUUID();

    // Create tenant row in NeonDB (Atlas WO operations use shared admin token)
    await createTenant({
      id: tenantId,
      email,
      company,
      tier: "free",
      atlasPassword: "",
      atlasCompanyId: 0,
      atlasUserId: 0,
    });

    // Seed demo data (async, don't block response)
    seedDemoData().catch((err) =>
      console.error("[register] Demo seed failed:", err)
    );

    // Issue JWT
    const token = await signToken({
      tenantId,
      email,
      tier: "free",
      atlasCompanyId: 0,
      atlasUserId: 0,
    });

    // Send welcome email (async, don't block response)
    sendWelcomeEmail(
      email,
      firstName || email.split("@")[0],
      company,
      token
    ).catch((err) => console.error("[register] Welcome email failed:", err));

    return c.json({ success: true, token, tenantId });
  } catch (err) {
    console.error("[register] Error:", err);
    return c.json({ error: "Registration failed. Please try again." }, 500);
  }
});

// ---------------------------------------------------------------------------
// Authenticated routes
// ---------------------------------------------------------------------------

// User profile
app.get("/api/me", requireAuth, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const quota = await getQuota(user.sub);
  return c.json({
    tenantId: user.sub,
    email: user.email,
    tier: user.tier,
    quota,
  });
});

// Query quota
app.get("/api/quota", requireAuth, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const quota = await getQuota(user.sub);
  return c.json(quota);
});

// Tenant work orders (real data from Atlas)
app.get("/demo/tenant-work-orders", requireAuth, async (c) => {
  try {
    const wos = await listWorkOrders(undefined, 50);
    return c.json(wos);
  } catch (err) {
    console.error("[tenant-wos] Error:", err);
    return c.json({ error: "Failed to fetch work orders" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Mira AI Chat (SSE)
// ---------------------------------------------------------------------------

app.post("/api/mira/chat", requireAuth, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const body = await c.req.json();
  const query = body.query?.trim();

  if (!query) {
    return c.json({ error: "query is required" }, 400);
  }

  // Check quota
  const canQuery = await hasQuotaRemaining(user.sub);
  if (!canQuery) {
    return c.json(
      {
        error: "Daily query limit reached",
        upgradeUrl: "/pricing",
      },
      429
    );
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

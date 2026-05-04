/**
 * Auto-register route for unknown QR asset tags (#439).
 *
 * GET  /m/:asset_tag/register
 *   — Renders the registration form page. Called by m.ts when tag is not found.
 *   — If authed (JWT present): form POSTs to /api/m/auto-register directly.
 *   — If unauthed: form submits as GET redirect to the hub signup/login page
 *     with asset data pre-filled in query params so the hub can complete
 *     registration after the user signs in.
 *
 * POST /api/m/auto-register
 *   — Auth required (JWT in Authorization header or mira_session cookie).
 *   — Rate-limited: 5 registrations per IP per hour (anti-spam, spec §439).
 *   — Creates asset in cmms_equipment + asset_qr_tags (same NeonDB).
 *   — Returns JSON { redirect_url } pointing to hub asset chat page.
 */
import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { verifyToken } from "../lib/auth.js";
import { ASSET_TAG_RE, recordScan } from "../lib/qr-tracker.js";
import { parseCookies } from "../lib/cookie-session.js";

export const mRegister = new Hono();
export const mRegisterApi = new Hono();

// ── Rate limiter ───────────────────────────────────────────────────────────
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

const rateStore = new Map<string, number[]>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const hits = (rateStore.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (hits.length >= RATE_LIMIT) return false;
  hits.push(now);
  rateStore.set(ip, hits);
  return true;
}

// ── HTML helpers ───────────────────────────────────────────────────────────
const EQUIPMENT_TYPES = [
  "Mechanical", "Electrical", "CNC", "HVAC", "Fluid",
  "Conveyor", "Pump", "Compressor", "Robot", "PLC", "Other",
];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!),
  );
}

function buildRegisterPage(
  assetTag: string,
  tenantId: string | null,
  opts: { error?: string } = {},
): string {
  const isAuthed = Boolean(tenantId);
  const hubBase = process.env.PLG_HUB_URL ?? "https://app.factorylm.com";
  const typeOptions = EQUIPMENT_TYPES.map(
    (t) => `<option value="${t}">${t}</option>`,
  ).join("");

  const formAction = isAuthed ? "/api/m/auto-register" : `${hubBase}/cmms`;
  const formMethod = isAuthed ? "POST" : "GET";
  const hiddenFields = isAuthed
    ? `<input type="hidden" name="asset_tag" value="${esc(assetTag)}">
       <input type="hidden" name="tenant_id" value="${esc(tenantId!)}">`
    : `<input type="hidden" name="register_tag" value="${esc(assetTag)}">`;

  const submitLabel = isAuthed ? "Register this equipment" : "Sign in to register →";

  const unauthedNote = !isAuthed
    ? `<p class="note">You'll be asked to sign in or create an account. Your equipment details will be pre-filled.</p>`
    : "";

  const errorBlock = opts.error
    ? `<div class="error">${esc(opts.error)}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Register equipment — MIRA</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 480px; margin: 0 auto;
      padding: 1.5rem 1rem 3rem;
      background: #f8f8f6; color: #111;
    }
    .logo { font-size: 1rem; font-weight: 700; color: #1B365D; margin-bottom: 2rem; }
    .tag-badge {
      display: inline-block; font-family: monospace; font-size: 0.8rem;
      background: #fff; border: 1px solid #ddd; border-radius: 6px;
      padding: 0.25rem 0.6rem; color: #555; margin-bottom: 0.5rem;
    }
    h1 { font-size: 1.2rem; font-weight: 700; margin: 0 0 0.5rem; color: #111; }
    .sub { color: #555; font-size: 0.9rem; margin-bottom: 1.5rem; line-height: 1.5; }
    .card {
      background: #fff; border: 1px solid #e0e0dd;
      border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem;
    }
    label { display: block; font-size: 0.8rem; font-weight: 600;
            color: #555; margin-bottom: 0.3rem; text-transform: uppercase;
            letter-spacing: 0.04em; }
    input[type="text"], select {
      width: 100%; padding: 0.65rem 0.75rem;
      border: 1px solid #ccc; border-radius: 8px;
      font-size: 0.95rem; color: #111;
      margin-bottom: 1rem; background: #fff;
    }
    input:focus, select:focus {
      outline: 2px solid #f5a623; outline-offset: 1px; border-color: #f5a623;
    }
    input[readonly] { background: #f3f3f1; color: #888; cursor: not-allowed; }
    .btn {
      display: block; width: 100%;
      padding: 0.85rem; background: #f5a623; color: #0a0a08;
      border: none; border-radius: 8px; font-size: 1rem; font-weight: 700;
      cursor: pointer; text-align: center;
    }
    .btn:hover { background: #e09000; }
    .btn:active { background: #c07800; }
    .note { font-size: 0.8rem; color: #777; margin-top: 0.75rem; line-height: 1.5; }
    .error {
      background: #FEF2F2; color: #991B1B;
      border: 1px solid #FECACA; border-radius: 8px;
      padding: 0.75rem 1rem; font-size: 0.875rem; margin-bottom: 1rem;
    }
    .why { color: #777; font-size: 0.8rem; margin-top: 1.25rem; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="logo">MIRA by FactoryLM</div>
  <div class="tag-badge">${esc(assetTag)}</div>
  <h1>This sticker isn't registered yet.</h1>
  <p class="sub">Add this equipment to your plant so MIRA can answer questions about it.</p>
  ${errorBlock}
  <div class="card">
    <form method="${formMethod}" action="${formAction}" id="reg-form">
      ${hiddenFields}
      <label for="equipment_name">Equipment name *</label>
      <input type="text" id="equipment_name" name="equipment_name"
             placeholder="e.g. Air Compressor #3" required maxlength="120">

      <label for="equipment_type">Type</label>
      <select id="equipment_type" name="equipment_type">
        <option value="">— Select —</option>
        ${typeOptions}
      </select>

      <label for="location">Location</label>
      <input type="text" id="location" name="location"
             placeholder="e.g. Building A, Bay 3" maxlength="120">

      <button type="submit" class="btn">${submitLabel}</button>
      ${unauthedNote}
    </form>
  </div>
  <p class="why">
    MIRA uses equipment records to give cited, asset-specific answers — manuals,
    fault history, PM schedules. Register once, ask forever.
  </p>
</body>
</html>`;
}

// ── GET /m/:asset_tag/register ─────────────────────────────────────────────
mRegister.get("/:asset_tag/register", async (c) => {
  const assetTag = c.req.param("asset_tag");
  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset tag" }, 400);
  }

  // Resolve auth — same token chain as m.ts
  const cookies = parseCookies(c.req.header("cookie"));
  const raw =
    c.req.header("Authorization")?.replace("Bearer ", "") ??
    c.req.query("token") ??
    cookies["mira_session"];
  const payload = raw ? await verifyToken(raw) : null;

  return c.html(buildRegisterPage(assetTag, payload?.sub ?? null));
});

// ── POST /api/m/auto-register ──────────────────────────────────────────────
mRegisterApi.post("/api/m/auto-register", async (c) => {
  // Auth required — no tenant context, no creation
  const cookies = parseCookies(c.req.header("cookie"));
  const raw =
    c.req.header("Authorization")?.replace("Bearer ", "") ??
    cookies["mira_session"];
  const payload = raw ? await verifyToken(raw) : null;
  if (!payload) {
    return c.json({ error: "Authentication required" }, 401);
  }
  const tenantId = payload.sub;

  // Rate limit
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown";
  if (!checkRateLimit(ip)) {
    return c.json({ error: "Too many registrations. Try again in an hour." }, 429);
  }

  if (!process.env.NEON_DATABASE_URL) {
    return c.json({ error: "DB not configured" }, 503);
  }

  let body: Record<string, string>;
  try {
    const raw = await c.req.json() as Record<string, unknown>;
    body = Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k, String(v ?? "").trim()]),
    );
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const { asset_tag, equipment_name, equipment_type, location } = body;

  if (!ASSET_TAG_RE.test(asset_tag ?? "")) {
    return c.json({ error: "Invalid asset_tag" }, 400);
  }
  if (!equipment_name) {
    return c.json({ error: "equipment_name is required" }, 400);
  }

  const safeType = equipment_type && equipment_type.length > 0 ? equipment_type : null;
  const safeLocation = location && location.length > 0 ? location : null;

  // DB: create asset in cmms_equipment + register in asset_qr_tags
  const pg = new Client(process.env.NEON_DATABASE_URL);
  await pg.connect();
  let newAssetId: string | null = null;
  try {
    await pg.query("BEGIN");

    // Set RLS context (same pattern as mira-hub/src/lib/tenant-context.ts)
    await pg.query(
      `SET LOCAL app.current_tenant_id = '${tenantId.replace(/'/g, "''")}'`,
    );

    // Create equipment record
    const equipResult = await pg.query(
      `INSERT INTO cmms_equipment
         (tenant_id, description, equipment_type, location, criticality)
       VALUES ($1, $2, $3, $4, 'medium')
       RETURNING id`,
      [tenantId, equipment_name, safeType, safeLocation],
    );
    newAssetId = String(equipResult.rows[0].id);

    // Register QR tag → atlas_asset_id = 0 (unlinked, will be linked when admin
    // reviews via /admin/qr-print or when Atlas CMMS ID is assigned)
    await pg.query(
      `INSERT INTO asset_qr_tags
         (tenant_id, asset_tag, atlas_asset_id, first_scan, last_scan, scan_count)
       VALUES ($1, $2, 0, NOW(), NOW(), 1)
       ON CONFLICT (tenant_id, asset_tag) DO UPDATE SET
         last_scan  = NOW(),
         scan_count = asset_qr_tags.scan_count + 1`,
      [tenantId, asset_tag],
    );

    await pg.query("COMMIT");
  } catch (err) {
    await pg.query("ROLLBACK");
    console.error("[auto-register] DB error:", err);
    return c.json({ error: "Failed to register equipment" }, 500);
  } finally {
    await pg.end();
  }

  // Track the scan now that the tag exists
  try {
    await recordScan({
      tenant_id: tenantId,
      asset_tag,
      atlas_user_id: payload.atlasUserId ?? null,
      user_agent: c.req.header("User-Agent") ?? null,
      found: true,
    });
  } catch {
    // Non-fatal
  }

  const hubBase = process.env.PLG_HUB_URL ?? "https://app.factorylm.com";
  const redirectUrl = newAssetId
    ? `${hubBase}/assets/${newAssetId}?tab=ask`
    : `${hubBase}/assets?registered=${encodeURIComponent(asset_tag)}`;

  return c.json({ redirect_url: redirectUrl }, 201);
});

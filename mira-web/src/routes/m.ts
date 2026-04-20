/**
 * Scan route — GET /m/:asset_tag
 *
 * QR code scan handler. Requires auth (Bearer token, ?token= query, or
 * mira_session cookie). Resolves the asset tag against the current
 * tenant, logs every attempt for audit, then:
 *   - Found: sets 5-min mira_pending_scan cookie → 302 to /c/new
 *   - Not found / cross-tenant: 200 byte-identical HTML (spec §12.6)
 *
 * The constant-time SELECT + identical not-found response prevents the
 * cross-tenant enumeration oracle called out in spec §12.6.
 */
import { Hono } from "hono";
import { requireAuth, type MiraTokenPayload } from "../lib/auth.js";
import {
  ASSET_TAG_RE,
  resolveAssetForScan,
  recordScan,
} from "../lib/qr-tracker.js";
import { buildPendingScanCookie } from "../lib/cookie-session.js";

const NOT_FOUND_HTML = `<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Asset not found in your plant</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 3rem auto; padding: 1rem; color: #111; }
    h1 { font-size: 1.25rem; font-weight: 600; }
    p { color: #444; line-height: 1.5; }
    a { color: #f5a623; }
  </style>
</head><body>
  <h1>Asset not found in your plant</h1>
  <p>This asset tag is not associated with your plant. If you believe this is an error, contact your admin.</p>
  <p><a href="https://app.factorylm.com">Open MIRA</a></p>
</body></html>`;

export const m = new Hono();

m.get("/:asset_tag", requireAuth, async (c) => {
  const assetTag = c.req.param("asset_tag");

  // Input validation: reject malformed tags at the edge
  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset tag" }, 400);
  }

  const user = c.get("user") as MiraTokenPayload;
  const tenantId = user.sub;
  const atlasUserId = user.atlasUserId ?? null;
  const userAgent = c.req.header("User-Agent") ?? null;

  // Constant-time: always do the SELECT, then branch on result
  const resolved = await resolveAssetForScan(tenantId, assetTag);

  // Always log the scan attempt (audit)
  const scanId = await recordScan({
    tenant_id: tenantId,
    asset_tag: assetTag,
    atlas_user_id: atlasUserId,
    user_agent: userAgent,
    found: resolved.found,
  });

  if (!resolved.found) {
    // Byte-identical response for cross-tenant and nonexistent (spec §12.6)
    return c.html(NOT_FOUND_HTML, 200);
  }

  // Set pending-scan cookie so mira-pipeline can read on first chat turn
  c.header("Set-Cookie", buildPendingScanCookie(scanId));
  return c.redirect("/c/new", 302);
});

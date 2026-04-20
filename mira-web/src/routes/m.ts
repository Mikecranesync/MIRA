/**
 * Scan route — GET /m/:asset_tag
 *
 * QR code scan handler. Auth is optional. Routing logic:
 *
 *   1. Authed (Bearer / ?token= / mira_session cookie)
 *      → existing constant-time tenant-scoped lookup → 302 /c/new (unchanged)
 *
 *   2. Unauthed + valid mira_channel_pref cookie
 *      → resolve asset+config globally → route to preferred channel
 *
 *   3. Unauthed + no pref + tenant has >1 channel OR mixed channels
 *      → 302 to chooser page (/m/:asset_tag/choose)
 *
 *   4. Unauthed + tenant has only 'guest' channel
 *      → 302 directly to guest report form (/m/:asset_tag/report)
 *
 *   5. Tag not found in any tenant → 200 byte-identical HTML (spec §12.6)
 *
 * The NOT_FOUND_HTML constant is kept byte-identical across all paths so
 * cross-tenant and nonexistent tags are indistinguishable to an attacker.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Hono } from "hono";
import { verifyToken } from "../lib/auth.js";
import {
  ASSET_TAG_RE,
  resolveAssetForScan,
  resolveAssetWithChannelConfig,
  recordScan,
} from "../lib/qr-tracker.js";
import {
  buildPendingScanCookie,
  parseCookies,
  readChannelPref,
} from "../lib/cookie-session.js";

const _dir = dirname(fileURLToPath(import.meta.url));
const NOT_FOUND_HTML = readFileSync(
  join(_dir, "../views/scan-not-found.html"),
  "utf-8",
);

function buildChannelUrl(
  channel: string,
  assetTag: string,
  config: { telegramBotUsername: string | null; openwebuiUrl: string },
): string {
  switch (channel) {
    case "telegram":
      return config.telegramBotUsername
        ? `https://t.me/${config.telegramBotUsername}?start=${encodeURIComponent(assetTag)}`
        : `/m/${assetTag}/report`;
    case "openwebui":
      return config.openwebuiUrl
        ? `${config.openwebuiUrl}/c/new`
        : "https://app.factorylm.com/c/new";
    case "guest":
      return `/m/${assetTag}/report`;
    case "slack":
      return `/m/${assetTag}/report`; // Phase 4
    default:
      return `/m/${assetTag}/report`;
  }
}

export const m = new Hono();

m.get("/:asset_tag", async (c) => {
  const assetTag = c.req.param("asset_tag");

  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset tag" }, 400);
  }

  const cookieHeader = c.req.header("cookie");
  const cookies = parseCookies(cookieHeader);

  // Try to resolve auth token: Authorization header > ?token= query > mira_session cookie
  const headerRaw = c.req.header("Authorization")?.replace("Bearer ", "");
  const queryRaw = c.req.query("token");
  const sessionCookieRaw = cookies["mira_session"];
  const raw = headerRaw ?? queryRaw ?? sessionCookieRaw;

  const payload = raw ? await verifyToken(raw) : null;

  // --- AUTHED PATH (unchanged from original, constant-time within tenant) ---
  if (payload) {
    const tenantId = payload.sub;
    const atlasUserId = payload.atlasUserId ?? null;
    const userAgent = c.req.header("User-Agent") ?? null;

    const resolved = await resolveAssetForScan(tenantId, assetTag);
    const scanId = await recordScan({
      tenant_id: tenantId,
      asset_tag: assetTag,
      atlas_user_id: atlasUserId,
      user_agent: userAgent,
      found: resolved.found,
    });

    if (!resolved.found) {
      return c.html(NOT_FOUND_HTML, 200);
    }

    c.header("Set-Cookie", buildPendingScanCookie(scanId));
    return c.redirect("/c/new", 302);
  }

  // --- UNAUTHED PATH — global lookup ---
  const resolved = await resolveAssetWithChannelConfig(assetTag);

  if (!resolved.found) {
    return c.html(NOT_FOUND_HTML, 200);
  }

  // Record scan (unauthed — no atlas_user_id)
  await recordScan({
    tenant_id: resolved.tenantId,
    asset_tag: assetTag,
    atlas_user_id: null,
    user_agent: c.req.header("User-Agent") ?? null,
    found: true,
  });

  const channels = resolved.enabledChannels;

  // Check channel pref cookie — if valid channel in tenant's config, route directly
  const prefChannel = await readChannelPref(cookieHeader);
  if (prefChannel && channels.includes(prefChannel)) {
    const url = buildChannelUrl(prefChannel, assetTag, resolved);
    return c.redirect(url, 302);
  }

  // Single channel or guest-only → skip chooser
  if (channels.length === 1) {
    const url = buildChannelUrl(channels[0]!, assetTag, resolved);
    return c.redirect(url, 302);
  }

  // Guest-only tenant (even if multiple entries, all are 'guest')
  const nonGuest = channels.filter((ch) => ch !== "guest");
  if (nonGuest.length === 0) {
    return c.redirect(`/m/${assetTag}/report`, 302);
  }

  // Multi-channel → chooser
  return c.redirect(`/m/${assetTag}/choose`, 302);
});

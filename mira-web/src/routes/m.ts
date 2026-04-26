/**
 * Scan route — GET /m/:asset_tag
 *
 * QR code scan handler. Auth is optional. Routing logic:
 *
 *   1. Authed (Bearer / ?token= / mira_session cookie)
 *      → existing constant-time tenant-scoped lookup → 302 /c/new (unchanged)
 *      → Unit 7: also fires preloadAssetContext() in background (non-blocking)
 *
 *   2. Unauthed + valid mira_channel_pref cookie
 *      → resolve asset+config globally → route to preferred channel
 *      → Unit 7: also fires preloadAssetContext() in background (non-blocking)
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
 *
 * Unit 7 (QR pre-load):
 *   After resolving asset_tag → tenant + atlas_asset_id, we fire a background
 *   call to Atlas that fetches the last 5 work orders + asset metadata and
 *   writes the result to asset_context_cache (NeonDB). This is non-blocking:
 *   the 302 redirect fires immediately. The Python Telegram /start handler
 *   reads asset_context_cache by (tenant_id, asset_tag) and injects the
 *   context into the FSM initial state so the first MIRA reply can say
 *   "I see you had WO-1234 on this pump 11 days ago — same symptom?"
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
  upsertAssetContextCache,
  type AssetContextPayload,
} from "../lib/qr-tracker.js";
import {
  buildPendingScanCookie,
  parseCookies,
  readChannelPref,
} from "../lib/cookie-session.js";
import {
  getWorkOrdersForAsset,
  getAssetMetadata,
} from "../lib/atlas.js";

const _dir = dirname(fileURLToPath(import.meta.url));
const NOT_FOUND_HTML = readFileSync(
  join(_dir, "../views/scan-not-found.html"),
  "utf-8",
);

/**
 * Unit 7 — fire-and-forget asset context pre-load.
 *
 * Fetches the last 5 work orders + asset metadata from Atlas, then writes the
 * result to asset_context_cache so the Python Telegram /start handler can
 * inject it into the FSM initial state (keyed by chat_id) when the user
 * opens the bot.
 *
 * Called after the asset is resolved but BEFORE returning the 302, so the
 * pre-load starts immediately.  The result is NOT awaited — we never block
 * the redirect on Atlas latency.
 *
 * Security: every call is scoped to tenantId so Atlas queries are per-tenant.
 */
async function preloadAssetContext(
  tenantId: string,
  assetTag: string,
  atlasAssetId: number,
): Promise<void> {
  try {
    const [workOrders, assetMeta] = await Promise.all([
      getWorkOrdersForAsset(atlasAssetId, 5),
      getAssetMetadata(atlasAssetId),
    ]);

    const payload: AssetContextPayload = {
      asset_name: assetMeta?.name ?? "",
      asset_model: assetMeta?.model ?? "",
      asset_area: assetMeta?.area ?? "",
      atlas_asset_id: atlasAssetId,
      work_orders: workOrders,
      pre_loaded_at: new Date().toISOString(),
    };

    await upsertAssetContextCache(tenantId, assetTag, atlasAssetId, payload);
  } catch {
    // Best-effort — never let a pre-load failure affect the QR redirect.
  }
}

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

    // Unit 7: fire pre-load in background — does NOT block the 302 redirect.
    void preloadAssetContext(tenantId, assetTag, resolved.atlas_asset_id);

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

  // Unit 7: fire pre-load in background — does NOT block the 302 redirect.
  void preloadAssetContext(resolved.tenantId, assetTag, resolved.atlasAssetId);

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

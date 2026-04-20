/**
 * Admin channel configuration.
 *
 * GET  /admin/channels          — settings page (admin only)
 * POST /api/admin/channels      — save config (admin only)
 *
 * Manages the tenant_channel_config row for the signed-in tenant.
 */
import { Hono } from "hono";
import { Client, neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/auth.js";
import type { MiraTokenPayload } from "../../lib/auth.js";

export const adminChannelPages = new Hono();
export const adminChannelApi = new Hono();

const VALID_CHANNELS = ["openwebui", "telegram", "slack", "guest"] as const;
type Channel = (typeof VALID_CHANNELS)[number];

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

adminChannelPages.get("/channels", requireAdmin, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const sql = neon(process.env.NEON_DATABASE_URL!);
  const rows = await sql`
    SELECT enabled_channels, telegram_bot_username, openwebui_url, allow_guest_reports
    FROM tenant_channel_config
    WHERE tenant_id = ${user.sub}::uuid`;

  const cfg = rows[0] ?? {
    enabled_channels: ["openwebui", "guest"],
    telegram_bot_username: null,
    openwebui_url: "https://app.factorylm.com",
    allow_guest_reports: true,
  };

  const enabledSet = new Set<string>(cfg.enabled_channels as string[]);

  const checkboxes = VALID_CHANNELS.map((ch) => {
    const checked = enabledSet.has(ch) ? "checked" : "";
    const labels: Record<Channel, string> = {
      openwebui: "Web Chat (Open WebUI)",
      telegram: "Telegram",
      slack: "Slack",
      guest: "Guest fault-report form",
    };
    return `<label class="channel-option">
        <input type="checkbox" name="channels" value="${ch}" ${checked}>
        ${escapeHtml(labels[ch])}
      </label>`;
  }).join("\n      ");

  return c.html(`<!doctype html>
<html><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>MIRA — Channel Settings</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 640px; margin: 2rem auto; padding: 1rem; color: #111; }
    h1 { font-size: 1.4rem; font-weight: 700; margin-bottom: 0.25rem; }
    p.sub { color: #666; margin-bottom: 1.5rem; font-size: 0.9rem; }
    .channel-option { display: flex; align-items: center; gap: 0.5rem; padding: 0.6rem 0; border-bottom: 1px solid #eee; font-size: 0.95rem; }
    .channel-option input { width: 18px; height: 18px; accent-color: #f5a623; }
    label { display: block; margin-top: 1.25rem; font-weight: 600; font-size: 0.9rem; color: #333; }
    input[type=text] { width: 100%; padding: 0.55rem 0.75rem; border: 1px solid #ddd; border-radius: 6px; font-size: 1rem; margin-top: 0.35rem; }
    button { margin-top: 1.5rem; padding: 0.75rem 1.5rem; background: #f5a623; border: 0; color: #0a0a08; font-size: 1rem; font-weight: 700; border-radius: 6px; cursor: pointer; }
    #msg { margin-top: 1rem; color: green; display: none; }
  </style>
</head><body>
  <h1>Channel Settings</h1>
  <p class="sub">Choose which channels your team uses when they scan a QR code. Order matters — the first channel appears first on the chooser page.</p>
  <form id="channelForm">
    <div class="channels-list">
      ${checkboxes}
    </div>
    <label>Telegram bot username <span style="font-weight:400;color:#888">(required if Telegram is enabled)</span></label>
    <input type="text" name="telegram_bot_username" placeholder="MiraBot" value="${escapeHtml((cfg.telegram_bot_username as string) ?? "")}">
    <label>Open WebUI URL <span style="font-weight:400;color:#888">(leave blank for default)</span></label>
    <input type="text" name="openwebui_url" placeholder="https://app.factorylm.com" value="${escapeHtml((cfg.openwebui_url as string) ?? "")}">
    <button type="submit">Save</button>
  </form>
  <div id="msg">✓ Channel settings saved.</div>
  <p style="margin-top:2rem"><a href="/admin/qr-analytics">← QR Analytics</a></p>
  <script>
    document.getElementById('channelForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const checked = [...form.querySelectorAll('input[name="channels"]:checked')].map(el => el.value);
      if (!checked.length) { alert('Enable at least one channel.'); return; }
      const payload = {
        enabled_channels: checked,
        telegram_bot_username: form.telegram_bot_username.value.trim() || null,
        openwebui_url: form.openwebui_url.value.trim() || null,
      };
      const res = await fetch('/api/admin/channels', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        document.getElementById('msg').style.display = 'block';
        setTimeout(() => document.getElementById('msg').style.display = 'none', 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert('Error: ' + (err.error || res.status));
      }
    });
  </script>
</body></html>`);
});

adminChannelApi.post("/api/admin/channels", requireAdmin, async (c) => {
  const user = c.get("user") as MiraTokenPayload;

  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const raw = body.enabled_channels;
  if (!Array.isArray(raw) || raw.length === 0) {
    return c.json({ error: "enabled_channels must be a non-empty array" }, 400);
  }
  const enabled = raw as string[];
  for (const ch of enabled) {
    if (!(VALID_CHANNELS as readonly string[]).includes(ch)) {
      return c.json({ error: `Unknown channel: ${ch}` }, 400);
    }
  }

  const telegramBotUsername =
    typeof body.telegram_bot_username === "string"
      ? body.telegram_bot_username.trim() || null
      : null;
  const openwebuiUrl =
    typeof body.openwebui_url === "string"
      ? body.openwebui_url.trim() || null
      : null;

  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  try {
    await pg.query("BEGIN");
    await pg.query(
      `INSERT INTO tenant_channel_config
         (tenant_id, enabled_channels, telegram_bot_username, openwebui_url, updated_at)
       VALUES ($1, $2, $3, COALESCE($4, 'https://app.factorylm.com'), NOW())
       ON CONFLICT (tenant_id) DO UPDATE SET
         enabled_channels      = EXCLUDED.enabled_channels,
         telegram_bot_username = EXCLUDED.telegram_bot_username,
         openwebui_url         = COALESCE(EXCLUDED.openwebui_url, 'https://app.factorylm.com'),
         updated_at            = NOW()`,
      [user.sub, enabled, telegramBotUsername, openwebuiUrl],
    );
    await pg.query("COMMIT");
  } catch (err) {
    await pg.query("ROLLBACK");
    console.error("[admin/channels] DB upsert failed:", err);
    return c.json({ error: "Failed to save config" }, 500);
  } finally {
    await pg.end();
  }

  return c.json({ ok: true });
});

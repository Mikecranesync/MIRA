/**
 * GET /m/:asset_tag/choose
 * GET /m/:asset_tag/choose?set_pref=<channel>
 *
 * Chooser page: shows the tenant's enabled channels in admin-preferred order.
 * When ?set_pref=<channel> is passed, sets the mira_channel_pref cookie and
 * redirects to the appropriate channel URL.
 *
 * No auth required — this is the unauthed scan path.
 */
import { Hono } from "hono";
import {
  ASSET_TAG_RE,
  resolveAssetWithChannelConfig,
} from "../lib/qr-tracker.js";
import { buildChannelPrefCookie } from "../lib/cookie-session.js";

export const mChooser = new Hono();

const VALID_CHANNELS = new Set(["openwebui", "telegram", "slack", "guest"]);

const CHANNEL_LABELS: Record<string, string> = {
  openwebui: "Web Chat",
  telegram: "Telegram",
  slack: "Slack",
  guest: "Submit a Report",
};

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
    case "slack":
      return `/m/${assetTag}/report`; // Phase 4 — fallback to report for now
    case "guest":
      return `/m/${assetTag}/report`;
    default:
      return `/m/${assetTag}/report`;
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

mChooser.get("/:asset_tag/choose", async (c) => {
  const assetTag = c.req.param("asset_tag");

  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset tag" }, 400);
  }

  const setPref = c.req.query("set_pref");

  // If setting a channel preference, validate + set cookie then redirect
  if (setPref) {
    if (!VALID_CHANNELS.has(setPref)) {
      return c.json({ error: "Invalid channel" }, 400);
    }
    const resolved = await resolveAssetWithChannelConfig(assetTag);
    if (!resolved.found) {
      return c.html(NOT_FOUND_HTML, 200);
    }
    const cookieVal = await buildChannelPrefCookie(setPref);
    c.header("Set-Cookie", cookieVal);
    const url = buildChannelUrl(setPref, assetTag, resolved);
    return c.redirect(url, 302);
  }

  // Render chooser page
  const resolved = await resolveAssetWithChannelConfig(assetTag);
  if (!resolved.found) {
    return c.html(NOT_FOUND_HTML, 200);
  }

  const buttons = resolved.enabledChannels
    .filter((ch) => VALID_CHANNELS.has(ch))
    .map((ch) => {
      const label = escapeHtml(CHANNEL_LABELS[ch] ?? ch);
      return `<a class="btn btn-${escapeHtml(ch)}" href="/m/${escapeHtml(assetTag)}/choose?set_pref=${encodeURIComponent(ch)}">${label}</a>`;
    })
    .join("\n        ");

  return c.html(`<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect with MIRA — ${escapeHtml(assetTag)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0a0a08;
      color: #e4e0d8;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 0;
      padding: 1rem;
    }
    .card {
      background: #141410;
      border: 1px solid #2a2a24;
      border-radius: 12px;
      max-width: 420px;
      width: 100%;
      padding: 2rem;
    }
    .brand { color: #f0a030; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 1.25rem; }
    h1 { font-size: 1.3rem; font-weight: 700; margin: 0 0 0.5rem; }
    .asset-tag { font-family: monospace; background: #1e1e1b; padding: 0.15rem 0.5rem; border-radius: 4px; color: #f0a030; font-size: 0.95rem; }
    p { color: #b0aca2; font-size: 0.95rem; line-height: 1.5; margin: 0.5rem 0 1.5rem; }
    .btn {
      display: block;
      width: 100%;
      padding: 0.9rem 1rem;
      margin-bottom: 0.75rem;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 600;
      text-align: center;
      text-decoration: none;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.88; }
    .btn-telegram  { background: #229ED9; color: #fff; }
    .btn-openwebui { background: #f0a030; color: #0a0a08; }
    .btn-slack     { background: #4A154B; color: #fff; }
    .btn-guest     { background: #1e1e1b; color: #b0aca2; border: 1px solid #2a2a24; }
    .footer { margin-top: 1.5rem; font-size: 0.78rem; color: #4a4840; text-align: center; }
  </style>
</head><body>
  <div class="card">
    <div class="brand">FactoryLM</div>
    <h1>How would you like to connect?</h1>
    <p>Asset <span class="asset-tag">${escapeHtml(assetTag)}</span> — choose your preferred channel.</p>
    ${buttons}
    <div class="footer">Your choice is remembered for 30 days on this device.</div>
  </div>
</body></html>`);
});

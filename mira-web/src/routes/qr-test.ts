// mira-web/src/routes/qr-test.ts
// GET /qr-test[?tenant_id=<uuid>] — branded, parameterized QR display page
// Reads live tags from NeonDB; falls back to hardcoded demo set on DB error.
import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { generatePng, scanUrlFor } from "../lib/qr-generate.js";

export const qrTest = new Hono();

const DEMO_TAGS = [
  { asset_tag: "VFD-07", asset_name: "GS10 VFD Line 1" },
  { asset_tag: "VFD-CHOOSER", asset_name: "Channel Chooser Demo" },
  { asset_tag: "PUMP-REPORT", asset_name: "Coolant Pump (Guest Report)" },
];

interface TagRow {
  asset_tag: string;
  asset_name: string | null;
}

async function fetchTags(tenantId: string | undefined): Promise<TagRow[]> {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) return DEMO_TAGS;
  const pg = new Client(url);
  await pg.connect();
  try {
    const q = tenantId
      ? "SELECT asset_tag, asset_name FROM asset_qr_tags WHERE tenant_id = $1 ORDER BY asset_tag LIMIT 100"
      : "SELECT asset_tag, asset_name FROM asset_qr_tags ORDER BY asset_tag LIMIT 100";
    const params = tenantId ? [tenantId] : [];
    const r = await pg.query(q, params);
    return r.rows.length > 0 ? r.rows : DEMO_TAGS;
  } finally {
    await pg.end();
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!
  );
}

qrTest.get("/qr-test", async (c) => {
  const tenantId = c.req.query("tenant_id") ?? undefined;
  const tenantName = c.req.query("tenant_name") ?? "FactoryLM Demo";

  let tags: TagRow[] = DEMO_TAGS;
  let dbError = false;
  try {
    tags = await fetchTags(tenantId);
  } catch {
    dbError = true;
  }

  // Generate QR code data URLs server-side (avoids requiring JS on client)
  const cards: Array<{ tag: string; name: string; dataUrl: string; scanUrl: string }> = [];
  for (const row of tags) {
    const scanUrl = scanUrlFor(row.asset_tag);
    const pngBuf = await generatePng(scanUrl, 512);
    const dataUrl = `data:image/png;base64,${pngBuf.toString("base64")}`;
    cards.push({
      tag: row.asset_tag,
      name: row.asset_name ?? row.asset_tag,
      dataUrl,
      scanUrl,
    });
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MIRA QR Sheet — ${escapeHtml(tenantName)}</title>
  <meta name="description" content="Scan any QR code to launch MIRA maintenance diagnostics for this asset.">
  <meta property="og:title" content="MIRA QR Asset Sheet — ${escapeHtml(tenantName)}">
  <meta property="og:description" content="Industrial maintenance AI — scan a code to start diagnosing.">
  <meta property="og:image" content="https://app.factorylm.com/static/favicon.png">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
      background: #f2f2f7;
      color: #111;
      min-height: 100vh;
    }

    /* ── Header ── */
    header {
      background: #1a1a1a;
      color: #fff;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      gap: 16px;
    }
    header .logo {
      font-size: 24px;
      font-weight: 800;
      color: #f5a623;
      letter-spacing: -0.5px;
    }
    header .tenant {
      font-size: 15px;
      color: #aaa;
      flex: 1;
    }
    header .tagline {
      font-size: 12px;
      color: #666;
    }

    /* ── Banner ── */
    .banner {
      background: #e8f4e8;
      border-left: 4px solid #2d7d2d;
      padding: 14px 24px;
      font-size: 14px;
    }
    .banner h2 { font-size: 15px; margin-bottom: 6px; color: #1a5c1a; }
    .banner ol { padding-left: 18px; }
    .banner li { margin-bottom: 4px; }

    /* ── Grid ── */
    .grid {
      display: flex;
      flex-wrap: wrap;
      gap: 20px;
      padding: 28px 24px;
      justify-content: center;
    }

    /* ── QR Card ── */
    .qr-card {
      background: #fff;
      border: 2px solid #d0d0d0;
      border-radius: 16px;
      padding: 20px;
      width: 260px;
      text-align: center;
      box-shadow: 0 2px 10px rgba(0,0,0,0.07);
      page-break-inside: avoid;
      break-inside: avoid;
    }
    .qr-card img {
      width: 200px;
      height: 200px;
      display: block;
      margin: 0 auto 12px;
    }
    .qr-card .asset-tag {
      font-size: 18px;
      font-weight: 700;
      color: #111;
      margin-bottom: 2px;
    }
    .qr-card .asset-name {
      font-size: 13px;
      color: #555;
      margin-bottom: 8px;
    }
    .qr-card .scan-cta {
      font-size: 12px;
      font-weight: 600;
      color: #2d7d2d;
      margin-bottom: 6px;
    }
    .qr-card .scan-url {
      font-size: 10px;
      color: #aaa;
      word-break: break-all;
    }

    /* ── Footer ── */
    footer {
      text-align: center;
      padding: 24px;
      color: #999;
      font-size: 12px;
      border-top: 1px solid #e0e0e0;
    }
    footer a { color: #f5a623; text-decoration: none; }

    /* ── Print ── */
    @media print {
      header, .banner, footer { display: none; }
      body { background: #fff; }
      .grid { padding: 0; gap: 12px; }
      .qr-card {
        width: 200px;
        padding: 12px;
        border: 1px solid #ccc;
        border-radius: 8px;
        box-shadow: none;
      }
      .qr-card img { width: 160px; height: 160px; }
    }

    @media (max-width: 600px) {
      .qr-card { width: 100%; }
      .grid { padding: 16px; gap: 16px; }
    }
  </style>
</head>
<body>
  <header>
    <span class="logo">MIRA</span>
    <span class="tenant">${escapeHtml(tenantName)}</span>
    <span class="tagline">Maintenance Intelligence &amp; Response Assistant</span>
  </header>

  <div class="banner">
    <h2>How to use</h2>
    <ol>
      <li><strong>Open your phone camera</strong> and point it at any QR code below</li>
      <li>Tap the link — it opens MIRA for this asset</li>
      <li>If logged in → chat opens with asset pre-loaded</li>
      <li>If not logged in → choose Telegram, Open WebUI, or Guest Report</li>
    </ol>
  </div>
${dbError ? `  <div style="background:#fff3cd;padding:10px 24px;font-size:13px;color:#856404;">⚠ Showing demo tags — live database temporarily unreachable.</div>` : ""}
  <div class="grid">
${cards.map((card) => `    <div class="qr-card">
      <img src="${card.dataUrl}" alt="QR code for ${escapeHtml(card.tag)}" loading="lazy">
      <div class="asset-tag">${escapeHtml(card.tag)}</div>
      <div class="asset-name">${escapeHtml(card.name)}</div>
      <div class="scan-cta">📷 Scan to diagnose</div>
      <div class="scan-url">${escapeHtml(card.scanUrl)}</div>
    </div>`).join("\n")}
  </div>

  <footer>
    <a href="https://app.factorylm.com">MIRA by FactoryLM</a>
    &nbsp;·&nbsp; ${escapeHtml(tenantName)}
    &nbsp;·&nbsp; ${cards.length} asset${cards.length !== 1 ? "s" : ""}
    &nbsp;·&nbsp; <a href="#" onclick="window.print();return false;">Print this page</a>
  </footer>
</body>
</html>`;

  return c.html(html);
});

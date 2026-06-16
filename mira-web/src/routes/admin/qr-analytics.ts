/**
 * GET /admin/qr-analytics
 *
 * Minimal admin analytics page: shows asset_tag | scan_count | last_scan | printed
 * for the signed-in tenant, sorted by last_scan DESC NULLS LAST, scan_count DESC.
 *
 * Admin-only (requireAdmin middleware). Single SELECT — uses neon() tagged
 * templates (same pattern as quota.ts, qr-tracker.ts, blog-db.ts).
 */
import { Hono } from "hono";
import { neon } from "@neondatabase/serverless";
import { requireAdmin } from "../../lib/auth.js";
import type { MiraTokenPayload } from "../../lib/auth.js";

export const qrAnalytics = new Hono();

qrAnalytics.get("/qr-analytics", requireAdmin, async (c) => {
  const user = c.get("user") as MiraTokenPayload;
  const sql = neon(process.env.NEON_DATABASE_URL!);
  const rows = await sql`
    SELECT asset_tag, scan_count, last_scan, printed_at IS NOT NULL AS printed
    FROM asset_qr_tags
    WHERE tenant_id = ${user.sub}::uuid
    ORDER BY last_scan DESC NULLS LAST, scan_count DESC
  `;

  const body = rows.length
    ? rows
        .map(
          (r) => `<tr>
        <td><code>${escapeHtml(String(r.asset_tag))}</code></td>
        <td>${r.scan_count}</td>
        <td>${r.last_scan ?? "—"}</td>
        <td>${r.printed ? "✓" : ""}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="4">No tags yet. <a href="/admin/qr-print">Print your first sticker sheet →</a></td></tr>`;

  return c.html(`<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>MIRA — QR Analytics</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem; border-bottom: 1px solid #eee; text-align: left; }
    th { background: #fafafa; }
    code { background: #f5f5f5; padding: 0.1rem 0.4rem; border-radius: 3px; }
  </style>
</head><body>
  <h1>QR Analytics</h1>
  <table>
    <tr><th>Asset tag</th><th>Scan count</th><th>Last scan</th><th>Printed</th></tr>
    ${body}
  </table>
  <p><a href="/admin/qr-print">→ Print more stickers</a></p>
</body></html>`);
});

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

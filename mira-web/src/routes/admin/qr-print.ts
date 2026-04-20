// mira-web/src/routes/admin/qr-print.ts
import { Hono } from "hono";
import { requireAdmin } from "../../lib/auth.js";
import { listAssets } from "../../lib/atlas.js";
import { buildStickerSheetPdf, type LabelFormat } from "../../lib/qr-pdf.js";
import { scanUrlFor } from "../../lib/qr-generate.js";
import { ASSET_TAG_RE } from "../../lib/qr-tracker.js";
import { Client } from "@neondatabase/serverless";

export const adminPages = new Hono();
export const adminApi = new Hono();

adminPages.get("/qr-print", requireAdmin, async (c) => {
  const assets = await listAssets(200);
  const user = c.get("user") as import("../../lib/auth.js").MiraTokenPayload;

  // Fetch existing tags for this tenant so admin can see what's already tagged
  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  let existingTags: Array<{ atlas_asset_id: number; asset_tag: string }> = [];
  try {
    const r = await pg.query(
      "SELECT atlas_asset_id, asset_tag FROM asset_qr_tags WHERE tenant_id = $1",
      [user.sub],
    );
    existingTags = r.rows;
  } finally {
    await pg.end();
  }
  const tagged = new Map(existingTags.map((r) => [r.atlas_asset_id, r.asset_tag]));

  const rows = assets
    .map((a) => {
      const tag = tagged.get(a.id) ?? autoTag(a.name);
      return `<tr>
        <td><input type="checkbox" name="pick" value="${a.id}" ${tagged.has(a.id) ? "checked" : ""}></td>
        <td>${escapeHtml(a.name)}</td>
        <td><input name="tag_${a.id}" value="${escapeHtml(tag)}" pattern="[A-Za-z0-9._-]{1,64}"></td>
        <td>${tagged.has(a.id) ? "tagged" : "new"}</td>
      </tr>`;
    })
    .join("");

  return c.html(`<!doctype html>
<html><head>
  <meta charset="utf-8">
  <title>MIRA — QR Stickers</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 0.5rem; border-bottom: 1px solid #eee; text-align: left; }
    input[name^="tag_"] { width: 160px; font-family: monospace; }
    button { padding: 0.75rem 1.5rem; font-size: 1rem; background: #f5a623; border: 0; color: white; cursor: pointer; }
  </style>
</head><body>
  <h1>QR Stickers</h1>
  <p>Check the assets you want stickers for. Edit the tag if needed (letters, numbers, dots, dashes, underscores; max 64 chars).</p>
  <form id="printform">
    <table>
      <tr><th></th><th>Asset</th><th>Tag</th><th>Status</th></tr>
      ${rows}
    </table>
    <p>
    Format:
    <label><input type="radio" name="fmt" value="5163" checked> Avery 5163 (2"×4", 10/sheet — recommended)</label>
    &nbsp;
    <label><input type="radio" name="fmt" value="5160"> Avery 5160 (1"×2.625", 30/sheet)</label>
  </p>
  <p><button type="submit">Generate sticker sheet (PDF)</button></p>
  </form>
  <script>
    document.getElementById('printform').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.currentTarget;
      const picks = [...form.querySelectorAll('input[name="pick"]:checked')];
      const tags = picks.map(p => ({
        atlas_asset_id: parseInt(p.value, 10),
        asset_tag: form.querySelector('input[name="tag_' + p.value + '"]').value.trim()
      }));
      if (!tags.length) { alert('Select at least one asset'); return; }
      const fmt = form.querySelector('input[name="fmt"]:checked').value;
      const res = await fetch('/api/admin/qr-print-batch', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags, format: fmt })
      });
      if (!res.ok) { alert('Error: ' + res.status); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'mira-stickers-' + new Date().toISOString().slice(0,10) + '.pdf';
      a.click();
    });
  </script>
</body></html>`);
});

adminApi.post("/api/admin/qr-print-batch", requireAdmin, async (c) => {
  const user = c.get("user") as import("../../lib/auth.js").MiraTokenPayload;
  const body = (await c.req.json()) as { tags?: Array<{ asset_tag: string; atlas_asset_id: number }>; format?: string };
  const tags = body.tags ?? [];
  const format: LabelFormat = body.format === "5160" ? "5160" : "5163";

  if (!tags.length) return c.json({ error: "tags must be non-empty" }, 400);
  for (const t of tags) {
    if (!ASSET_TAG_RE.test(t.asset_tag)) {
      return c.json({ error: `Invalid asset_tag: ${t.asset_tag}` }, 400);
    }
    if (!Number.isInteger(t.atlas_asset_id)) {
      return c.json({ error: "atlas_asset_id must be integer" }, 400);
    }
  }

  // UPSERT tag rows + bump print_count in one transaction
  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  try {
    await pg.query("BEGIN");
    for (const t of tags) {
      await pg.query(
        `INSERT INTO asset_qr_tags (tenant_id, asset_tag, atlas_asset_id, printed_at, print_count)
         VALUES ($1, $2, $3, NOW(), 1)
         ON CONFLICT (tenant_id, asset_tag) DO UPDATE SET
           printed_at = NOW(),
           print_count = asset_qr_tags.print_count + 1,
           atlas_asset_id = EXCLUDED.atlas_asset_id`,
        [user.sub, t.asset_tag, t.atlas_asset_id],
      );
    }
    await pg.query("COMMIT");
  } catch (e) {
    await pg.query("ROLLBACK");
    throw e;
  } finally {
    await pg.end();
  }

  const pdfInput = tags.map((t) => ({
    asset_tag: t.asset_tag,
    scan_url: scanUrlFor(t.asset_tag),
  }));
  const tenantName = process.env.MIRA_TENANT_NAME ?? process.env.PLG_ATLAS_ADMIN_USER ?? "FactoryLM";
  const pdfBytes = await buildStickerSheetPdf(pdfInput, format, tenantName);

  return new Response(pdfBytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="mira-stickers-${new Date().toISOString().slice(0, 10)}.pdf"`,
    },
  });
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function autoTag(name: string): string {
  return name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 64) || "ASSET";
}

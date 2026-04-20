/**
 * Guest fault-report form.
 *
 * GET  /m/:asset_tag/report  — renders the form
 * POST /api/m/report         — writes to guest_reports + emails tenant admin
 *
 * No auth required. Guest reports MUST NOT auto-create Atlas work orders.
 * Admin review is required before any WO is created.
 */
import { Hono } from "hono";
import { Client } from "@neondatabase/serverless";
import { neon } from "@neondatabase/serverless";
import {
  ASSET_TAG_RE,
  resolveAssetWithChannelConfig,
} from "../lib/qr-tracker.js";
import { sendEmail } from "../lib/mailer.js";

export const mReport = new Hono();
export const mReportApi = new Hono();

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

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

mReport.get("/:asset_tag/report", async (c) => {
  const assetTag = c.req.param("asset_tag");
  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset tag" }, 400);
  }

  const resolved = await resolveAssetWithChannelConfig(assetTag);
  if (!resolved.found) {
    return c.html(NOT_FOUND_HTML, 200);
  }

  return c.html(`<!doctype html>
<html lang="en"><head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Report a Problem — ${escapeHtml(assetTag)}</title>
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
      max-width: 480px;
      width: 100%;
      padding: 2rem;
    }
    .brand { color: #f0a030; font-size: 13px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; margin-bottom: 1.25rem; }
    h1 { font-size: 1.3rem; font-weight: 700; margin: 0 0 0.5rem; }
    .asset-tag { font-family: monospace; background: #1e1e1b; padding: 0.15rem 0.5rem; border-radius: 4px; color: #f0a030; }
    label { display: block; margin-top: 1rem; font-size: 0.9rem; color: #b0aca2; margin-bottom: 0.35rem; }
    input, textarea {
      width: 100%;
      background: #1e1e1b;
      border: 1px solid #2a2a24;
      border-radius: 6px;
      color: #e4e0d8;
      padding: 0.65rem 0.75rem;
      font-size: 1rem;
      font-family: inherit;
    }
    input:focus, textarea:focus { outline: 2px solid #f0a030; border-color: transparent; }
    textarea { min-height: 120px; resize: vertical; }
    .required { color: #f0a030; }
    button {
      display: block;
      width: 100%;
      margin-top: 1.5rem;
      padding: 0.9rem;
      background: #f0a030;
      color: #0a0a08;
      border: none;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 700;
      cursor: pointer;
    }
    button:hover { opacity: 0.88; }
    .footer { margin-top: 1.5rem; font-size: 0.78rem; color: #4a4840; text-align: center; }
    #success { display: none; padding: 1rem; background: #1e2e1b; border: 1px solid #2a4a24; border-radius: 8px; color: #7fc97f; margin-top: 1rem; }
  </style>
</head><body>
  <div class="card">
    <div class="brand">FactoryLM</div>
    <h1>Report a Problem</h1>
    <p style="color:#b0aca2;font-size:.95rem;margin:0 0 1rem">
      Asset <span class="asset-tag">${escapeHtml(assetTag)}</span> — your plant admin will be notified.
    </p>
    <form id="reportForm">
      <input type="hidden" name="asset_tag" value="${escapeHtml(assetTag)}">
      <input type="hidden" name="tenant_id" value="${escapeHtml(resolved.tenantId)}">
      <label>What's wrong? <span class="required">*</span></label>
      <textarea name="description" required placeholder="Describe the problem (noise, smoke, error code, etc.)"></textarea>
      <label>Your name <span style="color:#4a4840">(optional)</span></label>
      <input type="text" name="reporter_name" placeholder="Joe Operator">
      <label>Your contact <span style="color:#4a4840">(email or phone, optional)</span></label>
      <input type="text" name="reporter_contact" placeholder="joe@example.com or 555-0100">
      <button type="submit">Submit Report</button>
    </form>
    <div id="success">✓ Report submitted. Your plant admin has been notified.</div>
    <div class="footer">No account needed. Your report goes directly to your plant admin.</div>
  </div>
  <script>
    document.getElementById('reportForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const payload = Object.fromEntries(fd.entries());
      const res = await fetch('/api/m/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        e.currentTarget.style.display = 'none';
        document.getElementById('success').style.display = 'block';
      } else {
        alert('Something went wrong. Please try again.');
      }
    });
  </script>
</body></html>`);
});

mReportApi.post("/api/m/report", async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  const assetTag = typeof body.asset_tag === "string" ? body.asset_tag : "";
  const tenantId = typeof body.tenant_id === "string" ? body.tenant_id : "";
  const description = typeof body.description === "string" ? body.description.trim() : "";
  const reporterName = typeof body.reporter_name === "string" ? body.reporter_name.trim() : null;
  const reporterContact = typeof body.reporter_contact === "string" ? body.reporter_contact.trim() : null;
  const scanId = typeof body.scan_id === "string" ? body.scan_id : null;

  if (!ASSET_TAG_RE.test(assetTag)) {
    return c.json({ error: "Invalid asset_tag" }, 400);
  }
  if (!description) {
    return c.json({ error: "description is required" }, 400);
  }
  if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) {
    return c.json({ error: "Invalid tenant_id" }, 400);
  }

  const pg = new Client(process.env.NEON_DATABASE_URL!);
  await pg.connect();
  let reportId: string;
  try {
    await pg.query("BEGIN");
    const r = await pg.query(
      `INSERT INTO guest_reports
         (tenant_id, asset_tag, description, reporter_name, reporter_contact, scan_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [tenantId, assetTag, description, reporterName, reporterContact, scanId],
    );
    await pg.query("COMMIT");
    reportId = r.rows[0].id as string;
  } catch (err) {
    await pg.query("ROLLBACK");
    console.error("[m-report] DB insert failed:", err);
    return c.json({ error: "Failed to save report" }, 500);
  } finally {
    await pg.end();
  }

  // Email admin — graceful-fail (RESEND_API_KEY may be absent in dev)
  try {
    const db = neon(process.env.NEON_DATABASE_URL!);
    const rows = await db`SELECT email, first_name FROM plg_tenants WHERE id::text = ${tenantId} LIMIT 1`;
    if (rows.length > 0) {
      await sendEmail({
        to: rows[0].email as string,
        subject: `[MIRA] New fault report — ${assetTag}`,
        templateName: "guest-report-notify",
        vars: {
          ASSET_TAG: assetTag,
          DESCRIPTION: description,
          REPORTER_NAME: reporterName ?? "Anonymous",
          REPORTER_CONTACT: reporterContact ?? "—",
          REPORT_ID: reportId,
          ADMIN_NAME: (rows[0].first_name as string) || "Admin",
        },
      });
    }
  } catch (err) {
    console.warn("[m-report] Admin email failed (non-fatal):", err);
  }

  return c.json({ ok: true, report_id: reportId });
});

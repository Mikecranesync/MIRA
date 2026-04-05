/**
 * Drip email scheduler — runs daily to send timed follow-up emails.
 *
 * Uses @neondatabase/serverless tagged template syntax.
 */

import { neon } from "@neondatabase/serverless";
import { sendEmail, DRIP_SCHEDULE } from "./mailer.js";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

export async function processDripEmails(): Promise<void> {
  const db = sql();

  for (const drip of DRIP_SCHEDULE) {
    try {
      // Find tenants who signed up exactly N days ago and haven't received this email
      const tenants = await db`
        SELECT t.id, t.email, t.company
        FROM plg_tenants t
        WHERE t.created_at::date = (CURRENT_DATE - ${drip.day}::int)::date
          AND NOT EXISTS (
            SELECT 1 FROM plg_drip_log d
            WHERE d.tenant_id = t.id AND d.template_name = ${drip.templateName}
          )`;

      for (const tenant of tenants) {
        // Check engagement condition
        if (drip.condition === "no_query") {
          const rows = await db`
            SELECT COUNT(*) as c FROM plg_query_log WHERE tenant_id = ${tenant.id}`;
          if (parseInt(String(rows[0]?.c || "0"), 10) > 0) continue;
        }

        if (drip.condition === "low_usage") {
          const rows = await db`
            SELECT COUNT(*) as c FROM plg_query_log WHERE tenant_id = ${tenant.id}`;
          if (parseInt(String(rows[0]?.c || "0"), 10) >= 3) continue;
        }

        const firstName = String(tenant.email).split("@")[0];
        const sent = await sendEmail({
          to: String(tenant.email),
          subject: drip.subject.replace(
            "{{QUERIES_LEFT}}",
            process.env.PLG_DAILY_FREE_QUERIES || "5"
          ),
          templateName: drip.templateName,
          vars: {
            FIRST_NAME: firstName,
            COMPANY: String(tenant.company),
            QUERIES_LEFT: process.env.PLG_DAILY_FREE_QUERIES || "5",
            CMMS_URL: "https://factorylm.com/cmms",
            UPGRADE_URL: "https://factorylm.com/pricing",
          },
        });

        if (sent) {
          await db`
            INSERT INTO plg_drip_log (tenant_id, template_name, sent_at)
            VALUES (${tenant.id}, ${drip.templateName}, NOW())`;
        }
      }
    } catch (err) {
      console.error(`[drip] Error processing ${drip.templateName}:`, err);
    }
  }

  console.log("[drip] Daily drip processing complete");
}

export async function ensureDripSchema(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS plg_drip_log (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL REFERENCES plg_tenants(id),
      template_name TEXT NOT NULL,
      sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, template_name)
    )`;
}

export function startDripScheduler(): void {
  ensureDripSchema().catch((err) =>
    console.warn("[drip] Schema migration skipped:", err)
  );

  setTimeout(() => {
    processDripEmails().catch((err) =>
      console.error("[drip] Initial run failed:", err)
    );
  }, 10_000);

  setInterval(
    () => {
      processDripEmails().catch((err) =>
        console.error("[drip] Scheduled run failed:", err)
      );
    },
    24 * 60 * 60 * 1000
  );

  console.log("[drip] Scheduler started — runs daily");
}

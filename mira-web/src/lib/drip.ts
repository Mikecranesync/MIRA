/**
 * Drip email scheduler — runs daily to send timed follow-up emails.
 *
 * Queries NeonDB for tenants due for each email in the drip sequence,
 * checks engagement conditions, and sends via Resend.
 */

import { neon } from "@neondatabase/serverless";
import { sendEmail, DRIP_SCHEDULE } from "./mailer.js";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

/**
 * Process all pending drip emails for today.
 * Called once daily (e.g., 09:00 UTC via setInterval).
 */
export async function processDripEmails(): Promise<void> {
  const db = sql();

  for (const drip of DRIP_SCHEDULE) {
    try {
      // Find tenants who signed up exactly N days ago and haven't received this email
      const tenants = await db(
        `SELECT t.id, t.email, t.company
         FROM plg_tenants t
         WHERE t.created_at::date = (CURRENT_DATE - INTERVAL '${drip.day} days')::date
           AND NOT EXISTS (
             SELECT 1 FROM plg_drip_log d
             WHERE d.tenant_id = t.id AND d.template_name = $1
           )`,
        [drip.templateName]
      );

      for (const tenant of tenants) {
        // Check engagement condition
        if (drip.condition === "no_query") {
          const queryCount = await db(
            `SELECT COUNT(*) as c FROM plg_query_log WHERE tenant_id = $1`,
            [tenant.id]
          );
          if (parseInt(String(queryCount[0]?.c || "0"), 10) > 0) continue;
        }

        if (drip.condition === "low_usage") {
          const queryCount = await db(
            `SELECT COUNT(*) as c FROM plg_query_log WHERE tenant_id = $1`,
            [tenant.id]
          );
          if (parseInt(String(queryCount[0]?.c || "0"), 10) >= 3) continue;
        }

        // Send email
        const firstName = tenant.email.split("@")[0];
        const sent = await sendEmail({
          to: tenant.email,
          subject: drip.subject.replace(
            "{{QUERIES_LEFT}}",
            process.env.PLG_DAILY_FREE_QUERIES || "5"
          ),
          templateName: drip.templateName,
          vars: {
            FIRST_NAME: firstName,
            COMPANY: tenant.company,
            QUERIES_LEFT: process.env.PLG_DAILY_FREE_QUERIES || "5",
            CMMS_URL: `https://factorylm.com/cmms`,
            UPGRADE_URL: "https://factorylm.com/pricing",
          },
        });

        // Log that we sent this email
        if (sent) {
          await db(
            `INSERT INTO plg_drip_log (tenant_id, template_name, sent_at)
             VALUES ($1, $2, NOW())`,
            [tenant.id, drip.templateName]
          );
        }
      }
    } catch (err) {
      console.error(`[drip] Error processing ${drip.templateName}:`, err);
    }
  }

  console.log("[drip] Daily drip processing complete");
}

/**
 * Ensure drip log table exists.
 */
export async function ensureDripSchema(): Promise<void> {
  const db = sql();
  await db(`
    CREATE TABLE IF NOT EXISTS plg_drip_log (
      id            SERIAL PRIMARY KEY,
      tenant_id     TEXT NOT NULL REFERENCES plg_tenants(id),
      template_name TEXT NOT NULL,
      sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, template_name)
    )
  `);
}

/**
 * Start the daily drip scheduler.
 * Runs processDripEmails() once per day at startup + every 24 hours.
 */
export function startDripScheduler(): void {
  // Run schema migration
  ensureDripSchema().catch((err) =>
    console.warn("[drip] Schema migration skipped:", err)
  );

  // Run once on startup (catch up on any missed emails)
  setTimeout(() => {
    processDripEmails().catch((err) =>
      console.error("[drip] Initial run failed:", err)
    );
  }, 10_000); // 10s delay after startup

  // Then every 24 hours
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

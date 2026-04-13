/**
 * Drip email scheduler — runs daily to send timed follow-up emails.
 *
 * Beta nurture sequence: Loom videos (days 1-6) → payment ask (day 7) → reminder (day 10).
 * Uses @neondatabase/serverless tagged template syntax.
 */

import { neon } from "@neondatabase/serverless";
import { sendEmail, DRIP_SCHEDULE } from "./mailer.js";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

const BASE_URL = () => process.env.PUBLIC_URL || "https://factorylm.com";

function loomUrl(n: number): string {
  return process.env[`LOOM_URL_${n}`] || "https://www.loom.com/share/placeholder";
}

export async function processDripEmails(): Promise<void> {
  const db = sql();

  for (const drip of DRIP_SCHEDULE) {
    try {
      // Find tenants who signed up exactly N days ago and haven't received this email
      const tenants = await db`
        SELECT t.id, t.email, t.company, t.first_name, t.tier
        FROM plg_tenants t
        WHERE t.created_at::date = (CURRENT_DATE - ${drip.day}::int)::date
          AND NOT EXISTS (
            SELECT 1 FROM plg_drip_log d
            WHERE d.tenant_id = t.id AND d.template_name = ${drip.templateName}
          )`;

      for (const tenant of tenants) {
        // Skip payment/reminder emails for users who already paid
        if (drip.condition === "not_paid" && tenant.tier === "active") {
          continue;
        }

        const firstName = tenant.first_name
          ? String(tenant.first_name)
          : String(tenant.email).split("@")[0];

        const checkoutUrl = `${BASE_URL()}/api/checkout?tid=${tenant.id}&email=${encodeURIComponent(String(tenant.email))}`;

        // Personalize subject line
        const subject = drip.subject
          .replace("{{FIRST_NAME}}", firstName);

        const sent = await sendEmail({
          to: String(tenant.email),
          subject,
          templateName: drip.templateName,
          vars: {
            FIRST_NAME: firstName,
            COMPANY: String(tenant.company),
            LOOM_URL_1: loomUrl(1),
            LOOM_URL_2: loomUrl(2),
            LOOM_URL_3: loomUrl(3),
            LOOM_URL_4: loomUrl(4),
            LOOM_URL_5: loomUrl(5),
            CHECKOUT_URL: checkoutUrl,
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

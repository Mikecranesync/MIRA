/**
 * Transactional email via Resend SDK.
 *
 * Templates live in /emails/*.html with {{VAR}} placeholders.
 * The drip scheduler runs daily to send timed follow-ups.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const RESEND_API_KEY = () => process.env.RESEND_API_KEY || "";
const FROM_EMAIL = () =>
  process.env.RESEND_FROM_EMAIL || "noreply@factorylm.com";
const FROM_NAME = "Mira at FactoryLM";

interface SendEmailOpts {
  to: string;
  subject: string;
  templateName: string;
  vars?: Record<string, string>;
}

/**
 * Send a templated email via Resend HTTP API.
 * Falls back gracefully if RESEND_API_KEY is not set.
 */
export async function sendEmail(opts: SendEmailOpts): Promise<boolean> {
  const apiKey = RESEND_API_KEY();
  if (!apiKey) {
    console.warn("[mailer] RESEND_API_KEY not set — email skipped:", opts.subject);
    return false;
  }

  const templatePath = join(
    process.cwd(),
    "emails",
    `${opts.templateName}.html`
  );
  if (!existsSync(templatePath)) {
    console.error("[mailer] Template not found:", templatePath);
    return false;
  }

  let html = readFileSync(templatePath, "utf-8");

  // Substitute {{VAR}} placeholders
  for (const [key, val] of Object.entries(opts.vars || {})) {
    html = html.replaceAll(`{{${key}}}`, val);
  }

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL()}>`,
        to: [opts.to],
        subject: opts.subject,
        html,
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.error("[mailer] Resend API error:", resp.status, err);
      return false;
    }

    console.log("[mailer] Sent:", opts.subject, "→", opts.to);
    return true;
  } catch (err) {
    console.error("[mailer] Send failed:", err);
    return false;
  }
}

/**
 * Send the welcome email immediately after registration.
 */
export async function sendWelcomeEmail(
  email: string,
  firstName: string,
  company: string,
  token: string
): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: "Your FactoryLM CMMS is live — start here",
    templateName: "welcome",
    vars: {
      FIRST_NAME: firstName || email.split("@")[0],
      COMPANY: company,
      TOKEN: token,
      CMMS_URL: `https://factorylm.com/cmms?token=${token}`,
      QUERIES_LEFT: process.env.PLG_DAILY_FREE_QUERIES || "5",
    },
  });
}

/**
 * Drip email definitions — day offset from signup + template + subject.
 * Conditional: some only send if user hasn't engaged.
 */
export const DRIP_SCHEDULE = [
  {
    day: 1,
    templateName: "activation",
    subject: "30 seconds to try the AI that writes your work orders",
    condition: "no_query", // only if user hasn't queried yet
  },
  {
    day: 3,
    templateName: "feature",
    subject: "How to turn a fault code into a closed WO automatically",
    condition: "always",
  },
  {
    day: 7,
    templateName: "social-proof",
    subject: '"Cut repeat failures 40%" — how one tech used FactoryLM',
    condition: "always",
  },
  {
    day: 10,
    templateName: "nudge",
    subject: "You have {{QUERIES_LEFT}} Mira queries left today",
    condition: "low_usage", // only if < 3 queries used total
  },
  {
    day: 14,
    templateName: "conversion",
    subject: "Your free queries reset daily — unlimited is $49/mo",
    condition: "always",
  },
] as const;

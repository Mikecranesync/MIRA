/**
 * Transactional email via Resend HTTP API.
 *
 * Templates live in /emails/*.html with {{VAR}} placeholders.
 * The drip scheduler runs daily to send timed follow-ups.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const RESEND_API_KEY = () => process.env.RESEND_API_KEY || "";
const FROM_EMAIL = () =>
  process.env.RESEND_FROM_EMAIL || "noreply@factorylm.com";
const FROM_NAME = "Mike at FactoryLM";

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
 * Send the beta welcome email immediately after registration.
 * No token — pending users don't get product access.
 */
export async function sendBetaWelcomeEmail(
  email: string,
  firstName: string,
  company: string
): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: `You're on the list, ${firstName}`,
    templateName: "beta-welcome",
    vars: {
      FIRST_NAME: firstName || email.split("@")[0],
      COMPANY: company,
    },
  });
}

/**
 * Send the "you're in" email after successful Stripe payment.
 * Includes JWT login link for immediate CMMS access.
 */
export async function sendActivatedEmail(
  email: string,
  firstName: string,
  company: string,
  token: string
): Promise<boolean> {
  return sendEmail({
    to: email,
    subject: `You're in, ${firstName} — your CMMS is live`,
    templateName: "beta-activated",
    vars: {
      FIRST_NAME: firstName || email.split("@")[0],
      COMPANY: company,
      TOKEN: token,
      CMMS_URL: `https://factorylm.com/cmms?token=${token}`,
    },
  });
}

/**
 * Beta nurture drip schedule — Loom-heavy education → payment at Day 7.
 *
 * Conditions:
 *   "always"   — send to all tenants at day N
 *   "not_paid" — only send if tenant tier is still 'pending'
 */
export const DRIP_SCHEDULE = [
  {
    day: 1,
    templateName: "beta-loom-1",
    subject: "Watch: How Mira diagnoses a VFD fault in 10 seconds",
    condition: "always",
  },
  {
    day: 2,
    templateName: "beta-loom-2",
    subject: "Watch: The CMMS that fills itself out",
    condition: "always",
  },
  {
    day: 3,
    templateName: "beta-loom-3",
    subject: "Watch: Upload a manual, ask Mira anything from it",
    condition: "always",
  },
  {
    day: 5,
    templateName: "beta-loom-4",
    subject: "Watch: Slack + Telegram — Mira where your team already is",
    condition: "always",
  },
  {
    day: 6,
    templateName: "beta-social-proof",
    subject: '"We stopped guessing" — how one team uses FactoryLM',
    condition: "always",
  },
  {
    day: 7,
    templateName: "beta-payment",
    subject: "Your spot is ready — $97/mo to start",
    condition: "not_paid",
  },
  {
    day: 10,
    templateName: "beta-reminder",
    subject: "Still thinking about it?",
    condition: "not_paid",
  },
] as const;

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
const PUBLIC_URL = () => process.env.PUBLIC_URL || "https://factorylm.com";

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
    subject: `You're in, ${firstName} — upload your first manual`,
    templateName: "beta-activated",
    vars: {
      FIRST_NAME: firstName || email.split("@")[0],
      COMPANY: company,
      TOKEN: token,
      ACTIVATED_URL: `${PUBLIC_URL()}/activated?token=${token}`,
      CMMS_URL: `${PUBLIC_URL()}/api/cmms/login?token=${token}`,
    },
  });
}

// ---------------------------------------------------------------------------
// Magic email inbox (Unit 3) — receipt email after Postmark webhook fires
// ---------------------------------------------------------------------------

export interface InboxReceiptResult {
  ingested: { filename: string }[];
  skipped: { filename: string; reason: string }[];
  too_large: { filename: string; size_mb: number }[];
  duplicates: { filename: string; original_filename: string; original_uploaded_at: string }[];
  rejected: { filename: string; reason: string }[];
  errors: { filename: string; status: number | string }[];
}

function formatDate(iso: string): string {
  if (!iso) return "earlier";
  // Trim to YYYY-MM-DD if we can parse it; otherwise pass through.
  try {
    const d = new Date(iso);
    if (Number.isFinite(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  } catch {
    // fall through
  }
  return iso;
}

function formatInboxReceiptBody(firstName: string, r: InboxReceiptResult): string {
  const lines: string[] = [];
  lines.push(`Hey ${firstName || "there"},`);
  lines.push("");

  if (r.ingested.length > 0) {
    lines.push("Got it. Here's what landed in your knowledge base just now:");
    lines.push("");
    for (const f of r.ingested) {
      lines.push(`  ${f.filename}  (searchable in Telegram within 2 min)`);
    }
    lines.push("");
  } else {
    lines.push("Nothing landed in your knowledge base from that email — see why below.");
    lines.push("");
  }

  if (r.duplicates.length > 0) {
    lines.push("Already in your KB (skipped to avoid duplicates):");
    for (const f of r.duplicates) {
      const when = formatDate(f.original_uploaded_at);
      lines.push(`  - ${f.filename}  (original: ${f.original_filename}, uploaded ${when})`);
    }
    lines.push("");
  }

  if (r.rejected.length > 0) {
    lines.push("Didn't look like a manual to me, so I left them out:");
    for (const f of r.rejected) {
      lines.push(`  - ${f.filename}  (${f.reason})`);
    }
    lines.push("");
    lines.push("If I'm wrong, forward the file again with [force] at the start of the subject line.");
    lines.push("");
  }

  if (r.skipped.length > 0) {
    lines.push("Skipped because they aren't PDFs:");
    for (const f of r.skipped) {
      lines.push(`  - ${f.filename}  (${f.reason})`);
    }
    lines.push("");
  }

  if (r.too_large.length > 0) {
    lines.push("Too big (20 MB max per file):");
    for (const f of r.too_large) {
      lines.push(`  - ${f.filename}  (${f.size_mb} MB - reply and I'll share an upload link)`);
    }
    lines.push("");
  }

  if (r.errors.length > 0) {
    lines.push("Hit a problem on these (we'll auto-retry once, but reply if it persists):");
    for (const f of r.errors) {
      lines.push(`  - ${f.filename}  (status ${f.status})`);
    }
    lines.push("");
  }

  if (r.ingested.length > 0) {
    lines.push("Try it: ask MIRA in Telegram about anything from the new manual.");
  }

  return lines.join("\n");
}

/**
 * Send the inbox receipt email via Resend (plain text, no HTML template).
 * Variable-length file lists don't fit the {{VAR}} system, so this bypasses sendEmail().
 * Dev-mode short-circuit: logs body instead of sending when RESEND_API_KEY is unset.
 */
export async function sendInboxReceiptEmail(
  toEmail: string,
  firstName: string,
  result: InboxReceiptResult
): Promise<boolean> {
  const total = result.ingested.length;
  const subject = total > 0
    ? `MIRA - ${total} ${total === 1 ? "file" : "files"} added to your knowledge base`
    : "MIRA - couldn't add anything from your last email";
  const body = formatInboxReceiptBody(firstName, result);

  const apiKey = RESEND_API_KEY();
  if (!apiKey) {
    console.log("[mailer] (dev-mode) RESEND_API_KEY unset; would send to", toEmail);
    console.log("[mailer] subject:", subject);
    console.log("[mailer] body:\n" + body);
    return false;
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
        to: [toEmail],
        subject,
        text: body,
      }),
    });
    if (!resp.ok) {
      const err = await resp.text();
      console.error("[mailer] inbox receipt Resend error:", resp.status, err);
      return false;
    }
    console.log("[mailer] inbox receipt sent to", toEmail);
    return true;
  } catch (err) {
    console.error("[mailer] inbox receipt send failed:", err);
    return false;
  }
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

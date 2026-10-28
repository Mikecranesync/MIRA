/**
 * Free 30-day pilot request form — capture, store, notify (#4877).
 *
 * "Journey step 2" of the first-five-pilots funnel: a prospect who wants the
 * free pilot could previously only click a `mailto:` link. Nothing recorded
 * the request, its source, or consent. This module stores the submission in
 * NeonDB (idempotent `CREATE TABLE IF NOT EXISTS`, same pattern as
 * `lib/quota.ts` → `plg_tenants`), emails the owner via the existing
 * `lib/mailer.ts` `sendEmail()`, and fires a PostHog funnel event via the
 * existing `lib/posthog-server.ts` `captureServerEvent()` — no price, no ad
 * pixel, no free-text/email fields leave this module's capture() path.
 *
 * No price is ever rendered or stored: this is a free pilot for the first
 * five customers. CMMS connectors are optional — MIRA works from uploaded
 * equipment manuals alone.
 */

import { neon } from "@neondatabase/serverless";
import { sendEmail } from "../lib/mailer.js";
import { captureServerEvent } from "../lib/posthog-server.js";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

const OWNER_EMAIL = "mike@factorylm.com";

/** Bumped whenever the consent copy rendered on /pilot materially changes. */
export const CONSENT_TEXT_VERSION = "pilot-consent-v1";

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ALLOWED_FIELDS = new Set([
  "name",
  "work_email",
  "company",
  "equipment",
  "consent",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
]);

const UTM_FIELDS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

const MAX_LEN = {
  name: 200,
  work_email: 320,
  company: 200,
  equipment: 4000,
  utm: 200,
  referrer: 1000,
} as const;

// Same convention as /api/register and /api/magic-link in server.ts.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ValidPilotRequest {
  name: string;
  workEmail: string;
  company: string;
  equipment: string;
  consent: true;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
}

export type PilotRequestValidation =
  | { ok: true; value: ValidPilotRequest }
  | { ok: false; errors: string[] };

/** Pure validator — no I/O. Rejects unknown fields outright. */
export function validatePilotRequest(input: unknown): PilotRequestValidation {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, errors: ["Request body must be a JSON object."] };
  }
  const body = input as Record<string, unknown>;

  const extra = Object.keys(body).filter((k) => !ALLOWED_FIELDS.has(k));
  if (extra.length > 0) {
    errors.push(`Unexpected field(s): ${extra.join(", ")}.`);
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) errors.push("Name is required.");
  else if (name.length > MAX_LEN.name) {
    errors.push(`Name must be ${MAX_LEN.name} characters or fewer.`);
  }

  const workEmail = typeof body.work_email === "string" ? body.work_email.trim() : "";
  if (!workEmail) errors.push("Work email is required.");
  else if (workEmail.length > MAX_LEN.work_email) {
    errors.push(`Work email must be ${MAX_LEN.work_email} characters or fewer.`);
  } else if (!EMAIL_RE.test(workEmail)) {
    errors.push("Work email is not a valid email address.");
  }

  const company = typeof body.company === "string" ? body.company.trim() : "";
  if (!company) errors.push("Company is required.");
  else if (company.length > MAX_LEN.company) {
    errors.push(`Company must be ${MAX_LEN.company} characters or fewer.`);
  }

  const equipment = typeof body.equipment === "string" ? body.equipment.trim() : "";
  if (body.equipment !== undefined && typeof body.equipment !== "string") {
    errors.push("Equipment must be a string.");
  } else if (equipment.length > MAX_LEN.equipment) {
    errors.push(`Equipment must be ${MAX_LEN.equipment} characters or fewer.`);
  }

  if (body.consent !== true) {
    errors.push("Consent is required.");
  }

  const utmOut: Record<string, string | null> = {};
  for (const field of UTM_FIELDS) {
    const raw = body[field];
    if (raw === undefined || raw === null || raw === "") {
      utmOut[field] = null;
      continue;
    }
    if (typeof raw !== "string") {
      errors.push(`${field} must be a string.`);
      continue;
    }
    const trimmed = raw.trim();
    if (trimmed.length > MAX_LEN.utm) {
      errors.push(`${field} must be ${MAX_LEN.utm} characters or fewer.`);
      continue;
    }
    utmOut[field] = trimmed || null;
  }

  let referrer: string | null = null;
  if (body.referrer !== undefined && body.referrer !== null && body.referrer !== "") {
    if (typeof body.referrer !== "string") {
      errors.push("referrer must be a string.");
    } else if (body.referrer.length > MAX_LEN.referrer) {
      errors.push(`referrer must be ${MAX_LEN.referrer} characters or fewer.`);
    } else {
      referrer = body.referrer.trim() || null;
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    value: {
      name,
      workEmail,
      company,
      equipment,
      consent: true,
      utmSource: utmOut.utm_source ?? null,
      utmMedium: utmOut.utm_medium ?? null,
      utmCampaign: utmOut.utm_campaign ?? null,
      utmContent: utmOut.utm_content ?? null,
      utmTerm: utmOut.utm_term ?? null,
      referrer,
    },
  };
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StoredPilotRequest {
  id: string;
  createdAt: string;
}

/**
 * Idempotent schema creation — same pattern as `lib/quota.ts` → `ensureSchema()`.
 * No IP is stored (not a submitted/stored column at all).
 */
export async function ensurePilotRequestSchema(): Promise<void> {
  const db = sql();
  await db`
    CREATE TABLE IF NOT EXISTS plg_pilot_requests (
      id                    UUID PRIMARY KEY,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      name                  TEXT NOT NULL,
      work_email            TEXT NOT NULL,
      company               TEXT NOT NULL,
      equipment             TEXT NOT NULL DEFAULT '',
      consent               BOOLEAN NOT NULL,
      consent_text_version  TEXT NOT NULL,
      consent_at            TIMESTAMPTZ NOT NULL,
      utm_source            TEXT,
      utm_medium            TEXT,
      utm_campaign          TEXT,
      utm_content           TEXT,
      utm_term              TEXT,
      referrer              TEXT,
      status                TEXT NOT NULL DEFAULT 'new'
    )`;
  await db`
    CREATE INDEX IF NOT EXISTS idx_plg_pilot_requests_created_at
      ON plg_pilot_requests (created_at DESC)`;
}

/** Pure(ish) insert — one INSERT, no side effects beyond the row. */
export async function insertPilotRequest(
  value: ValidPilotRequest,
): Promise<StoredPilotRequest> {
  const db = sql();
  const id = crypto.randomUUID();
  const rows = (await db`
    INSERT INTO plg_pilot_requests (
      id, name, work_email, company, equipment, consent, consent_text_version,
      consent_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      referrer, status, created_at
    ) VALUES (
      ${id}, ${value.name}, ${value.workEmail}, ${value.company}, ${value.equipment},
      ${value.consent}, ${CONSENT_TEXT_VERSION}, NOW(),
      ${value.utmSource}, ${value.utmMedium}, ${value.utmCampaign}, ${value.utmContent}, ${value.utmTerm},
      ${value.referrer}, 'new', NOW()
    )
    RETURNING id, created_at
  `) as Array<{ id: string; created_at: string }>;
  const row = rows[0]!;
  return { id: row.id, createdAt: row.created_at };
}

// ---------------------------------------------------------------------------
// Owner notification (reuses lib/mailer.ts sendEmail — not edited here)
// ---------------------------------------------------------------------------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function defaultNotifyOwner(
  row: StoredPilotRequest,
  value: ValidPilotRequest,
): Promise<boolean> {
  return sendEmail({
    to: OWNER_EMAIL,
    subject: `New free pilot request — ${value.company}`,
    templateName: "pilot-request-notify",
    vars: {
      NAME: escapeHtml(value.name),
      WORK_EMAIL: escapeHtml(value.workEmail),
      COMPANY: escapeHtml(value.company),
      EQUIPMENT: escapeHtml(value.equipment || "(not provided)"),
      UTM_SOURCE: escapeHtml(value.utmSource ?? "(none)"),
      UTM_MEDIUM: escapeHtml(value.utmMedium ?? "(none)"),
      UTM_CAMPAIGN: escapeHtml(value.utmCampaign ?? "(none)"),
      REQUEST_ID: escapeHtml(row.id),
    },
  });
}

// ---------------------------------------------------------------------------
// Analytics (reuses lib/posthog-server.ts captureServerEvent — no PII)
// ---------------------------------------------------------------------------

/** Lowercased domain portion of an email, or null. Never the local part. */
export function companyDomainFromEmail(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain || null;
}

function defaultCapture(row: StoredPilotRequest, value: ValidPilotRequest): void {
  const properties: Record<string, unknown> = {};
  if (value.utmSource) properties.utm_source = value.utmSource;
  if (value.utmMedium) properties.utm_medium = value.utmMedium;
  if (value.utmCampaign) properties.utm_campaign = value.utmCampaign;
  if (value.utmContent) properties.utm_content = value.utmContent;
  if (value.utmTerm) properties.utm_term = value.utmTerm;
  const domain = companyDomainFromEmail(value.workEmail);
  if (domain) properties.company_domain = domain;

  captureServerEvent({ event: "pilot_request", distinctId: row.id, properties });
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface SubmitPilotRequestDeps {
  insert?: (value: ValidPilotRequest) => Promise<StoredPilotRequest>;
  notifyOwner?: (row: StoredPilotRequest, value: ValidPilotRequest) => Promise<boolean>;
  capture?: (row: StoredPilotRequest, value: ValidPilotRequest) => void;
}

export type SubmitPilotRequestResult =
  | { ok: true; id: string }
  | { ok: false; errors: string[] };

/**
 * Validate → insert → notify → capture. The stored row is never lost because
 * of a downstream failure: notifyOwner/capture errors are caught and logged,
 * never thrown back to the caller once the row exists.
 */
export async function submitPilotRequest(
  input: unknown,
  deps: SubmitPilotRequestDeps = {},
): Promise<SubmitPilotRequestResult> {
  const validated = validatePilotRequest(input);
  if (!validated.ok) return { ok: false, errors: validated.errors };

  const insert = deps.insert ?? insertPilotRequest;
  const notifyOwner = deps.notifyOwner ?? defaultNotifyOwner;
  const capture = deps.capture ?? defaultCapture;

  const row = await insert(validated.value);

  try {
    await notifyOwner(row, validated.value);
  } catch (err) {
    console.error("[pilot-request] owner notification failed:", err);
  }

  try {
    capture(row, validated.value);
  } catch (err) {
    console.error("[pilot-request] capture failed:", err);
  }

  return { ok: true, id: row.id };
}

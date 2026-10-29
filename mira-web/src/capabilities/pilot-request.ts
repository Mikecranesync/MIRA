/**
 * Free 30-day pilot request intake — capture, store, notify (#4877, reworked #4881).
 *
 * Originally built behind a standalone `/pilot` form; the owner decided
 * (#4881) that the Hub signup flow is the pilot application and ads run
 * through Meta/Google's native lead-gen forms instead of a website-to-React
 * integration, so that presentation page was removed. This module is now the
 * intake for however a pilot request originates — a lead-form export/import,
 * or any future first-party form — distinguished by `lead_source`. It stores
 * the submission in NeonDB (idempotent `CREATE TABLE IF NOT EXISTS`, same
 * pattern as `lib/quota.ts` → `plg_tenants`), emails the owner via the
 * existing `lib/mailer.ts` `sendEmail()`, and fires a PostHog funnel event via
 * the existing `lib/posthog-server.ts` `captureServerEvent()` — no price, no
 * ad pixel, no free-text/email fields leave this module's capture() path.
 *
 * No price is ever rendered or stored: this is a free pilot for the first
 * five customers. CMMS connectors are optional — MIRA works from uploaded
 * equipment manuals alone.
 */

import { neon } from "@neondatabase/serverless";
import { sendEmail } from "../lib/mailer.js";
import { captureServerEvent } from "../lib/posthog-server.js";
import { CURRENT_PILOT_CONSENT_VERSION, consentText, type ConsentText } from "./consent-texts.js";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

const OWNER_EMAIL = "mike@factorylm.com";

/**
 * The consent version new rows are recorded under (#4902). The wording itself
 * lives in consent-texts.ts; a new wording is a new version there, never an
 * edit here.
 */
export const CONSENT_TEXT_VERSION = CURRENT_PILOT_CONSENT_VERSION;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Known lead sources (#4881). Anything else is rejected, not coerced. */
const LEAD_SOURCES = new Set(["meta_lead_form", "google_lead_form", "direct", "other"]);
const DEFAULT_LEAD_SOURCE = "direct";

const ALLOWED_FIELDS = new Set([
  "name",
  "work_email",
  "company",
  "equipment",
  "consent",
  "consent_text_version",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "referrer",
  "lead_source",
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
  /** Version of the wording the submitter agreed to (#4902). */
  consentTextVersion: string;
  /** sha256 of that wording; null for a version whose text was never recorded. */
  consentTextSha256: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrer: string | null;
  leadSource: string;
}

export type PilotRequestValidation =
  | { ok: true; value: ValidPilotRequest }
  | { ok: false; errors: string[] };

/**
 * #4902: the error for a submitted `consent_text_version`, or null. Pure, so the
 * published-wording branch is tested before any wording is approved.
 */
export function checkConsentTextVersion(sent: unknown, current: ConsentText): string | null {
  if (sent !== undefined && sent !== current.version) {
    return `consent_text_version must be ${current.version}.`;
  }
  if (sent === undefined && current.status === "published") {
    return `consent_text_version is required (${current.version}).`;
  }
  return null;
}

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

  // #4902: once the current version has recorded wording, the submitter must
  // name it, so the row proves which words were agreed to. While the current
  // version is v1 (no recorded wording) the field stays optional, but a wrong
  // value is still rejected rather than stored.
  const current = consentText(CONSENT_TEXT_VERSION)!;
  const consentVersionError = checkConsentTextVersion(body.consent_text_version, current);
  if (consentVersionError) errors.push(consentVersionError);

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

  // lead_source (#4881): which channel this request came in on — a native
  // Meta/Google lead-form export/import, or a first-party ("direct") form.
  // Absent/undefined defaults to "direct" (same shape as /api/register
  // treating no explicit path as the default path); present-but-invalid is
  // rejected outright, same strictness as every other field here.
  let leadSource = DEFAULT_LEAD_SOURCE;
  if (body.lead_source !== undefined) {
    if (typeof body.lead_source !== "string") {
      errors.push("lead_source must be a string.");
    } else if (!LEAD_SOURCES.has(body.lead_source)) {
      errors.push(
        `lead_source must be one of: ${Array.from(LEAD_SOURCES).join(", ")}.`,
      );
    } else {
      leadSource = body.lead_source;
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
      consentTextVersion: current.version,
      consentTextSha256: current.sha256,
      utmSource: utmOut.utm_source ?? null,
      utmMedium: utmOut.utm_medium ?? null,
      utmCampaign: utmOut.utm_campaign ?? null,
      utmContent: utmOut.utm_content ?? null,
      utmTerm: utmOut.utm_term ?? null,
      referrer,
      leadSource,
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
 *
 * `lead_source` (#4881) is added via `ADD COLUMN IF NOT EXISTS` rather than
 * only in the `CREATE TABLE`, because this function also runs against an
 * already-created table on every startup (same idempotency contract as
 * `lib/quota.ts` → `ensureSchema()`) — the table predates this column.
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
      consent_text_sha256   TEXT,
      consent_at            TIMESTAMPTZ NOT NULL,
      utm_source            TEXT,
      utm_medium            TEXT,
      utm_campaign          TEXT,
      utm_content           TEXT,
      utm_term              TEXT,
      referrer              TEXT,
      status                TEXT NOT NULL DEFAULT 'new',
      lead_source            TEXT NOT NULL DEFAULT 'direct'
    )`;
  await db`
    ALTER TABLE plg_pilot_requests
      ADD COLUMN IF NOT EXISTS lead_source TEXT NOT NULL DEFAULT 'direct'`;
  // #4902: NULL on every pre-existing row — those were stamped v1, whose
  // wording was never recorded. Never back-filled.
  await db`
    ALTER TABLE plg_pilot_requests
      ADD COLUMN IF NOT EXISTS consent_text_sha256 TEXT`;
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
      consent_text_sha256, consent_at, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      referrer, status, lead_source, created_at
    ) VALUES (
      ${id}, ${value.name}, ${value.workEmail}, ${value.company}, ${value.equipment},
      ${value.consent}, ${value.consentTextVersion}, ${value.consentTextSha256}, NOW(),
      ${value.utmSource}, ${value.utmMedium}, ${value.utmCampaign}, ${value.utmContent}, ${value.utmTerm},
      ${value.referrer}, 'new', ${value.leadSource}, NOW()
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

/** Template vars for `emails/pilot-request-notify.html` (exported for tests, #4901). */
export function ownerNotifyVars(
  row: StoredPilotRequest,
  value: ValidPilotRequest,
): Record<string, string> {
  return {
    NAME: escapeHtml(value.name),
    WORK_EMAIL: escapeHtml(value.workEmail),
    COMPANY: escapeHtml(value.company),
    EQUIPMENT: escapeHtml(value.equipment || "(not provided)"),
    LEAD_SOURCE: escapeHtml(value.leadSource),
    UTM_SOURCE: escapeHtml(value.utmSource ?? "(none)"),
    UTM_MEDIUM: escapeHtml(value.utmMedium ?? "(none)"),
    UTM_CAMPAIGN: escapeHtml(value.utmCampaign ?? "(none)"),
    REQUEST_ID: escapeHtml(row.id),
  };
}

async function defaultNotifyOwner(
  row: StoredPilotRequest,
  value: ValidPilotRequest,
): Promise<boolean> {
  return sendEmail({
    to: OWNER_EMAIL,
    subject: `New free pilot request — ${value.company}`,
    templateName: "pilot-request-notify",
    vars: ownerNotifyVars(row, value),
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
// Codex round-1 F2 (PR #4881): a stalled Resend request must never block the
// response for a row that already committed. Bound the owner notification
// with a hard deadline and never await it on the response path.
const NOTIFY_OWNER_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    // Don't let this bookkeeping timer keep the process alive.
    (timer as unknown as { unref?: () => void }).unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

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

  // Fire-and-forget, deadline-bounded: the response below must not wait on
  // this. A failure (including a timeout) is logged, never thrown back to
  // the caller — the stored row is the thing that matters, and it already
  // committed above.
  withTimeout(notifyOwner(row, validated.value), NOTIFY_OWNER_TIMEOUT_MS, "owner notification").catch(
    (err) => {
      console.error("[pilot-request] owner notification failed:", err);
    },
  );

  try {
    capture(row, validated.value);
  } catch (err) {
    console.error("[pilot-request] capture failed:", err);
  }

  return { ok: true, id: row.id };
}

/**
 * Rate-limit key for POST /api/pilot-request (Codex #4881 F5). The shared
 * getClientIp in server.ts trusts the FIRST X-Forwarded-For value, which a
 * client can set to anything. nginx overwrites X-Real-IP with $remote_addr
 * (deployment/nginx-factorylm-marketing.conf), so prefer it; otherwise use the
 * LAST X-Forwarded-For hop, the one our own proxy appended.
 */
export function pilotRequestLimiterKey(headers: Headers): string {
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1]!;
  }
  return "unknown";
}

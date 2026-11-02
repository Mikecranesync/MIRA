import pool from "@/lib/db";
import { isPilotApprovalRequired } from "./pilot-access";
import {
  posthogHost,
  posthogKey,
  signupCompletedProperties,
  type SignupMethod,
} from "./posthog";
import type { PilotAttribution } from "./utm";

export { attributionFromRequest, type PilotAttribution } from "./utm";

// Pilot-application funnel plumbing (#4877). Mike's decision: the Hub signup
// at app.factorylm.com IS the free 30-day pilot application. This module is
// Hub-side only — ad capture is native Meta/Google lead forms, not this repo.
//
// Three concerns, kept together because they're always triggered by the same
// event (a NEW account created at /api/auth/register) and are all best-effort:
//   1. attributionFromRequest — parse utm_*/gclid/fbclid off the signup request
//      (body + first-touch cookie + Referer; see capabilities/utm.ts)
//   2. recordPilotApplication — persist one row per tenant (108_pilot_applications.sql)
//   3. captureFunnelEvent / notifyOwnerOfApplication — telemetry + owner email

// ---------------------------------------------------------------------------
// 2. Persistence (108_pilot_applications.sql)
// ---------------------------------------------------------------------------

export interface RecordPilotApplicationInput {
  tenantId: string;
  userId: string;
  attribution: PilotAttribution;
}

/**
 * Inserts the attribution row for a NEW pilot application. `UNIQUE
 * (tenant_id)` + `ON CONFLICT DO NOTHING` makes this idempotent: a second
 * call for the same tenant (e.g. a concurrent-request race through
 * `ensureUserAndTenant`) returns `null` without erroring.
 *
 * Throws on a genuine DB error — the caller (`handlePilotApplicationSubmitted`)
 * decides what that should mean for the event/email, which differs from "this
 * tenant already has a row" (see that function's doc comment).
 */
export async function recordPilotApplication(
  input: RecordPilotApplicationInput,
): Promise<string | null> {
  const a = input.attribution;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO pilot_applications
       (tenant_id, user_id, utm_source, utm_medium, utm_campaign, utm_content, utm_term, has_gclid, has_fbclid)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (tenant_id) DO NOTHING
     RETURNING id`,
    [
      input.tenantId,
      input.userId,
      a.utmSource,
      a.utmMedium,
      a.utmCampaign,
      a.utmContent,
      a.utmTerm,
      a.hasGclid,
      a.hasFbclid,
    ],
  );
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// 3a. PostHog funnel events
// ---------------------------------------------------------------------------

/**
 * The full pilot funnel. Only `pilot_application_submitted` is wired in this
 * PR (from `handlePilotApplicationSubmitted` below, called by the register
 * route). The rest have an obvious single existing seam and are listed here
 * so the next PR wires them without re-deriving where:
 *   - pilot_approved              → mira-hub/src/app/(hub)/api/admin/pilots/[tenantId]/approve/route.ts (PR #4882)
 *   - pilot_first_manual_uploaded → mira-hub/src/lib/node-knowledge-ingest.ts or
 *                                   mira-hub/src/app/api/documents/upload/route.ts, gated on
 *                                   "is this tenant's first knowledge_entries row"
 *   - pilot_first_cited_answer    → mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts
 *                                   (or /api/assets/[id]/chat), gated on "first turn with a citation"
 *   - pilot_answer_rated          → the rating path inside
 *                                   mira-hub/src/app/api/equipment-notebooks/[id]/chat/route.ts
 * See docs/runbooks/pilot-funnel-events.md for the full checklist.
 */
export const PILOT_FUNNEL_EVENTS = [
  "pilot_application_submitted",
  "pilot_approved",
  "pilot_first_manual_uploaded",
  "pilot_first_cited_answer",
  "pilot_answer_rated",
] as const;
export type PilotFunnelEvent = (typeof PILOT_FUNNEL_EVENTS)[number];
export type HubCaptureEvent = PilotFunnelEvent | "signup_completed";

export type PilotFunnelEventProperties = Record<string, string | number | boolean | null>;

// Named PLG_POSTHOG_KEY / PLG_POSTHOG_HOST — NOT a new POSTHOG_PROJECT_KEY
// name — to match mira-web/src/lib/posthog-server.ts exactly, so one Doppler
// key/host pair serves both mira-web's and mira-hub's server-side capture.
// Read at CALL time via capabilities/posthog.ts so the client snippet and
// this capture path cannot drift onto different env vars.

const CAPTURE_TIMEOUT_MS = 3000;

/**
 * Server-side PostHog capture. Fire-and-forget: callers must NOT await this
 * in the response path. No-ops silently when `PLG_POSTHOG_KEY` is unset
 * (dev/staging-without-telemetry must never page). Never throws — every
 * failure path (missing key, bad distinctId, network error, timeout) is
 * swallowed and logged, not raised.
 *
 * `properties` is a plain allowlisted map the caller builds — this function
 * does not accept free text. Callers must never pass email, name, company
 * free text, question text, or file names (security-boundaries.md PII rule).
 */
export function captureFunnelEvent(
  event: HubCaptureEvent,
  distinctId: string,
  properties?: PilotFunnelEventProperties,
): void {
  try {
    const apiKey = posthogKey();
    if (!apiKey || !distinctId) return;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CAPTURE_TIMEOUT_MS);

    const body = JSON.stringify({
      api_key: apiKey,
      event,
      distinct_id: distinctId,
      properties: { $lib: "mira-hub-server", ...properties },
      timestamp: new Date().toISOString(),
    });

    fetch(`${posthogHost()}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) console.warn(`[pilot-funnel] posthog capture rejected: HTTP ${res.status}`);
      })
      .catch((err) => {
        console.warn("[pilot-funnel] posthog capture failed:", err instanceof Error ? err.message : err);
      })
      .finally(() => clearTimeout(timeout));
  } catch (err) {
    // Belt-and-suspenders: a synchronous throw (e.g. a hostile `fetch` shim
    // in a test) must still never propagate to the caller.
    console.warn("[pilot-funnel] posthog capture setup failed:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// 3b. Owner notification (Resend)
// ---------------------------------------------------------------------------

export interface PilotApplicationNotice {
  email: string;
  name: string | null;
  tenantId: string;
  /** hub_tenants.name — the closest thing the frozen signup page captures to
   * a "company" field (ensureUserAndTenant defaults it to the user's name,
   * else their email; there is no separate company input today). */
  tenantName: string;
  attribution: PilotAttribution;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const NOTIFY_TIMEOUT_MS = 5000;

/**
 * Emails the pilot owner (`PILOT_OWNER_EMAIL`, default `mike@factorylm.com`)
 * that a new pilot application came in. Reuses the exact Resend call shape
 * as `sendInviteEmail` in `mira-hub/src/app/api/team/route.ts` — same env var
 * (`RESEND_API_KEY`), same `from` address. Fire-and-forget with a timeout:
 * any failure (missing key, network error, non-2xx, timeout) is only logged,
 * never thrown — this must never surface to or slow the registration
 * response. Every piece of applicant-controlled text is HTML-escaped before
 * it goes into the email body.
 */
export async function notifyOwnerOfApplication(notice: PilotApplicationNotice): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn("[pilot-funnel] RESEND_API_KEY not set — skipping owner notification");
      return;
    }
    const ownerEmail = process.env.PILOT_OWNER_EMAIL?.trim() || "mike@factorylm.com";
    const a = notice.attribution;
    const utmRows: Array<[string, string | null]> = [
      ["utm_source", a.utmSource],
      ["utm_medium", a.utmMedium],
      ["utm_campaign", a.utmCampaign],
      ["utm_content", a.utmContent],
      ["utm_term", a.utmTerm],
    ];
    const utmLines = utmRows
      .filter(([, v]) => v)
      .map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(String(v))}</li>`)
      .join("");
    const clickFlags = [a.hasGclid ? "gclid" : null, a.hasFbclid ? "fbclid" : null]
      .filter(Boolean)
      .join(", ");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOTIFY_TIMEOUT_MS);
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from: "FactoryLM <noreply@factorylm.com>",
          to: [ownerEmail],
          subject: "New FactoryLM pilot application",
          html: `
            <div style="font-family:Inter,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#0F172A;color:#F1F5F9;border-radius:12px;">
              <div style="margin-bottom:24px;">
                <span style="font-size:24px;font-weight:700;color:#2563EB;">FactoryLM</span>
              </div>
              <h2 style="font-size:20px;font-weight:600;margin-bottom:8px;">New pilot application</h2>
              <p style="color:#94A3B8;margin-bottom:8px;">
                ${escapeHtml(notice.email)}${notice.name ? ` (${escapeHtml(notice.name)})` : ""} — ${escapeHtml(notice.tenantName)}
              </p>
              ${utmLines ? `<ul style="color:#94A3B8;font-size:13px;">${utmLines}</ul>` : '<p style="color:#64748B;font-size:13px;">No UTM attribution captured.</p>'}
              ${clickFlags ? `<p style="color:#64748B;font-size:13px;">Click id present: ${escapeHtml(clickFlags)}</p>` : ""}
              <p style="color:#64748B;font-size:13px;margin-top:16px;">Approve by POSTing (not a link — a GET won't do this):</p>
              <pre style="background:#1E293B;color:#E2E8F0;padding:12px;border-radius:6px;font-size:12px;overflow-x:auto;">POST /api/admin/pilots/${escapeHtml(notice.tenantId)}/approve</pre>
            </div>
          `,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn("[pilot-funnel] Resend owner-notify error:", res.status, text);
      }
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.warn("[pilot-funnel] owner notification failed:", err instanceof Error ? err.message : err);
  }
}

// ---------------------------------------------------------------------------
// Orchestration — the one thing the register route calls
// ---------------------------------------------------------------------------

/**
 * Consolidated onto the real export now that #4882 has merged — this module
 * previously duplicated the function (same env var, same check) because
 * #4882 wasn't on `main` yet when this file was written. Re-exported, not
 * reimplemented, so there is exactly one definition.
 */
export { isPilotApprovalRequired } from "./pilot-access";

export interface PilotApplicationSubmittedInput {
  tenantId: string;
  userId: string;
  email: string;
  name: string | null;
  tenantName: string;
  attribution: PilotAttribution;
  /** How the account was created. Defaults to credentials (email/password). */
  method?: SignupMethod;
}

/**
 * The single best-effort hook the register route calls (fire-and-forget,
 * never awaited in the response path) after a NEW account is created.
 *
 * - Attribution insert failure is logged, not surfaced — but still runs the
 *   event capture and owner email, because a saving bug must never cost Mike
 *   a visible applicant.
 * - A `null` return with NO thrown error means `ON CONFLICT (tenant_id) DO
 *   NOTHING` found this tenant already had a row (a race through
 *   `ensureUserAndTenant`, or a retried request) — that's a genuine duplicate,
 *   so the event and email are skipped to avoid double-notifying Mike for one
 *   signup.
 * - The owner email only fires when `MIRA_PILOT_APPROVAL_REQUIRED` is on, so
 *   open-signup mode doesn't email Mike on every signup.
 */
export async function handlePilotApplicationSubmitted(
  input: PilotApplicationSubmittedInput,
): Promise<void> {
  let isDuplicate = false;
  try {
    const id = await recordPilotApplication({
      tenantId: input.tenantId,
      userId: input.userId,
      attribution: input.attribution,
    });
    isDuplicate = id === null;
  } catch (err) {
    console.error("[pilot-funnel] attribution insert failed — continuing with event + owner email:", err);
  }

  if (isDuplicate) return;

  const method = input.method ?? "credentials";
  captureFunnelEvent("pilot_application_submitted", input.tenantId, {
    has_gclid: input.attribution.hasGclid,
    has_fbclid: input.attribution.hasFbclid,
    utm_source: input.attribution.utmSource,
    utm_medium: input.attribution.utmMedium,
    utm_campaign: input.attribution.utmCampaign,
  });
  // Conversion event for Hub signup attribution (UTMs + method only; no PII).
  captureFunnelEvent(
    "signup_completed",
    input.tenantId,
    signupCompletedProperties(input.attribution, method),
  );

  if (isPilotApprovalRequired()) {
    await notifyOwnerOfApplication({
      email: input.email,
      name: input.name,
      tenantId: input.tenantId,
      tenantName: input.tenantName,
      attribution: input.attribution,
    });
  }
}

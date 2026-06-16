/**
 * Audit log — append-only event trail for tenant-scoped actions.
 *
 * Schema lives in quota.ensureSchema(). Reads are intentionally absent —
 * audit trails are written-only from app code. Querying happens via DB
 * tools or admin endpoints (added separately when SOC 2 readiness work
 * begins).
 *
 * Discipline:
 *   - Never UPDATE / DELETE rows. Append-only.
 *   - Never log secrets or full request bodies. Use `metadata` for
 *     small structured facts (filename, byte count, status).
 *   - Failures to record an audit event are logged + swallowed —
 *     never block the user-facing operation. The event will be
 *     missing in the trail; that's a known operational tradeoff.
 *
 * Common action names (extend as needed; keep dotted-namespace style):
 *   tenant.signup
 *   tenant.activated
 *   tenant.deleted
 *   auth.session.issued
 *   auth.mfa.enrolled
 *   auth.mfa.removed
 *   inbox.email.received
 *   inbox.attachment.ingested
 *   inbox.attachment.rejected
 *   manual.uploaded
 *   manual.deleted
 *   csv.imported
 *   atlas.workorder.created
 *   account.deleted
 */

import type { Context } from "hono";
import { neon } from "@neondatabase/serverless";

function sql() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error("NEON_DATABASE_URL not set");
  return neon(url);
}

export type ActorType = "tenant" | "admin" | "system" | "apps_script";

export interface AuditEventInput {
  tenantId: string;
  actorId?: string; // defaults to tenantId
  actorType?: ActorType; // defaults to "tenant"
  action: string;
  resource?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

/**
 * Record an audit event. Best-effort: logs and swallows on failure so a
 * DB hiccup doesn't break the user-facing operation. Returns whether the
 * insert succeeded — callers usually ignore.
 */
export async function recordAuditEvent(
  ev: AuditEventInput,
): Promise<boolean> {
  const db = sql();
  const actorId = ev.actorId ?? ev.tenantId;
  const actorType = ev.actorType ?? "tenant";
  // JSON.stringify before passing — driver will store as JSONB
  const metaJson = ev.metadata ? JSON.stringify(ev.metadata) : null;

  try {
    await db`
      INSERT INTO audit_events
        (tenant_id, actor_id, actor_type, action, resource, metadata, ip, user_agent)
      VALUES
        (${ev.tenantId}, ${actorId}, ${actorType}, ${ev.action},
         ${ev.resource ?? null}, ${metaJson}, ${ev.ip ?? null},
         ${ev.userAgent ?? null})`;
    return true;
  } catch (err) {
    console.error("[audit] failed to record %s for %s: %s", ev.action, ev.tenantId, err);
    return false;
  }
}

/**
 * Helper: extract IP + UA from a Hono context. Cloudflare / Bun behind a
 * proxy commonly land the real client IP in `x-forwarded-for` (first hop)
 * or `cf-connecting-ip`. Falls back to "unknown" so the column is never
 * null and queries can use string literals.
 */
export function requestMetadata(c: Context): { ip: string; userAgent: string } {
  const xff = c.req.header("x-forwarded-for");
  const cf = c.req.header("cf-connecting-ip");
  const ip = (cf || (xff ?? "").split(",")[0] || "").trim() || "unknown";
  const userAgent = c.req.header("user-agent") || "unknown";
  return { ip, userAgent };
}

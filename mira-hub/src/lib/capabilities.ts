import { NextResponse } from "next/server";
import type { SessionContext } from "@/lib/session";
import { isReviewAdmin } from "@/lib/review-queue";

// ── The ONE place authorization is computed ──────────────────────────────────
//
// #1932 was a nav-vs-API disagreement: the sidebar hardcoded `role="admin"` so
// every user saw the Admin/Review links, while the APIs gated on signals the
// user didn't satisfy (an email allowlist for review; status==="admin" for the
// platform user admin). Three independent checks, three different answers.
//
// Fix: derive capabilities once, here, from the signals we ALREADY have on the
// session, and feed the SAME result to both the nav (via /api/me) and every API
// route guard (via requireCapability). One source of truth = no drift.
//
// IMPORTANT — this does NOT expand who is authorized. Each capability maps to
// the *exact* signal its surface already used:
//   • review_queue.*      ← isReviewAdmin(email)  (matches /api/admin/review/*)
//   • platform.users.read ← status === "admin"    (matches /hub/api/admin/users)
//   • workspace.*         ← any authenticated tenant user, scoped to THEIR tenant
//
// "Workspace" caps are customer-facing (a tenant owner managing their own
// workspace under /settings/*). "Platform" caps are internal FactoryLM-staff
// surfaces (cross-tenant review, global user admin). Keep the two separate.
//
// Server-only module (imports node fs transitively via review-queue). Client
// components must read capabilities from /api/me, never import this file.

export type Capability =
  | "workspace.read"
  | "team.read"
  | "usage.read"
  | "integrations.read"
  | "audit_log.read"
  | "review_queue.read"
  | "review_queue.decide"
  | "platform.users.read"
  | "dev_tools.access";

// Available to every authenticated tenant user for their own tenant.
const WORKSPACE_CAPS: Capability[] = [
  "workspace.read",
  "team.read",
  "usage.read",
  "integrations.read",
  "audit_log.read",
];

export function getCapabilities(ctx: SessionContext): Capability[] {
  const caps: Capability[] = [...WORKSPACE_CAPS];
  // Platform review surface — same email allowlist the review APIs already use.
  if (isReviewAdmin(ctx.email)) {
    caps.push("review_queue.read", "review_queue.decide");
  }
  // Platform-wide (cross-tenant) user admin — same status gate it already used.
  if (ctx.status === "admin") {
    caps.push("platform.users.read");
  }
  return caps;
}

export function hasCapability(ctx: SessionContext, cap: Capability): boolean {
  return getCapabilities(ctx).includes(cap);
}

/**
 * API-route guard. Returns a 403 NextResponse when the caller lacks `cap`,
 * or null when allowed. Mirror of the sessionOr401 pattern:
 *
 *   const ctx = await sessionOr401();
 *   if (ctx instanceof NextResponse) return ctx;
 *   const denied = requireCapability(ctx, "review_queue.read");
 *   if (denied) return denied;
 */
export function requireCapability(
  ctx: SessionContext,
  cap: Capability,
): NextResponse | null {
  return hasCapability(ctx, cap)
    ? null
    : NextResponse.json({ error: "forbidden" }, { status: 403 });
}

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
  | "dev_tools.access"
  // Tenant-admin governance caps (issue #2360). These are intra-tenant admin
  // actions, gated on the caller's hub_users.role — NOT the platform email
  // allowlist above. Promotion proposed→verified is an admin action
  // (CLAUDE.md / ADR-0017); driving the asset-agent approval/deploy gate is an
  // admin action (train-before-deploy spec).
  | "proposals.decide"
  | "asset_agent.transition";

// Tenant roles (hub_users.role) that hold intra-tenant admin authority. Any
// other / unrecognized role string falls through to least-privilege — an
// unknown role can never satisfy a gate.
const ADMIN_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

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
  // Intra-tenant admin governance (issue #2360) — gated on hub_users.role,
  // derived fresh per request in lib/session.ts. owner/admin only; an
  // absent/unknown role falls through to least-privilege.
  if (ADMIN_ROLES.has(ctx.role ?? "")) {
    caps.push("proposals.decide", "asset_agent.transition");
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

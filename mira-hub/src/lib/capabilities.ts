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
  // Tenant-role governance + write caps (issues #2360, #578). These are
  // intra-tenant actions gated on the caller's hub_users.role — NOT the
  // platform email allowlist above. Promotion proposed→verified is an admin
  // action (CLAUDE.md / ADR-0017); driving the asset-agent approval/deploy gate
  // is an admin action (train-before-deploy spec); the remaining write caps are
  // the #578 fail-open inventory, mapped to roles per the documented intent.
  | "proposals.decide"
  | "asset_agent.transition"
  | "assets.create"
  | "assets.write"
  | "work_orders.create"
  | "work_orders.update"
  | "pm_schedules.write"
  | "pm_schedules.complete"
  | "reports.generate"
  | "namespace.admin";

// ── The tenant role → capability matrix (issue #2360 deferred slice / #578) ───
//
// `hub_users.role` is derived fresh per request in lib/session.ts. The matrix
// below is the SINGLE source of intra-tenant authorization. Intent comes from
// the #578 fail-open inventory + the synthetic-worker deny-grid:
//   • operator   — most-restricted: list / show / request only. No writes.
//   • technician — executes work: create/update work orders, complete PMs.
//                  NOT: create assets, edit PM schedules, reports, governance.
//   • scheduler  — owns the PM calendar + reports. NOT asset/WO mutation.
//   • manager    — asset / work-order / report scope. NOT namespace/kg/governance.
//   • admin/owner — full intra-tenant authority (everything above + namespace
//                  onboarding writes + the two #2360 governance caps).
//
// Real production roles are only owner (signup default) / technician / admin
// (the two invite roles); manager/scheduler/operator are forward-looking (the
// RBAC test personas + the access-control.ts type) and covered here too. Any
// role string NOT in this map falls through to least-privilege — an unknown or
// absent role can never satisfy a write/governance gate.
const TECHNICIAN_CAPS: Capability[] = [
  "work_orders.create",
  "work_orders.update",
  "pm_schedules.complete",
];
const SCHEDULER_CAPS: Capability[] = [
  "pm_schedules.write",
  "pm_schedules.complete",
  "reports.generate",
];
const MANAGER_CAPS: Capability[] = [
  "assets.create",
  "assets.write",
  "work_orders.create",
  "work_orders.update",
  "pm_schedules.write",
  "pm_schedules.complete",
  "reports.generate",
];
// admin/owner = manager scope + namespace onboarding writes + #2360 governance.
const ADMIN_CAPS: Capability[] = [
  ...MANAGER_CAPS,
  "namespace.admin",
  "proposals.decide",
  "asset_agent.transition",
];
const ROLE_CAPS: Readonly<Record<string, Capability[]>> = {
  operator: [],
  technician: TECHNICIAN_CAPS,
  scheduler: SCHEDULER_CAPS,
  manager: MANAGER_CAPS,
  admin: ADMIN_CAPS,
  owner: ADMIN_CAPS,
};

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
  // Intra-tenant role caps (issues #2360, #578) — gated on hub_users.role,
  // derived fresh per request in lib/session.ts. The matrix grants the exact
  // write/governance caps each role holds; an absent/unknown role resolves to
  // [] and falls through to least-privilege (read-only workspace caps only).
  caps.push(...(ROLE_CAPS[ctx.role ?? ""] ?? []));
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

"use client";

import type { AccessControlProvider } from "@refinedev/core";
import { getSession } from "next-auth/react";

type Role = "technician" | "manager" | "scheduler" | "admin" | "operator" | "owner";

type ResourcePermissions = {
  actions: string[];
  roles: Role[];
};

const PERMISSIONS: Record<string, ResourcePermissions[]> = {
  feed:       [{ actions: ["list"], roles: ["technician", "manager", "scheduler", "admin", "operator"] }],
  assets:     [{ actions: ["list", "show"], roles: ["technician", "manager", "scheduler", "admin", "operator"] },
               { actions: ["create", "edit", "delete"], roles: ["manager", "admin"] }],
  workorders: [{ actions: ["list", "show"], roles: ["technician", "manager", "scheduler", "admin", "operator"] },
               { actions: ["create", "edit"], roles: ["technician", "manager", "scheduler", "admin"] },
               { actions: ["delete"], roles: ["manager", "admin"] }],
  documents:  [{ actions: ["list", "show"], roles: ["technician", "manager", "scheduler", "admin", "operator"] },
               { actions: ["create", "delete"], roles: ["manager", "admin"] }],
  parts:      [{ actions: ["list", "show"], roles: ["technician", "manager", "scheduler", "admin", "operator"] },
               { actions: ["create", "edit", "delete"], roles: ["manager", "admin"] }],
  schedule:   [{ actions: ["list"], roles: ["technician", "manager", "scheduler", "admin", "operator"] },
               { actions: ["create", "edit", "delete"], roles: ["manager", "scheduler", "admin"] }],
  requests:   [{ actions: ["list", "show", "create"], roles: ["technician", "manager", "scheduler", "admin", "operator"] },
               { actions: ["edit", "delete"], roles: ["manager", "admin"] }],
  reports:    [{ actions: ["list", "show"], roles: ["manager", "scheduler", "admin"] }],
  team:       [{ actions: ["list", "show"], roles: ["manager", "admin"] },
               { actions: ["create", "edit", "delete"], roles: ["admin"] }],
};

export function canAccess(role: Role, resource: string, action: string): boolean {
  const resourcePerms = PERMISSIONS[resource];
  if (!resourcePerms) return role === "admin" || role === "owner";
  return resourcePerms.some(
    (p) => p.roles.includes(role) && p.actions.includes(action)
  );
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action, params: _params }) => {
    if (!resource) return { can: false };

    const session = await getSession();
    const role = ((session?.user as { role?: Role } | undefined)?.role ?? "owner") as Role;
    if (role === "owner") {
      return { can: true };
    }
    const allowed = canAccess(role, resource, action);
    return { can: allowed, reason: allowed ? undefined : `Role '${role}' cannot ${action} on ${resource}` };
  },
};

// ============================================================================
// Sidebar IA — product-led wedge (ADR-0014, 2026-05-20)
// ============================================================================
// Three groups:
//   primary  — always visible. Surfaces MIRA delivers today: Feed, Namespace,
//              Channels, Knowledge, Proposals.
//   secondary — shown below "More" divider. Operations + admin: Assets, CMMS,
//              Scan, Settings, Admin.
//   labs    — hidden unless NEXT_PUBLIC_LABS_ENABLED === "true". Mock-data
//              surfaces that hurt credibility on a paid product. Filtered out
//              in `sidebar.tsx`.
// ----------------------------------------------------------------------------
type NavGroup = "primary" | "secondary" | "labs";

const ALL_ROLES = ["technician", "manager", "scheduler", "admin", "operator", "owner"] as const;
const ADMIN_ROLES = ["manager", "admin", "owner"] as const;

export const NAV_ITEMS: ReadonlyArray<{
  key: string;
  label: string;
  icon: string;
  href: string;
  roles: readonly Role[];
  group: NavGroup;
}> = [
  // ── PRIMARY ────────────────────────────────────────────────────────────────
  { key: "feed",          label: "Feed",          icon: "Activity",      href: "/feed",          roles: [...ALL_ROLES], group: "primary" },
  { key: "namespace",     label: "Namespace",     icon: "Layers",        href: "/namespace",     roles: [...ALL_ROLES], group: "primary" },
  { key: "channels",      label: "Channels",      icon: "Radio",         href: "/channels",      roles: [...ADMIN_ROLES, "scheduler"], group: "primary" },
  { key: "knowledge",     label: "Knowledge",     icon: "BookOpen",      href: "/knowledge",     roles: [...ALL_ROLES], group: "primary" },
  { key: "graph",         label: "Graph",         icon: "Network",       href: "/graph",         roles: [...ALL_ROLES], group: "primary" },
  { key: "proposals",     label: "Proposals",     icon: "Sparkles",      href: "/proposals",     roles: [...ALL_ROLES], group: "primary" },

  // ── SECONDARY (collapsed under "More") ─────────────────────────────────────
  { key: "assets",        label: "Assets",        icon: "Wrench",        href: "/assets",        roles: [...ALL_ROLES], group: "secondary" },
  { key: "workorders",    label: "CMMS",          icon: "ClipboardList", href: "/workorders",    roles: [...ALL_ROLES], group: "secondary" },
  { key: "scan",          label: "Scan",          icon: "Cpu",           href: "/scan",          roles: [...ALL_ROLES], group: "secondary" },
  { key: "integrations",  label: "Settings",      icon: "Settings",      href: "/integrations",  roles: [...ADMIN_ROLES], group: "secondary" },
  { key: "admin",         label: "Admin",         icon: "Users",         href: "/admin",         roles: [...ADMIN_ROLES], group: "secondary" },
  { key: "admin-review",  label: "Review queue",  icon: "Inbox",         href: "/admin/review",  roles: ["admin", "owner"], group: "secondary" },

  // ── LABS (gated on NEXT_PUBLIC_LABS_ENABLED) ───────────────────────────────
  { key: "conversations", label: "Conversations", icon: "MessageSquare", href: "/conversations", roles: [...ALL_ROLES], group: "labs" },
  { key: "alerts",        label: "Alerts",        icon: "AlertTriangle", href: "/alerts",        roles: [...ALL_ROLES], group: "labs" },
  { key: "requests",      label: "Requests",      icon: "Inbox",         href: "/requests",      roles: [...ALL_ROLES], group: "labs" },
  { key: "parts",         label: "Parts",         icon: "Package",       href: "/parts",         roles: [...ALL_ROLES], group: "labs" },
  { key: "documents",     label: "Documents",     icon: "FileText",      href: "/documents",     roles: [...ALL_ROLES], group: "labs" },
  { key: "reports",       label: "Reports",       icon: "TrendingUp",    href: "/reports",       roles: [...ADMIN_ROLES, "scheduler"], group: "labs" },
  { key: "team",          label: "Team",          icon: "Users",         href: "/team",          roles: [...ADMIN_ROLES], group: "labs" },
] as const;

export function labsEnabled(): boolean {
  // Public env vars must use the NEXT_PUBLIC_ prefix to ship to the browser.
  // Default is OFF — mock-data surfaces stay hidden on production builds.
  return process.env.NEXT_PUBLIC_LABS_ENABLED === "true";
}

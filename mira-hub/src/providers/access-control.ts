"use client";

import type { AccessControlProvider } from "@refinedev/core";
import { getSession } from "next-auth/react";
import type { Capability } from "@/lib/capabilities";

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
  can: async ({ resource, action }) => {
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
  // When set, the link is shown only if the user's /api/me capabilities include
  // it. Same source of truth as the API guards (see src/lib/capabilities.ts).
  // Items with no capability are visible to every authenticated user. (#1932)
  capability?: Capability;
}> = [
  // ── PRIMARY ────────────────────────────────────────────────────────────────
  { key: "feed",          label: "Command Board", icon: "Activity",      href: "/feed",          roles: [...ALL_ROLES], group: "primary" },
  { key: "namespace",     label: "Namespace",     icon: "Layers",        href: "/namespace",     roles: [...ALL_ROLES], group: "primary" },
  { key: "command-center", label: "Command Center", icon: "Gauge",        href: "/command-center", roles: [...ADMIN_ROLES], group: "primary" },
  { key: "channels",      label: "Channels",      icon: "Radio",         href: "/channels",      roles: [...ADMIN_ROLES, "scheduler"], group: "primary" },
  // Knowledge is one section with sub-tabs: Manuals (KB) · Map (relationship
  // graph) · Suggestions (propose/verify queue). /graph and /proposals redirect in.
  { key: "knowledge",     label: "Knowledge",     icon: "BookOpen",      href: "/knowledge",     roles: [...ALL_ROLES], group: "primary" },

  // ── SECONDARY (collapsed under "More") ─────────────────────────────────────
  { key: "assets",        label: "Assets",        icon: "Wrench",        href: "/assets",        roles: [...ALL_ROLES], group: "secondary" },
  { key: "workorders",    label: "CMMS",          icon: "ClipboardList", href: "/workorders",    roles: [...ALL_ROLES], group: "secondary" },
  { key: "scan",          label: "Scan",          icon: "Cpu",           href: "/scan",          roles: [...ALL_ROLES], group: "secondary" },
  // Visual Focus Workspace (PR V2) — annotate evidence photos/prints; regions
  // persist to the shared visual ledger (migration 063).
  { key: "visual",        label: "Visual Workspace", icon: "Focus", href: "/visual", roles: [...ALL_ROLES], group: "secondary" },
  // PLC program import — upload an offline L5X / tag-CSV export → parser report +
  // proposed UNS paths → reviewable tag_mapping/kg_entity proposals (read-only, no PLC writes).
  // Dev/internal tool — hidden from end users.
  { key: "plc-import",    label: "PLC Import",    icon: "Upload",        href: "/plc-import",    roles: [...ADMIN_ROLES], group: "secondary", capability: "dev_tools.access" },
  // HubV3 contextualization workspace — import equipment sources / offline bundles,
  // review extracted signals + proposed UNS paths, promote to the KG (staged proposed).
  // Dev/internal tool — hidden from end users.
  { key: "ctx",           label: "Contextualization", icon: "Layers",    href: "/contextualization", roles: [...ADMIN_ROLES], group: "secondary", capability: "dev_tools.access" },
  // HubV3 contextualization Review Queue — approve imported (offline/Telegram)
  // context batches; approval publishes proposed → verified. Distinct from the
  // internal staff "Review queue" (admin-review) above.
  // Dev/internal tool — hidden from end users.
  { key: "ctx-review",    label: "Import Review", icon: "Network",       href: "/contextualization/review", roles: [...ADMIN_ROLES], group: "secondary", capability: "dev_tools.access" },
  // Customer-facing workspace admin. Visible to every authenticated tenant user
  // (workspace caps); the page itself shows only what each capability allows.
  { key: "settings",      label: "Settings",      icon: "Settings",      href: "/settings",      roles: [...ALL_ROLES], group: "secondary" },
  // Internal FactoryLM-staff review surface — gated to the platform allowlist.
  // A plain tenant owner no longer sees this (the #1932 bug); direct visits hit
  // a clean no-access page, not a raw 403.
  { key: "admin-review",  label: "Review queue",  icon: "Inbox",         href: "/settings/review-queue",  roles: ["admin", "owner"], group: "secondary", capability: "review_queue.read" },
  // Internal FactoryLM-staff account administration — cross-workspace signup
  // approval (approve / revoke / expire). Gated to platform admins
  // (platform.users.read ← status === "admin"); distinct from the tenant-scoped
  // /settings/users. URL stays /admin/users; only platform admins see this link.
  { key: "platform-users", label: "Platform accounts", icon: "Users",     href: "/admin/users",            roles: ["admin", "owner"], group: "secondary", capability: "platform.users.read" },

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

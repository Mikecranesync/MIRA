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
  "admin/users": [{ actions: ["list", "show", "create", "edit", "delete"], roles: ["admin"] }],
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

export const NAV_ITEMS = [
  // Primary nav — main surfaces, always visible to qualifying roles
  { key: "event-log",     label: "Event Log",     icon: "Activity",      href: "/event-log",     roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "primary" },
  { key: "conversations", label: "Conversations", icon: "MessageSquare", href: "/conversations", roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "primary" },
  { key: "actions",       label: "Actions",       icon: "Zap",           href: "/actions",       roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "primary" },
  { key: "alerts",        label: "Alerts",        icon: "AlertTriangle", href: "/alerts",        roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "primary" },
  { key: "knowledge",     label: "Knowledge",     icon: "BookOpen",      href: "/knowledge",     roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "primary" },
  { key: "assets",        label: "Assets",        icon: "Wrench",        href: "/assets",        roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "primary" },
  { key: "channels",      label: "Channels",      icon: "Radio",         href: "/channels",      roles: ["manager", "scheduler", "admin", "owner"],                           group: "primary" },
  { key: "integrations",  label: "Integrations",  icon: "Plug",          href: "/integrations",  roles: ["manager", "admin", "owner"],                                        group: "primary" },
  { key: "usage",         label: "Usage",         icon: "BarChart2",     href: "/usage",         roles: ["manager", "admin", "owner"],                                        group: "primary" },
  { key: "team",          label: "Team",          icon: "Users",         href: "/team",          roles: ["manager", "admin", "owner"],                                        group: "primary" },
  // Secondary nav — operations & admin surfaces, shown below divider
  { key: "workorders",    label: "Work Orders",   icon: "ClipboardList", href: "/workorders",    roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "secondary" },
  { key: "schedule",      label: "Schedule",      icon: "CalendarDays",  href: "/schedule",      roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "secondary" },
  { key: "requests",      label: "Requests",      icon: "Inbox",         href: "/requests",      roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "secondary" },
  { key: "parts",         label: "Parts",         icon: "Package",       href: "/parts",         roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "secondary" },
  { key: "documents",     label: "Documents",     icon: "FileText",      href: "/documents",     roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"], group: "secondary" },
  { key: "reports",       label: "Reports",       icon: "TrendingUp",    href: "/reports",       roles: ["manager", "scheduler", "admin", "owner"],                           group: "secondary" },
  { key: "admin/users",   label: "Admin",         icon: "Settings",      href: "/admin/users",   roles: ["admin", "owner"],                                                   group: "secondary" },
] as const;

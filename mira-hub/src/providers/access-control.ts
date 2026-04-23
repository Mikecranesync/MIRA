"use client";

import type { AccessControlProvider } from "@refinedev/core";

type Role = "technician" | "manager" | "scheduler" | "admin" | "operator";

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
  if (!resourcePerms) return role === "admin";
  return resourcePerms.some(
    (p) => p.roles.includes(role) && p.actions.includes(action)
  );
}

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action, params: _params }) => {
    if (!resource) return { can: false };

    let role: Role = "technician";
    if (typeof window !== "undefined") {
      const raw = localStorage.getItem("hub_user");
      if (raw) role = JSON.parse(raw).role as Role;
    }

    const allowed = canAccess(role, resource, action);
    return { can: allowed, reason: allowed ? undefined : `Role '${role}' cannot ${action} on ${resource}` };
  },
};

export const NAV_ITEMS = [
  { key: "feed",           label: "Activity Feed",  icon: "LayoutDashboard", href: "/feed",          roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "workorders",     label: "Work Orders",    icon: "ClipboardList",   href: "/workorders",    roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "assets",         label: "Assets",         icon: "Wrench",          href: "/assets",        roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "schedule",       label: "Schedule",       icon: "Calendar",        href: "/schedule",      roles: ["manager", "scheduler", "admin"] },
  { key: "requests",       label: "Requests",       icon: "MessageSquare",   href: "/requests",      roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "parts",          label: "Parts",          icon: "Package",         href: "/parts",         roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "documents",      label: "Documents",      icon: "FileText",        href: "/documents",     roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "reports",        label: "Reports",        icon: "BarChart2",       href: "/reports",       roles: ["manager", "scheduler", "admin"] },
  { key: "cmms",           label: "CMMS",           icon: "Database",        href: "/cmms",          roles: ["manager", "scheduler", "admin"] },
  { key: "team",           label: "Team",           icon: "Users",           href: "/team",          roles: ["manager", "admin"] },
  { key: "admin/users",    label: "Admin",          icon: "Settings",        href: "/admin/users",   roles: ["admin"] },
] as const;

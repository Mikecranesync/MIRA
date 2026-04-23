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
  { key: "event-log",      label: "Event Log",      icon: "Activity",        href: "/event-log",     roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "conversations",  label: "Conversations",  icon: "MessageSquare",   href: "/conversations", roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "actions",        label: "Actions",        icon: "Zap",             href: "/actions",       roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "alerts",         label: "Alerts",         icon: "AlertTriangle",   href: "/alerts",        roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "knowledge",      label: "Knowledge",      icon: "BookOpen",        href: "/knowledge",     roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "assets",         label: "Assets",         icon: "Wrench",          href: "/assets",        roles: ["technician", "manager", "scheduler", "admin", "operator"] },
  { key: "channels",       label: "Channels",       icon: "Radio",           href: "/channels",      roles: ["manager", "scheduler", "admin"] },
  { key: "integrations",   label: "Integrations",   icon: "Plug",            href: "/integrations",  roles: ["manager", "scheduler", "admin"] },
  { key: "usage",          label: "Usage",          icon: "BarChart2",       href: "/usage",         roles: ["manager", "admin"] },
  { key: "team",           label: "Team",           icon: "Users",           href: "/team",          roles: ["manager", "admin"] },
  { key: "admin/users",    label: "Admin",          icon: "Settings",        href: "/admin/users",   roles: ["admin"] },
] as const;

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

// Items shipped with a real NeonDB-backed API. The pages with only static
// mock data (actions, alerts, integrations, team, admin/users) are hidden
// from the customer nav until their backends ship — URLs still resolve if
// linked directly. This keeps the post-paywall surface honest.
export const NAV_ITEMS = [
  { key: "event-log",      label: "Event Log",      icon: "Activity",        href: "/event-log",     roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"] },
  { key: "conversations",  label: "Conversations",  icon: "MessageSquare",   href: "/conversations", roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"] },
  { key: "knowledge",      label: "Knowledge",      icon: "BookOpen",        href: "/knowledge",     roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"] },
  { key: "assets",         label: "Assets",         icon: "Wrench",          href: "/assets",        roles: ["technician", "manager", "scheduler", "admin", "operator", "owner"] },
  { key: "channels",       label: "Channels",       icon: "Radio",           href: "/channels",      roles: ["manager", "scheduler", "admin", "owner"] },
  { key: "usage",          label: "Usage",          icon: "BarChart2",       href: "/usage",         roles: ["manager", "admin", "owner"] },
] as const;

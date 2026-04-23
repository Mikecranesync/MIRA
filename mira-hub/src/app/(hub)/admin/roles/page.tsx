"use client";

import Link from "next/link";
import { Shield, Check, Minus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

type RoleKey = "admin" | "manager" | "scheduler" | "technician" | "operator";

type RoleDef = {
  key: RoleKey;
  label: string;
  description: string;
  userCount: number;
  badgeVariant: "red" | "inprogress" | "yellow" | "green" | "secondary";
  permissions: Partial<Record<PermKey, boolean>>;
};

type PermKey =
  | "view_dashboard" | "view_assets" | "view_workorders" | "view_documents" | "view_reports"
  | "create_workorders" | "edit_workorders" | "close_workorders"
  | "approve_requests" | "submit_requests"
  | "manage_pm_schedule" | "manage_parts"
  | "manage_users" | "manage_roles" | "view_admin";

const PERM_GROUPS: { label: string; perms: { key: PermKey; label: string }[] }[] = [
  {
    label: "General",
    perms: [
      { key: "view_dashboard",  label: "View Dashboard" },
      { key: "view_assets",     label: "View Assets" },
      { key: "view_workorders", label: "View Work Orders" },
      { key: "view_documents",  label: "View Documents" },
      { key: "view_reports",    label: "View Reports" },
    ],
  },
  {
    label: "Work Orders",
    perms: [
      { key: "create_workorders", label: "Create Work Orders" },
      { key: "edit_workorders",   label: "Edit Work Orders" },
      { key: "close_workorders",  label: "Close / Complete WOs" },
    ],
  },
  {
    label: "Requests",
    perms: [
      { key: "submit_requests",  label: "Submit Requests" },
      { key: "approve_requests", label: "Approve / Reject Requests" },
    ],
  },
  {
    label: "Maintenance",
    perms: [
      { key: "manage_pm_schedule", label: "Manage PM Schedule" },
      { key: "manage_parts",       label: "Manage Parts & Inventory" },
    ],
  },
  {
    label: "Administration",
    perms: [
      { key: "view_admin",    label: "Access Admin Panel" },
      { key: "manage_users",  label: "Manage Users" },
      { key: "manage_roles",  label: "Manage Roles" },
    ],
  },
];

const ROLES: RoleDef[] = [
  {
    key: "admin", label: "Admin", description: "Full access to all features, settings, and user management.",
    userCount: 1, badgeVariant: "red",
    permissions: { view_dashboard: true, view_assets: true, view_workorders: true, view_documents: true, view_reports: true,
      create_workorders: true, edit_workorders: true, close_workorders: true, submit_requests: true, approve_requests: true,
      manage_pm_schedule: true, manage_parts: true, view_admin: true, manage_users: true, manage_roles: true },
  },
  {
    key: "manager", label: "Manager", description: "Approves requests, reviews reports, assigns work orders.",
    userCount: 1, badgeVariant: "inprogress",
    permissions: { view_dashboard: true, view_assets: true, view_workorders: true, view_documents: true, view_reports: true,
      create_workorders: true, edit_workorders: true, close_workorders: true, submit_requests: true, approve_requests: true,
      manage_pm_schedule: true, manage_parts: true, view_admin: true, manage_users: false, manage_roles: false },
  },
  {
    key: "scheduler", label: "Scheduler", description: "Manages PM schedule, assigns techs, tracks parts.",
    userCount: 1, badgeVariant: "yellow",
    permissions: { view_dashboard: true, view_assets: true, view_workorders: true, view_documents: true, view_reports: true,
      create_workorders: true, edit_workorders: true, close_workorders: false, submit_requests: true, approve_requests: false,
      manage_pm_schedule: true, manage_parts: true, view_admin: false, manage_users: false, manage_roles: false },
  },
  {
    key: "technician", label: "Technician", description: "Executes work orders, logs parts usage, views assigned PMs.",
    userCount: 3, badgeVariant: "green",
    permissions: { view_dashboard: true, view_assets: true, view_workorders: true, view_documents: true, view_reports: false,
      create_workorders: false, edit_workorders: true, close_workorders: true, submit_requests: true, approve_requests: false,
      manage_pm_schedule: false, manage_parts: false, view_admin: false, manage_users: false, manage_roles: false },
  },
  {
    key: "operator", label: "Operator", description: "Submits maintenance requests, views own activity.",
    userCount: 1, badgeVariant: "secondary",
    permissions: { view_dashboard: true, view_assets: true, view_workorders: false, view_documents: false, view_reports: false,
      create_workorders: false, edit_workorders: false, close_workorders: false, submit_requests: true, approve_requests: false,
      manage_pm_schedule: false, manage_parts: false, view_admin: false, manage_users: false, manage_roles: false },
  },
];

export default function AdminRolesPage() {
  const t = useTranslations("admin");

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <h1 className="text-base font-semibold mb-2" style={{ color: "var(--foreground)" }}>{t("rolesTab")}</h1>
          {/* Sub-nav */}
          <div className="flex gap-4 text-xs border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <Link href="/admin/users" className="pb-1 border-b-2 border-transparent" style={{ color: "var(--foreground-muted)" }}>{t("usersTab")}</Link>
            <Link href="/admin/roles" className="font-semibold pb-1 border-b-2" style={{ color: "var(--brand-blue)", borderColor: "var(--brand-blue)" }}>{t("rolesTab")}</Link>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 space-y-4">
        {/* Role cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {ROLES.map(role => (
            <div key={role.key} className="card p-4">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ backgroundColor: "var(--surface-1)" }}>
                    <Shield className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
                  </div>
                  <div>
                    <Badge variant={role.badgeVariant} className="text-[10px]">{t(`roles.${role.key}`)}</Badge>
                  </div>
                </div>
                <span className="text-[11px] font-medium" style={{ color: "var(--foreground-subtle)" }}>
                  {role.userCount} user{role.userCount !== 1 ? "s" : ""}
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--foreground-muted)" }}>{role.description}</p>
            </div>
          ))}
        </div>

        {/* Permissions matrix — desktop */}
        <div className="hidden md:block card overflow-x-auto">
          <table className="w-full text-xs">
            <thead style={{ backgroundColor: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
              <tr>
                <th className="px-4 py-3 text-left font-semibold sticky left-0" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)", minWidth: 200 }}>Permission</th>
                {ROLES.map(r => (
                  <th key={r.key} className="px-3 py-3 text-center font-semibold" style={{ color: "var(--foreground-muted)", minWidth: 100 }}>
                    <Badge variant={r.badgeVariant} className="text-[10px]">{t(`roles.${r.key}`)}</Badge>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERM_GROUPS.map(group => (
                <>
                  <tr key={`group-${group.label}`}>
                    <td colSpan={ROLES.length + 1} className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider"
                      style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-subtle)" }}>
                      {group.label}
                    </td>
                  </tr>
                  {group.perms.map(perm => (
                    <tr key={perm.key} className="border-b hover:bg-[var(--surface-1)] transition-colors" style={{ borderColor: "var(--border)" }}>
                      <td className="px-4 py-2.5 sticky left-0" style={{ backgroundColor: "var(--surface-0)", color: "var(--foreground-muted)" }}>
                        {perm.label}
                      </td>
                      {ROLES.map(role => {
                        const has = role.permissions[perm.key] ?? false;
                        return (
                          <td key={role.key} className="px-3 py-2.5 text-center">
                            {has
                              ? <Check className="w-4 h-4 mx-auto" style={{ color: "#16A34A" }} />
                              : <Minus className="w-3 h-3 mx-auto" style={{ color: "var(--foreground-subtle)", opacity: 0.4 }} />
                            }
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile: per-role accordion */}
        <div className="md:hidden space-y-3">
          {ROLES.map(role => (
            <div key={role.key} className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <Badge variant={role.badgeVariant} className="text-[10px]">{t(`roles.${role.key}`)}</Badge>
                <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{role.description}</span>
              </div>
              <div className="space-y-1.5">
                {PERM_GROUPS.flatMap(g => g.perms).map(perm => {
                  const has = role.permissions[perm.key] ?? false;
                  return (
                    <div key={perm.key} className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{perm.label}</span>
                      {has
                        ? <Check className="w-3.5 h-3.5" style={{ color: "#16A34A" }} />
                        : <Minus className="w-3 h-3" style={{ color: "var(--foreground-subtle)", opacity: 0.4 }} />
                      }
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

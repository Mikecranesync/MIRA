"use client";

import { useState } from "react";
import Link from "next/link";
import { UserPlus, Search, MoreHorizontal, CheckCircle2, XCircle, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";

type User = {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "scheduler" | "technician" | "operator";
  dept: string;
  lastActive: string;
  active: boolean;
};

const ROLE_BADGE: Record<User["role"], "red" | "inprogress" | "secondary" | "green" | "yellow"> = {
  admin:      "red",
  manager:    "inprogress",
  scheduler:  "yellow",
  technician: "green",
  operator:   "secondary",
};

const INITIAL_USERS: User[] = [
  { id: "U-001", name: "Mike Harper",  email: "mike@factorylm.com",  role: "admin",      dept: "Maintenance", lastActive: "2026-04-22", active: true },
  { id: "U-002", name: "John Smith",   email: "john@factorylm.com",  role: "technician", dept: "Mechanical",  lastActive: "2026-04-22", active: true },
  { id: "U-003", name: "Sara Kim",     email: "sara@factorylm.com",  role: "operator",   dept: "Production",  lastActive: "2026-04-21", active: true },
  { id: "U-004", name: "Dave Torres",  email: "dave@factorylm.com",  role: "scheduler",  dept: "Maintenance", lastActive: "2026-04-20", active: true },
  { id: "U-005", name: "Lisa Wong",    email: "lisa@factorylm.com",  role: "manager",    dept: "Engineering", lastActive: "2026-04-19", active: true },
  { id: "U-006", name: "Ray Patel",    email: "ray@factorylm.com",   role: "technician", dept: "Electrical",  lastActive: "2026-04-18", active: true },
  { id: "U-007", name: "Tom Nguyen",   email: "tom@factorylm.com",   role: "technician", dept: "Mechanical",  lastActive: "2026-04-10", active: false },
];

export default function AdminUsersPage() {
  const t = useTranslations("admin");
  const tStatus = useTranslations("status");
  const tCommon = useTranslations("common");

  const [users, setUsers] = useState<User[]>(INITIAL_USERS);
  const [query, setQuery] = useState("");
  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<User["role"]>("technician");
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const visible = users.filter(u =>
    !query || u.name.toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase())
  );

  function toggleActive(id: string) {
    setUsers(prev => prev.map(u => u.id === id ? { ...u, active: !u.active } : u));
    setMenuOpen(null);
  }

  function sendInvite() {
    if (!inviteEmail) return;
    const newUser: User = {
      id: `U-${String(users.length + 1).padStart(3, "0")}`,
      name: inviteEmail.split("@")[0],
      email: inviteEmail,
      role: inviteRole,
      dept: "—",
      lastActive: "Invited",
      active: false,
    };
    setUsers(prev => [...prev, newUser]);
    setInviteEmail("");
    setShowInvite(false);
  }

  const activeCount = users.filter(u => u.active).length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("usersTab")}</h1>
              <div className="flex gap-3 mt-0.5">
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{activeCount} {tStatus("active")} · {users.length - activeCount} {tStatus("inactive")}</span>
              </div>
            </div>
            <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setShowInvite(true)}>
              <UserPlus className="w-3.5 h-3.5" />{t("inviteUser")}
            </Button>
          </div>

          {/* Role sub-nav */}
          <div className="flex gap-4 text-xs border-t pt-2" style={{ borderColor: "var(--border)" }}>
            <Link href="/admin/users" className="font-semibold pb-1 border-b-2" style={{ color: "var(--brand-blue)", borderColor: "var(--brand-blue)" }}>{t("usersTab")}</Link>
            <Link href="/admin/roles" className="pb-1 border-b-2 border-transparent" style={{ color: "var(--foreground-muted)" }}>{t("rolesTab")}</Link>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 space-y-4">
        {/* Invite form */}
        {showInvite && (
          <div className="card p-4 space-y-3">
            <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("inviteUser")}</h3>
            <Input placeholder={t("emailPlaceholder")} value={inviteEmail} onChange={e => setInviteEmail(e.target.value)} />
            <div className="flex gap-2">
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value as User["role"])}
                className="flex-1 text-xs px-3 py-2 rounded-lg border"
                style={{ borderColor: "var(--border)", backgroundColor: "var(--surface-0)", color: "var(--foreground)" }}>
                {(["technician","operator","scheduler","manager","admin"] as User["role"][]).map(r => (
                  <option key={r} value={r}>{t(`roles.${r}`)}</option>
                ))}
              </select>
              <Button size="sm" className="h-9" onClick={sendInvite}>{t("inviteUser")}</Button>
              <Button size="sm" variant="outline" className="h-9" onClick={() => setShowInvite(false)}>{tCommon("cancel")}</Button>
            </div>
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
          <Input placeholder={`${tCommon("search")}…`} value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
        </div>

        {/* Desktop table */}
        <div className="hidden md:block card overflow-hidden">
          <table className="w-full text-sm">
            <thead style={{ backgroundColor: "var(--surface-1)", borderBottom: "1px solid var(--border)" }}>
              <tr>
                {[t("tableHeaders.user"), t("tableHeaders.role"), t("tableHeaders.department"), t("tableHeaders.lastActive"), tCommon("status"), ""].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold" style={{ color: "var(--foreground-muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y" style={{ borderColor: "var(--border)" }}>
              {visible.map(u => (
                <tr key={u.id} className="hover:bg-[var(--surface-1)] transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                        style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
                        {u.name.split(" ").map(n => n[0]).join("")}
                      </div>
                      <div>
                        <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{u.name}</p>
                        <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{u.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={ROLE_BADGE[u.role]} className="text-[10px]">{t(`roles.${u.role}`)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>{u.dept}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: "var(--foreground-muted)" }}>{u.lastActive}</td>
                  <td className="px-4 py-3">
                    {u.active
                      ? <span className="flex items-center gap-1 text-xs" style={{ color: "#16A34A" }}><CheckCircle2 className="w-3.5 h-3.5" />{tStatus("active")}</span>
                      : <span className="flex items-center gap-1 text-xs" style={{ color: "#94A3B8" }}><XCircle className="w-3.5 h-3.5" />{tStatus("inactive")}</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <div className="relative">
                      <button onClick={() => setMenuOpen(menuOpen === u.id ? null : u.id)}
                        className="p-1 rounded" style={{ color: "var(--foreground-subtle)" }}>
                        <MoreHorizontal className="w-4 h-4" />
                      </button>
                      {menuOpen === u.id && (
                        <div className="absolute right-0 top-6 z-10 card py-1 w-36 shadow-lg">
                          <button onClick={() => toggleActive(u.id)}
                            className="w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--surface-1)] transition-colors"
                            style={{ color: u.active ? "#DC2626" : "#16A34A" }}>
                            {u.active ? tStatus("inactive") : tStatus("active")}
                          </button>
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden space-y-2">
          {visible.map(u => (
            <div key={u.id} className="card p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}>
                {u.name.split(" ").map(n => n[0]).join("")}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{u.name}</p>
                <p className="text-[11px] truncate" style={{ color: "var(--foreground-subtle)" }}>{u.email}</p>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant={ROLE_BADGE[u.role]} className="text-[10px]">{t(`roles.${u.role}`)}</Badge>
                  {!u.active && <span className="text-[10px]" style={{ color: "#94A3B8" }}>{tStatus("inactive")}</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

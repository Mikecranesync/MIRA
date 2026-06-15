"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, UserPlus } from "lucide-react";
import { API_BASE } from "@/lib/config";

type TeamMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
  joinedAt: string | null;
};

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  admin: { label: "Admin", color: "#EF4444", bg: "rgba(239,68,68,0.1)" },
  approved: { label: "Approved", color: "#22C55E", bg: "rgba(34,197,94,0.1)" },
  trial: { label: "Trial", color: "#60A5FA", bg: "rgba(96,165,250,0.1)" },
  pending: { label: "Pending", color: "#EAB308", bg: "rgba(234,179,8,0.1)" },
  expired: { label: "Expired", color: "#94A3B8", bg: "rgba(148,163,184,0.1)" },
};

export default function SettingsUsersPage() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // /api/team is tenant-scoped (WHERE tenant_id = $caller) — this lists only
    // the caller's own workspace members, never another tenant's. (#1932)
    fetch(`${API_BASE}/api/team/`)
      .then((r) => (r.ok ? r.json() : []))
      .then((d: TeamMember[]) => setMembers(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3 flex items-center justify-between">
          <div>
            <Link href="/settings" className="inline-flex items-center gap-1 text-xs mb-1" style={{ color: "var(--foreground-muted)" }}>
              <ChevronLeft className="w-3.5 h-3.5" /> Settings
            </Link>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Users</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {loading ? "" : `${members.length} in your workspace`}
            </p>
          </div>
          {/* Invite is not wired yet — disabled, honest about it (no fake success). */}
          <button
            type="button"
            disabled
            title="Inviting users is coming soon"
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md cursor-not-allowed opacity-60"
            style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
          >
            <UserPlus className="w-3.5 h-3.5" /> Invite (soon)
          </button>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-3xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--brand-blue)" }} />
          </div>
        ) : members.length === 0 ? (
          <p className="text-center py-8 text-sm" style={{ color: "var(--foreground-subtle)" }}>No users found.</p>
        ) : (
          <div className="space-y-2">
            {members.map((u) => {
              const cfg = STATUS_STYLE[u.status] ?? STATUS_STYLE.pending;
              return (
                <div key={u.id} className="card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                    {(u.name ?? u.email)[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>{u.name ?? u.email}</span>
                      {u.name && <span className="text-xs truncate" style={{ color: "var(--foreground-muted)" }}>{u.email}</span>}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="inline-flex items-center text-xs px-1.5 py-0.5 rounded" style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                        {cfg.label}
                      </span>
                      <span className="text-xs capitalize" style={{ color: "var(--foreground-subtle)" }}>{u.role}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-xs" style={{ color: "var(--foreground-subtle)" }}>
          Inviting members, changing roles, and deactivating accounts are coming soon.
        </p>
      </div>
    </div>
  );
}

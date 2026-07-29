"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { ChevronLeft, Loader2, Send, UserPlus } from "lucide-react";
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
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"technician" | "admin">("technician");
  const [inviteStatus, setInviteStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [inviteMessage, setInviteMessage] = useState("");

  const fetchMembers = useCallback(async () => {
    // /api/team is tenant-scoped (WHERE tenant_id = $caller) — this lists only
    // the caller's own workspace members, never another tenant's. (#1932)
    try {
      const r = await fetch(`${API_BASE}/api/team/`);
      const d = r.ok ? await r.json() : [];
      setMembers(Array.isArray(d) ? d : []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchMembers();
  }, [fetchMembers]);

  async function sendInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInviteStatus("sending");
    setInviteMessage("");
    try {
      const res = await fetch(`${API_BASE}/api/team/`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `Invite failed (${res.status})`);
      setInviteStatus("sent");
      setInviteMessage(`Invite sent to ${inviteEmail}.`);
      setInviteEmail("");
      await fetchMembers();
    } catch (err) {
      setInviteStatus("error");
      setInviteMessage((err as Error).message);
    }
  }

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
          <button
            type="button"
            onClick={() => setInviteOpen((v) => !v)}
            title="Invite a teammate to your workspace"
            className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors min-h-[44px]"
            style={{
              backgroundColor: "var(--surface-1)",
              color: "var(--foreground)",
              display: "inline-flex",
              alignItems: "center"
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-2)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = "var(--surface-1)";
            }}
          >
            <UserPlus className="w-3.5 h-3.5" /> Invite member
          </button>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-3xl mx-auto">
        {inviteOpen && (
          <form onSubmit={sendInvite} className="card mb-4 p-3 space-y-3" data-testid="team-invite-form">
            <div>
              <label htmlFor="team-invite-email" className="block text-xs font-medium mb-1" style={{ color: "var(--foreground-muted)" }}>
                Email
              </label>
              <input
                id="team-invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setInviteStatus("idle");
                  setInviteMessage("");
                }}
                placeholder="teammate@plant.com"
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--surface-0)",
                  borderColor: "var(--border)",
                  color: "var(--foreground)",
                }}
              />
            </div>
            <div>
              <label htmlFor="team-invite-role" className="block text-xs font-medium mb-1" style={{ color: "var(--foreground-muted)" }}>
                Role
              </label>
              <select
                id="team-invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "technician" | "admin")}
                className="w-full rounded-md border px-3 py-2 text-sm"
                style={{
                  backgroundColor: "var(--surface-0)",
                  borderColor: "var(--border)",
                  color: "var(--foreground)",
                }}
              >
                <option value="technician">Technician</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs min-h-[1rem]" style={{
                color: inviteStatus === "error" ? "#EF4444" : inviteStatus === "sent" ? "#22C55E" : "var(--foreground-subtle)",
              }}>
                {inviteMessage}
              </p>
              <button
                type="submit"
                disabled={inviteStatus === "sending"}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)" }}
              >
                {inviteStatus === "sending" ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Send className="w-3.5 h-3.5" />
                )}
                Send invite
              </button>
            </div>
          </form>
        )}
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
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, CheckCircle2, XCircle, ShieldCheck, Clock, Loader2, Zap } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import { API_BASE } from "@/lib/config";
import { NoAccess } from "@/components/ui/no-access";
import { useToast } from "@/providers/toast-provider";
import {
  formatCountLabel,
  confirmMessage,
  actionAriaLabel,
  type MutationStatus,
} from "./account-actions";

// Platform user administration (FactoryLM staff): the cross-workspace list with
// approve / revoke / expire actions used to gate new signups. Distinct from the
// read-only, tenant-scoped /settings/users (a customer's own workspace).
// Gated by platform.users.read (status==="admin") — both in the nav (the link
// only shows for platform admins) and the API. A non-admin who reaches this URL
// directly gets a clean no-access panel, not the old silent spinner (#1932).

type ApiUser = {
  id: string;
  name: string | null;
  email: string;
  status: string;
  plan: string | null;
  trialExpiresAt: string | null;
  role: string;
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; Icon: typeof CheckCircle2 }> = {
  admin:    { label: "Admin",    color: "#EF4444", bg: "rgba(239,68,68,0.1)",    Icon: ShieldCheck },
  approved: { label: "Approved", color: "#22C55E", bg: "rgba(34,197,94,0.1)",    Icon: CheckCircle2 },
  trial:    { label: "Trial",    color: "#60A5FA", bg: "rgba(96,165,250,0.1)",    Icon: Zap },
  pending:  { label: "Pending",  color: "#EAB308", bg: "rgba(234,179,8,0.1)",     Icon: Clock },
  expired:  { label: "Expired",  color: "#94A3B8", bg: "rgba(148,163,184,0.1)",   Icon: XCircle },
};

function daysLeft(isoDate: string): number {
  return Math.max(0, Math.ceil((new Date(isoDate).getTime() - Date.now()) / 86_400_000));
}

export default function AdminUsersPage() {
  const t = useTranslations("admin");
  const { toast } = useToast();
  const [users, setUsers] = useState<ApiUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const [query, setQuery] = useState("");
  const [updating, setUpdating] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [systemHidden, setSystemHidden] = useState(0);

  const loadUsers = useCallback(async () => {
    const qs = showSystem ? "?includeSystem=1" : "";
    const res = await fetch(`${API_BASE}/api/admin/users${qs}`);
    // Clean no-access instead of an indefinite spinner when the caller lacks
    // platform.users.read (#1932).
    if (res.status === 401 || res.status === 403) {
      setDenied(true);
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setLoading(false);
      return;
    }
    const { users: data, systemHidden: hidden } =
      await res.json() as { users: ApiUser[]; systemHidden?: number };
    setUsers(data);
    setSystemHidden(hidden ?? 0);
    setLoading(false);
  }, [showSystem]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function setStatus(id: string, status: MutationStatus, label: string) {
    // Destructive transitions (Revoke / Expire) confirm before mutating;
    // approval stays one-click. confirmMessage returns null for one-click.
    const prompt = confirmMessage(status, label);
    if (prompt && !window.confirm(prompt)) return;

    setUpdating(id);
    try {
      const res = await fetch(`/hub/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        // Surface the failure instead of silently reloading the old state.
        toast(
          `Couldn't update ${label} — ${res.status === 403 ? "not permitted" : "please try again"}`,
          "error",
        );
        return;
      }
      await loadUsers();
    } catch {
      toast(`Couldn't update ${label} — network error`, "error");
    } finally {
      setUpdating(null);
    }
  }

  if (denied) {
    return (
      <NoAccess
        title="User administration is admin-only"
        message="Managing and approving accounts across workspaces is limited to FactoryLM administrators."
      />
    );
  }

  const visible = users.filter(u =>
    !query || (u.name ?? u.email).toLowerCase().includes(query.toLowerCase()) || u.email.toLowerCase().includes(query.toLowerCase())
  );

  const pendingCount = users.filter(u => u.status === "pending").length;
  const countLabel = formatCountLabel({
    total: users.length,
    visible: visible.length,
    hasQuery: query.trim().length > 0,
    pending: pendingCount,
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("users.title")}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {/* Scope hint distinguishes this platform-wide approvals surface
                  from the tenant-scoped Settings → Users (#1945). */}
              Platform-wide account approvals · {countLabel}
            </p>
          </div>
          {(showSystem || systemHidden > 0) && (
            <button
              onClick={() => { setLoading(true); setShowSystem(s => !s); }}
              className="text-xs px-2.5 py-1 rounded-md transition-colors flex-shrink-0"
              style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
            >
              {showSystem
                ? "Hide system accounts"
                : `Show ${systemHidden} system account${systemHidden === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-4xl mx-auto">
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search users…"
            className="pl-9 h-9"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--brand-blue)" }} />
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map(user => {
              const cfg = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.pending;
              const StatusIcon = cfg.Icon;
              const label = user.name ?? user.email;
              return (
                <div key={user.id} className="card p-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                    {(user.name ?? user.email)[0].toUpperCase()}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                        {user.name ?? user.email}
                      </span>
                      {user.name && (
                        <span className="text-xs truncate" style={{ color: "var(--foreground-muted)" }}>{user.email}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded"
                        style={{ backgroundColor: cfg.bg, color: cfg.color }}>
                        <StatusIcon className="w-3 h-3" />
                        {cfg.label}
                      </span>
                      {user.status === "trial" && user.trialExpiresAt && (
                        <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                          {daysLeft(user.trialExpiresAt)}d left
                        </span>
                      )}
                      {user.plan && (
                        <span className="text-xs capitalize" style={{ color: "var(--foreground-subtle)" }}>{user.plan}</span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {updating === user.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" style={{ color: "var(--brand-blue)" }} />
                    ) : user.status !== "admin" && (
                      <>
                        {user.status !== "approved" && (
                          <button
                            onClick={() => setStatus(user.id, "approved", label)}
                            aria-label={actionAriaLabel("approved", label)}
                            className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
                            style={{ backgroundColor: "rgba(34,197,94,0.1)", color: "#22C55E" }}
                          >
                            Approve
                          </button>
                        )}
                        {user.status === "approved" && (
                          <button
                            onClick={() => setStatus(user.id, "pending", label)}
                            aria-label={actionAriaLabel("pending", label)}
                            className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
                            style={{ backgroundColor: "rgba(234,179,8,0.1)", color: "#EAB308" }}
                          >
                            Revoke
                          </button>
                        )}
                        {user.status === "trial" && (
                          <button
                            onClick={() => setStatus(user.id, "expired", label)}
                            aria-label={actionAriaLabel("expired", label)}
                            className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
                            style={{ backgroundColor: "rgba(148,163,184,0.1)", color: "#94A3B8" }}
                          >
                            Expire
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && !loading && (
              <p className="text-center py-8 text-sm" style={{ color: "var(--foreground-subtle)" }}>No users found</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

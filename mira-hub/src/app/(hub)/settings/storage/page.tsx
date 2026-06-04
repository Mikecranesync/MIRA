"use client";

import { useCallback, useEffect, useState } from "react";
import { HardDrive, RefreshCw, Trash2, Plus, X, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { API_BASE } from "@/lib/config";

// ── Types ─────────────────────────────────────────────────────────────────────

type ProviderKind = "google_drive" | "sharepoint" | "dropbox";

interface ConnectedProvider {
  id: string;
  provider: ProviderKind;
  display_name: string;
  root_path: string | null;
  sync_status: "idle" | "syncing" | "error";
  sync_error: string | null;
  file_count: number;
  last_synced_at: string | null;
}

interface ConnectForm {
  provider: ProviderKind;
  displayName: string;
  rootPath: string;
}

const PROVIDER_META: Record<ProviderKind, { label: string; icon: string; placeholder: string }> = {
  google_drive: { label: "Google Drive", icon: "🔵", placeholder: "e.g. /maintenance-docs or leave blank for root" },
  sharepoint: { label: "SharePoint / OneDrive", icon: "🟦", placeholder: "e.g. /sites/maintenance/Shared Documents" },
  dropbox: { label: "Dropbox", icon: "🟩", placeholder: "e.g. /maintenance or leave blank for root" },
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StorageSettingsPage() {
  const [providers, setProviders] = useState<ConnectedProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ConnectForm>({ provider: "google_drive", displayName: "", rootPath: "" });
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const loadProviders = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/storage/providers`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { providers: ConnectedProvider[] };
      setProviders(data.providers);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProviders(); }, [loadProviders]);

  async function handleConnect(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const displayName = form.displayName.trim();
    if (!displayName) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE}/api/storage/providers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          provider: form.provider,
          displayName,
          rootPath: form.rootPath.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setShowForm(false);
      setForm({ provider: "google_drive", displayName: "", rootPath: "" });
      await loadProviders();
      showToast("Provider connected");
    } catch (e) {
      showToast(`Connect failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect(id: string) {
    try {
      const res = await fetch(`${API_BASE}/api/storage/providers/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadProviders();
      showToast("Provider disconnected");
    } catch (e) {
      showToast(`Disconnect failed: ${(e as Error).message}`);
    }
  }

  async function handleSync(id: string) {
    setSyncing(id);
    try {
      const res = await fetch(`${API_BASE}/api/storage/providers/${id}/sync`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await loadProviders();
      showToast("Sync complete");
    } catch (e) {
      showToast(`Sync failed: ${(e as Error).message}`);
      await loadProviders();
    } finally {
      setSyncing(null);
    }
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 border-b px-4 py-3 md:px-6"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
              Connected Storage
            </h1>
            <p className="mt-0.5 text-xs" style={{ color: "var(--foreground-muted)" }}>
              Index Google Drive, SharePoint, or Dropbox folders — files stay in your provider, MIRA reads them.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm font-medium text-white"
            style={{ backgroundColor: "var(--brand-blue)" }}
          >
            <Plus className="h-4 w-4" />
            Connect provider
          </button>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 py-6 pb-24 md:px-6">
        {/* OAuth note */}
        <div
          className="mb-5 rounded-lg border px-4 py-3 text-xs"
          style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)", color: "var(--foreground-muted)" }}
        >
          <strong style={{ color: "var(--foreground)" }}>Before connecting:</strong> make sure you have authorized
          the OAuth integration for this provider in{" "}
          <a href="/integrations" className="underline" style={{ color: "var(--brand-blue)" }}>
            Integrations
          </a>{" "}
          so MIRA has a valid access token.
        </div>

        {/* Connect form */}
        {showForm && (
          <div
            className="mb-6 rounded-lg border p-5"
            style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
                Connect a storage provider
              </h2>
              <button type="button" onClick={() => setShowForm(false)}>
                <X className="h-4 w-4" style={{ color: "var(--foreground-muted)" }} />
              </button>
            </div>
            <form onSubmit={(e) => void handleConnect(e)} className="space-y-4">
              {/* Provider select */}
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                  Provider
                </label>
                <div className="flex gap-2">
                  {(["google_drive", "sharepoint", "dropbox"] as ProviderKind[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, provider: p }))}
                      className="flex flex-1 flex-col items-center gap-1 rounded-lg border p-3 text-xs transition-colors"
                      style={{
                        borderColor: form.provider === p ? "var(--brand-blue)" : "var(--border)",
                        backgroundColor: form.provider === p ? "var(--surface-1)" : "transparent",
                        color: "var(--foreground)",
                      }}
                    >
                      <span className="text-xl">{PROVIDER_META[p].icon}</span>
                      <span className="font-medium">{PROVIDER_META[p].label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Display name */}
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                  Display name <span className="text-red-500">*</span>
                </label>
                <input
                  required
                  value={form.displayName}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                  placeholder={`e.g. ${PROVIDER_META[form.provider].label} — OEM Manuals`}
                  className="w-full rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface-1)",
                    color: "var(--foreground)",
                  }}
                />
              </div>

              {/* Root path */}
              <div>
                <label className="mb-1 block text-xs font-medium" style={{ color: "var(--foreground-muted)" }}>
                  Root folder path (optional)
                </label>
                <input
                  value={form.rootPath}
                  onChange={(e) => setForm((f) => ({ ...f, rootPath: e.target.value }))}
                  placeholder={PROVIDER_META[form.provider].placeholder}
                  className="w-full rounded border px-3 py-2 text-sm"
                  style={{
                    borderColor: "var(--border)",
                    backgroundColor: "var(--surface-1)",
                    color: "var(--foreground)",
                  }}
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="rounded px-4 py-1.5 text-sm"
                  style={{ color: "var(--foreground-muted)" }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !form.displayName.trim()}
                  className="flex items-center gap-1.5 rounded px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  style={{ backgroundColor: "var(--brand-blue)" }}
                >
                  {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Connect
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Providers list */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin" style={{ color: "var(--foreground-muted)" }} />
          </div>
        ) : error ? (
          <div className="py-6 text-center text-sm text-red-500">{error}</div>
        ) : providers.length === 0 ? (
          <EmptyState onConnect={() => setShowForm(true)} />
        ) : (
          <div className="space-y-3">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                isSyncing={syncing === p.id}
                onSync={() => void handleSync(p.id)}
                onDisconnect={() => void handleDisconnect(p.id)}
              />
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded bg-slate-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}

// ── ProviderCard ──────────────────────────────────────────────────────────────

function ProviderCard({
  provider, isSyncing, onSync, onDisconnect,
}: {
  provider: ConnectedProvider;
  isSyncing: boolean;
  onSync: () => void;
  onDisconnect: () => void;
}) {
  const meta = PROVIDER_META[provider.provider];

  const StatusIcon =
    provider.sync_status === "error" ? AlertCircle :
    provider.sync_status === "syncing" ? Loader2 : CheckCircle2;

  const statusColor =
    provider.sync_status === "error" ? "#DC2626" :
    provider.sync_status === "syncing" ? "#2563EB" : "#16A34A";

  const statusLabel =
    provider.sync_status === "error" ? "Sync error" :
    provider.sync_status === "syncing" ? "Syncing…" : "Connected";

  return (
    <div
      className="rounded-lg border p-4"
      style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl text-xl"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          {meta.icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
              {provider.display_name}
            </span>
            <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: statusColor }}>
              <StatusIcon className={`h-3 w-3 ${provider.sync_status === "syncing" ? "animate-spin" : ""}`} />
              {statusLabel}
            </span>
          </div>
          <p className="mt-0.5 text-xs" style={{ color: "var(--foreground-muted)" }}>
            {meta.label}
            {provider.root_path ? ` · ${provider.root_path}` : " · (root)"}
          </p>
          {provider.sync_error && (
            <p className="mt-1 text-[11px] text-red-500">{provider.sync_error}</p>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg p-2" style={{ backgroundColor: "var(--surface-1)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
            {provider.file_count}
          </div>
          <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>
            Files indexed
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ backgroundColor: "var(--surface-1)" }}>
          <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>
            {provider.last_synced_at
              ? new Date(provider.last_synced_at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
              : "Never"}
          </div>
          <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>
            Last synced
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onSync}
          disabled={isSyncing || provider.sync_status === "syncing"}
          className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
          style={{ borderColor: "var(--border)", color: "var(--foreground)", backgroundColor: "var(--surface-1)" }}
        >
          {isSyncing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Sync now
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          className="flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors"
          style={{ borderColor: "var(--border)", color: "#DC2626" }}
        >
          <Trash2 className="h-3 w-3" />
          Disconnect
        </button>
      </div>
    </div>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────

function EmptyState({ onConnect }: { onConnect: () => void }) {
  return (
    <div
      className="flex flex-col items-center rounded-xl border-2 border-dashed py-16 text-center"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl"
        style={{ backgroundColor: "var(--surface-1)" }}
      >
        <HardDrive className="h-7 w-7" style={{ color: "var(--foreground-muted)" }} />
      </div>
      <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
        No storage connected
      </p>
      <p className="mt-1 max-w-xs text-xs" style={{ color: "var(--foreground-muted)" }}>
        Connect Google Drive, SharePoint, or Dropbox so MIRA can index your OEM manuals and wiring diagrams.
      </p>
      <button
        type="button"
        onClick={onConnect}
        className="mt-5 flex items-center gap-1.5 rounded px-4 py-2 text-sm font-medium text-white"
        style={{ backgroundColor: "var(--brand-blue)" }}
      >
        <Plus className="h-4 w-4" />
        Connect your first provider
      </button>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

// ---------------------------------------------------------------------------
// Types — mirror the backend response shapes exactly
// ---------------------------------------------------------------------------
type ApiKey = {
  id: string;
  label: string | null;
  enabled: boolean;
  created_at: string;
  last_used_at: string | null;
};

type RevealedKey = {
  key: string;
  id: string;
  label: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [labelInput, setLabelInput] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [revealed, setRevealed] = useState<RevealedKey | null>(null);
  const [copied, setCopied] = useState(false);

  const [revokingId, setRevokingId] = useState<string | null>(null);

  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchKeys = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const res = await fetch("/api/i3x-keys");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { keys: ApiKey[] };
      setKeys(data.keys ?? []);
    } catch {
      setListError("Failed to load API keys. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchKeys();
  }, [fetchKeys]);

  async function handleCreate() {
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/i3x-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: labelInput.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as RevealedKey;
      setRevealed(data);
      setLabelInput("");
      await fetchKeys();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create key");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("Revoke this API key? Any integrations using it will stop working immediately.")) return;
    setRevokingId(id);
    try {
      const res = await fetch(`/api/i3x-keys/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      await fetchKeys();
    } finally {
      setRevokingId(null);
    }
  }

  async function handleCopy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.key);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard blocked (e.g. in test; silently ignore)
    }
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Sticky header */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="px-4 md:px-6 py-3">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 text-xs mb-1"
            style={{ color: "var(--foreground-muted)" }}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Settings
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            API Keys
          </h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            Programmatic access for the i3X API.
          </p>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 max-w-2xl mx-auto space-y-4">

        {/* One-time reveal panel */}
        {revealed && (
          <div
            className="card p-4 border"
            style={{
              borderColor: "var(--warning, #ca8a04)",
              backgroundColor: "var(--warning-surface, #fefce8)",
            }}
          >
            <p className="text-xs font-semibold mb-1" style={{ color: "var(--warning-fg, #854d0e)" }}>
              New key created{revealed.label ? ` — ${revealed.label}` : ""}
            </p>
            <p className="text-xs mb-3" style={{ color: "var(--warning-fg, #854d0e)" }}>
              Copy this key now — it will not be shown again.
            </p>
            <div
              className="flex items-center gap-2 rounded p-2 mb-3 overflow-x-auto"
              style={{ backgroundColor: "var(--surface-1)", borderColor: "var(--border)" }}
            >
              <code
                className="text-xs break-all select-all flex-1"
                style={{ color: "var(--foreground)", fontFamily: "monospace" }}
              >
                {revealed.key}
              </code>
              <button
                onClick={handleCopy}
                className="flex-shrink-0 text-xs px-3 rounded font-medium transition-colors"
                style={{
                  minHeight: "44px",
                  backgroundColor: copied ? "var(--success, #16a34a)" : "var(--brand-blue, #2563eb)",
                  color: "#fff",
                }}
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>
            <button
              onClick={() => { setRevealed(null); setCopied(false); }}
              className="text-xs"
              style={{ color: "var(--foreground-muted)" }}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Create key form */}
        <div className="card p-4">
          <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>
            Create a new key
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Label (optional)"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !creating) void handleCreate(); }}
              disabled={creating}
              className="flex-1 rounded border px-3 text-sm"
              style={{
                minHeight: "44px",
                borderColor: "var(--border)",
                backgroundColor: "var(--surface-1)",
                color: "var(--foreground)",
              }}
            />
            <button
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex-shrink-0 rounded px-4 text-sm font-medium transition-opacity"
              style={{
                minHeight: "44px",
                backgroundColor: "var(--brand-blue, #2563eb)",
                color: "#fff",
                opacity: creating ? 0.6 : 1,
              }}
            >
              {creating ? "Creating…" : "Create key"}
            </button>
          </div>
          {createError && (
            <p className="text-xs mt-2" style={{ color: "var(--error, #dc2626)" }}>
              {createError}
            </p>
          )}
        </div>

        {/* Key list */}
        {loading ? (
          <p className="text-xs py-2" style={{ color: "var(--foreground-muted)" }}>
            Loading…
          </p>
        ) : listError ? (
          <p className="text-xs py-2" style={{ color: "var(--error, #dc2626)" }}>
            {listError}
          </p>
        ) : keys.length === 0 ? (
          <div className="card p-6 text-center">
            <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
              No API keys yet
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--foreground-muted)" }}>
              Create a key above to authenticate programmatic i3X API calls.
            </p>
          </div>
        ) : (
          <div className="card divide-y" style={{ borderColor: "var(--border)" }}>
            {keys.map((k) => (
              <div key={k.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>
                    {k.label ?? <span style={{ color: "var(--foreground-subtle)" }}>(unlabeled)</span>}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                    Created {fmtDate(k.created_at)}
                    {" · Last used: "}
                    {k.last_used_at ? fmtDate(k.last_used_at) : "never"}
                  </p>
                </div>
                <button
                  onClick={() => void handleRevoke(k.id)}
                  disabled={revokingId === k.id}
                  className="flex-shrink-0 text-xs px-3 rounded font-medium transition-opacity border"
                  style={{
                    minHeight: "44px",
                    borderColor: "var(--error, #dc2626)",
                    color: "var(--error, #dc2626)",
                    backgroundColor: "transparent",
                    opacity: revokingId === k.id ? 0.5 : 1,
                  }}
                >
                  {revokingId === k.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

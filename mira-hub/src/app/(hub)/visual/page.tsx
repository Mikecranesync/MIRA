"use client";

// Visual Focus Workspace (PR V2) — session list + create.
// Styling: globals.css tokens only (muted-normal, accent-for-action).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { API_BASE } from "@/lib/config";

interface VisualSessionSummary {
  session_id: string;
  title: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function VisualSessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<VisualSessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/visual/sessions/`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { sessions: VisualSessionSummary[] };
      setSessions(body.sessions ?? []);
    } catch {
      setError("Could not load sessions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createSession() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/visual/sessions/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { session: VisualSessionSummary };
      router.push(`/visual/${body.session.session_id}`);
    } catch {
      setError("Could not create a session.");
      setCreating(false);
    }
  }

  return (
    <div style={{ padding: "1.5rem", maxWidth: 960, margin: "0 auto" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "1rem",
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Visual Workspace</h1>
          <p style={{ color: "var(--foreground-muted)", fontSize: "0.875rem" }}>
            Annotate evidence photos and prints. Regions are saved to the shared visual ledger.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void createSession()}
          disabled={creating}
          style={{
            background: "var(--brand-blue)",
            color: "var(--surface-0)",
            border: "none",
            borderRadius: 6,
            padding: "0.5rem 1rem",
            fontSize: "0.875rem",
            fontWeight: 600,
            cursor: creating ? "default" : "pointer",
            opacity: creating ? 0.6 : 1,
          }}
        >
          {creating ? "Creating…" : "New session"}
        </button>
      </div>

      {error && (
        <p role="alert" style={{ color: "var(--status-red)" }}>
          {error}
        </p>
      )}
      {loading ? (
        <p style={{ color: "var(--foreground-subtle)" }}>Loading…</p>
      ) : sessions.length === 0 ? (
        <div
          style={{
            border: "1px dashed var(--border-default)",
            borderRadius: 8,
            padding: "2rem",
            textAlign: "center",
            color: "var(--foreground-muted)",
          }}
        >
          No visual sessions yet. Create one to start annotating.
        </div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {sessions.map((s) => (
            <li key={s.session_id}>
              <button
                type="button"
                onClick={() => router.push(`/visual/${s.session_id}`)}
                style={{
                  display: "flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "space-between",
                  textAlign: "left",
                  background: "var(--surface-1)",
                  border: "1px solid var(--border-default)",
                  borderRadius: 8,
                  padding: "0.75rem 1rem",
                  marginBottom: "0.5rem",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 500 }}>
                  {s.title || `Session ${s.session_id.slice(0, 8)}`}
                </span>
                <span style={{ color: "var(--foreground-subtle)", fontSize: "0.75rem" }}>
                  {s.status} · {new Date(s.updated_at).toLocaleString()}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

"use client";

// Equipment Notebooks — home. "Ask your equipment, not the whole internet."
// Machine-first: the primary object is a bounded notebook per physical asset.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Camera, FilePlus2, Search, FileText, Clock } from "lucide-react";
import { API_BASE } from "@/lib/config";

type Notebook = {
  id: string;
  displayName: string;
  manufacturer: string | null;
  model: string | null;
  locationLabel: string | null;
  identityStatus: string;
  sourceCount: number;
  lastOpenedAt: string | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function EquipmentNotebooksPage() {
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/`, { cache: "no-store" });
      if (!res.ok) throw new Error(`load_${res.status}`);
      const data = await res.json();
      setNotebooks(data.notebooks ?? []);
    } catch {
      setError("Couldn't load your notebooks.");
      setNotebooks([]);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load (codebase precedent: namespace/page.tsx)
    void load();
  }, [load]);

  const createNotebook = useCallback(async () => {
    const name = window.prompt("Name this equipment (e.g. Conveyor 4)")?.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName: name }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      window.location.href = `${API_BASE}/equipment/${data.notebook.id}`;
    } catch {
      setError("Couldn't create the notebook.");
      setCreating(false);
    }
  }, []);

  const filtered = (notebooks ?? []).filter((n) => {
    const hay = `${n.displayName} ${n.manufacturer ?? ""} ${n.model ?? ""} ${n.locationLabel ?? ""}`.toLowerCase();
    return hay.includes(query.toLowerCase());
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6" style={{ color: "var(--foreground)" }}>
      <header className="mb-5">
        <h1 className="text-xl font-semibold" style={{ color: "var(--foreground)" }}>
          Equipment Notebooks
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--foreground-muted)" }}>
          One notebook per machine. Ask questions grounded only in that machine&apos;s sources.
        </p>
      </header>

      <div className="mb-4 flex gap-2">
        <Link
          href={`${API_BASE}/equipment/scan`}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium"
          style={{ background: "var(--brand-blue)", color: "white" }}
        >
          <Camera size={18} aria-hidden /> Scan machine
        </Link>
        <button
          onClick={createNotebook}
          disabled={creating}
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-medium"
          style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
        >
          <FilePlus2 size={18} aria-hidden /> New notebook
        </button>
      </div>

      <div
        className="mb-4 flex items-center gap-2 rounded-lg px-3 py-2"
        style={{ border: "1px solid var(--border)" }}
      >
        <Search size={16} aria-hidden style={{ color: "var(--foreground-subtle)" }} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search equipment"
          className="w-full bg-transparent text-sm outline-none"
          style={{ color: "var(--foreground)" }}
          aria-label="Search equipment notebooks"
        />
      </div>

      {error && (
        <p className="mb-3 text-sm" style={{ color: "var(--status-red)" }} role="alert">
          {error}
        </p>
      )}

      {notebooks === null ? (
        <p className="py-10 text-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
          Loading…
        </p>
      ) : filtered.length === 0 ? (
        <div
          className="rounded-xl px-6 py-12 text-center"
          style={{ border: "1px dashed var(--border)", background: "var(--surface-1)" }}
        >
          <h2 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Ask your equipment, not the whole internet.
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm" style={{ color: "var(--foreground-muted)" }}>
            Scan a nameplate or create a notebook, add its manual, and ask a question.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link
              href={`${API_BASE}/equipment/scan`}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ background: "var(--brand-blue)", color: "white" }}
            >
              Scan a machine
            </Link>
            <button
              onClick={createNotebook}
              className="rounded-lg px-4 py-2 text-sm font-medium"
              style={{ border: "1px solid var(--border)", color: "var(--foreground)" }}
            >
              Create notebook
            </button>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((n) => (
            <li key={n.id}>
              <Link
                href={`${API_BASE}/equipment/${n.id}`}
                className="block rounded-lg p-3"
                style={{ border: "1px solid var(--border)", background: "var(--surface-1)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium" style={{ color: "var(--foreground)" }}>
                    {n.displayName}
                  </span>
                  {n.identityStatus === "user_confirmed" || n.identityStatus === "verified" ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ background: "var(--status-green-bg)", color: "var(--status-green-ink)" }}
                    >
                      Confirmed
                    </span>
                  ) : n.identityStatus === "candidate" ? (
                    <span
                      className="rounded px-1.5 py-0.5 text-[11px]"
                      style={{ background: "var(--status-yellow-bg)", color: "var(--foreground)" }}
                    >
                      Candidate
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                  {(n.manufacturer || n.model) && (
                    <span>{[n.manufacturer, n.model].filter(Boolean).join(" ")}</span>
                  )}
                  {n.locationLabel && <span>{n.locationLabel}</span>}
                  <span className="inline-flex items-center gap-1">
                    <FileText size={12} aria-hidden /> {n.sourceCount} {n.sourceCount === 1 ? "source" : "sources"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Clock size={12} aria-hidden /> {timeAgo(n.lastOpenedAt)}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

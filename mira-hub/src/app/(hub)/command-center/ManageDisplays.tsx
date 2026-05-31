"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, Trash2, X, Save, Power } from "lucide-react";
import { API_BASE } from "@/lib/config";

/**
 * Command Center display-registry CRUD drawer (Phase 2).
 * Lists display_endpoints, lets a manager/admin add/edit/delete a watchable display
 * by host/IP. Read-only product: this records WHERE to watch, never a control endpoint.
 * After a change, the on-prem proxy allowlist must be regenerated (see banner).
 */

interface Display {
  id: string;
  uns_path: string | null;
  equipment_id: string | null;
  display_type: string;
  scheme: string;
  host: string;
  port: number | null;
  path: string;
  label: string | null;
  enabled: boolean;
}

type Draft = Partial<Display>;

const EMPTY: Draft = {
  uns_path: "", display_type: "web_iframe", scheme: "http", host: "", port: undefined, path: "/", label: "", enabled: true,
};

export function ManageDisplays({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<Display[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null); // null = not editing; {} = new; {id} = edit
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/command-center/displays`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setRows(json.displays ?? []);
      setErr(null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setErr(null);
    try {
      const isEdit = Boolean(draft.id);
      const url = isEdit
        ? `${API_BASE}/api/command-center/displays/${draft.id}`
        : `${API_BASE}/api/command-center/displays`;
      const res = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setDraft(null);
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this display registration? (The HMI itself is untouched.)")) return;
    try {
      const res = await fetch(`${API_BASE}/api/command-center/displays/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <div className="flex h-full w-full max-w-[560px] flex-col bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#e2e8f0" }}>
          <h2 className="text-base font-bold">Manage displays</h2>
          <button onClick={onClose} className="rounded p-1 hover:bg-black/5"><X className="h-4 w-4" /></button>
        </div>

        {/* Allowlist regen reminder — the proxy only reaches registered hosts. */}
        <p className="border-b bg-amber-50 px-5 py-2 text-[11px] text-amber-800" style={{ borderColor: "#fde68a" }}>
          After adding or editing a host, regenerate the on-prem proxy allowlist
          (<code>mira-proxy/gen_allowlist.py</code>) so it becomes reachable through the cloud Hub.
        </p>

        {err && <p className="px-5 py-2 text-sm text-red-600">{err}</p>}

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="px-5 py-4 text-sm text-slate-500">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No displays registered yet.</p>
          ) : (
            <ul>
              {rows.map((r) => (
                <li key={r.id} className="flex items-center justify-between border-b px-5 py-2.5 text-sm" style={{ borderColor: "#f1f5f9" }}>
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      {r.label || r.host}{!r.enabled && <span className="ml-2 text-[10px] text-slate-400">(disabled)</span>}
                    </p>
                    <p className="truncate font-mono text-[11px] text-slate-400">
                      {r.scheme}://{r.host}{r.port ? `:${r.port}` : ""}{r.path} · {r.display_type}
                    </p>
                    {r.uns_path && <p className="truncate font-mono text-[10px] text-slate-400">{r.uns_path}</p>}
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button onClick={() => setDraft({ ...r, port: r.port ?? undefined })}
                      className="rounded px-2 py-1 text-xs hover:bg-black/5">Edit</button>
                    <button onClick={() => remove(r.id)} className="rounded p-1 text-red-500 hover:bg-red-50">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Editor */}
        {draft ? (
          <div className="border-t px-5 py-3" style={{ borderColor: "#e2e8f0" }}>
            <p className="mb-2 text-xs font-semibold text-slate-600">{draft.id ? "Edit display" : "New display"}</p>
            <div className="grid grid-cols-2 gap-2">
              <Field label="UNS path" value={draft.uns_path ?? ""} mono
                onChange={(v) => setDraft({ ...draft, uns_path: v })} placeholder="enterprise.site.line.asset" full />
              <Field label="Label" value={draft.label ?? ""} onChange={(v) => setDraft({ ...draft, label: v })} placeholder="Conveyor 1 HMI" />
              <Select label="Type" value={draft.display_type ?? "web_iframe"}
                onChange={(v) => setDraft({ ...draft, display_type: v })} options={["web_iframe", "nodered"]} />
              <Select label="Scheme" value={draft.scheme ?? "http"}
                onChange={(v) => setDraft({ ...draft, scheme: v })} options={["http", "https"]} />
              <Field label="Host / IP" value={draft.host ?? ""} mono onChange={(v) => setDraft({ ...draft, host: v })} placeholder="192.168.1.12" />
              <Field label="Port" value={draft.port != null ? String(draft.port) : ""} mono
                onChange={(v) => setDraft({ ...draft, port: v ? Number(v) : undefined })} placeholder="1880" />
              <Field label="Path" value={draft.path ?? "/"} mono onChange={(v) => setDraft({ ...draft, path: v })} placeholder="/dashboard/x" full />
            </div>
            <label className="mt-2 flex items-center gap-1.5 text-xs">
              <input type="checkbox" checked={draft.enabled !== false}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} />
              <Power className="h-3 w-3" /> Enabled
            </label>
            <div className="mt-3 flex gap-2">
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50">
                <Save className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => setDraft(null)} className="rounded-md px-3 py-1.5 text-xs hover:bg-black/5">Cancel</button>
            </div>
          </div>
        ) : (
          <div className="border-t px-5 py-3" style={{ borderColor: "#e2e8f0" }}>
            <button onClick={() => setDraft({ ...EMPTY })}
              className="flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700">
              <Plus className="h-3.5 w-3.5" /> Add display
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, mono, full }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean; full?: boolean;
}) {
  return (
    <label className={`flex flex-col gap-0.5 text-[11px] text-slate-500 ${full ? "col-span-2" : ""}`}>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className={`rounded border px-2 py-1 text-sm text-slate-900 ${mono ? "font-mono" : ""}`}
        style={{ borderColor: "#cbd5e1" }} />
    </label>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: string[];
}) {
  return (
    <label className="flex flex-col gap-0.5 text-[11px] text-slate-500">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded border px-2 py-1 text-sm text-slate-900" style={{ borderColor: "#cbd5e1" }}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

"use client";

import { useMemo, useState } from "react";
import { X, Loader2, MonitorPlay, Link2 } from "lucide-react";
import { API_BASE } from "@/lib/config";

// Minimal node shape needed to pick a UNS target. Mirrors CCNode.
interface PickNode {
  name: string;
  unsPath: string | null;
  children: PickNode[];
}

interface FlatNode {
  unsPath: string;
  name: string;
}

function flattenPickable(nodes: PickNode[]): FlatNode[] {
  const out: FlatNode[] = [];
  const walk = (ns: PickNode[]) => {
    for (const n of ns) {
      if (n.unsPath) out.push({ unsPath: n.unsPath, name: n.name });
      walk(n.children);
    }
  };
  walk(nodes);
  out.sort((a, b) => a.unsPath.localeCompare(b.unsPath));
  return out;
}

const DISPLAY_TYPES = [
  { value: "web_iframe", label: "Web / HMI page (Ignition Perspective, panel page)" },
  { value: "nodered", label: "Node-RED dashboard" },
  { value: "signals", label: "Hub live-signal panel" },
  { value: "vnc", label: "VNC (noVNC bridge)" },
];

/**
 * Onboarding modal — connect/lock a live display to a namespace node.
 * POSTs to /api/command-center/display (register). On success the parent
 * refreshes the tree so the new display appears under "Live Views".
 *
 * conv_simple preset fills the Ignition Perspective path + label; the operator
 * supplies the reachable host:port (their origin-root XFO-stripping proxy — see
 * db/seeds/command_center_conveyor.sql for the dev/Tailscale values).
 */
export function ConnectDisplayModal({
  nodes,
  onClose,
  onRegistered,
}: {
  nodes: PickNode[];
  onClose: () => void;
  onRegistered: (unsPath: string) => void;
}) {
  const pickable = useMemo(() => flattenPickable(nodes), [nodes]);

  const [unsPath, setUnsPath] = useState(
    pickable.find((n) => n.unsPath.includes("conv_simple"))?.unsPath ?? pickable[0]?.unsPath ?? "",
  );
  const [label, setLabel] = useState("");
  const [displayType, setDisplayType] = useState("web_iframe");
  const [scheme, setScheme] = useState("http");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [path, setPath] = useState("/");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyConvSimplePreset = () => {
    setDisplayType("web_iframe");
    setPath("/data/perspective/client/ConvSimpleLive");
    setLabel("Conv Simple — Live");
    const cs = pickable.find((n) => n.unsPath.includes("conv_simple"));
    if (cs) setUnsPath(cs.unsPath);
  };

  const submit = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/command-center/display/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unsPath,
          label: label.trim() || undefined,
          displayType,
          scheme,
          host: host.trim(),
          port: port.trim() === "" ? undefined : port.trim(),
          path: path.trim() || "/",
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? `Register failed (${res.status})`);
        return;
      }
      onRegistered(unsPath);
      onClose();
    } catch {
      setError("Network error — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit = unsPath !== "" && host.trim() !== "" && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Connect live view">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold">Connect a live view</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {pickable.length === 0 ? (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
              No namespace nodes yet. Build the namespace first, then connect a display to a node.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500">
                  Link an Ignition / Node-RED / HMI screen to a namespace node. It opens in a new
                  tab and persists until you change it.
                </p>
                <button
                  type="button"
                  onClick={applyConvSimplePreset}
                  className="flex-shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                  style={{ borderColor: "var(--border, #e2e8f0)" }}
                >
                  Use Conv Simple preset
                </button>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Namespace node</span>
                <select
                  value={unsPath}
                  onChange={(e) => setUnsPath(e.target.value)}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--border, #e2e8f0)" }}
                >
                  {pickable.map((n) => (
                    <option key={n.unsPath} value={n.unsPath}>
                      {n.name} — {n.unsPath}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Label</span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Conv Simple — Live"
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--border, #e2e8f0)" }}
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Display type</span>
                <select
                  value={displayType}
                  onChange={(e) => setDisplayType(e.target.value)}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--border, #e2e8f0)" }}
                >
                  {DISPLAY_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-[90px_1fr_90px] gap-2">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Scheme</span>
                  <select
                    value={scheme}
                    onChange={(e) => setScheme(e.target.value)}
                    className="w-full rounded-md border px-2 py-1.5 text-sm"
                    style={{ borderColor: "var(--border, #e2e8f0)" }}
                  >
                    <option value="http">http</option>
                    <option value="https">https</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Host (proxy origin)</span>
                  <input
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    placeholder="127.0.0.1"
                    className="w-full rounded-md border px-2 py-1.5 font-mono text-sm"
                    style={{ borderColor: "var(--border, #e2e8f0)" }}
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-600">Port</span>
                  <input
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    placeholder="8890"
                    inputMode="numeric"
                    className="w-full rounded-md border px-2 py-1.5 font-mono text-sm"
                    style={{ borderColor: "var(--border, #e2e8f0)" }}
                  />
                </label>
              </div>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Path</span>
                <input
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="/data/perspective/client/ConvSimpleLive"
                  className="w-full rounded-md border px-2 py-1.5 font-mono text-sm"
                  style={{ borderColor: "var(--border, #e2e8f0)" }}
                />
              </label>

              {error && <p className="rounded-md bg-red-50 p-2 text-xs text-red-700">{error}</p>}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-sm font-medium hover:bg-black/5">
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
            {submitting ? "Connecting…" : "Connect & lock"}
          </button>
        </div>
      </div>
    </div>
  );
}

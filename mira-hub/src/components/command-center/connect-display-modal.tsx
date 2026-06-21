"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Loader2, MonitorPlay, Link2, Server, Settings2, ChevronDown, Wifi, WifiOff } from "lucide-react";
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

// ── Gateway registry (issue #2014, Phase 2) ──────────────────────────────────
// Gateways are now fetched from GET /api/command-center/gateways which reads
// activated tenants from plg_activation_codes (mira-web activation flow).
// Phase 3 will have the gateway report its own screens; until then each
// activated gateway defaults to the known Ignition Perspective screen list.
interface CatalogScreen {
  name: string;
  kind: string;
  path: string;
}
interface CatalogGateway {
  id: string;       // hostname used as stable id
  name: string;     // display label
  scheme: "http" | "https";
  host: string;
  port: number;
  online: boolean;
  screens: CatalogScreen[];
}

// Known Ignition Perspective screens for MIRA-connected gateways.
// Replaced by gateway-reported screens in Phase 3 (#2014 §2).
const DEFAULT_SCREENS: CatalogScreen[] = [
  { name: "Conveyor Live",  kind: "Ignition Perspective", path: "/data/perspective/client/ConvSimpleLive" },
  { name: "Conveyor MIRA",  kind: "Ignition Perspective", path: "/data/perspective/client/ConveyorMIRA" },
];

function parseHostname(raw: string): { host: string; port: number } {
  const [h, p] = raw.split(":");
  return { host: h, port: p ? parseInt(p, 10) : 8088 };
}

const DISPLAY_TYPES = [
  { value: "web_iframe", label: "Web / HMI page (Ignition Perspective, panel page)" },
  { value: "nodered",    label: "Node-RED dashboard" },
  { value: "signals",    label: "Hub live-signal panel" },
  { value: "vnc",        label: "VNC (noVNC bridge)" },
];

/**
 * Onboarding modal — connect a live screen to a machine (namespace node).
 * POSTs to /api/command-center/display (register). On success the parent
 * refreshes the tree so the new screen appears under "Live Views".
 *
 * SIMPLE mode (default, issue #2014): pick gateway → screen → machine. The
 * scheme/host/port/path come from the per-tenant gateway registry — the user
 * never types a URL.
 * ADVANCED mode: the original manual scheme/host/port/path form, for a gateway
 * or screen not in the registry. Same POST contract either way.
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

  const [mode, setMode] = useState<"simple" | "advanced">("simple");

  // Machine (namespace node) — shared by both modes. Default to a conveyor node.
  const [unsPath, setUnsPath] = useState(
    pickable.find((n) => n.unsPath.includes("conv"))?.unsPath ?? pickable[0]?.unsPath ?? "",
  );
  const [label, setLabel] = useState("");

  // Phase 2: fetched gateway registry.
  const [gateways, setGateways] = useState<CatalogGateway[]>([]);
  const [gatewaysLoading, setGatewaysLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/command-center/gateways`, { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { gateways: Array<{ hostname: string; online: boolean }> };
        setGateways(
          json.gateways.map((g) => {
            const { host, port } = parseHostname(g.hostname);
            return {
              id: g.hostname,
              name: `Ignition @ ${host}`,
              scheme: "http",
              host,
              port,
              online: g.online,
              screens: DEFAULT_SCREENS,
            };
          }),
        );
      } finally {
        setGatewaysLoading(false);
      }
    })();
  }, []);

  // Simple mode — gateway + screen selection.
  const [gatewayId, setGatewayId] = useState("");
  const [screenIdx, setScreenIdx] = useState(0);
  // Keep gateway selection in sync with fetched list: default to first gateway on load.
  useEffect(() => {
    if (gateways.length > 0 && gatewayId === "") {
      setGatewayId(gateways[0].id);
    }
  }, [gateways, gatewayId]);
  const gateway = useMemo(() => gateways.find((g) => g.id === gatewayId), [gateways, gatewayId]);
  const screen = gateway?.screens[screenIdx];

  // Advanced mode — manual URL pieces.
  const [displayType, setDisplayType] = useState("web_iframe");
  const [scheme, setScheme] = useState("http");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [path, setPath] = useState("/");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    setError(null);

    let body: Record<string, unknown>;
    if (mode === "simple") {
      if (!gateway || !screen) {
        setError("Pick a gateway and a screen.");
        return;
      }
      body = {
        unsPath,
        label: label.trim() || screen.name,
        displayType: "web_iframe",
        scheme: gateway.scheme,
        host: gateway.host,
        port: gateway.port,
        path: screen.path,
      };
    } else {
      body = {
        unsPath,
        label: label.trim() || undefined,
        displayType,
        scheme,
        host: host.trim(),
        port: port.trim() === "" ? undefined : port.trim(),
        path: path.trim() || "/",
      };
    }

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/api/command-center/display/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const canSubmit =
    unsPath !== "" &&
    !submitting &&
    (mode === "simple" ? !!screen : host.trim() !== "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Connect live screen">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
          <div className="flex items-center gap-2">
            <MonitorPlay className="h-4 w-4 text-blue-600" />
            <h2 className="text-sm font-semibold">Connect a live screen</h2>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-black/5">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 px-5 py-4 text-sm">
          {pickable.length === 0 ? (
            <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-800">
              No machines in your namespace yet. Build the namespace first, then connect a live
              screen to a machine.
            </p>
          ) : (
            <>
              {mode === "simple" ? (
                <>
                  <p className="text-xs text-slate-500">
                    Pick a gateway and the screen you want to watch, then choose the machine it
                    shows. The screen opens in a new tab.
                  </p>

                  {/* 1 — Gateway */}
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">1. Gateway</span>
                    {gatewaysLoading ? (
                      <div className="flex items-center gap-2 rounded-md border px-3 py-2 text-xs text-slate-400" style={{ borderColor: "var(--border, #e2e8f0)" }}>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading connected gateways…
                      </div>
                    ) : gateways.length === 0 ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        No Ignition gateway connected yet. Activate MIRA Connect from the Ignition gateway to pair it, or use Advanced mode below.
                      </div>
                    ) : (
                      <div className="relative">
                        <Server className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                        <select
                          value={gatewayId}
                          onChange={(e) => { setGatewayId(e.target.value); setScreenIdx(0); }}
                          className="w-full rounded-md border py-1.5 pl-7 pr-2 text-sm"
                          style={{ borderColor: "var(--border, #e2e8f0)" }}
                        >
                          {gateways.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name} {g.online ? "● online" : "○ offline"}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {/* Online/offline badge for selected gateway */}
                    {gateway && (
                      <span className={`mt-1 flex items-center gap-1 text-[11px] ${gateway.online ? "text-green-600" : "text-amber-600"}`}>
                        {gateway.online
                          ? <><Wifi className="h-3 w-3" /> Gateway reachable</>
                          : <><WifiOff className="h-3 w-3" /> Gateway unreachable — screen may not load</>}
                      </span>
                    )}
                  </label>

                  {/* 2 — Screen (only shown when a gateway is selected) */}
                  {gateway && (
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">2. Live screen</span>
                      <select
                        value={screenIdx}
                        onChange={(e) => setScreenIdx(Number(e.target.value))}
                        className="w-full rounded-md border px-2 py-1.5 text-sm"
                        style={{ borderColor: "var(--border, #e2e8f0)" }}
                      >
                        {gateway.screens.map((s, i) => (
                          <option key={s.path} value={i}>{s.name} — {s.kind}</option>
                        ))}
                      </select>
                    </label>
                  )}

                  {/* 3 — Machine */}
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">{gateway ? "3." : "2."} Machine</span>
                    <select
                      value={unsPath}
                      onChange={(e) => setUnsPath(e.target.value)}
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      style={{ borderColor: "var(--border, #e2e8f0)" }}
                    >
                      {pickable.map((n) => (
                        <option key={n.unsPath} value={n.unsPath}>{n.name}</option>
                      ))}
                    </select>
                  </label>

                  <button
                    type="button"
                    onClick={() => setMode("advanced")}
                    className="flex items-center gap-1 text-[11px] font-medium text-slate-500 hover:text-slate-700"
                  >
                    <Settings2 className="h-3 w-3" />
                    Advanced: add a custom screen URL
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-slate-500">
                      Enter the screen&apos;s address manually. Use this for a gateway or screen not
                      in the list.
                    </p>
                    <button
                      type="button"
                      onClick={() => setMode("simple")}
                      className="flex flex-shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50"
                      style={{ borderColor: "var(--border, #e2e8f0)" }}
                    >
                      <ChevronDown className="h-3 w-3" />
                      Back to simple
                    </button>
                  </div>

                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-slate-600">Machine</span>
                    <select
                      value={unsPath}
                      onChange={(e) => setUnsPath(e.target.value)}
                      className="w-full rounded-md border px-2 py-1.5 text-sm"
                      style={{ borderColor: "var(--border, #e2e8f0)" }}
                    >
                      {pickable.map((n) => (
                        <option key={n.unsPath} value={n.unsPath}>{n.name} — {n.unsPath}</option>
                      ))}
                    </select>
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
                        placeholder="100.72.2.99"
                        className="w-full rounded-md border px-2 py-1.5 font-mono text-sm"
                        style={{ borderColor: "var(--border, #e2e8f0)" }}
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-600">Port</span>
                      <input
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        placeholder="8088"
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
                </>
              )}

              {/* Label — shared, optional. Defaults to the screen name in simple mode. */}
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">
                  Label <span className="font-normal text-slate-400">(optional)</span>
                </span>
                <input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder={mode === "simple" ? (screen?.name ?? "Conveyor Live") : "Conv Simple — Live"}
                  className="w-full rounded-md border px-2 py-1.5 text-sm"
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
            {submitting ? "Connecting…" : "Connect live screen"}
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronRight,
  Folder, FolderOpen, Cog, Factory, FileText, Layers,
  RefreshCw, MonitorPlay, MonitorOff, Radio, ExternalLink, Plus,
  Wifi, WifiOff,
} from "lucide-react";
import { API_BASE } from "@/lib/config";
import {
  collectConfiguredDisplays,
  isCommandCenterEmpty,
  type ConfiguredDisplay,
} from "@/lib/command-center-view";
import { ConnectDisplayModal } from "@/components/command-center/connect-display-modal";

// ── Types ───────────────────────────────────────────────────────────────────
// Mirrors CommandCenterNode in /api/command-center/tree/route.ts.

interface CCNode {
  id: string;
  name: string;
  kind: string;
  unsPath: string | null;
  filesCount: number;
  status: string | null;
  counts: { children: number; proposalsPending: number; proposalsVerified: number };
  hasLiveDisplay: boolean;
  displayId: string | null;
  displayType: string | null;
  displayLabel: string | null;
  // PRIMARY "live" status = real telemetry freshness for this subtree.
  tagFreshness: "live" | "stale" | "simulated" | "unknown";
  // SECONDARY = registered HMI display URL reachable over HTTP.
  live: boolean;
  children: CCNode[];
}

interface TreeResponse {
  nodes: CCNode[];
  total: number;
  displaysTotal: number;
  liveCount: number; // display-reachability count (secondary)
  freshnessCounts: { live: number; stale: number; simulated: number };
}

const POLL_MS = 10_000;

// Renders the kind icon directly (no component-from-call in render — keeps the
// react-hooks/static-components rule happy).
function KindIcon({ kind, open, className }: { kind: string; open: boolean; className?: string }) {
  if (kind === "site" || kind === "plant") return <Factory className={className} />;
  if (kind === "asset" || kind === "equipment" || kind === "component") return <Cog className={className} />;
  if (kind === "document") return <FileText className={className} />;
  if (kind === "namespace") return open ? <FolderOpen className={className} /> : <Folder className={className} />;
  return <Layers className={className} />;
}

// ── Connected Gateways Bar (Phase 2, issue #2014) ────────────────────────────
// Reads from GET /api/command-center/gateways which surfaces every Ignition
// gateway that completed the MIRA Connect activation flow for this tenant.
// Each gateway is probed for HTTP reachability on the server side; we just
// render the result here.

interface GatewayEntry {
  hostname: string;
  agentId: string | null;
  activatedAt: string;
  online: boolean;
}

function ConnectedGatewaysBar() {
  const [gateways, setGateways] = useState<GatewayEntry[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void fetch(`${API_BASE}/api/command-center/gateways`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { gateways: GatewayEntry[] }) => setGateways(j.gateways))
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  // Don't show anything until loaded (avoids flicker on first paint).
  if (!loaded) return null;
  // No gateways yet — show a compact hint instead of an empty bar.
  if (gateways.length === 0) return (
    <div className="border-b px-5 py-1.5 text-[11px] text-slate-400"
      style={{ borderColor: "var(--border, #e2e8f0)" }}>
      No Ignition gateways connected. Activate MIRA Connect from your gateway to pair it.
    </div>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-5 py-1.5"
      style={{ borderColor: "var(--border, #e2e8f0)" }}>
      <span className="text-[11px] font-medium text-slate-500">Gateways:</span>
      {gateways.map((g) => (
        <span key={g.hostname}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{
            borderColor: g.online ? "#16a34a40" : "#cbd5e1",
            backgroundColor: g.online ? "#f0fdf4" : "#f8fafc",
            color: g.online ? "#15803d" : "#64748b",
          }}
          title={`${g.hostname}${g.agentId ? ` · agent ${g.agentId}` : ""}`}>
          {g.online
            ? <Wifi className="h-3 w-3" />
            : <WifiOff className="h-3 w-3" />}
          {g.hostname}
        </span>
      ))}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CommandCenterPage() {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CCNode | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  // The full namespace tree (incl. audit/test nodes) is demoted behind this
  // toggle so the default view leads with configured live views, not 117 nodes.
  const [showAllNodes, setShowAllNodes] = useState(false);
  // Auto-select the first configured display once, on first load.
  const autoSelectedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/command-center/tree/`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TreeResponse;
      setData(json);
      setError(null);
      // Land on the first live view so "Open Live View" is immediately visible
      // instead of a bare "Select a node". Once only — never overrides a user's
      // later selection or re-fires on the 10s poll.
      if (!autoSelectedRef.current) {
        const first = collectConfiguredDisplays(json.nodes)[0];
        const node = first ? findById(json.nodes, first.nodeId) : null;
        if (node) {
          setSelected(node);
          autoSelectedRef.current = true;
        }
      }
      // Expand the path to every display so live equipment is visible on load.
      setExpanded((prev) => {
        if (prev.size > 0) return prev;
        const next = new Set<string>();
        const walk = (nodes: CCNode[]) => {
          for (const n of nodes) {
            if (subtreeHasDisplay(n)) next.add(n.id);
            walk(n.children);
          }
        };
        walk(json.nodes);
        return next;
      });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    const t = setInterval(refresh, POLL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [refresh]);

  // Keep the selected node's live flag fresh as the tree re-polls.
  const selectedLive = useMemo(() => {
    if (!selected || !data) return selected;
    return findById(data.nodes, selected.id) ?? selected;
  }, [data, selected]);

  // Configured live views (the curated, displays-first list) + the honest
  // empty-state decision. Audit/no-display nodes are excluded here and demoted
  // to the collapsible "All namespace nodes" section below.
  const displays = useMemo(() => (data ? collectConfiguredDisplays(data.nodes) : []), [data]);
  const empty = data ? isCommandCenterEmpty(data) : false;

  const selectByNodeId = useCallback(
    (id: string) => {
      if (!data) return;
      const hit = findById(data.nodes, id);
      if (hit) setSelected(hit);
    },
    [data],
  );

  // Manual refresh: show a spinner so the click reads as doing something. The
  // background poll (POLL_MS) keeps re-fetching silently and must NOT flip this.
  const manualRefresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-[calc(100vh-0px)] flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-5 py-3"
        style={{ borderColor: "var(--border, #e2e8f0)" }}>
        <div className="flex items-center gap-2.5">
          <Radio className="h-5 w-5" style={{ color: "#2563EB" }} />
          <h1 className="text-lg font-bold tracking-tight">Command Center</h1>
          {data && <FreshnessSummary counts={data.freshnessCounts}
            displaysTotal={data.displaysTotal} reachable={data.liveCount} />}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowConnect(true)}
            className="flex items-center gap-1.5 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700"
            title="Connect a live view">
            <Plus className="h-3.5 w-3.5" />
            Connect live view
          </button>
          <button onClick={() => void manualRefresh()}
            disabled={refreshing}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-black/5 disabled:opacity-50"
            title="Refresh">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Connected Gateways Bar — Phase 2, issue #2014. */}
      <ConnectedGatewaysBar />

      {loading && <p className="px-5 py-4 text-sm text-slate-500">Loading namespace…</p>}
      {error && <p className="px-5 py-4 text-sm text-red-600">Failed to load: {error}</p>}

      {/* Empty / onboarding state — shown when nothing is connected and no
          telemetry is arriving. We do NOT dump the 100+ audit/test nodes here;
          the full tree is available behind "Browse all namespace nodes". */}
      {!loading && !error && data && empty && (
        <OnboardingEmpty
          totalNodes={data.total}
          showAllNodes={showAllNodes}
          onToggleAllNodes={() => setShowAllNodes((v) => !v)}
          onConnect={() => setShowConnect(true)}
          tree={
            <div className="overflow-y-auto py-2">
              {data.nodes.map((n) => (
                <TreeRow key={n.id} node={n} depth={0}
                  expanded={expanded} toggle={toggle}
                  selectedId={selectedLive?.id ?? null} onSelect={setSelected} />
              ))}
            </div>
          }
        />
      )}

      {/* Configured / populated state — displays first, full tree demoted. */}
      {!loading && !error && data && !empty && (
        <div className="flex flex-1 overflow-hidden">
          <div className="w-[340px] flex-shrink-0 overflow-y-auto border-r py-2"
            style={{ borderColor: "var(--border, #e2e8f0)" }}>
            <LiveViewsSection
              displays={displays}
              selectedId={selectedLive?.id ?? null}
              onSelect={selectByNodeId}
              onConnect={() => setShowConnect(true)}
            />

            {/* Full namespace tree (incl. audit/test nodes) — demoted, collapsed
                by default so it isn't the buyer-facing default experience. */}
            <button
              onClick={() => setShowAllNodes((v) => !v)}
              className="mt-2 flex w-full items-center gap-1.5 border-t px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 hover:bg-black/5"
              style={{ borderColor: "var(--border, #e2e8f0)" }}
            >
              {showAllNodes ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              All namespace nodes ({data.total})
            </button>
            {showAllNodes && data.nodes.map((n) => (
              <TreeRow key={n.id} node={n} depth={0}
                expanded={expanded} toggle={toggle}
                selectedId={selectedLive?.id ?? null} onSelect={setSelected} />
            ))}
          </div>

          {/* Right: live viewer */}
          <div className="flex flex-1 flex-col overflow-hidden bg-slate-50">
            <Viewer node={selectedLive} />
          </div>
        </div>
      )}

      {showConnect && data && (
        <ConnectDisplayModal
          nodes={data.nodes}
          onClose={() => setShowConnect(false)}
          onRegistered={() => { void manualRefresh(); }}
        />
      )}
    </div>
  );
}

// ── Live Views section (the curated, displays-first list) ─────────────────────

function LiveViewsSection({
  displays, selectedId, onSelect, onConnect,
}: {
  displays: ConfiguredDisplay[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onConnect: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between px-4 pb-1.5 pt-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Live Views ({displays.length})
        </span>
      </div>
      {displays.length === 0 ? (
        <div className="px-4 py-3">
          <p className="text-xs text-slate-500">No live screens connected yet.</p>
          <button onClick={onConnect} className="mt-2 inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
            style={{ borderColor: "var(--border, #e2e8f0)" }}>
            <Plus className="h-3.5 w-3.5" /> Connect live screen
          </button>
        </div>
      ) : (
        displays.map((d) => {
          const isSel = d.nodeId === selectedId;
          return (
            <button
              key={d.displayId}
              onClick={() => onSelect(d.nodeId)}
              className="flex w-full items-start gap-2 px-4 py-2 text-left hover:bg-black/5"
              style={{ backgroundColor: isSel ? "#2563EB14" : undefined }}
            >
              <MonitorPlay className="mt-0.5 h-4 w-4 flex-shrink-0 text-slate-500" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{d.label}</span>
                  <FreshnessDot freshness={d.tagFreshness} />
                </span>
                {d.unsPath && <span className="block truncate font-mono text-[10px] text-slate-400">{d.unsPath}</span>}
                <span className="mt-0.5 inline-flex items-center gap-1 text-[10px]"
                  style={{ color: d.live ? "#16a34a" : "#2563eb" }}>
                  <DisplayDot live={d.live} />
                  {d.live ? "display up" : "open to view ↗"}
                </span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

// ── Onboarding empty state ────────────────────────────────────────────────────

function OnboardingEmpty({
  totalNodes, showAllNodes, onToggleAllNodes, onConnect, tree,
}: {
  totalNodes: number;
  showAllNodes: boolean;
  onToggleAllNodes: () => void;
  onConnect: () => void;
  tree: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
        <MonitorPlay className="mb-4 h-12 w-12 text-slate-300" />
        <h2 className="text-base font-semibold text-slate-700">No live screens connected yet</h2>
        <p className="mt-1 max-w-md text-sm text-slate-500">
          Pick a gateway and a screen MIRA already knows about, choose the machine it shows, and
          it&apos;ll appear here. The screen opens in its own tab and stays connected across
          refreshes.
        </p>
        <button onClick={onConnect}
          className="mt-5 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700">
          <Plus className="h-4 w-4" /> Connect live screen
        </button>
        {totalNodes > 0 && (
          <button onClick={onToggleAllNodes}
            className="mt-3 text-xs font-medium text-slate-500 underline-offset-2 hover:underline">
            {showAllNodes ? "Hide namespace nodes" : `Browse all namespace nodes (${totalNodes})`}
          </button>
        )}
      </div>
      {showAllNodes && (
        <div className="border-t" style={{ borderColor: "var(--border, #e2e8f0)" }}>
          {tree}
        </div>
      )}
    </div>
  );
}

// ── Tree row ────────────────────────────────────────────────────────────────

function TreeRow({
  node, depth, expanded, toggle, selectedId, onSelect,
}: {
  node: CCNode;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  selectedId: string | null;
  onSelect: (n: CCNode) => void;
}) {
  const isOpen = expanded.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === selectedId;

  return (
    <div>
      <div
        className="flex cursor-pointer items-center gap-1 rounded px-1 py-1 text-sm hover:bg-black/5"
        style={{
          paddingLeft: depth * 14 + 6,
          backgroundColor: isSelected ? "#2563EB14" : undefined,
        }}
        onClick={() => {
          // Every node is selectable — the Viewer renders the right state per
          // node (live display, "no display configured", or no-tags). Gating
          // selection on hasLiveDisplay froze the detail panel on the one
          // display node and swallowed every other click.
          onSelect(node);
          if (hasChildren) toggle(node.id);
        }}
      >
        {hasChildren ? (
          isOpen ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                 : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        ) : (
          <span className="inline-block h-3.5 w-3.5 flex-shrink-0" />
        )}
        <KindIcon kind={node.kind} open={isOpen} className="h-4 w-4 flex-shrink-0 text-slate-500" />
        <span className="truncate">{node.name}</span>
        {/* PRIMARY: telemetry freshness. SECONDARY: display reachability. */}
        <FreshnessDot freshness={node.tagFreshness} />
        {node.hasLiveDisplay && <DisplayDot live={node.live} />}
      </div>
      {isOpen && node.children.map((c) => (
        <TreeRow key={c.id} node={c} depth={depth + 1}
          expanded={expanded} toggle={toggle}
          selectedId={selectedId} onSelect={onSelect} />
      ))}
    </div>
  );
}

/** Open ring = a registered HMI display. Green when the Hub server confirmed it
 * reachable over HTTP; blue ("open to view") when it couldn't probe — which is
 * the normal case for a Tailscale/LAN gateway viewed from the cloud Hub, since
 * the VPS isn't on the tenant's tailnet and an HTTPS page can't probe an HTTP
 * gateway (mixed content). Blue is NOT "down": the display opens in the user's
 * browser, which CAN reach it. SECONDARY status — reachability, not telemetry. */
function DisplayDot({ live }: { live: boolean }) {
  return (
    <span className="relative ml-1 flex h-2.5 w-2.5 flex-shrink-0"
      title={live
        ? "Display URL reachable (HTTP) — click to watch"
        : "Registered — opens in your browser. The cloud Hub can't probe a Tailscale/LAN gateway, so reachability isn't confirmed server-side."}>
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2"
        style={{ borderColor: live ? "#16a34a" : "#2563eb", backgroundColor: "transparent" }} />
    </span>
  );
}

// ── Freshness (PRIMARY "live" status = telemetry freshness) ───────────────────

type Freshness = CCNode["tagFreshness"];

const FRESHNESS_COLOR: Record<Freshness, string> = {
  live: "#16a34a",       // green — fresh real telemetry
  stale: "#d97706",      // amber — real, but no recent update
  simulated: "#2563eb",  // blue — only simulated data available
  unknown: "#94a3b8",    // gray — no mapped tags
};

const FRESHNESS_LABEL: Record<Freshness, string> = {
  live: "Live",
  stale: "Stale",
  simulated: "Simulated",
  unknown: "No tags",
};

const FRESHNESS_TITLE: Record<Freshness, string> = {
  live: "Live telemetry — a mapped tag updated within its freshness window",
  stale: "Stale — mapped tags exist but none updated recently",
  simulated: "Simulated data only — no real telemetry for this asset",
  unknown: "No mapped tags under this node",
};

/** Filled dot for telemetry freshness. Hidden for 'unknown' unless forceShow
 * (the viewer header always shows the explicit status). Live pulses. */
function FreshnessDot({ freshness, forceShow = false }: { freshness: Freshness; forceShow?: boolean }) {
  if (freshness === "unknown" && !forceShow) return null;
  const color = FRESHNESS_COLOR[freshness];
  return (
    <span className="relative ml-1.5 flex h-2.5 w-2.5 flex-shrink-0" title={FRESHNESS_TITLE[freshness]}>
      {freshness === "live" && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
          style={{ backgroundColor: color }} />
      )}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

/** Header summary — freshness counts are the PRIMARY headline; display
 * reachability is shown as a secondary clause. */
function FreshnessSummary({
  counts, displaysTotal, reachable,
}: {
  counts: { live: number; stale: number; simulated: number };
  displaysTotal: number;
  reachable: number;
}) {
  const headline: Freshness =
    counts.live > 0 ? "live" : counts.stale > 0 ? "stale" : counts.simulated > 0 ? "simulated" : "unknown";
  const color = FRESHNESS_COLOR[headline];
  return (
    <span className="ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `${color}1a`, color }}>
      <FreshnessDot freshness={headline} forceShow />
      {counts.live} live · {counts.stale} stale · {counts.simulated} sim
      <span className="text-slate-400">
        · {displaysTotal} display{displaysTotal === 1 ? "" : "s"} connected
        {reachable > 0 ? ` · ${reachable} cloud-reachable` : ""}
      </span>
    </span>
  );
}

// ── Viewer ────────────────────────────────────────────────────────────────────

function Viewer({ node }: { node: CCNode | null }) {
  if (!node) {
    return (
      <Empty icon={MonitorPlay}
        title="Select a node to see its details"
        sub="Equipment with a green dot has a live screen you can watch." />
    );
  }
  if (!node.hasLiveDisplay || !node.displayId) {
    return (
      <Empty icon={MonitorOff}
        title="No live display configured for this asset"
        sub={node.unsPath ?? node.name} />
    );
  }

  // Open-in-new-tab handoff. Iframing third-party HMIs (Ignition Perspective,
  // Node-RED) is fragile: X-Frame-Options/CSP block the frame, the SPA loads
  // assets at origin-root absolute paths that bypass per-id sub-path proxies,
  // and the embedded panel still wants its own login. Top-level navigation
  // ignores XFO and matches the direct-connection model in
  // .claude/rules/direct-connection-uns-certified.md — the Hub hands off, the
  // HMI runs in its own tab.
  const displayHref = `${API_BASE}/api/command-center/display/${node.displayId}`;

  return (
    <>
      <div className="flex items-center justify-between border-b bg-white px-4 py-2"
        style={{ borderColor: "var(--border, #e2e8f0)" }}>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{node.displayLabel ?? node.name}</p>
          {node.unsPath && <p className="truncate font-mono text-[11px] text-slate-400">{node.unsPath}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-3 text-xs font-medium">
          {/* PRIMARY: telemetry freshness */}
          <span className="flex items-center gap-1.5"
            style={{ color: FRESHNESS_COLOR[node.tagFreshness] }}>
            <FreshnessDot freshness={node.tagFreshness} forceShow />
            {FRESHNESS_LABEL[node.tagFreshness]}
          </span>
          {/* SECONDARY: display reachability */}
          <span className="flex items-center gap-1.5 text-slate-400" title="HTTP reachability of the display URL">
            <DisplayDot live={node.live} />
            {node.live ? "display up" : "display down"}
          </span>
        </div>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
        <MonitorPlay className="h-12 w-12 text-slate-300" />
        <div>
          <p className="text-base font-semibold text-slate-700">
            {node.displayLabel ?? node.name}
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-500">
            Live HMIs open in a new tab so they keep their own session and
            WebSocket connection. Click below to view the screen.
          </p>
        </div>
        {node.live ? (
          <a
            href={displayHref}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <ExternalLink className="h-4 w-4" />
            Open Live View
          </a>
        ) : (
          <>
            <button
              disabled
              title="Display is unreachable — start the HMI service to open the live view"
              className="inline-flex cursor-not-allowed items-center gap-2 rounded-md bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-400 shadow-sm"
            >
              <ExternalLink className="h-4 w-4" />
              Open Live View
            </button>
            <p className="text-xs text-amber-600">
              Display is currently unreachable — start the HMI service to enable this button.
            </p>
          </>
        )}
      </div>
    </>
  );
}

function Empty({ icon: Icon, title, sub }: { icon: React.ElementType; title: string; sub: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center text-center">
      <Icon className="mb-3 h-10 w-10 text-slate-300" />
      <p className="text-sm font-medium text-slate-600">{title}</p>
      <p className="mt-1 max-w-sm text-xs text-slate-400">{sub}</p>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function subtreeHasDisplay(node: CCNode): boolean {
  if (node.hasLiveDisplay) return true;
  return node.children.some(subtreeHasDisplay);
}

function findById(nodes: CCNode[], id: string): CCNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findById(n.children, id);
    if (hit) return hit;
  }
  return null;
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown, ChevronRight,
  Folder, FolderOpen, Cog, Factory, FileText, Layers,
  RefreshCw, MonitorPlay, MonitorOff, Radio, Settings,
} from "lucide-react";
import { API_BASE } from "@/lib/config";
import { ManageDisplays } from "./ManageDisplays";

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
  live: boolean;
  children: CCNode[];
}

interface TreeResponse {
  nodes: CCNode[];
  total: number;
  displaysTotal: number;
  liveCount: number;
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CommandCenterPage() {
  const [data, setData] = useState<TreeResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<CCNode | null>(null);
  const [managing, setManaging] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/command-center/tree`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as TreeResponse;
      setData(json);
      setError(null);
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
          {data && (
            <span className="ml-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium"
              style={{ backgroundColor: "#16a34a1a", color: "#16a34a" }}>
              <span className="relative flex h-2 w-2">
                {data.liveCount > 0 && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
                    style={{ backgroundColor: "#16a34a" }} />
                )}
                <span className="relative inline-flex h-2 w-2 rounded-full"
                  style={{ backgroundColor: data.liveCount > 0 ? "#16a34a" : "#94a3b8" }} />
              </span>
              {data.liveCount} live · {data.displaysTotal} display{data.displaysTotal === 1 ? "" : "s"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button onClick={() => setManaging(true)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-black/5"
            title="Manage displays">
            <Settings className="h-3.5 w-3.5" /> Manage
          </button>
          <button onClick={() => refresh()}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium hover:bg-black/5"
            title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {managing && (
        <ManageDisplays onClose={() => setManaging(false)} onChanged={() => refresh()} />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: UNS tree */}
        <div className="w-[320px] flex-shrink-0 overflow-y-auto border-r py-2"
          style={{ borderColor: "var(--border, #e2e8f0)" }}>
          {loading && <p className="px-4 py-3 text-sm text-slate-500">Loading namespace…</p>}
          {error && <p className="px-4 py-3 text-sm text-red-600">Failed to load: {error}</p>}
          {!loading && !error && data && data.nodes.length === 0 && (
            <p className="px-4 py-3 text-sm text-slate-500">No equipment in the namespace yet.</p>
          )}
          {data?.nodes.map((n) => (
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
          if (node.hasLiveDisplay) onSelect(node);
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

/** Green pulsing dot = a live, watchable display. Gray = registered but stale. */
function DisplayDot({ live }: { live: boolean }) {
  return (
    <span className="relative ml-1.5 flex h-2.5 w-2.5 flex-shrink-0"
      title={live ? "Live display — click to watch" : "Display registered (no live signal)"}>
      {live && (
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
          style={{ backgroundColor: "#16a34a" }} />
      )}
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: live ? "#16a34a" : "#cbd5e1" }} />
    </span>
  );
}

// ── Viewer ────────────────────────────────────────────────────────────────────

function Viewer({ node }: { node: CCNode | null }) {
  if (!node) {
    return (
      <Empty icon={MonitorPlay}
        title="Select an asset with a live display"
        sub="Equipment with a green dot has a screen you can watch." />
    );
  }
  if (!node.hasLiveDisplay || !node.displayId) {
    return (
      <Empty icon={MonitorOff}
        title="No live display configured for this asset"
        sub={node.unsPath ?? node.name} />
    );
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-white px-4 py-2"
        style={{ borderColor: "var(--border, #e2e8f0)" }}>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{node.displayLabel ?? node.name}</p>
          {node.unsPath && <p className="truncate font-mono text-[11px] text-slate-400">{node.unsPath}</p>}
        </div>
        <span className="flex flex-shrink-0 items-center gap-1.5 text-xs font-medium"
          style={{ color: node.live ? "#16a34a" : "#64748b" }}>
          <DisplayDot live={node.live} />
          {node.live ? "Live" : "No live signal"}
        </span>
      </div>
      <iframe
        // Browser is redirected straight to the HMI (WebSockets intact). No
        // allow-forms / allow-top-navigation: the embedded screen is watch-only.
        key={node.displayId}
        src={`${API_BASE}/api/command-center/display/${node.displayId}`}
        title={node.displayLabel ?? node.name}
        className="flex-1 border-0"
        sandbox="allow-same-origin allow-scripts allow-popups"
      />
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

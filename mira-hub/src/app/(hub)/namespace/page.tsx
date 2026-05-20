"use client";

/**
 * Namespace tree — read-only view (Phase 2 slice 1).
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Namespace tree"
 * API : GET /api/namespace/tree
 *
 * Drag-drop move, rename, and merge land in slice 2.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, Layers, Loader2, Factory, MapPin, Cog, FileText, Search } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface NamespaceNode {
  id: string;
  name: string;
  kind: string;
  unsPath: string | null;
  counts: {
    children: number;
    proposalsPending: number;
    proposalsVerified: number;
  };
  children: NamespaceNode[];
}

interface TreeResponse {
  tree: NamespaceNode[];
  total: number;
}

const KIND_ICON: Record<string, React.ElementType> = {
  site: Factory,
  plant: Factory,
  area: MapPin,
  line: MapPin,
  production_line: MapPin,
  asset: Cog,
  component: Cog,
  component_template: Cog,
  document: FileText,
  // Synthesized parent (no kg_entities row) — see #1344. Renders as a folder.
  namespace: Layers,
};

// Next.js `<Link>` auto-prepends the configured basePath ('/hub' in this
// app). Build hrefs as bare app-relative paths — NOT prefixed with
// API_BASE — or they'll double-up to '/hub/hub/...'. Plain `<a>` does
// not transform; those still need the full prefix (see EmptyState below).
const HUB_BASE = API_BASE.replace(/\/api$/, "");

function filterTree(nodes: NamespaceNode[], query: string): NamespaceNode[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return nodes;
  const walk = (node: NamespaceNode): NamespaceNode | null => {
    const selfMatches =
      node.name.toLowerCase().includes(q) ||
      (node.unsPath?.toLowerCase().includes(q) ?? false);
    const filteredChildren = node.children
      .map(walk)
      .filter((c): c is NamespaceNode => c !== null);
    if (!selfMatches && filteredChildren.length === 0) return null;
    // When a child matches, surface the whole subtree so the user keeps context.
    return { ...node, children: selfMatches ? node.children : filteredChildren };
  };
  return nodes.map(walk).filter((n): n is NamespaceNode => n !== null);
}

export default function NamespacePage() {
  const [tree, setTree] = useState<NamespaceNode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<NamespaceNode | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const refreshTree = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/namespace/tree`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as TreeResponse;
      setTree(data.tree);
      setTotal(data.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await refreshTree();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTree]);

  const visibleTree = useMemo(() => filterTree(tree, search), [tree, search]);

  async function handleDrop(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const previous = tree;
    setToast("Moving…");
    try {
      const res = await fetch(`${API_BASE}/api/namespace/node/${sourceId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ newParentId: targetId, reason: "drag-and-drop" }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      await refreshTree();
      setToast("Move saved");
    } catch (e) {
      setTree(previous);
      setToast(`Move failed: ${(e as Error).message}`);
    } finally {
      setDraggingId(null);
      setDropTargetId(null);
      setTimeout(() => setToast(null), 3500);
    }
  }

  return (
    <div className="flex h-full" data-testid="namespace-page">
      <div className="flex-1 overflow-auto p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Namespace</h1>
            <p className="mt-1 text-sm text-slate-500">
              {loading
                ? "Loading…"
                : `${total} entit${total === 1 ? "y" : "ies"} — drag any node to reparent`}
            </p>
          </div>
        </div>

        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search namespace…"
            className="w-full rounded-md border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            data-testid="namespace-search"
            aria-label="Search namespace"
          />
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading tree…
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Failed to load namespace: {error}
          </div>
        ) : tree.length === 0 ? (
          <EmptyState />
        ) : visibleTree.length === 0 ? (
          <div className="rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No nodes match <span className="font-mono">&quot;{search}&quot;</span>.
          </div>
        ) : (
          <div className="space-y-1" data-testid="namespace-tree">
            {visibleTree.map((node) => (
              <TreeNode
                key={node.id}
                node={node}
                depth={0}
                selectedId={selected?.id ?? null}
                onSelect={setSelected}
                draggingId={draggingId}
                dropTargetId={dropTargetId}
                onDragStart={setDraggingId}
                onDragOver={setDropTargetId}
                onDrop={handleDrop}
              />
            ))}
          </div>
        )}
      </div>

      <aside
        className="hidden w-80 shrink-0 border-l border-slate-200 bg-slate-50 p-6 lg:block"
        data-testid="namespace-detail-pane"
      >
        {loading ? null : selected ? <DetailPane node={selected} /> : <DetailEmpty />}
      </aside>

      {toast && (
        <div
          className="fixed bottom-4 right-4 z-50 rounded-md bg-slate-900 px-4 py-2 text-sm text-white shadow-lg"
          data-testid="namespace-toast"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function TreeNode({
  node,
  depth,
  selectedId,
  onSelect,
  draggingId,
  dropTargetId,
  onDragStart,
  onDragOver,
  onDrop,
}: {
  node: NamespaceNode;
  depth: number;
  selectedId: string | null;
  onSelect: (n: NamespaceNode) => void;
  draggingId: string | null;
  dropTargetId: string | null;
  onDragStart: (id: string | null) => void;
  onDragOver: (id: string | null) => void;
  onDrop: (sourceId: string, targetId: string) => void;
}) {
  const [open, setOpen] = useState(depth < 2);
  const hasChildren = node.children.length > 0;
  const Icon = KIND_ICON[node.kind] ?? Layers;
  const isSelected = node.id === selectedId;
  const isDragging = draggingId === node.id;
  const isDropTarget = dropTargetId === node.id && draggingId !== node.id;

  return (
    <div>
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
          onDragStart(node.id);
        }}
        onDragEnd={() => onDragStart(null)}
        onDragOver={(e) => {
          if (draggingId && draggingId !== node.id) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onDragOver(node.id);
          }
        }}
        onDragLeave={() => onDragOver(null)}
        onDrop={(e) => {
          e.preventDefault();
          const sourceId = e.dataTransfer.getData("text/plain") || draggingId;
          if (sourceId && sourceId !== node.id) {
            onDrop(sourceId, node.id);
          }
        }}
        className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm transition ${
          isSelected ? "bg-blue-50 ring-1 ring-blue-200" : ""
        } ${isDragging ? "opacity-40" : ""} ${
          isDropTarget ? "bg-blue-100 ring-2 ring-blue-500" : "hover:bg-slate-100"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        data-testid="namespace-node"
        data-node-id={node.id}
        data-drop-target={isDropTarget ? "true" : "false"}
      >
        <button
          type="button"
          onClick={() => hasChildren && setOpen((o) => !o)}
          className="flex h-5 w-5 items-center justify-center text-slate-600 hover:text-slate-900"
          aria-label={open ? "Collapse" : "Expand"}
        >
          {hasChildren ? open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" /> : null}
        </button>
        <button
          type="button"
          onClick={() => onSelect(node)}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <Icon className="h-4 w-4 text-slate-500" />
          <span className="text-slate-900">{node.name}</span>
          <span className="text-xs text-slate-600">{node.kind}</span>
          {node.counts.proposalsPending > 0 && (
            <span className="ml-auto rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
              {node.counts.proposalsPending} proposed
            </span>
          )}
        </button>
      </div>
      {open && hasChildren && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedId={selectedId}
              onSelect={onSelect}
              draggingId={draggingId}
              dropTargetId={dropTargetId}
              onDragStart={onDragStart}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DetailPane({ node }: { node: NamespaceNode }) {
  const path = node.unsPath ?? "";
  const proposalsHref = (status: "pending" | "verified") =>
    `/proposals?path=${encodeURIComponent(path)}&status=${status}`;
  return (
    <div data-testid="namespace-detail">
      <div className="text-xs uppercase tracking-wide text-slate-500">{node.kind}</div>
      <h2 className="mt-1 text-lg font-semibold text-slate-900">{node.name}</h2>
      {node.unsPath && (
        <code className="mt-2 block break-all rounded bg-slate-100 p-2 text-xs text-slate-700">
          {node.unsPath}
        </code>
      )}
      <dl className="mt-6 space-y-1 text-sm">
        <Stat label="Children" value={node.counts.children} />
        <CounterLink
          label="Proposals pending"
          value={node.counts.proposalsPending}
          href={proposalsHref("pending")}
        />
        <CounterLink
          label="Proposals verified"
          value={node.counts.proposalsVerified}
          href={proposalsHref("verified")}
        />
      </dl>
      {node.counts.proposalsPending > 0 && (
        <Link
          href={proposalsHref("pending")}
          className="mt-6 inline-block text-sm font-medium text-blue-600 hover:underline"
        >
          Review {node.counts.proposalsPending} pending proposal
          {node.counts.proposalsPending === 1 ? "" : "s"} →
        </Link>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between rounded px-2 py-1.5">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

function CounterLink({ label, value, href }: { label: string; value: number; href: string }) {
  const isZero = value === 0;
  return (
    <Link
      href={href}
      className={`group flex items-center justify-between rounded px-2 py-1.5 ${
        isZero ? "pointer-events-none cursor-default" : "hover:bg-blue-50"
      }`}
      aria-disabled={isZero}
      tabIndex={isZero ? -1 : 0}
      data-testid="namespace-counter-link"
    >
      <dt className={`${isZero ? "text-slate-500" : "text-slate-500 group-hover:text-blue-700"}`}>
        {label}
      </dt>
      <dd className={`font-semibold text-slate-900 ${!isZero && "group-hover:text-blue-700"}`}>
        {value}
        {!isZero && " →"}
      </dd>
    </Link>
  );
}

function DetailEmpty() {
  return (
    <div className="text-sm text-slate-500">
      <p>Select a node to see its details — children, proposed edges, and verified relationships.</p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-12 text-center" data-testid="namespace-empty">
      <Layers className="mx-auto h-10 w-10 text-slate-300" />
      <h2 className="mt-4 text-lg font-semibold text-slate-900">Your namespace is empty</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
        Start the namespace wizard to add your first site and line, then MIRA will
        propose assets and components from your manuals, photos, and PLC tags.
      </p>
      <a
        href={`${HUB_BASE}/onboarding`}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        data-testid="namespace-empty-start"
      >
        Build your namespace →
      </a>
    </div>
  );
}

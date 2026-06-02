"use client";

import { useEffect, useMemo, useState } from "react";
import { GraphCanvas } from "@/components/kg/GraphCanvas";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  capped?: boolean;
  error?: string;
}

export default function GraphPage() {
  const [raw, setRaw] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showOrphans, setShowOrphans] = useState(true);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);

  useEffect(() => {
    fetch("/api/kg/graph")
      .then((r) => r.json())
      .then((j: GraphResponse) => (j.error ? setError(j.error) : setRaw(j)))
      .catch((e) => setError(String(e)));
  }, []);

  const types = useMemo(
    () => [...new Set((raw?.nodes ?? []).map((n) => n.type))].sort(),
    [raw],
  );

  const view = useMemo(() => {
    if (!raw) return { nodes: [], links: [] };
    const q = query.trim().toLowerCase();
    const keep = new Set(
      raw.nodes
        .filter((n) => !hiddenTypes.has(n.type))
        .filter((n) => showOrphans || n.degree > 0)
        .filter((n) => !q || n.label.toLowerCase().includes(q))
        .map((n) => n.id),
    );
    return {
      nodes: raw.nodes.filter((n) => keep.has(n.id)),
      links: raw.links.filter((l) => keep.has(l.source) && keep.has(l.target)),
    };
  }, [raw, hiddenTypes, showOrphans, query]);

  if (error) return <div className="p-6 text-red-400">Graph error: {error}</div>;
  if (!raw) return <div className="p-6 text-slate-400">Loading relationship graph…</div>;

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      {/* HUD */}
      <div className="absolute left-4 top-4 z-10 w-64 space-y-2 rounded-md bg-slate-900/80 p-3 text-sm text-slate-200">
        <div className="font-semibold text-white">Relationship Graph</div>
        <div className="text-xs text-slate-400">
          {view.nodes.length}/{raw.nodes.length} nodes · {view.links.length} edges
          {raw.capped ? " (capped)" : ""}
        </div>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nodes…"
          className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs outline-none"
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showOrphans}
            onChange={(e) => setShowOrphans(e.target.checked)}
          />
          Show orphans
        </label>
        <div className="space-y-1">
          {types.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={!hiddenTypes.has(t)}
                onChange={(e) => {
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) next.delete(t);
                    else next.add(t);
                    return next;
                  });
                }}
              />
              {t}
            </label>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div className="absolute right-4 top-4 z-10 w-72 rounded-md bg-slate-900/90 p-4 text-sm text-slate-200">
          <button
            onClick={() => setSelected(null)}
            className="float-right text-slate-500 hover:text-slate-300"
          >
            ✕
          </button>
          <div className="mb-1 font-semibold text-white">{selected.label}</div>
          <div className="text-xs text-slate-400">type: {selected.type}</div>
          <div className="text-xs text-slate-400">degree: {selected.degree}</div>
          {selected.unsPath && (
            <div className="mt-2 break-words text-xs text-slate-400">
              {selected.unsPath}
            </div>
          )}
        </div>
      )}

      <GraphCanvas data={view} onNodeClick={setSelected} />
    </div>
  );
}

"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { GraphCanvas } from "@/components/kg/GraphCanvas";
import type { GraphNode, GraphLink } from "@/lib/knowledge-graph/graph-view";

interface GraphResponse {
  nodes: GraphNode[];
  links: GraphLink[];
  capped?: boolean;
  error?: string;
}

function GraphView() {
  const [raw, setRaw] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showOrphans, setShowOrphans] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);

  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const turnParam = searchParams.get("turn");
  const [trace, setTrace] = useState<{ ids: Set<string>; question: string | null; provider: string | null } | null>(null);

  const load = useCallback(() => {
    const url = showSuggestions ? "/api/kg/graph?includeProposals=true" : "/api/kg/graph";
    fetch(url)
      .then((r) => r.json())
      .then((j: GraphResponse) => {
        if (j.error) setError(j.error);
        else {
          setError(null);
          setRaw(j);
        }
      })
      .catch((e) => setError(String(e)));
  }, [showSuggestions]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!sessionParam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTrace(null);
      return;
    }
    const url = `/api/kg/trace?sessionId=${encodeURIComponent(sessionParam)}${
      turnParam ? `&turn=${encodeURIComponent(turnParam)}` : ""
    }`;
    fetch(url)
      .then((r) => r.json())
      .then((j: { entityIds?: string[]; question?: string | null; provider?: string | null; error?: string }) => {
        if (j.error || !j.entityIds) setTrace(null);
        else setTrace({ ids: new Set(j.entityIds), question: j.question ?? null, provider: j.provider ?? null });
      })
      .catch(() => setTrace(null));
  }, [sessionParam, turnParam]);

  const promote = useCallback(
    async (link: GraphLink) => {
      if (!link.proposalId) return;
      if (!window.confirm(`Promote suggested "${link.type}" edge to a confirmed relationship?`)) return;
      try {
        const res = await fetch(`/api/proposals/${link.proposalId}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "verify" }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `promote failed (${res.status})`);
          return;
        }
        load();
      } catch (e) {
        setError(String(e));
      }
    },
    [load],
  );

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
    const endId = (v: unknown): string =>
      typeof v === "string" ? v : (v as { id: string }).id;
    return {
      nodes: raw.nodes.filter((n) => keep.has(n.id)),
      links: raw.links.filter((l) => keep.has(endId(l.source)) && keep.has(endId(l.target))),
    };
  }, [raw, hiddenTypes, showOrphans, query]);

  if (error) return <div className="p-6 text-red-400">Graph error: {error}</div>;
  if (!raw) return <div className="p-6 text-slate-400">Loading relationship graph…</div>;

  const suggestionCount = raw.links.filter((l) => l.state === "proposed").length;

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      {trace && (
        <div className="absolute left-1/2 top-4 z-20 -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-100">
          <span className="font-semibold">Reasoning trace</span>
          {trace.question ? <> — “{trace.question}”</> : null}
          {trace.provider ? <span className="text-amber-300/70"> · {trace.provider}</span> : null}{" "}
          <Link href="/graph" className="ml-2 text-amber-200/80 underline hover:text-amber-100">
            Clear
          </Link>
        </div>
      )}
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
          <input type="checkbox" checked={showOrphans} onChange={(e) => setShowOrphans(e.target.checked)} />
          Show orphans
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showSuggestions}
            onChange={(e) => setShowSuggestions(e.target.checked)}
          />
          Show suggestions{showSuggestions && suggestionCount > 0 ? ` (${suggestionCount})` : ""}
        </label>
        {showSuggestions && (
          <div className="text-[11px] text-slate-500">Click a dashed edge to confirm it.</div>
        )}
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
          <button onClick={() => setSelected(null)} className="float-right text-slate-500 hover:text-slate-300">
            ✕
          </button>
          <div className="mb-1 font-semibold text-white">{selected.label}</div>
          <div className="text-xs text-slate-400">type: {selected.type}</div>
          <div className="text-xs text-slate-400">degree: {selected.degree}</div>
          {selected.unsPath && (
            <div className="mt-2 break-words text-xs text-slate-400">{selected.unsPath}</div>
          )}
        </div>
      )}

      <GraphCanvas data={view} onNodeClick={setSelected} onLinkClick={promote} highlightNodeIds={trace?.ids} />
    </div>
  );
}

export default function GraphPage() {
  return (
    <Suspense fallback={<div className="p-6 text-slate-400">Loading relationship graph…</div>}>
      <GraphView />
    </Suspense>
  );
}

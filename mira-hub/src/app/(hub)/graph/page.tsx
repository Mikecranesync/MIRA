"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const endId = (v: unknown): string =>
  typeof v === "string" ? v : (v as { id: string }).id;

function GraphView() {
  const searchParams = useSearchParams();
  const sessionParam = searchParams.get("session");
  const turnParam = searchParams.get("turn");

  const [raw, setRaw] = useState<GraphResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [showOrphans, setShowOrphans] = useState(true);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<GraphNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<GraphLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<{ ids: Set<string>; question: string | null; provider: string | null } | null>(null);
  const autoToggled = useRef(false);

  const load = useCallback(() => {
    // Always fetch proposals so we can show the suggestion count + empty state;
    // the toggle filters them client-side.
    fetch("/api/kg/graph?includeProposals=true")
      .then((r) => r.json())
      .then((j: GraphResponse) => {
        if (j.error) setError(j.error);
        else {
          setError(null);
          setRaw(j);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

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

  const verifiedCount = useMemo(() => (raw?.links ?? []).filter((l) => l.state !== "proposed").length, [raw]);
  const proposedCount = useMemo(() => (raw?.links ?? []).filter((l) => l.state === "proposed").length, [raw]);

  // Default "Show suggestions" ON the first time we load a graph with 0 verified
  // edges but >0 proposed — so the user isn't staring at disconnected dots.
  useEffect(() => {
    if (raw && !autoToggled.current && verifiedCount === 0 && proposedCount > 0) {
      autoToggled.current = true;
      setShowSuggestions(true);
    }
  }, [raw, verifiedCount, proposedCount]);

  const nodeById = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of raw?.nodes ?? []) m.set(n.id, n);
    return m;
  }, [raw]);

  const decide = useCallback(
    async (decision: "verify" | "reject") => {
      const link = selectedEdge;
      if (!link?.proposalId) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/proposals/${link.proposalId}/decide`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setError(j.error ?? `${decision} failed (${res.status})`);
        } else {
          setSelectedEdge(null);
          load();
        }
      } catch (e) {
        setError(String(e));
      } finally {
        setBusy(false);
      }
    },
    [selectedEdge, load],
  );

  const types = useMemo(() => [...new Set((raw?.nodes ?? []).map((n) => n.type))].sort(), [raw]);

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
    const links = raw.links
      .filter((l) => showSuggestions || l.state !== "proposed")
      .filter((l) => keep.has(endId(l.source)) && keep.has(endId(l.target)));
    return { nodes: raw.nodes.filter((n) => keep.has(n.id)), links };
  }, [raw, hiddenTypes, showOrphans, showSuggestions, query]);

  if (error) return <div className="p-6 text-red-400">Graph error: {error}</div>;
  if (!raw) return <div className="p-6 text-slate-400">Loading relationship graph…</div>;

  const showEmptyState = verifiedCount === 0 && proposedCount > 0;

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      {showEmptyState && (
        <div className="absolute left-1/2 top-4 z-20 w-[min(92vw,640px)] -translate-x-1/2 rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-center text-sm text-sky-100">
          No verified relationships yet. MIRA found <span className="font-semibold">{proposedCount}</span> proposed relationship
          {proposedCount === 1 ? "" : "s"}.{" "}
          {showSuggestions
            ? "Tap a dashed edge to review the evidence and confirm it."
            : "Turn on Show suggestions to review them."}
        </div>
      )}

      {trace && (
        <div className="absolute left-1/2 top-16 z-20 -translate-x-1/2 rounded-md border border-amber-500/40 bg-amber-500/15 px-4 py-2 text-sm text-amber-100">
          <span className="font-semibold">Reasoning trace</span>
          {trace.question ? <> — &ldquo;{trace.question}&rdquo;</> : null}
          {trace.provider ? <span className="text-amber-300/70"> · {trace.provider}</span> : null}{" "}
          <Link href="/graph" className="ml-2 text-amber-200/80 underline hover:text-amber-100">
            Clear
          </Link>
        </div>
      )}

      <div className="absolute left-4 top-4 z-10 w-64 space-y-2 rounded-md bg-slate-900/80 p-3 text-sm text-slate-200">
        <div className="font-semibold text-white">Relationship Graph</div>
        <div className="text-xs text-slate-400">
          {view.nodes.length}/{raw.nodes.length} nodes · {view.links.length} edges{raw.capped ? " (capped)" : ""}
        </div>
        <div className="text-[11px] text-slate-500">
          {verifiedCount} verified · {proposedCount} proposed
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
          <input type="checkbox" checked={showSuggestions} onChange={(e) => setShowSuggestions(e.target.checked)} />
          Show suggestions{proposedCount > 0 ? ` (${proposedCount})` : ""}
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

      {selectedEdge?.proposalId && (
        <div className="absolute right-4 top-4 z-10 w-80 rounded-md bg-slate-900/95 p-4 text-sm text-slate-200">
          <button onClick={() => setSelectedEdge(null)} className="float-right text-slate-500 hover:text-slate-300">
            ✕
          </button>
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-300">Proposed by MIRA</div>
          <div className="mb-2 font-semibold text-white">{selectedEdge.type}</div>
          <div className="text-xs text-slate-400">
            {nodeById.get(endId(selectedEdge.source))?.label ?? "?"} <span className="text-slate-600">→</span>{" "}
            {nodeById.get(endId(selectedEdge.target))?.label ?? "?"}
          </div>
          <div className="mt-3 text-[11px] uppercase tracking-wide text-slate-500">Why MIRA thinks this</div>
          <div className="mt-1 text-xs text-slate-300">
            {selectedEdge.reasoning ?? "No explanation recorded for this proposal."}
          </div>
          <div className="mt-4 flex gap-2">
            <button
              disabled={busy}
              onClick={() => decide("verify")}
              className="flex-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              Confirm
            </button>
            <button
              disabled={busy}
              onClick={() => decide("reject")}
              className="flex-1 rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
            >
              Reject
            </button>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            Confirm makes it a verified relationship. Reject removes the suggestion.
          </div>
        </div>
      )}

      {selected && !selectedEdge && (
        <div className="absolute right-4 top-4 z-10 w-72 rounded-md bg-slate-900/90 p-4 text-sm text-slate-200">
          <button onClick={() => setSelected(null)} className="float-right text-slate-500 hover:text-slate-300">
            ✕
          </button>
          <div className="mb-1 font-semibold text-white">{selected.label}</div>
          <div className="text-xs text-slate-400">type: {selected.type}</div>
          <div className="text-xs text-slate-400">degree: {selected.degree}</div>
          {selected.unsPath && <div className="mt-2 break-words text-xs text-slate-400">{selected.unsPath}</div>}
        </div>
      )}

      <GraphCanvas
        data={view}
        onNodeClick={(n) => {
          setSelected(n);
          setSelectedEdge(null);
        }}
        onLinkClick={(l) => setSelectedEdge(l.proposalId ? l : null)}
        highlightNodeIds={trace?.ids}
      />
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

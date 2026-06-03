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

interface Friendly {
  label: string;
  lead: (src: string, tgt: string) => string;
  confirm: string;
  footer: string;
  targetLabel?: string;
}

// Plain-English presentation of edge types for maintenance technicians.
const FRIENDLY: Record<string, Friendly> = {
  HAS_DOCUMENT: {
    label: "User manual",
    lead: (src) => `MIRA found a manual that looks like it belongs to ${src}.`,
    confirm: "Link manual",
    footer: "Linking saves this manual to the component so techs can find it later.",
    targetLabel: "Manual",
  },
};

function friendlyEdge(type: string): Friendly {
  return (
    FRIENDLY[type] ?? {
      label: type.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase()),
      lead: (src, tgt) => `MIRA suggests linking ${src} and ${tgt}.`,
      confirm: "Confirm",
      footer: "Confirm to save this connection. Reject if it's wrong.",
    }
  );
}

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
  const density = Math.min(verifiedCount / 24, 1); // 0..1 → ambient glow + lattice brightness

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
    <div className="relative h-[calc(100vh-7rem)] w-full overflow-hidden bg-[#05070d]">
      {/* depth */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at 50% 45%, #0b1018 0%, #05070d 62%, #03040a 100%)" }}
      />
      {/* knowledge-density ambient sphere (more verified knowledge → stronger glow) */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          style={{
            width: "62vmin",
            height: "62vmin",
            borderRadius: "50%",
            background:
              "radial-gradient(circle, rgba(94,234,212,0.16) 0%, rgba(94,234,212,0.05) 46%, rgba(0,0,0,0) 70%)",
            opacity: 0.22 + 0.6 * density,
            filter: "blur(8px)",
          }}
        />
      </div>

      {showEmptyState && (
        <div className="absolute left-1/2 top-4 z-20 w-[min(92vw,640px)] -translate-x-1/2 rounded-md border border-sky-500/40 bg-sky-500/10 px-4 py-2 text-center text-sm text-sky-100">
          No verified relationships yet. MIRA found <span className="font-semibold">{proposedCount}</span> suggested connection
          {proposedCount === 1 ? "" : "s"} to review.{" "}
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
          <Link href="/knowledge/map" className="ml-2 text-amber-200/80 underline hover:text-amber-100">
            Clear
          </Link>
        </div>
      )}

      <div className="absolute left-4 top-4 z-10 w-56 max-h-[44vh] overflow-y-auto space-y-2 rounded-md bg-slate-900/80 p-3 text-sm text-slate-200 sm:w-64">
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

      {selectedEdge?.proposalId &&
        (() => {
          const f = friendlyEdge(selectedEdge.type);
          const src = nodeById.get(endId(selectedEdge.source))?.label ?? "this component";
          const tgt = nodeById.get(endId(selectedEdge.target))?.label ?? "this item";
          return (
            <div className="absolute inset-x-2 bottom-2 z-20 w-auto rounded-xl bg-slate-900/95 p-4 text-sm text-slate-200 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-80 sm:rounded-md">
              <button onClick={() => setSelectedEdge(null)} className="float-right text-slate-500 hover:text-slate-300">
                ✕
              </button>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-300">Suggested by MIRA</div>
              <div className="mb-2 text-base font-semibold text-white">{f.label}</div>
              <div className="text-xs text-slate-300">{f.lead(src, tgt)}</div>
              {f.targetLabel && (
                <div className="mt-2 rounded bg-slate-800/70 px-2 py-1 text-xs text-slate-300">
                  <span className="text-slate-500">{f.targetLabel}:</span> {tgt}
                </div>
              )}
              {selectedEdge.reasoning && (
                <div className="mt-2 text-[11px] text-slate-500">Match: {selectedEdge.reasoning}</div>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  disabled={busy}
                  onClick={() => decide("verify")}
                  className="flex-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  {f.confirm}
                </button>
                <button
                  disabled={busy}
                  onClick={() => decide("reject")}
                  className="flex-1 rounded border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                >
                  Not this one
                </button>
              </div>
              <div className="mt-2 text-[10px] text-slate-500">{f.footer}</div>
            </div>
          );
        })()}

      {selected && !selectedEdge && (
        <div className="absolute inset-x-2 bottom-2 z-20 w-auto rounded-xl bg-slate-900/90 p-4 text-sm text-slate-200 sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-4 sm:w-72 sm:rounded-md">
          <button onClick={() => setSelected(null)} className="float-right text-slate-500 hover:text-slate-300">
            ✕
          </button>
          <div className="mb-1 font-semibold text-white">{selected.label}</div>
          <div className="text-xs text-slate-400">type: {selected.type}</div>
          <div className="text-xs text-slate-400">degree: {selected.degree}</div>
          {selected.unsPath && <div className="mt-2 break-words text-xs text-slate-400">{selected.unsPath}</div>}
        </div>
      )}

      <div className="absolute inset-0">
        <GraphCanvas
          data={view}
          onNodeClick={(n) => {
            setSelected(n);
            setSelectedEdge(null);
          }}
          onLinkClick={(l) => setSelectedEdge(l.proposalId ? l : null)}
          highlightNodeIds={trace?.ids}
          intensity={density}
        />
      </div>

      <div className="pointer-events-none absolute bottom-3 left-3 z-10 hidden rounded-md bg-slate-900/55 px-3 py-2 text-[10px] leading-relaxed text-slate-400 backdrop-blur-sm sm:block">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-px w-4" style={{ background: "rgba(94,234,212,0.7)" }} /> solid = verified
        </div>
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-4 border-t border-dashed" style={{ borderColor: "rgba(120,150,135,0.85)" }} /> dashed = proposed by MIRA
        </div>
        <div className="mt-0.5 text-slate-500">green network = connected knowledge</div>
      </div>
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

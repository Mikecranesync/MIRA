"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Brain, Database, Network, Cpu, Globe, RefreshCw,
  Play, ExternalLink, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EnrichmentReport, KBHit, KGEntityHit, WebResult, YouTubeHit } from "@/lib/agents/asset-intelligence";

interface Props { assetId: string }

export function AssetIntelligencePanel({ assetId }: Props) {
  const [report, setReport] = useState<EnrichmentReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/hub/api/assets/${assetId}/enrich`);
      if (resp.ok) setReport(await resp.json());
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => { load(); }, [load]);

  const runEnrichment = async () => {
    setRunning(true);
    try {
      const resp = await fetch(`/hub/api/assets/${assetId}/enrich`, { method: "POST" });
      if (resp.ok) setReport(await resp.json());
    } finally {
      setRunning(false);
    }
  };

  if (loading) return <LoadingSkeleton />;

  if (!report) {
    return (
      <div className="flex flex-col items-center gap-4 py-10">
        <div className="w-14 h-14 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "var(--surface-1)" }}>
          <Brain className="w-7 h-7" style={{ color: "var(--brand-blue)" }} />
        </div>
        <div className="text-center">
          <p className="font-semibold text-sm" style={{ color: "var(--foreground)" }}>No intelligence yet</p>
          <p className="text-xs mt-1" style={{ color: "var(--foreground-muted)" }}>
            Run enrichment to pull KB matches, KG relationships, and expert video insights.
          </p>
        </div>
        <Button onClick={runEnrichment} disabled={running} size="sm"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", color: "#fff" }}>
          {running ? <RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
          {running ? "Enriching…" : "Run Intelligence"}
        </Button>
      </div>
    );
  }

  const { sources, enrichedAt, durationMs, status } = report;
  const totalHits = sources.kb.length + sources.kgEntities.length + sources.web.length + sources.oemAdvisories.length + sources.youtube.length;

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
          <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            {totalHits} signals
          </span>
          <StatusPill status={status} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
            {enrichedAt.slice(0, 10)} · {Math.round(durationMs / 100) / 10}s
          </span>
          <Button variant="ghost" size="sm" onClick={runEnrichment} disabled={running}
            className="h-7 px-2 text-xs gap-1">
            <RefreshCw className={`w-3 h-3 ${running ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* CMMS Summary */}
      <CMMSCard summary={sources.cmms} />

      {/* KB Knowledge */}
      {sources.kb.length > 0 && (
        <Section title="Knowledge Base" icon={<Database className="w-4 h-4" />} count={sources.kb.length}>
          {sources.kb.map((hit) => <KBCard key={hit.id} hit={hit} />)}
        </Section>
      )}

      {/* KG Entities */}
      {sources.kgEntities.length > 0 && (
        <Section title="Knowledge Graph" icon={<Network className="w-4 h-4" />} count={sources.kgEntities.length}>
          <div className="flex flex-wrap gap-2">
            {sources.kgEntities.map((e) => <EntityChip key={e.id} entity={e} />)}
          </div>
          {sources.kgRelationships.length > 0 && (
            <p className="text-[11px] mt-2" style={{ color: "var(--foreground-subtle)" }}>
              {sources.kgRelationships.length} relationship{sources.kgRelationships.length !== 1 ? "s" : ""} mapped
            </p>
          )}
        </Section>
      )}

      {/* OEM Advisories */}
      {sources.oemAdvisories.length > 0 && (
        <Section title="OEM Advisories" icon={<Cpu className="w-4 h-4" />} count={sources.oemAdvisories.length}>
          {sources.oemAdvisories.map((hit) => <KBCard key={hit.id} hit={hit} />)}
        </Section>
      )}

      {/* Web Results */}
      {sources.web.length > 0 && (
        <Section title="Web Search" icon={<Globe className="w-4 h-4" />} count={sources.web.length}>
          {sources.web.map((r, i) => <WebCard key={i} result={r} />)}
        </Section>
      )}

      {/* YouTube */}
      {sources.youtube.length > 0 && (
        <Section title="Expert Videos" icon={<span className="text-sm">▶</span>} count={sources.youtube.length}>
          {sources.youtube.map((hit) => <YouTubeCard key={hit.videoId} hit={hit} />)}
        </Section>
      )}

      {totalHits === 0 && (
        <div className="rounded-xl p-4 text-center text-sm" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
          No signals found. Add OEM documents to the KB or check manufacturer/model fields.
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cfg = {
    complete: { bg: "#DCFCE7", color: "#16A34A", label: "Complete" },
    partial:  { bg: "#FEF9C3", color: "#CA8A04", label: "Partial" },
    failed:   { bg: "#FEE2E2", color: "#DC2626", label: "Failed" },
  }[status] ?? { bg: "var(--surface-1)", color: "var(--foreground-muted)", label: status };

  return (
    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}>
      {cfg.label}
    </span>
  );
}

function Section({ title, icon, count, children }: {
  title: string; icon: React.ReactNode; count: number; children: React.ReactNode;
}) {
  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--brand-blue)" }}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>
          {title}
        </span>
        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full ml-auto"
          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
          {count}
        </span>
      </div>
      {children}
    </div>
  );
}

function CMMSCard({ summary }: { summary: EnrichmentReport["sources"]["cmms"] }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {[
        { label: "Work Orders", value: summary.openWorkOrders },
        { label: "Downtime (hrs)", value: summary.totalDowntimeHours.toFixed(1) },
        { label: "Last Maintenance", value: summary.lastMaintenance?.slice(0, 10) ?? "—" },
        { label: "Last Fault", value: summary.lastFault ?? "None reported" },
      ].map(({ label, value }) => (
        <div key={label} className="card p-3">
          <p className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "var(--foreground-subtle)" }}>{label}</p>
          <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function KBCard({ hit }: { hit: KBHit }) {
  const [expanded, setExpanded] = useState(false);
  const preview = hit.content.slice(0, 200);
  const hasMore = hit.content.length > 200;

  return (
    <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: "var(--surface-1)" }}>
      <div className="flex items-start justify-between gap-2">
        <p style={{ color: "var(--foreground)" }}>
          {expanded ? hit.content : preview}
          {!expanded && hasMore && "…"}
        </p>
        {hasMore && (
          <button onClick={() => setExpanded(!expanded)} className="flex-shrink-0 mt-0.5"
            style={{ color: "var(--brand-blue)" }}>
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>
      {hit.sourceUrl && (
        <a href={hit.sourceUrl} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-[10px]"
          style={{ color: "var(--brand-blue)" }}>
          <ExternalLink className="w-2.5 h-2.5" /> Source
        </a>
      )}
      <span className="float-right text-[10px] mt-1" style={{ color: "var(--foreground-subtle)" }}>
        {Math.round(hit.score * 100)}% match
      </span>
    </div>
  );
}

function EntityChip({ entity }: { entity: KGEntityHit }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs"
      style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground)" }}>
      <span className="text-[10px] font-medium uppercase" style={{ color: "var(--brand-blue)" }}>
        {entity.entityType}
      </span>
      <span>{entity.name}</span>
    </div>
  );
}

function WebCard({ result }: { result: WebResult }) {
  return (
    <a href={result.url} target="_blank" rel="noopener noreferrer"
      className="block rounded-lg p-3 hover:opacity-80 transition-opacity"
      style={{ backgroundColor: "var(--surface-1)" }}>
      <p className="text-xs font-medium" style={{ color: "var(--brand-blue)" }}>{result.title}</p>
      <p className="text-[11px] mt-1 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
        {result.snippet}
      </p>
      <p className="text-[10px] mt-1.5 flex items-center gap-1" style={{ color: "var(--foreground-subtle)" }}>
        <ExternalLink className="w-2.5 h-2.5" /> {new URL(result.url).hostname}
      </p>
    </a>
  );
}

function YouTubeCard({ hit }: { hit: YouTubeHit }) {
  return (
    <a href={hit.videoUrl} target="_blank" rel="noopener noreferrer"
      className="block rounded-lg p-3 hover:opacity-80 transition-opacity"
      style={{ backgroundColor: "var(--surface-1)" }}>
      <div className="flex items-start gap-2">
        <div className="w-8 h-8 rounded flex items-center justify-center flex-shrink-0"
          style={{ backgroundColor: "#FF0000", color: "#fff" }}>
          <Play className="w-3.5 h-3.5 fill-current" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium leading-snug" style={{ color: "var(--foreground)" }}>{hit.videoTitle}</p>
          <p className="text-[10px] mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            {hit.channel} · {hit.viewCount.toLocaleString()} views · {hit.topic}
          </p>
        </div>
      </div>
      <p className="text-[11px] mt-2 leading-relaxed" style={{ color: "var(--foreground-subtle)" }}>
        {hit.snippet}…
      </p>
    </a>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-4 w-32 rounded" style={{ backgroundColor: "var(--surface-1)" }} />
      <div className="grid grid-cols-2 gap-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }} />
        ))}
      </div>
      <div className="h-32 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }} />
      <div className="h-24 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }} />
    </div>
  );
}

"use client";

// /decision-traces/[id] — read-only admin detail view for a single
// decision_traces row (Phase 8, issue #1660).
//
// Data comes from GET /api/decision-trace/[id] (tenant-scoped, RLS-enforced).
// This is an observational page only — no writes, no mutations.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Cpu,
  MapPin,
  MessageSquare,
  Tag,
  BookOpen,
  Share2,
} from "lucide-react";
import { API_BASE } from "@/lib/config";

interface TraceRow {
  trace_id: string;
  platform: string | null;
  uns_path: string | null;
  user_question: string;
  tag_evidence: Array<Record<string, unknown>>;
  manual_evidence: Array<Record<string, unknown>>;
  kg_evidence: Array<Record<string, unknown>>;
  recommendation: string | null;
  citations_present: boolean;
  confidence: string | null;
  outcome: string | null;
  model_used: string | null;
  latency_ms: number | null;
  ts: string;
}

const PLATFORM_LABEL: Record<string, string> = {
  slack: "Slack",
  telegram: "Telegram",
  ignition: "Ignition",
  hub: "Hub",
  web: "Web",
};

const CONFIDENCE_CLASS: Record<string, string> = {
  high: "text-green-600",
  medium: "text-amber-500",
  low: "text-red-500",
  none: "text-gray-400",
};

const OUTCOME_CLASS: Record<string, string> = {
  resolved: "text-green-600",
  gate_fired: "text-blue-500",
  kb_gap: "text-amber-500",
  handoff: "text-purple-500",
  engine_error: "text-red-500",
};

function EvidencePanel({
  title,
  icon,
  items,
}: {
  title: string;
  icon: React.ReactNode;
  items: Array<Record<string, unknown>>;
}) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;
  return (
    <div className="border border-[var(--fl-line)] rounded-lg overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-4 py-3 bg-[var(--fl-surface)] hover:bg-[var(--fl-surface-raised)] transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-sm font-medium text-[var(--fl-text)]">
          {icon}
          {title}
          <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-[var(--fl-surface-raised)] text-[var(--fl-text-muted)]">
            {items.length}
          </span>
        </span>
        {open ? (
          <ChevronUp className="w-4 h-4 text-[var(--fl-text-muted)]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[var(--fl-text-muted)]" />
        )}
      </button>
      {open && (
        <div className="px-4 py-3 bg-[var(--fl-background)] border-t border-[var(--fl-line)]">
          <pre className="text-xs text-[var(--fl-text-muted)] whitespace-pre-wrap break-all overflow-auto max-h-64">
            {JSON.stringify(items, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export default function DecisionTracePage() {
  const { id } = useParams<{ id: string }>();
  const [trace, setTrace] = useState<TraceRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetch(`${API_BASE}/api/decision-trace/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          setError((body as { error?: string }).error ?? `HTTP ${r.status}`);
          return;
        }
        setTrace(await r.json());
      })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-[var(--fl-text-muted)]">
        <Clock className="w-5 h-5 animate-spin mr-2" />
        Loading trace…
      </div>
    );
  }

  if (error || !trace) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/command-center"
          className="inline-flex items-center gap-1 text-sm text-[var(--fl-text-muted)] hover:text-[var(--fl-text)] mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="rounded-lg border border-[var(--fl-line)] bg-[var(--fl-surface)] px-6 py-8 text-center text-[var(--fl-text-muted)]">
          {error === "not_found"
            ? "Trace not found or belongs to a different tenant."
            : `Could not load trace: ${error ?? "unknown error"}`}
        </div>
      </div>
    );
  }

  const tagEvidence: Array<Record<string, unknown>> = Array.isArray(trace.tag_evidence)
    ? trace.tag_evidence
    : [];
  const manualEvidence: Array<Record<string, unknown>> = Array.isArray(trace.manual_evidence)
    ? trace.manual_evidence
    : [];
  const kgEvidence: Array<Record<string, unknown>> = Array.isArray(trace.kg_evidence)
    ? trace.kg_evidence
    : [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      {/* Header */}
      <div>
        <Link
          href="/command-center"
          className="inline-flex items-center gap-1 text-sm text-[var(--fl-text-muted)] hover:text-[var(--fl-text)] mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-semibold text-[var(--fl-text)]">Decision Trace</h1>
            <p className="text-xs font-mono text-[var(--fl-text-muted)] mt-0.5">{trace.trace_id}</p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {trace.platform && (
              <span className="px-2 py-0.5 rounded text-xs bg-[var(--fl-surface-raised)] text-[var(--fl-text-muted)] font-medium">
                {PLATFORM_LABEL[trace.platform] ?? trace.platform}
              </span>
            )}
            {trace.citations_present ? (
              <span className="inline-flex items-center gap-1 text-xs text-green-600 font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Cited
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs text-red-500 font-medium">
                <XCircle className="w-3.5 h-3.5" />
                Uncited
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Metadata row */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div className="rounded-lg border border-[var(--fl-line)] bg-[var(--fl-surface)] px-4 py-3 space-y-1">
          <p className="text-xs text-[var(--fl-text-muted)] font-medium uppercase tracking-wide">Time</p>
          <p className="text-[var(--fl-text)]">
            {new Date(trace.ts).toLocaleString()}
          </p>
        </div>
        <div className="rounded-lg border border-[var(--fl-line)] bg-[var(--fl-surface)] px-4 py-3 space-y-1">
          <p className="text-xs text-[var(--fl-text-muted)] font-medium uppercase tracking-wide">Confidence</p>
          <p className={`font-medium ${CONFIDENCE_CLASS[trace.confidence ?? ""] ?? "text-gray-400"}`}>
            {trace.confidence ?? "—"}
          </p>
        </div>
        {trace.uns_path && (
          <div className="col-span-2 rounded-lg border border-[var(--fl-line)] bg-[var(--fl-surface)] px-4 py-3 space-y-1">
            <p className="text-xs text-[var(--fl-text-muted)] font-medium uppercase tracking-wide flex items-center gap-1">
              <MapPin className="w-3 h-3" />
              UNS Path
            </p>
            <p className="text-[var(--fl-text)] font-mono text-xs break-all">{trace.uns_path}</p>
          </div>
        )}
      </div>

      {/* Question */}
      <div className="rounded-lg border border-[var(--fl-line)] bg-[var(--fl-surface)] px-4 py-3 space-y-1">
        <p className="text-xs text-[var(--fl-text-muted)] font-medium uppercase tracking-wide flex items-center gap-1">
          <MessageSquare className="w-3 h-3" />
          Question (sanitized)
        </p>
        <p className="text-[var(--fl-text)]">{trace.user_question}</p>
      </div>

      {/* Recommendation */}
      {trace.recommendation && (
        <div className="rounded-lg border border-[var(--fl-line)] bg-[var(--fl-surface)] px-4 py-3 space-y-1">
          <p className="text-xs text-[var(--fl-text-muted)] font-medium uppercase tracking-wide">Recommendation (sanitized)</p>
          <p className="text-[var(--fl-text)] whitespace-pre-wrap">{trace.recommendation}</p>
        </div>
      )}

      {/* Outcome + model */}
      <div className="flex items-center gap-4 text-sm text-[var(--fl-text-muted)]">
        {trace.outcome && (
          <span className={`font-medium ${OUTCOME_CLASS[trace.outcome] ?? ""}`}>
            Outcome: {trace.outcome}
          </span>
        )}
        {trace.model_used && (
          <span className="flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5" />
            {trace.model_used}
          </span>
        )}
        {trace.latency_ms != null && (
          <span className="flex items-center gap-1">
            <Clock className="w-3.5 h-3.5" />
            {trace.latency_ms} ms
          </span>
        )}
      </div>

      {/* Evidence panels */}
      <div className="space-y-3">
        <EvidencePanel
          title="Tag evidence"
          icon={<Tag className="w-4 h-4" />}
          items={tagEvidence}
        />
        <EvidencePanel
          title="Manual evidence"
          icon={<BookOpen className="w-4 h-4" />}
          items={manualEvidence}
        />
        <EvidencePanel
          title="KG evidence"
          icon={<Share2 className="w-4 h-4" />}
          items={kgEvidence}
        />
      </div>
    </div>
  );
}

"use client";

// /decision-traces/[id] — full decision-trace admin view.
// Loads the trace once and renders all evidence inline. Read-only.

import { useParams } from "next/navigation";
import Link from "next/link";
import { useState, useEffect } from "react";
import {
  ArrowLeft, MessageSquare, FileText, Activity, Network,
  CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { API_BASE } from "@/lib/config";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ManualEv { doc?: string; page?: number | null; score?: number | null; chunk_id?: string; }
interface TagEv    { tag_path?: string; value?: unknown; quality?: string | null; uns_path?: string | null; }
interface KgEv     { entity_id?: string; rel?: string; target?: unknown; }

interface Trace {
  trace_id: string;
  session_id: string | null;
  platform: string | null;
  uns_path: string | null;
  user_question: string;
  recommendation: string | null;
  tag_evidence: TagEv[];
  manual_evidence: ManualEv[];
  kg_evidence: KgEv[];
  citations_present: boolean;
  confidence: string | null;
  outcome: string | null;
  model_used: string | null;
  latency_ms: number | null;
  ts: string;
}

function formatTs(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}44` }}
    >
      {label}
    </span>
  );
}

function ConfPill({ value }: { value: string | null }) {
  const c = (value ?? "none").toLowerCase();
  const color =
    c === "high" ? "#16A34A" : c === "medium" ? "#D97706" : c === "low" ? "#DC2626" : "#6B7280";
  return <Pill label={`Confidence: ${c}`} color={color} />;
}

function Section({ icon: Icon, title, children }: { icon: typeof FileText; title: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--foreground-subtle)" }}>
        <Icon className="w-3.5 h-3.5" /> {title}
      </div>
      <div className="text-sm" style={{ color: "var(--foreground)" }}>{children}</div>
    </div>
  );
}

export default function DecisionTraceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? params.id : "";

  const [trace, setTrace] = useState<Trace | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!UUID_RE.test(id)) return;
    void fetch(`${API_BASE}/api/decision-trace/${id}`)
      .then((r) => {
        if (r.status === 404) { setError("Trace not found — it may belong to another tenant or may not exist."); return null; }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => { if (d) setTrace(d as Trace); })
      .catch(() => setError("Couldn't load trace."));
  }, [id]);

  if (!UUID_RE.test(id)) {
    return (
      <div className="p-6 text-sm" style={{ color: "var(--foreground-subtle)" }}>
        Invalid trace ID.
      </div>
    );
  }

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div
        className="sticky top-0 z-10 flex items-center gap-3 border-b px-4 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <Link
          href="/decision-traces"
          className="flex items-center gap-1 text-xs rounded-md px-2 py-1 transition-colors hover:bg-[var(--surface-1)]"
          style={{ color: "var(--foreground-subtle)" }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Decision Traces
        </Link>
        <span style={{ color: "var(--border)" }}>·</span>
        <span className="text-xs font-mono truncate" style={{ color: "var(--foreground-subtle)" }}>
          {id.slice(0, 8)}…
        </span>
      </div>

      <div className="p-4 max-w-2xl">
        {!trace && !error && (
          <div className="flex items-center gap-2 py-10 justify-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {error && (
          <div className="py-10 text-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
            {error}
          </div>
        )}

        {trace && (
          <div
            className="rounded-lg p-4 space-y-1"
            style={{ background: "var(--surface-0)", border: "1px solid var(--border)" }}
          >
            {/* Meta row */}
            <div className="flex items-center gap-2 flex-wrap text-xs" style={{ color: "var(--foreground-subtle)" }}>
              <span>{formatTs(trace.ts)}</span>
              {trace.platform && <span>· {trace.platform}</span>}
              {trace.uns_path && (
                <span
                  className="rounded px-1 py-0.5"
                  style={{ background: "var(--surface-2)", fontFamily: "monospace" }}
                >
                  {trace.uns_path}
                </span>
              )}
            </div>

            {/* Question */}
            <Section icon={MessageSquare} title="Question">
              {trace.user_question}
            </Section>

            {/* Evidence */}
            {(trace.manual_evidence?.length ?? 0) > 0 && (
              <Section icon={FileText} title={`Manual evidence (${trace.manual_evidence.length})`}>
                <ul className="space-y-1">
                  {trace.manual_evidence.map((m, i) => (
                    <li key={i}>
                      {m.doc ?? "OEM document"}
                      {m.page != null ? ` · p.${m.page}` : ""}
                      {m.score != null ? ` · score ${m.score.toFixed(3)}` : ""}
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {(trace.tag_evidence?.length ?? 0) > 0 && (
              <Section icon={Activity} title={`Live tags (${trace.tag_evidence.length})`}>
                <ul className="space-y-1 font-mono text-xs">
                  {trace.tag_evidence.map((t, i) => (
                    <li key={i}>{t.tag_path ?? t.uns_path ?? "?"} = {String(t.value ?? "?")}</li>
                  ))}
                </ul>
              </Section>
            )}

            {(trace.kg_evidence?.length ?? 0) > 0 && (
              <Section icon={Network} title={`Knowledge graph (${trace.kg_evidence.length})`}>
                <ul className="space-y-1">
                  {trace.kg_evidence.map((k, i) => (
                    <li key={i}>{k.entity_id} —[{k.rel}]→ {String(k.target)}</li>
                  ))}
                </ul>
              </Section>
            )}

            {/* Recommendation */}
            {trace.recommendation && (
              <Section icon={MessageSquare} title="Recommendation">
                <p className="whitespace-pre-wrap">{trace.recommendation}</p>
              </Section>
            )}

            {/* Outcome row */}
            <div className="mt-4 pt-3 flex items-center gap-2 flex-wrap" style={{ borderTop: "1px solid var(--border)" }}>
              {trace.citations_present ? (
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#16A34A" }}>
                  <CheckCircle2 className="w-3.5 h-3.5" /> Citations present
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#DC2626" }}>
                  <XCircle className="w-3.5 h-3.5" /> No citations
                </span>
              )}
              <ConfPill value={trace.confidence} />
              {trace.outcome && (
                <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                  · {trace.outcome}
                </span>
              )}
              {trace.model_used && (
                <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                  · {trace.model_used}
                </span>
              )}
              {trace.latency_ms != null && (
                <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                  · {trace.latency_ms} ms
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

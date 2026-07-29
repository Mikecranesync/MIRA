"use client";

// Read-only admin view for a single decision_traces row.
// The API route at /api/decision-trace/[id] handles auth (sessionOr401) and
// tenant-scoping — this page just fetches and renders the result.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { API_BASE } from "@/lib/config";
import { ChevronLeft } from "lucide-react";

type DecisionTrace = {
  trace_id: string;
  platform: string | null;
  uns_path: string | null;
  user_question: string;
  tag_evidence: unknown[];
  manual_evidence: unknown[];
  kg_evidence: unknown[];
  recommendation: string;
  citations_present: boolean;
  confidence: string | null;
  outcome: string | null;
  model_used: string | null;
  latency_ms: number | null;
  ts: string;
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-4 py-3 border-b"
      style={{ borderColor: "var(--border)" }}
    >
      <span
        className="text-xs w-36 shrink-0 pt-0.5"
        style={{ color: "var(--foreground-muted)" }}
      >
        {label}
      </span>
      <span className="text-sm break-words min-w-0 flex-1" style={{ color: "var(--foreground)" }}>
        {children}
      </span>
    </div>
  );
}

function Badge({ value }: { value: string | null | boolean }) {
  if (value === null || value === undefined) return <span style={{ color: "var(--foreground-subtle)" }}>—</span>;
  const str = String(value);
  const color =
    str === "true" || str === "high" || str === "resolved"
      ? "var(--ok)"
      : str === "false" || str === "low" || str === "none"
      ? "var(--fault)"
      : "var(--warning)";
  return (
    <span
      className="inline-block px-2 py-0.5 rounded text-xs font-medium"
      style={{ background: color + "22", color }}
    >
      {str}
    </span>
  );
}

function JsonBlock({ data }: { data: unknown }) {
  if (!Array.isArray(data) || data.length === 0) {
    return <span style={{ color: "var(--foreground-subtle)" }}>—</span>;
  }
  return (
    <pre
      className="text-xs rounded p-2 overflow-x-auto max-h-48"
      style={{ background: "var(--surface-1)", color: "var(--foreground-muted)" }}
    >
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default function DecisionTracePage() {
  const params = useParams<{ id: string }>();
  const [trace, setTrace] = useState<DecisionTrace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params?.id) return;
    fetch(`${API_BASE}/api/decision-trace/${params.id}`)
      .then((r) => {
        if (r.status === 401) { window.location.href = "/login"; return null; }
        if (!r.ok) { setError(`${r.status}: ${r.statusText}`); return null; }
        return r.json() as Promise<DecisionTrace>;
      })
      .then((d) => { if (d) setTrace(d); })
      .catch((e: unknown) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [params?.id]);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div
        className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="px-4 md:px-6 py-3">
          <Link
            href="/event-log"
            className="inline-flex items-center gap-1 text-xs mb-1"
            style={{ color: "var(--foreground-muted)" }}
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Event Log
          </Link>
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
            Decision Trace
          </h1>
          {trace && (
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
              {trace.trace_id}
            </p>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="px-4 md:px-6 py-4 max-w-3xl mx-auto">
        {loading && (
          <p className="text-sm" style={{ color: "var(--foreground-subtle)" }}>Loading…</p>
        )}
        {error && (
          <p className="text-sm" style={{ color: "var(--fault)" }}>Error: {error}</p>
        )}
        {trace && (
          <div className="card p-4">
            <Row label="Timestamp">{new Date(trace.ts).toLocaleString()}</Row>
            <Row label="Platform">{trace.platform ?? "—"}</Row>
            <Row label="UNS Path">{trace.uns_path ?? "—"}</Row>
            <Row label="Outcome"><Badge value={trace.outcome} /></Row>
            <Row label="Confidence"><Badge value={trace.confidence} /></Row>
            <Row label="Citations present"><Badge value={trace.citations_present} /></Row>
            <Row label="Model">{trace.model_used ?? "—"}</Row>
            <Row label="Latency">
              {trace.latency_ms != null ? `${trace.latency_ms} ms` : "—"}
            </Row>
            <Row label="Question">
              <span className="whitespace-pre-wrap">{trace.user_question}</span>
            </Row>
            <Row label="Recommendation">
              <span className="whitespace-pre-wrap">{trace.recommendation}</span>
            </Row>
            <Row label="Tag evidence">
              <JsonBlock data={trace.tag_evidence} />
            </Row>
            <Row label="Manual evidence">
              <JsonBlock data={trace.manual_evidence} />
            </Row>
            <Row label="KG evidence">
              <JsonBlock data={trace.kg_evidence} />
            </Row>
          </div>
        )}
      </div>
    </div>
  );
}

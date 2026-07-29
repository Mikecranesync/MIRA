"use client";

// /decision-traces — admin list of the most recent grounded-turn audit rows.
// Read-only. Tenant-scoped (each tenant sees only their own rows).

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Brain, CheckCircle2, XCircle, Loader2, RefreshCw, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { API_BASE } from "@/lib/config";

interface TraceRow {
  trace_id: string;
  session_id: string | null;
  platform: string | null;
  uns_path: string | null;
  user_question: string;
  citations_present: boolean;
  confidence: string | null;
  outcome: string | null;
  model_used: string | null;
  latency_ms: number | null;
  ts: string;
}

function formatTs(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 24) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffH < 48) return `Yesterday ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function ConfidencePill({ value }: { value: string | null }) {
  const c = (value ?? "none").toLowerCase();
  const color =
    c === "high" ? "#16A34A" : c === "medium" ? "#D97706" : c === "low" ? "#DC2626" : "#6B7280";
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium"
      style={{ background: `${color}1A`, color, border: `1px solid ${color}44` }}
    >
      {c}
    </span>
  );
}

export default function DecisionTracesPage() {
  const [rows, setRows] = useState<TraceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/decision-trace?limit=50`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { rows: TraceRow[] };
      setRows(data.rows ?? []);
    } catch {
      setError("Couldn't load traces.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div
        className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b px-4 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2">
          <Brain className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
          <h1 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
            Decision Traces
          </h1>
          {rows.length > 0 && (
            <span
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: "var(--surface-1)", color: "var(--foreground-subtle)", border: "1px solid var(--border)" }}
            >
              {rows.length}
            </span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1${loading ? " animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2 py-10 justify-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
            <Loader2 className="w-4 h-4 animate-spin" /> Loading…
          </div>
        )}

        {error && !loading && (
          <div className="py-10 text-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
            {error}
          </div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="py-10 text-center text-sm" style={{ color: "var(--foreground-subtle)" }}>
            No traces recorded yet. Traces appear here after a grounded troubleshooting turn.
          </div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div
            className="rounded-lg overflow-hidden border"
            style={{ borderColor: "var(--border)" }}
          >
            {rows.map((row, i) => (
              <Link
                key={row.trace_id}
                href={`/decision-traces/${row.trace_id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--surface-1)] group"
                style={{
                  backgroundColor: "var(--surface-0)",
                  borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : "none",
                }}
              >
                <div className="flex-shrink-0">
                  {row.citations_present ? (
                    <CheckCircle2 className="w-4 h-4" style={{ color: "#16A34A" }} />
                  ) : (
                    <XCircle className="w-4 h-4" style={{ color: "#DC2626" }} />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate" style={{ color: "var(--foreground)" }}>
                    {row.user_question}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                    <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                      {formatTs(row.ts)}
                    </span>
                    {row.platform && (
                      <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                        · {row.platform}
                      </span>
                    )}
                    {row.uns_path && (
                      <span
                        className="text-xs rounded px-1 py-0.5"
                        style={{ background: "var(--surface-2)", color: "var(--foreground-subtle)", fontFamily: "monospace" }}
                      >
                        {row.uns_path}
                      </span>
                    )}
                    {row.outcome && (
                      <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                        · {row.outcome}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <ConfidencePill value={row.confidence} />
                  {typeof row.latency_ms === "number" && (
                    <span className="text-xs" style={{ color: "var(--foreground-subtle)" }}>
                      {row.latency_ms} ms
                    </span>
                  )}
                  <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: "var(--foreground-subtle)" }} />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

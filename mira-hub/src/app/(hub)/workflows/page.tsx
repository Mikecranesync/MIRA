"use client";

// Workflow durability dashboard (audit criterion #9 — "Status view").
//
// Renders recent `workflow_runs` (migration 044) across every wrapped surface:
// status badges, a 24h per-workflow rollup, filters by name/status, expandable
// step artifacts + output + error for each run. Auto-refreshes every 30s.
//
// This is the "dashboard, not a hidden code path" the audit asks for — it turns
// the run-record primitive into something an operator can actually watch.

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, XCircle, Loader2, AlertTriangle, ChevronRight, ChevronDown, RefreshCw } from "lucide-react";
import { API_BASE } from "@/lib/config";

type Status = "running" | "ok" | "degraded" | "failed";

interface StepArtifact {
  step_name: string;
  status: string;
  started_at?: string;
  finished_at?: string;
  duration_ms?: number;
  artifact?: unknown;
  error?: string;
}

interface Run {
  runId: string;
  workflowName: string;
  workflowVersion: string;
  tenantId: string | null;
  status: Status;
  errorDetail: string | null;
  stepArtifacts: StepArtifact[];
  output: unknown;
  startedAt: string;
  finishedAt: string | null;
  retryCount: number;
  durationMs: number | null;
}

interface SummaryRow {
  workflowName: string;
  status: Status;
  count: number;
}

interface ApiResponse {
  runs: Run[];
  summary: SummaryRow[];
}

const STATUS_META: Record<Status, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  ok: { label: "ok", cls: "bg-green-100 text-green-800 border-green-200", Icon: CheckCircle2 },
  failed: { label: "failed", cls: "bg-red-100 text-red-800 border-red-200", Icon: XCircle },
  running: { label: "running", cls: "bg-blue-100 text-blue-800 border-blue-200", Icon: Loader2 },
  degraded: { label: "degraded", cls: "bg-amber-100 text-amber-900 border-amber-200", Icon: AlertTriangle },
};

function StatusBadge({ status }: { status: Status }) {
  const meta = STATUS_META[status] ?? STATUS_META.running;
  const { Icon } = meta;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
      <Icon className={`h-3 w-3 ${status === "running" ? "animate-spin" : ""}`} />
      {meta.label}
    </span>
  );
}

function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60_000).toFixed(1)} m`;
}

export default function WorkflowsPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nameFilter, setNameFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Status>("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (nameFilter.trim()) qs.set("workflow_name", nameFilter.trim());
      if (statusFilter) qs.set("status", statusFilter);
      const res = await fetch(`${API_BASE}/api/workflows/?${qs.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ApiResponse = await res.json();
      setData(json);
      setError(null);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [nameFilter, statusFilter]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // Auto-refresh every 30s.
  useEffect(() => {
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const rollup = useMemo(() => {
    const map = new Map<string, Record<Status, number>>();
    for (const s of data?.summary ?? []) {
      const cur = map.get(s.workflowName) ?? { running: 0, ok: 0, degraded: 0, failed: 0 };
      cur[s.status] = (cur[s.status] ?? 0) + s.count;
      map.set(s.workflowName, cur);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [data]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflow Runs</h1>
          <p className="text-sm text-gray-500">
            Durable run records across every wrapped surface (migration 044).
            {lastUpdated ? ` Updated ${lastUpdated.toLocaleTimeString()} · auto-refresh 30s.` : ""}
          </p>
        </div>
        <button
          onClick={() => load()}
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* 24h rollup */}
      {rollup.length > 0 && (
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rollup.map(([name, counts]) => (
            <div key={name} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-1 font-mono text-sm font-medium">{name}</div>
              <div className="flex flex-wrap gap-2 text-xs text-gray-600">
                {(["ok", "degraded", "failed", "running"] as Status[])
                  .filter((s) => counts[s] > 0)
                  .map((s) => (
                    <span key={s}>
                      {STATUS_META[s].label}: <span className="font-semibold">{counts[s]}</span>
                    </span>
                  ))}
                <span className="text-gray-400">(24h)</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          value={nameFilter}
          onChange={(e) => setNameFilter(e.target.value)}
          placeholder="filter by workflow_name…"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "" | Status)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
        >
          <option value="">all statuses</option>
          <option value="ok">ok</option>
          <option value="degraded">degraded</option>
          <option value="failed">failed</option>
          <option value="running">running</option>
        </select>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed to load runs: {error}
        </div>
      )}

      {loading && !data ? (
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (data?.runs.length ?? 0) === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-gray-500">
          No workflow runs yet. As surfaces are wrapped with the run-record primitive, they appear here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 w-6" />
                <th className="px-3 py-2">Workflow</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Duration</th>
                <th className="px-3 py-2">Steps</th>
                <th className="px-3 py-2">Retry</th>
                <th className="px-3 py-2">Tenant</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {data?.runs.map((run) => {
                const isOpen = expanded.has(run.runId);
                return (
                  <Fragment key={run.runId}>
                    <tr
                      className="cursor-pointer hover:bg-gray-50"
                      onClick={() => toggle(run.runId)}
                    >
                      <td className="px-3 py-2 text-gray-400">
                        {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </td>
                      <td className="px-3 py-2">
                        <span className="font-mono">{run.workflowName}</span>
                        <span className="ml-1 text-xs text-gray-400">v{run.workflowVersion}</span>
                      </td>
                      <td className="px-3 py-2"><StatusBadge status={run.status} /></td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{fmtTime(run.startedAt)}</td>
                      <td className="px-3 py-2 text-gray-600">{fmtDuration(run.durationMs)}</td>
                      <td className="px-3 py-2 text-gray-600">{run.stepArtifacts.length}</td>
                      <td className="px-3 py-2 text-gray-600">{run.retryCount}</td>
                      <td className="px-3 py-2 font-mono text-xs text-gray-500">{run.tenantId ?? "—"}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${run.runId}-detail`} className="bg-gray-50/60">
                        <td />
                        <td colSpan={7} className="px-3 py-3">
                          {run.errorDetail && (
                            <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
                              <span className="font-semibold">error:</span> {run.errorDetail}
                            </div>
                          )}
                          <div className="mb-2 text-xs font-semibold uppercase text-gray-500">Steps</div>
                          {run.stepArtifacts.length === 0 ? (
                            <div className="text-xs text-gray-400">No step artifacts recorded.</div>
                          ) : (
                            <ol className="space-y-1">
                              {run.stepArtifacts.map((s, i) => (
                                <li key={i} className="flex items-start gap-2 text-xs">
                                  <span className={s.status === "failed" ? "text-red-600" : "text-green-600"}>
                                    {s.status === "failed" ? "✗" : "✓"}
                                  </span>
                                  <span className="font-mono">{s.step_name}</span>
                                  {s.duration_ms != null && <span className="text-gray-400">{s.duration_ms} ms</span>}
                                  {s.error && <span className="text-red-600">— {s.error}</span>}
                                  {s.artifact != null && (
                                    <code className="rounded bg-gray-100 px-1 text-gray-600">
                                      {JSON.stringify(s.artifact)}
                                    </code>
                                  )}
                                </li>
                              ))}
                            </ol>
                          )}
                          {run.output != null && (
                            <>
                              <div className="mb-1 mt-3 text-xs font-semibold uppercase text-gray-500">Output</div>
                              <pre className="overflow-x-auto rounded bg-gray-100 p-2 text-xs text-gray-700">
                                {JSON.stringify(run.output, null, 2)}
                              </pre>
                            </>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

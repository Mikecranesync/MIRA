"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LatestRun {
  run_id: string;
  status: "open" | "closed" | "anomalous";
  started_at: string;
  stopped_at: string | null;
  duration_seconds: number | null;
  run_trigger_tag: string;
}

interface LatestWindow {
  window_id: string;
  state: "idle" | "running" | "faulted" | "comm_down" | "estopped" | "unknown";
  started_at: string;
  ended_at: string | null;
}

interface LatestDiff {
  diff_id: string;
  tag_path: string;
  severity: "info" | "warning" | "critical";
  diff_type: string | null;
  observed: number | null;
  baseline: number | null;
  delta_percent: number | null;
  event_timestamp: string | null;
  next_check: string | null;
}

interface EvidenceWindow {
  started_at: string | null;
  stopped_at: string | null;
  uns_path: string;
}

export interface MachineMemoryResponse {
  uns_path: string | null;
  latest_run: LatestRun | null;
  latest_window: LatestWindow | null;
  latest_diffs: LatestDiff[];
  evidence_window: EvidenceWindow | null;
}

interface Props {
  assetId: string;
}

const SEVERITY_COLOR: Record<LatestDiff["severity"], string> = {
  info: "var(--foreground-subtle)",
  warning: "var(--status-yellow)",
  critical: "var(--status-red)",
};

interface MachineMemoryCardProps extends Props {
  /** Pre-fetched response — skips the client fetch when provided (used by tests/SSR). */
  initialData?: MachineMemoryResponse | null;
  /** Set false to disable the client-side fetch entirely (used by tests). Defaults true. */
  poll?: boolean;
}

export function MachineMemoryCard({ assetId, initialData, poll = true }: MachineMemoryCardProps) {
  const [data, setData] = useState<MachineMemoryResponse | null>(initialData ?? null);
  const [loading, setLoading] = useState(!initialData && poll);
  const [fetchFailed, setFetchFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/hub/api/assets/${assetId}/machine-memory/`);
      if (resp.ok && !resp.url.includes("/login")) {
        setData(await resp.json());
        setFetchFailed(false);
      } else {
        setFetchFailed(true);
      }
    } catch {
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  useEffect(() => {
    if (!poll) return;
    const timeout = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [load, poll]);

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
        <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          Machine memory
        </span>
      </div>

      {loading ? (
        <div className="h-16 rounded-lg animate-pulse" style={{ backgroundColor: "var(--surface-1)" }} />
      ) : fetchFailed && !data ? (
        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
          Machine memory unavailable.
        </p>
      ) : !data || !data.uns_path || (!data.latest_run && !data.latest_window) ? (
        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
          No machine runs recorded for this asset yet.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {data.latest_run && <StatusPill label="Run" value={data.latest_run.status} />}
            {data.latest_window && <StatusPill label="State" value={data.latest_window.state} />}
          </div>

          {data.latest_diffs.length > 0 && (
            <div className="space-y-1.5">
              {data.latest_diffs.slice(0, 5).map((d) => (
                <div key={d.diff_id} className="flex items-start gap-2 text-xs">
                  <span
                    className="mt-1 inline-block w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: SEVERITY_COLOR[d.severity] }}
                    title={d.severity}
                  />
                  <div className="min-w-0">
                    <p style={{ color: "var(--foreground)" }}>
                      <span className="font-mono">{d.tag_path}</span>
                      {d.diff_type ? <span style={{ color: "var(--foreground-subtle)" }}> — {d.diff_type}</span> : null}
                    </p>
                    {d.next_check && (
                      <p style={{ color: "var(--foreground-subtle)" }}>Next check: {d.next_check}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {data.evidence_window && (
            <p className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
              Evidence: tag_events {formatTs(data.evidence_window.started_at)} → {formatTs(data.evidence_window.stopped_at)}
            </p>
          )}
        </>
      )}

      <Link href="/workorders/new">
        <Button variant="outline" size="sm" disabled>
          Create work order (soon)
        </Button>
      </Link>
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  const cfg = {
    closed: { bg: "var(--status-green-bg)", color: "var(--status-green)" },
    running: { bg: "var(--status-green-bg)", color: "var(--status-green)" },
    open: { bg: "var(--status-blue-bg)", color: "var(--brand-blue)" },
    idle: { bg: "var(--surface-1)", color: "var(--foreground-muted)" },
    anomalous: { bg: "var(--status-red-bg)", color: "var(--status-red)" },
    faulted: { bg: "var(--status-red-bg)", color: "var(--status-red)" },
    comm_down: { bg: "var(--status-red-bg)", color: "var(--status-red)" },
    estopped: { bg: "var(--status-red-bg)", color: "var(--status-red)" },
    unknown: { bg: "var(--surface-1)", color: "var(--foreground-muted)" },
  }[value] ?? { bg: "var(--surface-1)", color: "var(--foreground-muted)" };

  return (
    <span
      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
      style={{ backgroundColor: cfg.bg, color: cfg.color }}
    >
      {label}: {value}
    </span>
  );
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.slice(0, 16).replace("T", " ");
}

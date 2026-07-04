"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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

interface LiveTag {
  tag_path: string;
  value: string | number | boolean | null;
  /** Engineering-unit display string from gs10-display (e.g. "328.6 V"). */
  display?: string;
  numeric?: number | null;
  unit?: string | null;
  last_seen_at: string | null;
  last_changed_at?: string | null;
  freshness: "live" | "stale" | "simulated" | "unknown";
}

interface SparkPoint {
  t: number;
  v: number;
}

interface CurrentState {
  state: string;
  since: string | null;
  fresh: boolean;
}

export interface MachineMemoryResponse {
  uns_path: string | null;
  latest_run: LatestRun | null;
  latest_window: LatestWindow | null;
  latest_diffs: LatestDiff[];
  evidence_window: EvidenceWindow | null;
  live_tags?: LiveTag[];
  current_state?: CurrentState | null;
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
  /** Pre-fetched sparkline series keyed by tag_path (used by tests/SSR). */
  initialHistory?: Record<string, SparkPoint[]> | null;
}

/** Refresh cadence — matches the Ignition collector's 2 s stream so value
 * changes appear as they happen. */
const POLL_INTERVAL_MS = 2000;
/** Sparkline history refresh — heavier query, slower cadence. */
const HISTORY_INTERVAL_MS = 15000;

export function MachineMemoryCard({ assetId, initialData, poll = true, initialHistory }: MachineMemoryCardProps) {
  const [data, setData] = useState<MachineMemoryResponse | null>(initialData ?? null);
  const [history, setHistory] = useState<Record<string, SparkPoint[]>>(initialHistory ?? {});
  const [loading, setLoading] = useState(!initialData && poll);
  const [fetchFailed, setFetchFailed] = useState(false);
  const hasLoadedRef = useRef(false);
  // display-string per tag from the previous poll + a change counter per tag —
  // a bumped counter re-keys the row so the CSS flash animation replays.
  const prevDisplayRef = useRef<Map<string, string>>(new Map());
  const [changeCounts, setChangeCounts] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    // Skeleton only on the first load — refreshes must not flash the pulse.
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const resp = await fetch(`/hub/api/assets/${assetId}/machine-memory/`);
      if (resp.ok && !resp.url.includes("/login")) {
        const json = (await resp.json()) as MachineMemoryResponse;
        // Detect value changes BEFORE rendering so changed rows flash.
        const prev = prevDisplayRef.current;
        const changed: string[] = [];
        for (const t of json.live_tags ?? []) {
          const disp = t.display ?? String(t.value ?? "");
          if (prev.has(t.tag_path) && prev.get(t.tag_path) !== disp) changed.push(t.tag_path);
          prev.set(t.tag_path, disp);
        }
        if (changed.length > 0) {
          setChangeCounts((c) => {
            const next = { ...c };
            for (const tag of changed) next[tag] = (next[tag] ?? 0) + 1;
            return next;
          });
        }
        setData(json);
        setFetchFailed(false);
        hasLoadedRef.current = true;
      } else {
        setFetchFailed(true);
      }
    } catch {
      setFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, [assetId]);

  const loadHistory = useCallback(async () => {
    try {
      const resp = await fetch(`/hub/api/assets/${assetId}/signal-history/`);
      if (resp.ok && !resp.url.includes("/login")) {
        const json = (await resp.json()) as { series?: Record<string, SparkPoint[]> };
        setHistory(json.series ?? {});
      }
    } catch {
      // sparkline history is best-effort — the card stays useful without it
    }
  }, [assetId]);

  useEffect(() => {
    if (!poll) return;
    let inFlight = false;
    const tick = () => {
      if (inFlight) return;
      inFlight = true;
      void load().finally(() => {
        inFlight = false;
      });
    };
    const timeout = window.setTimeout(tick, 0);
    const interval = window.setInterval(tick, POLL_INTERVAL_MS);
    const historyTimeout = window.setTimeout(() => void loadHistory(), 0);
    const historyInterval = window.setInterval(() => void loadHistory(), HISTORY_INTERVAL_MS);
    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
      window.clearTimeout(historyTimeout);
      window.clearInterval(historyInterval);
    };
  }, [load, loadHistory, poll]);

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
      ) : !data || !data.uns_path || (!data.latest_run && !data.latest_window && !data.live_tags?.length) ? (
        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
          No machine runs recorded for this asset yet.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            {data.latest_run && <StatusPill label="Run" value={data.latest_run.status} />}
            {(data.current_state || data.latest_window) && (
              <StatusPill label="State" value={data.current_state?.state ?? data.latest_window!.state} />
            )}
          </div>

          {(data.live_tags?.length ?? 0) > 0 && (
            <div className="space-y-1">
              <p className="text-[11px] font-medium" style={{ color: "var(--foreground-subtle)" }}>
                Live signals
              </p>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1 max-h-56 overflow-y-auto pr-1">
                {data.live_tags!.map((t) => (
                  <LiveTagRow
                    key={`${t.tag_path}#${changeCounts[t.tag_path] ?? 0}`}
                    tag={t}
                    flash={(changeCounts[t.tag_path] ?? 0) > 0}
                    points={history[t.tag_path]}
                  />
                ))}
              </div>
            </div>
          )}

          {data.latest_diffs.length > 0 && (
            <div className="space-y-1.5">
              {dedupeDiffs(data.latest_diffs).map(({ diff: d, count }) => (
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
                      {count > 1 && (
                        <span
                          className="ml-1.5 text-[10px] font-medium px-1.5 py-0.5 rounded-full align-middle"
                          style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}
                          title={`${count} occurrences across recent state windows`}
                        >
                          ×{count}
                        </span>
                      )}
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

      {data?.latest_diffs[0] ? (
        <Link href={workOrderPrefillHref(data.uns_path, data.latest_diffs[0])}>
          <Button variant="outline" size="sm">
            Create work order
          </Button>
        </Link>
      ) : (
        <Button variant="outline" size="sm" disabled>
          Create work order (no anomaly yet)
        </Button>
      )}
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

/** One live-signal row: last path segment + engineering-unit value. Live tags
 * are underlined readable-green (state color, per the UI-style law); anything
 * not live renders muted with how long ago it was last seen. A value change
 * replays the neutral .signal-flash animation (row is re-keyed by the change
 * counter); numeric tags with history get a mini sparkline. */
function LiveTagRow({ tag, flash, points }: { tag: LiveTag; flash?: boolean; points?: SparkPoint[] }) {
  const label = tag.tag_path.split("/").filter(Boolean).pop() ?? tag.tag_path;
  const live = tag.freshness === "live";
  const shown = tag.display ?? String(tag.value ?? "—");
  return (
    <div
      className={`text-xs font-mono min-w-0 rounded px-0.5 ${flash ? "signal-flash" : ""}`}
      title={`${tag.tag_path}${tag.value !== null && tag.value !== undefined ? ` (raw: ${String(tag.value)})` : ""}`}
    >
      <div className="truncate">
        {live ? (
          <span className="underline decoration-1 underline-offset-2" style={{ color: "var(--status-green-ink)" }}>
            {label}: {shown}
          </span>
        ) : (
          <span style={{ color: "var(--foreground-muted)" }}>
            {label}: {shown}{" "}
            <span style={{ color: "var(--foreground-subtle)" }}>· last seen {ago(tag.last_seen_at)}</span>
          </span>
        )}
        {live && tag.last_changed_at && (
          <span style={{ color: "var(--foreground-subtle)" }}> · chg {ago(tag.last_changed_at)}</span>
        )}
      </div>
      {points && points.length >= 2 && <Sparkline points={points} />}
    </div>
  );
}

/** Tiny inline trend — honest by design: a frozen source draws a flat line. */
function Sparkline({ points }: { points: SparkPoint[] }) {
  const W = 96;
  const H = 14;
  const vs = points.map((p) => p.v);
  const min = Math.min(...vs);
  const max = Math.max(...vs);
  const span = max - min || 1;
  const ts = points.map((p) => p.t);
  const t0 = Math.min(...ts);
  const tSpan = Math.max(...ts) - t0 || 1;
  const path = points
    .map((p) => `${((p.t - t0) / tSpan) * W},${H - 1 - ((p.v - min) / span) * (H - 2)}`)
    .join(" ");
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      className="block mt-0.5"
      aria-hidden="true"
      data-testid="sparkline"
    >
      <polyline points={path} fill="none" stroke="var(--foreground-subtle)" strokeWidth="1" />
    </svg>
  );
}

/** Collapse repeated anomalies (same tag_path + diff_type) into one row with a
 * count — persistent MED anomalies re-fire per state window (issue #2431);
 * showing four identical DC-bus rows helps nobody. Keeps the newest (the API
 * orders newest-first). */
function dedupeDiffs(diffs: LatestDiff[]): Array<{ diff: LatestDiff; count: number }> {
  const out: Array<{ diff: LatestDiff; count: number }> = [];
  const index = new Map<string, number>();
  for (const d of diffs) {
    const key = `${d.tag_path}|${d.diff_type ?? ""}`;
    const at = index.get(key);
    if (at === undefined) {
      index.set(key, out.length);
      out.push({ diff: d, count: 1 });
    } else {
      out[at].count += 1;
    }
  }
  return out.slice(0, 5);
}

/** Compact "Xs/Xm/Xh ago" for stale-signal rows; "never" when null/invalid. */
function ago(ts: string | null): string {
  if (!ts) return "never";
  const ms = Date.now() - new Date(ts).getTime();
  if (Number.isNaN(ms)) return "never";
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.round(m / 60)}h ago`;
}

function formatTs(ts: string | null): string {
  if (!ts) return "—";
  return ts.slice(0, 16).replace("T", " ");
}

/** Last UNS segment as a short human label, e.g. "enterprise...cv_101" -> "CV-101". */
function assetLabelFromUnsPath(unsPath: string | null): string {
  if (!unsPath) return "Asset";
  const last = unsPath.split(".").filter(Boolean).pop() ?? unsPath;
  return last.replace(/_/g, "-").toUpperCase();
}

/** Build the /workorders/new deep-link that prefills from the latest anomaly
 * diff (master-plan T4 — the anomaly→work-order link). */
function workOrderPrefillHref(unsPath: string | null, diff: LatestDiff): string {
  const label = assetLabelFromUnsPath(unsPath);
  const title = `[${label}] ${diff.diff_type ?? "anomaly"} on ${diff.tag_path}`;
  const description = diff.next_check
    ? `${diff.severity} — next check: ${diff.next_check}`
    : diff.severity;

  const params = new URLSearchParams({
    prefill_title: title,
    prefill_description: description,
    source_run_diff_id: diff.diff_id,
  });
  return `/workorders/new?${params.toString()}`;
}

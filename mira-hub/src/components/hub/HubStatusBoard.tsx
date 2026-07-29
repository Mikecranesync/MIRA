"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CircleStop, Gauge, Loader2, RadioTower, RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { API_BASE } from "@/lib/config";
import type { HubZoneState, HubZoneStatus } from "@/lib/hub/status";

export type HubStatusResponse = {
  zones: HubZoneStatus[];
  as_of: string;
};

type HubStatusBoardProps = {
  initialStatus?: HubStatusResponse;
  poll?: boolean;
};

const POLL_MS = 2_000;

const STATE_LABEL: Record<HubZoneState, string> = {
  running: "Running",
  idle: "Idle",
  blocked: "Blocked",
  faulted: "Faulted",
  unknown: "Unknown",
};

const STATE_STYLE: Record<HubZoneState, string> = {
  running: "border-emerald-200 bg-emerald-50 text-emerald-800",
  idle: "border-sky-200 bg-sky-50 text-sky-800",
  blocked: "border-amber-200 bg-amber-50 text-amber-800",
  faulted: "border-red-200 bg-red-50 text-red-800",
  unknown: "border-slate-200 bg-slate-50 text-slate-600",
};

const STATE_DOT: Record<HubZoneState, string> = {
  running: "bg-emerald-500",
  idle: "bg-sky-500",
  blocked: "bg-amber-500",
  faulted: "bg-red-500",
  unknown: "bg-slate-400",
};

const KIND_LABEL: Record<HubZoneStatus["kind"], string> = {
  conveyor_cell: "Conveyor",
  coaster_zone: "Coaster block",
};

function metricLabel(key: string) {
  return key.replaceAll("_", " ");
}

function metricValue(value: string | number | boolean | null) {
  if (typeof value === "boolean") return value ? "on" : "off";
  if (value === null || value === "") return "n/a";
  return String(value);
}

function formatTime(value: string | null) {
  if (!value) return "no updates";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "invalid time";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function sortZones(zones: HubZoneStatus[]) {
  const order = new Map([
    ["conv_simple", 0],
    ["stardust.launch_1", 1],
    ["stardust.launch_2", 2],
    ["stardust.station_load", 3],
    ["stardust.station_unload", 4],
  ]);

  return [...zones].sort((a, b) => {
    const aOrder = order.get(a.id) ?? 99;
    const bOrder = order.get(b.id) ?? 99;
    return aOrder === bOrder ? a.label.localeCompare(b.label) : aOrder - bOrder;
  });
}

function statusCounts(zones: HubZoneStatus[]) {
  return zones.reduce(
    (counts, zone) => {
      counts[zone.state] += 1;
      if (zone.stale) counts.stale += 1;
      return counts;
    },
    { running: 0, idle: 0, blocked: 0, faulted: 0, unknown: 0, stale: 0 },
  );
}

export function HubStatusBoard({ initialStatus, poll = true }: HubStatusBoardProps) {
  const [status, setStatus] = useState<HubStatusResponse | null>(initialStatus ?? null);
  const [loading, setLoading] = useState(!initialStatus);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!poll) return;

    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(`${API_BASE}/api/hub/status`, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const nextStatus = (await response.json()) as HubStatusResponse;
        if (cancelled) return;
        setStatus(nextStatus);
        setError(null);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    const interval = setInterval(() => void load(), POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [poll]);

  const zones = useMemo(() => sortZones(status?.zones ?? []), [status?.zones]);
  const counts = useMemo(() => statusCounts(zones), [zones]);

  return (
    <section className="border-b bg-white px-5 py-3" style={{ borderColor: "var(--border, #e2e8f0)" }}>
      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <RadioTower className="h-4 w-4 flex-shrink-0 text-blue-600" />
            <h2 className="text-sm font-semibold tracking-tight text-slate-900">One-Board Status</h2>
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-400" aria-label="Loading status" />}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-slate-500">
            Conveyor cell and Stardust block zones from live UNS signal cache.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <Badge variant="green" className="gap-1">Running {counts.running}</Badge>
          <Badge variant="yellow" className="gap-1">Blocked {counts.blocked}</Badge>
          <Badge variant="red" className="gap-1">Faults {counts.faulted}</Badge>
          <Badge variant="outline" className="gap-1">Stale {counts.stale}</Badge>
          {status && (
            <span className="inline-flex items-center gap-1 text-slate-400">
              <RefreshCw className="h-3 w-3" />
              {formatTime(status.as_of)}
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          Hub status unavailable: {error}
        </div>
      )}

      {zones.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-xs text-slate-500">
          <CircleStop className="h-4 w-4 flex-shrink-0" />
          No conveyor or Stardust telemetry has landed yet.
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {zones.map((zone) => (
            <article
              key={zone.id}
              className={`min-w-0 rounded-md border px-3 py-2 ${STATE_STYLE[zone.state]}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{zone.label}</p>
                  <p className="truncate text-[10px] uppercase tracking-wide opacity-70">
                    {KIND_LABEL[zone.kind]}
                  </p>
                </div>
                <span className="inline-flex flex-shrink-0 items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold">
                  <span className={`h-2 w-2 rounded-full ${STATE_DOT[zone.state]}`} />
                  {STATE_LABEL[zone.state]}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {zone.stale && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
                    <AlertTriangle className="h-3 w-3" />
                    Stale
                  </span>
                )}
                <span className="inline-flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-[10px] text-slate-600">
                  <Gauge className="h-3 w-3" />
                  {formatTime(zone.updatedAt)}
                </span>
              </div>

              <dl className="mt-2 grid grid-cols-1 gap-1 text-[11px]">
                {Object.entries(zone.metrics).slice(0, 3).map(([key, value]) => (
                  <div key={key} className="flex min-w-0 items-center justify-between gap-2">
                    <dt className="truncate opacity-70">{metricLabel(key)}</dt>
                    <dd className="max-w-[8rem] truncate font-mono font-semibold">{metricValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  Clock,
  Database,
  Layers,
  TrendingUp,
  Zap,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { API_BASE } from "@/lib/config";

type Stats = {
  totals: {
    totalEntries: number;
    totalDocs: number;
    manufacturerCount: number;
    lastIngested: string | null;
  };
  recent: {
    today: number;
    week: number;
    month: number;
    dailyAvg7d: number;
  };
  worker: {
    running: boolean;
    chunksLastHour: number;
    lastIngested: string | null;
  };
  pipeline: {
    queueDepth: number;
  };
  topManufacturers: { name: string; chunkCount: number }[];
  fetchedAt: string;
};

type GrowthPoint = { date: string; count: number; cumulative: number };

const POLL_MS = 60_000;

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function KbGrowthDashboard() {
  const [mounted, setMounted] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [growth, setGrowth] = useState<GrowthPoint[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setMounted(true), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [statsRes, growthRes] = await Promise.all([
          fetch(`${API_BASE}/api/knowledge/stats/`, { cache: "no-store" }),
          fetch(`${API_BASE}/api/knowledge/growth/`, { cache: "no-store" }),
        ]);
        if (!statsRes.ok || !growthRes.ok) {
          if (!cancelled) setError(`stats=${statsRes.status} growth=${growthRes.status}`);
          return;
        }
        const s = (await statsRes.json()) as Stats;
        const g = (await growthRes.json()) as { series: GrowthPoint[] };
        if (cancelled) return;
        setStats(s);
        setGrowth(g.series ?? []);
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "fetch failed");
      }
    }
    void load();
    const iv = setInterval(load, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  if (error && !stats) {
    return (
      <div className="card p-4 mb-4" style={{ backgroundColor: "var(--surface-1)" }}>
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4" style={{ color: "var(--danger, #f87171)" }} />
          <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
            KB stats unavailable: {error}
          </p>
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="card p-4 mb-4" style={{ backgroundColor: "var(--surface-1)" }}>
        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
          Loading KB stats…
        </p>
      </div>
    );
  }

  const workerStatusColor = stats.worker.running ? "#16A34A" : "#EAB308";
  const workerStatusLabel = stats.worker.running ? "Running" : "Idle";

  const topMfrChartData = stats.topManufacturers.map((m) => ({
    name: m.name.length > 14 ? `${m.name.slice(0, 14)}…` : m.name,
    fullName: m.name,
    count: m.chunkCount,
  }));

  return (
    <div className="mb-4 space-y-3">
      {/* Top tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Tile
          icon={<Database className="w-4 h-4" />}
          label="Total entries"
          value={formatNumber(stats.totals.totalEntries)}
          sub={`${formatNumber(stats.totals.totalDocs)} documents`}
        />
        <Tile
          icon={<TrendingUp className="w-4 h-4" />}
          label="Today"
          value={formatNumber(stats.recent.today)}
          sub={`${formatNumber(stats.recent.dailyAvg7d)}/day avg (7d)`}
        />
        <Tile
          icon={<Layers className="w-4 h-4" />}
          label="This week"
          value={formatNumber(stats.recent.week)}
          sub={`${formatNumber(stats.recent.month)} this month`}
        />
        <Tile
          icon={<Activity className="w-4 h-4" style={{ color: workerStatusColor }} />}
          label="Worker"
          value={workerStatusLabel}
          sub={`${stats.worker.chunksLastHour} chunks/hr · ${timeAgo(stats.worker.lastIngested)}`}
          accent={workerStatusColor}
        />
      </div>

      {/* Growth chart + Top manufacturers chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div
          className="card p-3 lg:col-span-2"
          style={{ backgroundColor: "var(--surface-1)" }}
        >
          <div className="flex items-center justify-between mb-2">
            <div>
              <p
                className="text-[11px] uppercase tracking-wider font-semibold"
                style={{ color: "var(--foreground-subtle)" }}
              >
                Cumulative KB growth
              </p>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>
                Last 30 days · {formatNumber(stats.totals.totalEntries)} total
              </p>
            </div>
            <div
              className="flex items-center gap-1 text-[11px]"
              style={{ color: "var(--foreground-subtle)" }}
            >
              <Clock className="w-3 h-3" />
              {timeAgo(stats.fetchedAt)}
            </div>
          </div>
          <div className="h-44">
            {mounted && growth.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart
                  data={growth}
                  margin={{ top: 4, right: 8, bottom: 0, left: -16 }}
                >
                  <defs>
                    <linearGradient id="kbGrowthFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#2563EB" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }}
                    tickFormatter={shortDate}
                    interval="preserveStartEnd"
                    stroke="var(--border)"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }}
                    tickFormatter={(v: number) => formatNumber(v)}
                    stroke="var(--border)"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--surface-0)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    labelFormatter={(label: unknown) =>
                      typeof label === "string" ? shortDate(label) : String(label ?? "")
                    }
                    formatter={(value: unknown, name: unknown) => [
                      formatNumber(Number(value ?? 0)),
                      name === "cumulative" ? "Total" : "New that day",
                    ]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#2563EB"
                    strokeWidth={2}
                    fill="url(#kbGrowthFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div
                className="h-full flex items-center justify-center text-xs"
                style={{ color: "var(--foreground-subtle)" }}
              >
                {mounted ? "No ingest in the last 30 days" : "Loading…"}
              </div>
            )}
          </div>
        </div>

        <div className="card p-3" style={{ backgroundColor: "var(--surface-1)" }}>
          <p
            className="text-[11px] uppercase tracking-wider font-semibold"
            style={{ color: "var(--foreground-subtle)" }}
          >
            Top manufacturers
          </p>
          <p className="text-xs mb-2" style={{ color: "var(--foreground-muted)" }}>
            By chunk count
          </p>
          <div className="h-44">
            {mounted && topMfrChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topMfrChartData}
                  layout="vertical"
                  margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
                >
                  <XAxis
                    type="number"
                    tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }}
                    tickFormatter={(v: number) => formatNumber(v)}
                    stroke="var(--border)"
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 10, fill: "var(--foreground-muted)" }}
                    stroke="var(--border)"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "var(--surface-0)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 11,
                    }}
                    formatter={(value: unknown) => [
                      formatNumber(Number(value ?? 0)),
                      "chunks",
                    ]}
                    labelFormatter={(_label: unknown, payload: unknown) => {
                      const p = payload as Array<{ payload?: { fullName?: string } }> | undefined;
                      return p?.[0]?.payload?.fullName ?? "";
                    }}
                  />
                  <Bar dataKey="count" fill="#2563EB" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div
                className="h-full flex items-center justify-center text-xs"
                style={{ color: "var(--foreground-subtle)" }}
              >
                No manufacturer data
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pipeline health strip */}
      <div className="card p-3" style={{ backgroundColor: "var(--surface-1)" }}>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            {stats.worker.running ? (
              <CheckCircle2 className="w-4 h-4" style={{ color: "#16A34A" }} />
            ) : (
              <AlertCircle className="w-4 h-4" style={{ color: "#EAB308" }} />
            )}
            <div>
              <p
                className="text-xs font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                Ingest pipeline · {workerStatusLabel}
              </p>
              <p className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>
                Last successful ingest {timeAgo(stats.worker.lastIngested)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <div>
              <p
                className="uppercase tracking-wider font-semibold"
                style={{ color: "var(--foreground-subtle)" }}
              >
                Last hour
              </p>
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {formatNumber(stats.worker.chunksLastHour)} chunks
              </p>
            </div>
            <div>
              <p
                className="uppercase tracking-wider font-semibold"
                style={{ color: "var(--foreground-subtle)" }}
              >
                Queue depth
              </p>
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {formatNumber(stats.pipeline.queueDepth)} URLs
              </p>
            </div>
            <div>
              <p
                className="uppercase tracking-wider font-semibold"
                style={{ color: "var(--foreground-subtle)" }}
              >
                Manufacturers
              </p>
              <p
                className="text-sm font-semibold"
                style={{ color: "var(--foreground)" }}
              >
                {formatNumber(stats.totals.manufacturerCount)}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Tile({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  accent?: string;
}) {
  return (
    <div
      className="card p-3 flex items-start gap-2"
      style={{ backgroundColor: "var(--surface-1)" }}
    >
      <div
        className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
        style={{
          backgroundColor: "var(--surface-2)",
          color: accent ?? "var(--brand-blue)",
        }}
      >
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p
          className="text-[10px] uppercase tracking-wider font-semibold"
          style={{ color: "var(--foreground-subtle)" }}
        >
          {label}
        </p>
        <p
          className="text-base font-semibold leading-tight truncate"
          style={{ color: accent ?? "var(--foreground)" }}
        >
          {value}
        </p>
        <p className="text-[11px] truncate" style={{ color: "var(--foreground-muted)" }}>
          {sub}
        </p>
      </div>
    </div>
  );
}

// Helps eslint keep the unused-import nag away when the icon is referenced
// only in conditional branches above.
export const _zap = Zap;

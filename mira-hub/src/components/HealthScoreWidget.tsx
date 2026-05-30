"use client";

/**
 * Tenant readiness widget (Phase 2 slice 1).
 *
 * Spec: docs/specs/maintenance-namespace-builder-spec.md §"Readiness levels"
 * API : GET /api/readiness
 *
 * Read-only L0–L6 readiness pulled from /api/readiness, which runs the pure
 * calculator in src/lib/health-score.ts on demand. The event-driven recompute
 * worker lands in slice 3.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2, Sparkles } from "lucide-react";
import { API_BASE } from "@/lib/config";

interface ReadinessResponse {
  level: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  levelName: string;
  nextStep: string;
  counts: {
    assets: number;
    components: number;
    docs: number;
    proposalsPending: number;
    proposalsVerified: number;
    unsPaths: number;
  };
  computedAt: string;
}

const LEVEL_BAR_COLORS = [
  "bg-slate-200", // L0
  "bg-red-400",
  "bg-amber-400",
  "bg-yellow-400",
  "bg-lime-500",
  "bg-emerald-500",
  "bg-blue-500", // L6
];

export default function HealthScoreWidget() {
  const [data, setData] = useState<ReadinessResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/readiness`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as ReadinessResponse;
        if (cancelled) return;
        setData(json);
      } catch (e) {
        if (cancelled) return;
        setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        data-testid="health-score-widget"
        data-state="loading"
      >
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking namespace readiness…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
        data-testid="health-score-widget"
        data-state="error"
      >
        <p className="text-sm text-slate-500">
          Namespace readiness unavailable{error ? ` — ${error}` : ""}.
        </p>
      </div>
    );
  }

  const fillCount = data.level + 1; // L0 fills 1 segment; L6 fills 7.

  return (
    <Link
      href="/namespace"
      className="block rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300 hover:shadow-md"
      data-testid="health-score-widget"
      data-state="ready"
      data-level={data.level}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50">
          <Sparkles className="h-5 w-5 text-blue-600" />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <span
              className="text-lg font-semibold text-slate-900"
              data-testid="health-score-level-name"
            >
              {data.levelName}
            </span>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
              Namespace readiness
            </span>
          </div>
          <p className="mt-1 text-sm text-slate-500" data-testid="health-score-next-step">
            {data.nextStep}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" />
      </div>

      <div className="mt-4 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-slate-100">
        {Array.from({ length: 7 }, (_, i) => (
          <div
            key={i}
            className={`h-full flex-1 ${i < fillCount ? LEVEL_BAR_COLORS[data.level] : ""}`}
            data-testid={`health-score-segment-${i}`}
            data-filled={i < fillCount ? "true" : "false"}
          />
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs text-slate-500">
        <Stat label="Assets" value={data.counts.assets} />
        <Stat label="Components" value={data.counts.components} />
        <Stat label="Verified edges" value={data.counts.proposalsVerified} />
      </dl>
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[0.7rem] uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Radio, ArrowRight } from "lucide-react";
import { API_BASE } from "@/lib/config";

// Mirrors CommissioningStatus in lib/commissioning.ts + the route response.
type ItemState = "ok" | "warn" | "missing";
interface CommissioningItem {
  key: string;
  label: string;
  state: ItemState;
  detail: string;
}
interface CommissioningResponse {
  status: { ready: boolean; checklist: CommissioningItem[]; nextAction: string };
}

const POLL_MS = 15_000;

function StateIcon({ state }: { state: ItemState }) {
  if (state === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />;
  if (state === "warn") return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <XCircle className="h-3.5 w-3.5 text-red-500" />;
}

/**
 * Remote Commissioning panel — read-only. Renders the Hub-side commissioning
 * checklist (claimed / online / bound / source / display / tags / live / Ask-MIRA)
 * so a user in Orlando can see whether a customer-site connector is ready and
 * what still needs doing on-site. Data: GET /api/command-center/commissioning.
 */
export function CommissioningPanel() {
  const [data, setData] = useState<CommissioningResponse | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetch(`${API_BASE}/api/command-center/commissioning`, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (!cancelled && j) setData(j);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setLoaded(true);
        });
    void load();
    const t = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  if (!loaded || !data) return null;

  const { ready, checklist, nextAction } = data.status;

  return (
    <div className="border-b px-5 py-2.5" style={{ borderColor: "rgba(0,0,0,0.08)" }}>
      <div className="mb-2 flex items-center gap-2">
        <Radio className="h-3.5 w-3.5 text-slate-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          Remote Commissioning
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            ready ? "bg-green-100 text-green-700" : "bg-amber-100 text-amber-700"
          }`}
        >
          {ready ? "Ready" : "Not ready"}
        </span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5">
        {checklist.map((it) => (
          <span
            key={it.key}
            className="inline-flex items-center gap-1.5 text-[12px] text-slate-700"
            title={it.detail}
          >
            <StateIcon state={it.state} />
            {it.label}
          </span>
        ))}
      </div>

      <div className="mt-2 flex items-start gap-1.5 text-[12px] text-slate-600">
        <ArrowRight className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
        <span>
          <span className="font-medium text-slate-500">Next:</span> {nextAction}
        </span>
      </div>
    </div>
  );
}

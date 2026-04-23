"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Plus, ChevronRight, User, Calendar as CalIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/* ─── Mock data ─────────────────────────────────────────────────────── */
const WORK_ORDERS = [
  { id: "WO-2026-001", asset: "Air Compressor #1",  desc: "Quarterly PM — oil, belts, filters",     priority: "High",     status: "open",       assignee: "Mike H.",  created: "2026-04-20", due: "2026-04-25" },
  { id: "WO-2026-002", asset: "Conveyor Belt #3",   desc: "Replace main drive belt — snapped",       priority: "Critical", status: "inprogress", assignee: "John S.",  created: "2026-04-21", due: "2026-04-23" },
  { id: "WO-2026-003", asset: "HVAC Unit #2",       desc: "Quarterly filter change + coil inspection", priority: "Medium",   status: "open",       assignee: "—",        created: "2026-04-18", due: "2026-04-30" },
  { id: "WO-2026-004", asset: "CNC Mill #7",        desc: "Lubrication PM cycle — all axes",         priority: "Low",      status: "scheduled",  assignee: "Mike H.",  created: "2026-04-17", due: "2026-05-01" },
  { id: "WO-2026-005", asset: "Pump Station A",     desc: "Mechanical seal replacement",             priority: "Critical", status: "completed",  assignee: "John S.",  created: "2026-04-10", due: "2026-04-12" },
  { id: "WO-2026-006", asset: "Generator #1",       desc: "Annual load test + fuel check",           priority: "High",     status: "scheduled",  assignee: "Mike H.",  created: "2026-04-16", due: "2026-05-10" },
  { id: "WO-2026-007", asset: "Air Compressor #1",  desc: "Belt tension adjustment — MIRA alert",    priority: "Medium",   status: "completed",  assignee: "John S.",  created: "2026-04-13", due: "2026-04-15" },
  { id: "WO-2025-099", asset: "Boiler Unit B",      desc: "Pressure relief valve test (overdue)",    priority: "High",     status: "overdue",    assignee: "—",        created: "2026-03-01", due: "2026-03-15" },
];

const STATUS_TABS = ["all", "open", "inprogress", "scheduled", "completed", "overdue"];

const STATUS_LABEL: Record<string, string> = {
  open: "Open", inprogress: "In Progress", scheduled: "Scheduled", completed: "Completed", overdue: "Overdue",
};

const PRIORITY_VARIANT: Record<string, "critical" | "high" | "medium" | "low"> = {
  Critical: "critical", High: "high", Medium: "medium", Low: "low",
};

const STATUS_VARIANT: Record<string, "open" | "inprogress" | "completed" | "overdue" | "gray"> = {
  open: "open", inprogress: "inprogress", scheduled: "gray", completed: "completed", overdue: "overdue",
};

export default function WorkOrdersPage() {
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");

  const visible = WORK_ORDERS.filter((wo) => {
    const matchTab = tab === "all" || wo.status === tab;
    const matchQuery = !query || wo.desc.toLowerCase().includes(query.toLowerCase()) || wo.asset.toLowerCase().includes(query.toLowerCase()) || wo.id.includes(query);
    return matchTab && matchQuery;
  });

  const counts = STATUS_TABS.reduce<Record<string, number>>((acc, t) => {
    acc[t] = t === "all" ? WORK_ORDERS.length : WORK_ORDERS.filter(w => w.status === t).length;
    return acc;
  }, {});

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Work Orders</h1>
            <Link href="/workorders/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" /> New Order
              </Button>
            </Link>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
              style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder="Search by asset, description, or WO#…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>

          {/* Status tabs */}
          <div className="flex gap-0 overflow-x-auto scrollbar-none -mb-px">
            {STATUS_TABS.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium capitalize border-b-2 transition-colors"
                style={{
                  borderColor: tab === t ? "var(--brand-blue)" : "transparent",
                  color: tab === t ? "var(--brand-blue)" : "var(--foreground-muted)",
                }}
              >
                {t === "all" ? "All" : STATUS_LABEL[t]}
                {counts[t] > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{
                      backgroundColor: tab === t ? "var(--brand-blue)" : "var(--surface-1)",
                      color: tab === t ? "white" : "var(--foreground-muted)",
                    }}>
                    {counts[t]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* List */}
      <div className="px-4 md:px-6 py-4 space-y-3 max-w-3xl">
        {visible.map((wo) => (
          <div key={wo.id} className="card">
            <div className="p-4">
              {/* Top row */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] font-mono" style={{ color: "var(--foreground-subtle)" }}>{wo.id}</span>
                  <Badge variant={PRIORITY_VARIANT[wo.priority] ?? "low"}>{wo.priority}</Badge>
                  <Badge variant={STATUS_VARIANT[wo.status] ?? "gray"} className="capitalize">
                    {STATUS_LABEL[wo.status] ?? wo.status}
                  </Badge>
                </div>
                <ChevronRight className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
              </div>

              {/* Description */}
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{wo.desc}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{wo.asset}</p>

              {/* Footer */}
              <div className="flex items-center gap-4 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                <span className="flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                  <User className="w-3 h-3" /> {wo.assignee}
                </span>
                <span className="flex items-center gap-1 text-xs" style={{ color: wo.status === "overdue" ? "var(--status-red)" : "var(--foreground-muted)" }}>
                  <CalIcon className="w-3 h-3" /> Due {wo.due}
                </span>
              </div>
            </div>
          </div>
        ))}

        {visible.length === 0 && (
          <div className="text-center py-16">
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>No work orders match</p>
          </div>
        )}
      </div>
    </div>
  );
}

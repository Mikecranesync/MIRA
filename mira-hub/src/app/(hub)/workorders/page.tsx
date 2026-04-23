"use client";

import { useState } from "react";
import Link from "next/link";
import { Search, Plus, User, Calendar as CalIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WORK_ORDERS, STATUS_LABEL, PRIORITY_VARIANT, STATUS_VARIANT } from "@/lib/workorders-data";

const STATUS_TABS = ["all", "open", "inprogress", "scheduled", "completed", "overdue"] as const;

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
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-0">
          <div className="flex items-center justify-between mb-3">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Work Orders</h1>
            <Link href="/workorders/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />New Order
              </Button>
            </Link>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder="Search by asset, description, or WO#…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>

          <div className="flex gap-0 overflow-x-auto scrollbar-none -mb-px">
            {STATUS_TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium capitalize border-b-2 transition-colors"
                style={{ borderColor: tab === t ? "var(--brand-blue)" : "transparent", color: tab === t ? "var(--brand-blue)" : "var(--foreground-muted)" }}>
                {t === "all" ? "All" : STATUS_LABEL[t]}
                {counts[t] > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium"
                    style={{ backgroundColor: tab === t ? "var(--brand-blue)" : "var(--surface-1)", color: tab === t ? "white" : "var(--foreground-muted)" }}>
                    {counts[t]}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 space-y-3 max-w-3xl">
        {visible.length === 0 ? (
          <div className="text-center py-16">
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>No work orders match</p>
            <Link href="/workorders/new">
              <Button size="sm" className="mt-3">Create Work Order</Button>
            </Link>
          </div>
        ) : visible.map((wo) => (
          <Link key={wo.id} href={`/workorders/${wo.id}`}>
            <div className="card hover:shadow-md transition-shadow cursor-pointer">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono" style={{ color: "var(--foreground-subtle)" }}>{wo.id}</span>
                    <Badge variant={PRIORITY_VARIANT[wo.priority]}>{wo.priority}</Badge>
                    <Badge variant={STATUS_VARIANT[wo.status] ?? "gray"} className="capitalize">
                      {STATUS_LABEL[wo.status]}
                    </Badge>
                  </div>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{wo.desc}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{wo.asset}</p>
                <div className="flex items-center gap-4 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                    <User className="w-3 h-3" />{wo.assignee}
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color: wo.status === "overdue" ? "var(--status-red)" : "var(--foreground-muted)" }}>
                    <CalIcon className="w-3 h-3" />Due {wo.due}
                  </span>
                </div>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

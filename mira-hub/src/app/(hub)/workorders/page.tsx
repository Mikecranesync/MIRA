"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Search, Plus, User, Calendar as CalIcon, Bot, Sparkles, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

type WO = {
  id: string;
  work_order_number: string;
  title: string;
  asset: string;
  status: string;
  priority: string;
  source: string;
  source_label: string;
  is_auto_pm: boolean;
  due: string;
  created_at: string;
  suggested_actions: string[];
  parts_needed: string[];
  tools_needed: string[];
  source_citation: string | null;
  manufacturer: string | null;
  model_number: string | null;
};

const PRIORITY_VARIANT: Record<string, "critical" | "high" | "medium" | "low"> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low",
};

const STATUS_VARIANT: Record<string, "default" | "overdue" | "completed" | "inprogress" | "secondary"> = {
  open: "secondary",
  in_progress: "inprogress",
  completed: "completed",
  cancelled: "secondary",
  overdue: "overdue",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
  overdue: "Overdue",
};

const STATUS_TABS = ["all", "open", "in_progress", "completed"] as const;

// Fallback hardcoded WOs while loading
const FALLBACK_WOS: WO[] = [];

export default function WorkOrdersPage() {
  const tWO = useTranslations("workorders");
  const tCommon = useTranslations("common");
  const [tab, setTab] = useState("all");
  const [query, setQuery] = useState("");
  const [wos, setWos] = useState<WO[]>(FALLBACK_WOS);
  const [loading, setLoading] = useState(true);
  const [autoPMCount, setAutoPMCount] = useState(0);

  useEffect(() => {
    fetch("/hub/api/work-orders")
      .then(r => r.json())
      .then((data: { count: number; work_orders: WO[] }) => {
        if (data.work_orders) {
          setWos(data.work_orders);
          setAutoPMCount(data.work_orders.filter(w => w.is_auto_pm).length);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const visible = wos.filter((wo) => {
    const matchTab = tab === "all" || wo.status === tab;
    const q = query.toLowerCase();
    const matchQuery = !query ||
      wo.title.toLowerCase().includes(q) ||
      wo.asset.toLowerCase().includes(q) ||
      wo.work_order_number.toLowerCase().includes(q);
    return matchTab && matchQuery;
  });

  const counts: Record<string, number> = {
    all: wos.length,
    open: wos.filter(w => w.status === "open").length,
    in_progress: wos.filter(w => w.status === "in_progress").length,
    completed: wos.filter(w => w.status === "completed").length,
  };

  const tabLabels: Record<string, string> = {
    all: tWO("filters.all"),
    open: tWO("filters.open"),
    in_progress: "In Progress",
    completed: tWO("filters.completed"),
  };

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-0">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{tWO("title")}</h1>
                {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: "var(--foreground-subtle)" }} />}
                {!loading && autoPMCount > 0 && (
                  <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: "rgba(37,99,235,0.08)", color: "var(--brand-blue)" }}>
                    <Sparkles className="w-2.5 h-2.5" />{autoPMCount} auto-generated
                  </span>
                )}
              </div>
            </div>
            <Link href="/workorders/new">
              <Button size="sm" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" />{tWO("new")}
              </Button>
            </Link>
          </div>

          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--foreground-subtle)" }} />
            <Input placeholder={tCommon("search")} value={query} onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>

          <div className="flex gap-0 overflow-x-auto scrollbar-none -mb-px">
            {STATUS_TABS.map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium capitalize border-b-2 transition-colors"
                style={{ borderColor: tab === t ? "var(--brand-blue)" : "transparent", color: tab === t ? "var(--brand-blue)" : "var(--foreground-muted)" }}>
                {tabLabels[t]}
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
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="card p-4 animate-pulse">
                <div className="h-3 rounded w-1/3 mb-2" style={{ backgroundColor: "var(--surface-1)" }} />
                <div className="h-4 rounded w-2/3" style={{ backgroundColor: "var(--surface-1)" }} />
              </div>
            ))}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="text-center py-16">
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{tWO("noWorkOrders")}</p>
            <Link href="/workorders/new">
              <Button size="sm" className="mt-3">{tWO("createFirst")}</Button>
            </Link>
          </div>
        )}

        {!loading && visible.map((wo) => (
          <Link key={wo.id} href={`/workorders/${wo.id}`}>
            <div className="card hover:shadow-md transition-shadow cursor-pointer">
              <div className="p-4">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-mono" style={{ color: "var(--foreground-subtle)" }}>{wo.work_order_number}</span>
                    <Badge variant={PRIORITY_VARIANT[wo.priority] ?? "medium"}>{wo.priority}</Badge>
                    <Badge variant={STATUS_VARIANT[wo.status] ?? "secondary"} className="capitalize">
                      {STATUS_LABEL[wo.status] ?? wo.status}
                    </Badge>
                    {wo.is_auto_pm && (
                      <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: "rgba(37,99,235,0.08)", color: "var(--brand-blue)" }}>
                        <Sparkles className="w-2.5 h-2.5" />Auto-PM
                      </span>
                    )}
                    {wo.source === "telegram_text" && (
                      <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: "rgba(14,165,233,0.08)", color: "#0EA5E9" }}>
                        <Bot className="w-2.5 h-2.5" />Telegram
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{wo.title}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{wo.asset}</p>
                {wo.is_auto_pm && wo.source_citation && (
                  <p className="text-[10px] mt-1 italic" style={{ color: "var(--foreground-subtle)" }}>
                    From: {wo.source_citation.slice(0, 60)}{wo.source_citation.length > 60 ? "…" : ""}
                  </p>
                )}
                {wo.parts_needed.length > 0 && (
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
                    Parts: {wo.parts_needed.slice(0, 3).join(", ")}{wo.parts_needed.length > 3 ? ` +${wo.parts_needed.length - 3}` : ""}
                  </p>
                )}
                <div className="flex items-center gap-4 mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                    <User className="w-3 h-3" />{wo.is_auto_pm ? "pm_scheduler" : "—"}
                  </span>
                  <span className="flex items-center gap-1 text-xs" style={{ color: "var(--foreground-muted)" }}>
                    <CalIcon className="w-3 h-3" />{tWO("dueDate")} {wo.due}
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

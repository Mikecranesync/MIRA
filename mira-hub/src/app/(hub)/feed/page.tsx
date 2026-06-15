"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ClipboardList, Calendar,
  Plus, QrCode, MessageSquarePlus, X, CheckCircle2,
  Clock, AlertTriangle, Wrench, Cog,
  ChevronRight, RefreshCw, User, ShieldAlert, FileText, Package,
  Upload, Layers,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import HealthScoreWidget from "@/components/HealthScoreWidget";
import { API_BASE } from "@/lib/config";

type KpiCard = {
  label: string;
  value: string;
  icon: React.ElementType;
  color: string;
  bg: string;
  href: string;
};

function buildKpiCards(
  openWoCount: number | null,
  overduePmCount: number | null,
  totalWoCount: number | null,
  autoPmCount: number | null,
): KpiCard[] {
  const fmt = (n: number | null) => (n === null ? "—" : String(n));
  return [
    { label: "Open Work Orders", value: fmt(openWoCount),  icon: ClipboardList, color: "#2563EB", bg: "#EFF6FF", href: "/workorders" },
    { label: "Overdue PMs",      value: fmt(overduePmCount), icon: Calendar,      color: "#DC2626", bg: "#FEF2F2", href: "/schedule" },
    { label: "Total Work Orders", value: fmt(totalWoCount),  icon: AlertTriangle, color: "#EAB308", bg: "#FEF9C3", href: "/workorders" },
    { label: "Auto-Extracted PMs", value: fmt(autoPmCount), icon: Wrench,        color: "#16A34A", bg: "#DCFCE7", href: "/schedule" },
  ];
}

// Command-board operational card. Every field traces to real backend data
// (work_orders / pm_schedules). Fields the schema does NOT carry — assigned
// owner, an explicit blocker column — render as explicit empty state
// ("Unassigned"), never invented. See issue #1953 acceptance criteria.
type BoardItem = {
  key: string;
  kind: "wo" | "pm";
  woNumber: string | null;
  title: string;
  status: string;          // open | in_progress | overdue | due | ...
  priority: string;        // low | medium | high | critical
  ageMs: number | null;    // downtime / open age, from created_at (WO) or due (PM)
  ageLabel: string;        // "down" | "open" | "due"
  owner: string | null;    // not in schema today → null renders "Unassigned"
  blocker: string | null;  // derived from safety_warnings (real) when present
  note: string | null;     // latest note — WO description / PM task
  manual: string | null;   // linked manual reference (source_citation)
  parts: string[];         // linked parts (parts_needed)
  assetId: string | null;
  actions: { label: string; href?: string; primary?: boolean }[];
};

type WOApi = {
  id: string;
  work_order_number: string;
  title: string;
  description: string;
  asset: string;
  equipment_id: string | null;
  status: string;
  priority: string;
  source: string;
  source_label: string;
  is_auto_pm: boolean;
  safety_warnings: string[];
  parts_needed: string[];
  source_citation: string | null;
  created_at: string;
};

type PMApi = {
  id: string;
  task: string;
  manufacturer: string | null;
  model_number: string | null;
  next_due_at: string | null;
  auto_extracted: boolean;
  criticality: string | null;
};

// Highest urgency first: critical/overdue → high → medium → low.
function severityRank(priority: string, status: string): number {
  if (status === "overdue") return 0;
  switch (priority) {
    case "critical": return 1;
    case "high":     return 2;
    case "medium":   return 3;
    default:         return 4;
  }
}

function statusBadge(status: string): { label: string; bg: string; color: string } {
  switch (status) {
    case "overdue":     return { label: "Overdue",     bg: "#FEE2E2", color: "#DC2626" };
    case "in_progress": return { label: "In Progress", bg: "#FEF9C3", color: "#A16207" };
    case "due":         return { label: "Due",         bg: "#FEF3C7", color: "#B45309" };
    case "completed":   return { label: "Completed",   bg: "#DCFCE7", color: "#16A34A" };
    default:            return { label: "Open",        bg: "#EFF6FF", color: "#2563EB" };
  }
}

function priorityDot(priority: string): string {
  switch (priority) {
    case "critical": return "#DC2626";
    case "high":     return "#EA580C";
    case "medium":   return "#EAB308";
    default:         return "#94A3B8";
  }
}

// "38 min" / "2h 15m" / "3d 4h" — compact downtime/age for a phone glance.
function formatAge(ms: number | null): string {
  if (ms === null || Number.isNaN(ms)) return "—";
  const sign = ms < 0 ? "in " : "";
  let s = Math.abs(ms) / 1000;
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600);  s -= h * 3600;
  const m = Math.floor(s / 60);
  if (d > 0) return `${sign}${d}d ${h}h`;
  if (h > 0) return `${sign}${h}h ${m}m`;
  return `${sign}${m} min`;
}

function woToBoardItem(wo: WOApi, now: number): BoardItem {
  const createdMs = wo.created_at ? Date.parse(wo.created_at) : NaN;
  const ageMs = Number.isNaN(createdMs) ? null : now - createdMs;
  const blocker = wo.safety_warnings && wo.safety_warnings.length > 0
    ? wo.safety_warnings[0]
    : null;
  return {
    key: `wo-${wo.id}`,
    kind: "wo",
    woNumber: wo.work_order_number || null,
    title: wo.title || "Work order",
    status: wo.status || "open",
    priority: wo.priority || "medium",
    ageMs,
    ageLabel: wo.status === "in_progress" ? "down" : "open",
    owner: null,
    blocker,
    note: wo.description ? wo.description.split("\n")[0].slice(0, 140) : null,
    manual: wo.source_citation,
    parts: Array.isArray(wo.parts_needed) ? wo.parts_needed : [],
    assetId: wo.equipment_id,
    actions: [
      { label: "View WO", href: wo.work_order_number ? `/workorders/${wo.work_order_number}` : "/workorders", primary: true },
      { label: "Ask MIRA", href: "https://t.me/FactoryLMDiagnose_bot" },
    ],
  };
}

function pmToBoardItem(pm: PMApi, now: number): BoardItem {
  const dueMs = pm.next_due_at ? Date.parse(pm.next_due_at) : NaN;
  const overdue = !Number.isNaN(dueMs) && dueMs < now;
  const ageMs = Number.isNaN(dueMs) ? null : now - dueMs;
  return {
    key: `pm-${pm.id}`,
    kind: "pm",
    woNumber: null,
    title: pm.task || "Preventive maintenance",
    status: overdue ? "overdue" : "due",
    priority: pm.criticality === "critical" ? "critical"
      : pm.criticality === "high" ? "high"
      : pm.criticality === "low" ? "low" : "medium",
    ageMs,
    ageLabel: "due",
    owner: null,
    blocker: null,
    note: null,
    manual: null,
    parts: [],
    assetId: null,
    actions: [{ label: "Schedule", href: "/schedule", primary: true }],
  };
}

function assetKeyFor(item: BoardItem, woAsset: Map<string, string>, pmAsset: Map<string, string>): string {
  if (item.kind === "wo") return woAsset.get(item.key) || "Unassigned asset";
  return pmAsset.get(item.key) || "Unassigned asset";
}

export default function FeedPage() {
  const tFeed = useTranslations("feed");
  const [fabOpen, setFabOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [read, setRead] = useState<Set<string>>(new Set());
  const [wos, setWos] = useState<WOApi[]>([]);
  const [pms, setPms] = useState<PMApi[]>([]);
  const [loading, setLoading] = useState(true);
  // Captured once per load (in the effect) so age/downtime math stays pure in
  // render — React 19 / Next 16 forbid Date.now() inside render or useMemo.
  const [now, setNow] = useState(0);
  // #1904: show the real signed-in user, not a hardcoded "Mike Harper".
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/me/`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { name: string; role: string } | null) => d && setMe(d))
      .catch(() => {});
  }, []);

  const KPI_LABEL_MAP: Record<string, string> = {
    "Open Work Orders": tFeed("kpi.openWorkOrders"),
    "Overdue PMs":      tFeed("kpi.overduePMs"),
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [woRes, pmRes] = await Promise.all([
          fetch(`${API_BASE}/api/work-orders/`).then(r => r.ok ? r.json() : { work_orders: [] }),
          fetch(`${API_BASE}/api/pm-schedules/`).then(r => r.ok ? r.json() : { pm_schedules: [] }),
        ]);
        if (cancelled) return;
        const woList: WOApi[] = woRes?.work_orders ?? [];
        const pmList: PMApi[] = pmRes?.pm_schedules ?? pmRes?.schedules ?? [];
        setNow(Date.now());
        setWos(woList);
        setPms(pmList);
      } catch {
        if (!cancelled) { setWos([]); setPms([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [refreshing]);

  const openWoCount = useMemo(() => wos.filter(w => w.status === "open" || w.status === "in_progress").length, [wos]);
  const totalWoCount = wos.length;
  const overduePmCount = useMemo(
    () => pms.filter(p => p.next_due_at && Date.parse(p.next_due_at) < now).length,
    [pms, now],
  );
  const autoPmCount = useMemo(() => pms.filter(p => p.auto_extracted).length, [pms]);

  const kpiCards = buildKpiCards(
    loading ? null : openWoCount,
    loading ? null : overduePmCount,
    loading ? null : totalWoCount,
    loading ? null : autoPmCount,
  );

  // ── Build the asset-grouped board ─────────────────────────────────────────
  // Only OPEN maintenance work belongs on a command board: open / in-progress
  // / overdue work orders, plus overdue + upcoming PMs. Completed WOs drop off.
  const groups = useMemo(() => {
    const woAsset = new Map<string, string>();
    const pmAsset = new Map<string, string>();

    const openWos = wos.filter(w => w.status === "open" || w.status === "in_progress" || w.status === "overdue");
    const woItems = openWos.map((wo) => {
      const item = woToBoardItem(wo, now);
      woAsset.set(item.key, wo.asset || "Unassigned asset");
      return item;
    });

    // Overdue + soon-due PMs (within 30 days), most urgent first.
    const horizon = now + 30 * 24 * 3600 * 1000;
    const duePms = pms.filter(p => p.next_due_at && Date.parse(p.next_due_at) <= horizon);
    const pmItems = duePms.map((pm) => {
      const item = pmToBoardItem(pm, now);
      pmAsset.set(item.key, [pm.manufacturer, pm.model_number].filter(Boolean).join(" ") || "Unassigned asset");
      return item;
    });

    const all = [...woItems, ...pmItems].filter(i => !dismissed.has(i.key));

    // Group by asset.
    const byAsset = new Map<string, BoardItem[]>();
    for (const item of all) {
      const k = assetKeyFor(item, woAsset, pmAsset);
      const arr = byAsset.get(k) ?? [];
      arr.push(item);
      byAsset.set(k, arr);
    }

    // Sort items within each asset by severity, then by age (oldest down first).
    for (const arr of byAsset.values()) {
      arr.sort((a, b) => {
        const sr = severityRank(a.priority, a.status) - severityRank(b.priority, b.status);
        if (sr !== 0) return sr;
        return (b.ageMs ?? 0) - (a.ageMs ?? 0);
      });
    }

    // Order asset sections: worst severity present first, then most open items.
    const sections = [...byAsset.entries()].map(([asset, items]) => ({
      asset,
      items,
      worst: Math.min(...items.map(i => severityRank(i.priority, i.status))),
      assetId: items.find(i => i.assetId)?.assetId ?? null,
    }));
    sections.sort((a, b) => (a.worst - b.worst) || (b.items.length - a.items.length) || a.asset.localeCompare(b.asset));
    return sections;
  }, [wos, pms, dismissed, now]);

  const totalOpenItems = useMemo(() => groups.reduce((n, g) => n + g.items.length, 0), [groups]);

  function handleRefresh() {
    setRefreshing(prev => !prev);
  }

  return (
    <div className="relative min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Command Board</h1>
              <Badge variant="secondary" className="text-[10px]">Live</Badge>
            </div>
            {me ? (
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                {me.name} · <span className="capitalize font-medium" style={{ color: "var(--brand-blue)" }}>{me.role}</span>
                {!loading && <> · {totalOpenItems} open {totalOpenItems === 1 ? "item" : "items"}</>}
              </p>
            ) : (
              !loading && (
                <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                  {totalOpenItems} open {totalOpenItems === 1 ? "item" : "items"} across {groups.length} {groups.length === 1 ? "asset" : "assets"}
                </p>
              )
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh} aria-label="Refresh board">
            <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} style={{ color: "var(--foreground-muted)" }} />
          </Button>
        </div>
        {refreshing && (
          <div className="h-1 w-full overflow-hidden" style={{ backgroundColor: "var(--surface-1)" }}>
            <div className="h-full animate-pulse" style={{ background: "linear-gradient(90deg, var(--brand-blue), var(--brand-cyan))", width: "60%" }} />
          </div>
        )}
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 space-y-4 max-w-3xl mx-auto">
        {/* Namespace readiness widget (Phase 2 slice 1) — kept above the KPI row. */}
        <HealthScoreWidget />

        {/* KPI Summary Row — dispatch clarity at a glance */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => (
            <Link key={kpi.label} href={kpi.href}>
              <div className="card p-3 flex flex-col gap-1 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: kpi.bg }}>
                    <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                  </div>
                </div>
                <div className="kpi-value mt-1" style={{ color: "var(--foreground)" }}>{kpi.value}</div>
                <div className="kpi-label mt-0.5">{KPI_LABEL_MAP[kpi.label] ?? kpi.label}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Asset-grouped command board */}
        {loading ? (
          <div className="text-center py-16">
            <RefreshCw className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: "var(--foreground-subtle)" }} />
            <p className="text-sm" style={{ color: "var(--foreground-muted)" }}>Loading open maintenance work…</p>
          </div>
        ) : totalOpenItems === 0 ? (
          <BoardEmptyState />
        ) : (
          <div className="space-y-5">
            {groups.map((group) => (
              <section key={group.asset}>
                <div className="flex items-center justify-between mb-2 px-0.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Cog className="w-4 h-4 flex-shrink-0" style={{ color: "var(--foreground-muted)" }} />
                    {group.assetId ? (
                      <Link href={`/assets/${group.assetId}`}
                        className="text-sm font-semibold tracking-tight truncate hover:underline"
                        style={{ color: "var(--foreground)" }}>
                        {group.asset}
                      </Link>
                    ) : (
                      <h2 className="text-sm font-semibold tracking-tight truncate" style={{ color: "var(--foreground)" }}>
                        {group.asset}
                      </h2>
                    )}
                  </div>
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                    {group.items.length} open
                  </span>
                </div>
                <div className="space-y-2.5">
                  {group.items.map((item) => (
                    <BoardCard
                      key={item.key}
                      item={item}
                      isRead={read.has(item.key)}
                      onDismiss={() => setDismissed(prev => new Set([...prev, item.key]))}
                      onMarkRead={() => setRead(prev => new Set([...prev, item.key]))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* FAB — "Scan asset QR" first: most field-relevant quick action */}
      <div className="fixed bottom-20 right-5 md:bottom-6 z-30 flex flex-col items-end gap-2">
        {fabOpen && (
          <div className="flex flex-col items-end gap-2 mb-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {[
              { label: tFeed("scanQr"),          icon: QrCode,            href: "/scan" },
              { label: tFeed("createWorkOrder"), icon: ClipboardList,     href: "/workorders/new" },
              { label: tFeed("newRequest"),      icon: MessageSquarePlus, href: "/requests/new" },
              { label: tFeed("newAsset"),        icon: Cog,               href: "/assets?create=1" },
            ].map((action) => (
              <Link key={action.label} href={action.href}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
                onClick={() => setFabOpen(false)}>
                <action.icon className="w-4 h-4" />{action.label}
              </Link>
            ))}
          </div>
        )}
        <button onClick={() => setFabOpen(v => !v)}
          aria-expanded={fabOpen}
          aria-label={fabOpen ? "Close quick actions" : "Open quick actions"}
          className="w-14 h-14 rounded-full text-white flex items-center justify-center transition-all duration-200"
          style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)", boxShadow: "var(--shadow-fab)", transform: fabOpen ? "rotate(45deg)" : "none" }}>
          {fabOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        </button>
      </div>

      {fabOpen && <div className="fixed inset-0 z-20" style={{ backgroundColor: "rgba(0,0,0,0.2)" }} onClick={() => setFabOpen(false)} />}
    </div>
  );
}

// Empty state — explains how to add/import assets or faults (AC: "Empty state
// explains how to add/import assets or faults"). No invented data.
function BoardEmptyState() {
  const links = [
    { label: "Add an asset", desc: "Register equipment you maintain", icon: Cog, href: "/assets?create=1" },
    { label: "Import a manual", desc: "Upload OEM docs to ground MIRA", icon: Upload, href: "/documents" },
    { label: "Create a work order", desc: "Log an open fault or job", icon: ClipboardList, href: "/workorders/new" },
    { label: "Build your namespace", desc: "Map sites, lines and machines", icon: Layers, href: "/namespace" },
  ];
  return (
    <div className="card p-6 text-center">
      <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: "#16A34A" }} />
      <p className="font-semibold text-base" style={{ color: "var(--foreground)" }}>No open maintenance work</p>
      <p className="text-sm mt-1 mb-5" style={{ color: "var(--foreground-muted)" }}>
        Nothing is down right now. To start tracking work, add an asset, import a manual, or log a fault.
      </p>
      <div className="grid sm:grid-cols-2 gap-2.5 text-left">
        {links.map((l) => (
          <Link key={l.href} href={l.href}
            className="flex items-start gap-3 p-3 rounded-lg border transition-colors hover:bg-[var(--surface-1)]"
            style={{ borderColor: "var(--border)" }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: "#EFF6FF" }}>
              <l.icon className="w-4 h-4" style={{ color: "#2563EB" }} />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{l.label}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{l.desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function BoardCard({ item, isRead, onDismiss, onMarkRead }: {
  item: BoardItem;
  isRead: boolean;
  onDismiss: () => void;
  onMarkRead: () => void;
}) {
  const tFeed = useTranslations("feed");
  const badge = statusBadge(item.status);
  const borderColor = item.status === "overdue" || item.priority === "critical" ? "#DC2626"
    : item.status === "in_progress" ? "#EAB308"
    : null;

  return (
    <div className="card overflow-hidden transition-all"
      style={{ borderLeft: borderColor ? `3px solid ${borderColor}` : undefined, opacity: isRead ? 0.7 : 1 }}>
      <div className="p-4">
        {/* Title row: symptom / WO title + status badge */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2 min-w-0">
            <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ backgroundColor: priorityDot(item.priority) }}
              title={`Priority: ${item.priority}`} />
            <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>
              {item.woNumber && <span style={{ color: "var(--foreground-subtle)" }}>{item.woNumber} · </span>}
              {item.title}
            </p>
          </div>
          <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
            style={{ backgroundColor: badge.bg, color: badge.color }}>
            {badge.label}
          </span>
        </div>

        {/* Metadata row: owner · age · priority */}
        <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]" style={{ color: "var(--foreground-muted)" }}>
          <span className="inline-flex items-center gap-1">
            <User className="w-3 h-3" />
            {item.owner ?? "Unassigned"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {item.ageLabel} {formatAge(item.ageMs)}
          </span>
          <span className="capitalize">{item.priority} priority</span>
        </div>

        {/* Blocker — only when real (derived from safety_warnings) */}
        {item.blocker && (
          <div className="flex items-center gap-1.5 mt-2 text-[11px] font-medium" style={{ color: "#B45309" }}>
            <ShieldAlert className="w-3.5 h-3.5 flex-shrink-0" />
            <span>Blocked: {item.blocker}</span>
          </div>
        )}

        {/* Latest note */}
        {item.note && (
          <p className="text-xs mt-2 leading-relaxed line-clamp-2" style={{ color: "var(--foreground-muted)" }}>
            {item.note}
          </p>
        )}

        {/* Linked evidence: manual + parts */}
        {(item.manual || item.parts.length > 0) && (
          <div className="flex items-center flex-wrap gap-1.5 mt-2">
            {item.manual && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                <FileText className="w-3 h-3" /> Manual linked
              </span>
            )}
            {item.parts.length > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                <Package className="w-3 h-3" /> {item.parts.length} part{item.parts.length === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {item.actions.map((action, i) => {
            const isExternal = action.href?.startsWith("http");
            const inner = (
              <button key={action.label}
                className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={i === 0
                  ? { backgroundColor: "var(--brand-blue)", color: "white" }
                  : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                {action.label}
                {i === 0 && <ChevronRight className="w-3 h-3" />}
              </button>
            );
            if (action.href && !isExternal) return <Link key={action.label} href={action.href}>{inner}</Link>;
            if (action.href && isExternal) return <a key={action.label} href={action.href} target="_blank" rel="noopener noreferrer">{inner}</a>;
            return inner;
          })}
        </div>
      </div>

      {/* Card footer: mark read / dismiss */}
      <div className="px-4 py-2 border-t flex justify-between" style={{ borderColor: "var(--border)" }}>
        <button onClick={onMarkRead} className="text-[11px] transition-colors"
          style={{ color: isRead ? "var(--foreground-subtle)" : "var(--brand-blue)" }}>
          {tFeed("markRead")}
        </button>
        <button onClick={onDismiss} className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
          {tFeed("dismiss")}
        </button>
      </div>
    </div>
  );
}

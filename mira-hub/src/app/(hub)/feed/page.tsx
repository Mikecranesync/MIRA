"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ClipboardList, Bot, Calendar,
  Plus, QrCode, MessageSquarePlus, X, CheckCircle2,
  Clock, AlertTriangle, TrendingUp, Wrench, Cog,
  ChevronRight, RefreshCw, Volume2, VolumeX, ChevronDown, ChevronUp,
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

type FeedItem = {
  id: number;
  type: string;
  icon: React.ElementType;
  iconBg: string;
  iconColor: string;
  title: string;
  subtitle: string;
  fullText?: string;
  timestamp: string;
  asset: string | null;
  assetId?: string;
  woId?: string;
  actions: { label: string; href?: string; primary?: boolean }[];
  border: string | null;
  safetyAudit?: { ts: string; user: string; action: string }[];
};

type WOApi = {
  id: string;
  work_order_number: string;
  title: string;
  asset: string;
  status: string;
  priority: string;
  source: string;
  source_label: string;
  is_auto_pm: boolean;
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

function statusToStyling(status: string, isAutoPm: boolean): {
  icon: React.ElementType; iconBg: string; iconColor: string; border: string | null;
} {
  if (status === "completed") return { icon: CheckCircle2, iconBg: "#DCFCE7", iconColor: "#16A34A", border: null };
  if (status === "in_progress") return { icon: ClipboardList, iconBg: "#FEF9C3", iconColor: "#EAB308", border: null };
  if (status === "overdue") return { icon: AlertTriangle, iconBg: "#FEE2E2", iconColor: "#DC2626", border: "#DC2626" };
  if (isAutoPm) return { icon: Bot, iconBg: "#F0FDF4", iconColor: "#16A34A", border: null };
  return { icon: ClipboardList, iconBg: "#EFF6FF", iconColor: "#2563EB", border: null };
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { hour: "numeric", minute: "2-digit", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

function woToFeedItem(wo: WOApi, idx: number): FeedItem {
  const styling = statusToStyling(wo.status, wo.is_auto_pm);
  const statusLabel = wo.status === "in_progress" ? "In Progress" : wo.status.charAt(0).toUpperCase() + wo.status.slice(1);
  return {
    id: idx,
    type: wo.is_auto_pm ? "pm_due" : "wo_update",
    icon: styling.icon,
    iconBg: styling.iconBg,
    iconColor: styling.iconColor,
    title: `${wo.work_order_number}: ${wo.title.slice(0, 60)}${wo.title.length > 60 ? "…" : ""}`,
    subtitle: `${statusLabel} · ${wo.asset || "Unknown asset"} · Priority ${wo.priority}`,
    timestamp: formatTimestamp(wo.created_at),
    asset: wo.asset || null,
    woId: wo.work_order_number,
    actions: [
      { label: "View WO", href: `/workorders/${wo.work_order_number}`, primary: true },
      { label: "Ask MIRA", href: "https://t.me/FactoryLMDiagnose_bot" },
    ],
    border: styling.border,
  };
}

function pmToFeedItem(pm: PMApi, idx: number): FeedItem {
  const isOverdue = pm.next_due_at !== null && new Date(pm.next_due_at) < new Date();
  return {
    id: idx,
    type: "pm_due",
    icon: Calendar,
    iconBg: isOverdue ? "#FEE2E2" : "#F5F3FF",
    iconColor: isOverdue ? "#DC2626" : "#7C3AED",
    title: `${isOverdue ? "Overdue PM" : "PM Due"}: ${pm.task}`,
    subtitle: [pm.manufacturer, pm.model_number].filter(Boolean).join(" ")
      + (pm.next_due_at ? ` · Due ${formatTimestamp(pm.next_due_at)}` : ""),
    timestamp: pm.next_due_at ? formatTimestamp(pm.next_due_at) : "—",
    asset: [pm.manufacturer, pm.model_number].filter(Boolean).join(" ") || null,
    actions: [
      { label: "Schedule", href: "/schedule", primary: true },
    ],
    border: isOverdue ? "#DC2626" : null,
  };
}

function useSpeech() {
  const [speaking, setSpeaking] = useState<number | null>(null);
  function speak(id: number, text: string) {
    if (!window.speechSynthesis) return;
    if (speaking === id) { window.speechSynthesis.cancel(); setSpeaking(null); return; }
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.95;
    utt.onend = () => setSpeaking(null);
    utt.onerror = () => setSpeaking(null);
    window.speechSynthesis.speak(utt);
    setSpeaking(id);
  }
  return { speaking, speak };
}

export default function FeedPage() {
  const tFeed = useTranslations("feed");
  const [fabOpen, setFabOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [read, setRead] = useState<Set<number>>(new Set());
  const [wos, setWos] = useState<WOApi[]>([]);
  const [pms, setPms] = useState<PMApi[]>([]);
  const [loading, setLoading] = useState(true);
  // #1904: the header showed a hardcoded "Mike Harper · Admin" to every tenant.
  // Show the real signed-in user instead (same /api/me source as the sidebar).
  const [me, setMe] = useState<{ name: string; role: string } | null>(null);
  const { speaking, speak } = useSpeech();

  useEffect(() => {
    fetch(`${API_BASE}/api/me`)
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
          fetch(`${API_BASE}/api/work-orders`).then(r => r.ok ? r.json() : { work_orders: [] }),
          fetch(`${API_BASE}/api/pm-schedules`).then(r => r.ok ? r.json() : { pm_schedules: [] }),
        ]);
        if (cancelled) return;
        const woList: WOApi[] = woRes?.work_orders ?? [];
        const pmList: PMApi[] = pmRes?.pm_schedules ?? pmRes?.schedules ?? [];
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
  const overduePmCount = useMemo(() => {
    const now = Date.now();
    return pms.filter(p => p.next_due_at && new Date(p.next_due_at).getTime() < now).length;
  }, [pms]);
  const autoPmCount = useMemo(() => pms.filter(p => p.auto_extracted).length, [pms]);

  const kpiCards = buildKpiCards(
    loading ? null : openWoCount,
    loading ? null : overduePmCount,
    loading ? null : totalWoCount,
    loading ? null : autoPmCount,
  );

  const feedItems = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [];
    // Most recent WOs first (top 5)
    const recentWos = [...wos]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 5)
      .map((wo, i) => woToFeedItem(wo, i + 1));
    items.push(...recentWos);
    // Upcoming PMs (top 3 by due date)
    const upcomingPms = [...pms]
      .filter(p => p.next_due_at)
      .sort((a, b) => new Date(a.next_due_at!).getTime() - new Date(b.next_due_at!).getTime())
      .slice(0, 3)
      .map((pm, i) => pmToFeedItem(pm, 1000 + i));
    items.push(...upcomingPms);
    return items;
  }, [wos, pms]);

  function handleRefresh() {
    setRefreshing(prev => !prev);
  }

  const visibleItems = feedItems.filter(i => !dismissed.has(i.id));

  return (
    <div className="relative min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{tFeed("title")}</h1>
              <Badge variant="secondary" className="text-[10px]">Live</Badge>
            </div>
            {me && (
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                {me.name} · <span className="capitalize font-medium" style={{ color: "var(--brand-blue)" }}>{me.role}</span>
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon" onClick={handleRefresh}>
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
        {/* Namespace readiness widget (Phase 2 slice 1) */}
        <HealthScoreWidget />

        {/* KPI Summary Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {kpiCards.map((kpi) => (
            <Link key={kpi.label} href={kpi.href}>
              <div className="card p-3 flex flex-col gap-1 hover:shadow-md transition-shadow cursor-pointer">
                <div className="flex items-center justify-between">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: kpi.bg }}>
                    <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                  </div>
                  <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
                </div>
                <div className="kpi-value mt-1" style={{ color: "var(--foreground)" }}>{kpi.value}</div>
                <div className="kpi-label mt-0.5">{KPI_LABEL_MAP[kpi.label] ?? kpi.label}</div>
              </div>
            </Link>
          ))}
        </div>

        {/* Feed Items */}
        <div className="space-y-3">
          {visibleItems.map((item) => (
            <FeedCard
              key={item.id}
              item={item}
              isRead={read.has(item.id)}
              isSpeaking={speaking === item.id}
              onSpeak={(text) => speak(item.id, text)}
              onDismiss={() => setDismissed(prev => new Set([...prev, item.id]))}
              onMarkRead={() => setRead(prev => new Set([...prev, item.id]))}
            />
          ))}
        </div>

        {visibleItems.length === 0 && (
          <div className="text-center py-16">
            <CheckCircle2 className="w-12 h-12 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{tFeed("allCaughtUp")}</p>
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

function FeedCard({ item, isRead, isSpeaking, onSpeak, onDismiss, onMarkRead }: {
  item: FeedItem;
  isRead: boolean;
  isSpeaking: boolean;
  onSpeak: (text: string) => void;
  onDismiss: () => void;
  onMarkRead: () => void;
}) {
  const tFeed = useTranslations("feed");
  const [expanded, setExpanded] = useState(false);
  const [showAudit, setShowAudit] = useState(false);
  const speakText = item.fullText ?? item.title + ". " + item.subtitle;

  return (
    <div className="card overflow-hidden transition-all"
      style={{ borderLeft: item.border ? `3px solid ${item.border}` : undefined, opacity: isRead ? 0.75 : 1 }}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5" style={{ backgroundColor: item.iconBg }}>
            <item.icon className="w-4.5 h-4.5" style={{ color: item.iconColor, width: 18, height: 18 }} />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>{item.title}</p>
              <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                {/* TTS button */}
                {(item.fullText || item.type === "brief") && (
                  <button onClick={() => onSpeak(speakText)} className="p-1 rounded-md transition-colors hover:bg-[var(--surface-1)]"
                    title={isSpeaking ? "Stop" : "Play audio"}>
                    {isSpeaking
                      ? <VolumeX className="w-3.5 h-3.5" style={{ color: "var(--brand-blue)" }} />
                      : <Volume2 className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
                    }
                  </button>
                )}
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                  <Clock className="inline w-3 h-3 mr-0.5" />{item.timestamp}
                </span>
              </div>
            </div>

            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
              {item.subtitle}
            </p>

            {/* Expanded full text */}
            {expanded && item.fullText && (
              <div className="mt-2 p-3 rounded-lg text-xs leading-relaxed" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                {item.fullText}
              </div>
            )}

            {/* Safety audit trail */}
            {showAudit && item.safetyAudit && (
              <div className="mt-2 space-y-1.5">
                {item.safetyAudit.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                    <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#DC2626" }} />
                    <span>{e.ts} — {e.user}: {e.action}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Asset chip */}
            {item.asset && (
              <div className="flex items-center gap-1 mt-2">
                {item.assetId ? (
                  <Link href={`/assets/${item.assetId}`}
                    className="text-[11px] font-medium px-2 py-0.5 rounded-full transition-colors hover:bg-[var(--surface-2)]"
                    style={{ backgroundColor: "var(--surface-1)", color: "var(--brand-blue)" }}>
                    {item.asset} <ChevronRight className="inline w-3 h-3" />
                  </Link>
                ) : (
                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                    {item.asset}
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

              {/* Expand toggle */}
              {item.fullText && (
                <button onClick={() => setExpanded(v => !v)}
                  className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg transition-colors"
                  style={{ color: "var(--foreground-subtle)", backgroundColor: "var(--surface-1)" }}>
                  {expanded ? <><ChevronUp className="w-3 h-3" />{tFeed("showLess")}</> : <><ChevronDown className="w-3 h-3" />{tFeed("showMore")}</>}
                </button>
              )}

              {/* Safety audit button */}
              {item.safetyAudit && (
                <button onClick={() => setShowAudit(v => !v)}
                  className="text-xs px-2 py-1.5 rounded-lg transition-colors"
                  style={{ color: "#DC2626", backgroundColor: "#FEF2F2" }}>
                  {tFeed("auditTrail")}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Card footer: mark read / dismiss */}
      <div className="px-4 py-2 border-t flex justify-between" style={{ borderColor: "var(--border)" }}>
        <button onClick={onMarkRead} className="text-[11px] transition-colors"
          style={{ color: isRead ? "var(--foreground-subtle)" : "var(--brand-blue)" }}>
          {isRead ? tFeed("markRead") : tFeed("markRead")}
        </button>
        <button onClick={onDismiss} className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
          {tFeed("dismiss")}
        </button>
      </div>
    </div>
  );
}

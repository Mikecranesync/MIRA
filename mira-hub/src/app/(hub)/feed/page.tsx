"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  Mic, ClipboardList, Bot, ShieldAlert, Calendar,
  Plus, QrCode, MessageSquarePlus, X, CheckCircle2,
  Clock, AlertTriangle, TrendingUp, Wrench, Cog,
  ChevronRight, RefreshCw, Volume2, VolumeX, ChevronDown, ChevronUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const KPI_CARDS = [
  { label: "Open Work Orders", value: "12", icon: ClipboardList, color: "#2563EB", bg: "#EFF6FF", href: "/workorders" },
  { label: "Overdue PMs",      value: "3",  icon: Calendar,      color: "#DC2626", bg: "#FEF2F2", href: "/schedule" },
  { label: "Downtime Today",   value: "2.4h", icon: AlertTriangle, color: "#EAB308", bg: "#FEF9C3", href: "/reports" },
  { label: "Wrench Time",      value: "67%", icon: Wrench,        color: "#16A34A", bg: "#DCFCE7", href: "/reports" },
];

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

const FEED_ITEMS: FeedItem[] = [
  {
    id: 1, type: "brief",
    icon: Mic, iconBg: "#EFF6FF", iconColor: "#2563EB",
    title: "MIRA Voice Brief — Morning Shift",
    subtitle: "3 high-priority items, 2 overdue PMs, 1 critical asset",
    fullText: "Good morning Mike. Here's your shift briefing: Conveyor Belt #3 emergency replacement is in progress — John S. is on it, ETA 2 hours. Air Compressor PM is due today; parts are in stock at A-3-1. HVAC Unit #2 has a quarterly filter change due in 3 days. Generator load test is scheduled for May 10th. Watch the CNC Mill #7 vibration alert — MIRA flagged a spindle bearing anomaly at 78% confidence. 2 overdue PMs need attention. Wrench time is at 67% this week. Have a safe shift.",
    timestamp: "6:00 AM", asset: null,
    actions: [{ label: "Play Brief", primary: true }, { label: "Read" }],
    border: null,
  },
  {
    id: 2, type: "safety",
    icon: ShieldAlert, iconBg: "#FEF2F2", iconColor: "#DC2626",
    title: "SAFETY ALERT: Arc Flash Hazard — Panel E-12",
    subtitle: "Arc flash assessment required before any work on Panel E-12. LOTO procedure in effect.",
    fullText: "Arc flash hazard confirmed at Electrical Panel E-12. Category 2 PPE required. LOTO procedure document LOTO-E12-2026 is in effect. No work may begin without written authorization from the site safety officer. Boundary: 4 ft restricted, 10 ft limited. Contact Ray P. (ext. 106) for LOTO coordination.",
    timestamp: "7:15 AM", asset: "Electrical Panel E-12",
    actions: [{ label: "View Procedure", href: "/documents/d04", primary: true }, { label: "Acknowledge" }],
    border: "#DC2626",
    safetyAudit: [
      { ts: "7:15 AM", user: "MIRA System", action: "Alert issued" },
      { ts: "7:22 AM", user: "Mike H.", action: "Viewed alert" },
    ],
  },
  {
    id: 3, type: "wo_update",
    icon: ClipboardList, iconBg: "#FEF9C3", iconColor: "#EAB308",
    title: "WO-2026-002: Conveyor Belt #3 — In Progress",
    subtitle: "John S. started work. Belt tension adjusted, monitoring for 30 min before sign-off.",
    timestamp: "8:32 AM", asset: "Conveyor Belt #3", assetId: "2", woId: "WO-2026-002",
    actions: [{ label: "View WO", href: "/workorders/WO-2026-002", primary: true }, { label: "Add Note" }],
    border: null,
  },
  {
    id: 4, type: "mira_diagnostic",
    icon: Bot, iconBg: "#F0FDF4", iconColor: "#16A34A",
    title: "MIRA Diagnostic — Air Compressor #1",
    subtitle: "Elevated bearing temp detected (82°C vs 65°C baseline). Recommend lubrication check within 48h.",
    fullText: "MIRA detected bearing temperature 26% above baseline (82°C vs 65°C normal). Most likely cause: insufficient lubrication (confidence 84%). Recommended action: lubricate drive-end bearing per OEM spec. If temp exceeds 90°C, shut down immediately. Part FAG-6308-2RS (P-005) available at A-2-3 if replacement is needed. Check oil level as secondary step.",
    timestamp: "9:05 AM", asset: "Air Compressor #1", assetId: "1",
    actions: [{ label: "Ask MIRA", href: "https://t.me/FactoryLMDiagnose_bot", primary: true }, { label: "Create WO", href: "/workorders/new" }],
    border: null,
  },
  {
    id: 5, type: "pm_due",
    icon: Calendar, iconBg: "#F5F3FF", iconColor: "#7C3AED",
    title: "PM Due in 3 Days: HVAC Unit #2 Filter Change",
    subtitle: "Quarterly filter change. Est. 45 min. Parts confirmed in stock: Part P-008 (3 available).",
    timestamp: "9:30 AM", asset: "HVAC Unit #2", assetId: "4",
    actions: [{ label: "Schedule Now", href: "/schedule", primary: true }, { label: "Defer" }],
    border: null,
  },
  {
    id: 6, type: "wo_update",
    icon: CheckCircle2, iconBg: "#DCFCE7", iconColor: "#16A34A",
    title: "WO-2026-005: Pump Station A — Completed",
    subtitle: "Mechanical seal replaced. 4h total. Asset returned to service. No further issues.",
    timestamp: "11:47 AM", asset: "Pump Station A", assetId: "5", woId: "WO-2026-005",
    actions: [{ label: "View Report", href: "/workorders/WO-2026-005", primary: true }],
    border: null,
  },
  {
    id: 7, type: "mira_diagnostic",
    icon: Bot, iconBg: "#FEF9C3", iconColor: "#EAB308",
    title: "MIRA Alert — CNC Mill #7 Vibration Anomaly",
    subtitle: "Z-axis vibration 3.2x normal. Possible spindle bearing wear. Confidence: 78%.",
    fullText: "Z-axis vibration signature shows 3.2× deviation from baseline. Pattern consistent with angular contact bearing wear (SKF 7020, part P-012). Confidence: 78%. Recommended action: schedule inspection within 7 days. Continued operation at high speeds may accelerate wear. Ask MIRA for a complete diagnostic conversation.",
    timestamp: "1:15 PM", asset: "CNC Mill #7", assetId: "3",
    actions: [{ label: "Chat with MIRA", href: "https://t.me/FactoryLMDiagnose_bot", primary: true }, { label: "Create WO", href: "/workorders/new" }],
    border: "#EAB308",
  },
];

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
  const tWorkorders = useTranslations("workorders");
  const [fabOpen, setFabOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());
  const [read, setRead] = useState<Set<number>>(new Set());
  const { speaking, speak } = useSpeech();

  const KPI_LABEL_MAP: Record<string, string> = {
    "Open Work Orders": tFeed("kpi.openWorkOrders"),
    "Overdue PMs":      tFeed("kpi.overduePMs"),
    "Downtime Today":   tFeed("kpi.downtimeToday"),
    "Wrench Time":      tFeed("kpi.wrenchTime"),
  };

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }

  const visibleItems = FEED_ITEMS.filter(i => !dismissed.has(i.id));

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
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              Mike Harper · <span className="capitalize font-medium" style={{ color: "var(--brand-blue)" }}>Admin</span>
            </p>
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
        {/* KPI Summary Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {KPI_CARDS.map((kpi) => (
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

      {/* FAB */}
      <div className="fixed bottom-20 right-5 md:bottom-6 z-30 flex flex-col items-end gap-2">
        {fabOpen && (
          <div className="flex flex-col items-end gap-2 mb-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {[
              { label: tWorkorders("new"), icon: ClipboardList,     href: "/workorders/new" },
              { label: tFeed("scanQr"),    icon: QrCode,            href: "#" },
              { label: tFeed("newRequest"), icon: MessageSquarePlus, href: "/requests/new" },
              { label: "New Asset",        icon: Cog,               href: "/assets?create=1" },
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

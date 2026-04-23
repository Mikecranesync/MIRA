"use client";

import { useState } from "react";
import {
  Mic, ClipboardList, Bot, ShieldAlert, Calendar,
  Plus, QrCode, MessageSquarePlus, X, CheckCircle2,
  Clock, AlertTriangle, TrendingUp, Wrench,
  ChevronRight, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/* ─── Mock data ─────────────────────────────────────────────────────── */
const KPI_CARDS = [
  { label: "Open Work Orders", value: "12", icon: ClipboardList, color: "#2563EB", bg: "#EFF6FF" },
  { label: "Overdue PMs",      value: "3",  icon: Calendar,      color: "#DC2626", bg: "#FEF2F2" },
  { label: "Downtime Today",   value: "2.4h", icon: AlertTriangle, color: "#EAB308", bg: "#FEF9C3" },
  { label: "Wrench Time",      value: "67%", icon: Wrench,        color: "#16A34A", bg: "#DCFCE7" },
];

const FEED_ITEMS = [
  {
    id: 1,
    type: "brief",
    icon: Mic,
    iconBg: "#EFF6FF",
    iconColor: "#2563EB",
    title: "MIRA Voice Brief — Morning Shift",
    subtitle: "3 high-priority items, 2 overdue PMs, 1 critical asset",
    timestamp: "6:00 AM",
    asset: null,
    actions: ["Play Brief", "Read"],
    border: null,
  },
  {
    id: 2,
    type: "safety",
    icon: ShieldAlert,
    iconBg: "#FEF2F2",
    iconColor: "#DC2626",
    title: "SAFETY ALERT: Arc Flash Hazard — Panel E-12",
    subtitle: "Arc flash assessment required before any work on Panel E-12. LOTO procedure in effect.",
    timestamp: "7:15 AM",
    asset: "Electrical Panel E-12",
    actions: ["View Procedure", "Acknowledge"],
    border: "#DC2626",
  },
  {
    id: 3,
    type: "wo_update",
    icon: ClipboardList,
    iconBg: "#FEF9C3",
    iconColor: "#EAB308",
    title: "WO-2026-002: Conveyor Belt #3 — In Progress",
    subtitle: "John S. started work. Belt tension adjusted, monitoring for 30 min before sign-off.",
    timestamp: "8:32 AM",
    asset: "Conveyor Belt #3",
    actions: ["View WO", "Add Note"],
    border: null,
  },
  {
    id: 4,
    type: "mira_diagnostic",
    icon: Bot,
    iconBg: "#F0FDF4",
    iconColor: "#16A34A",
    title: "MIRA Diagnostic — Air Compressor #1",
    subtitle: "Elevated bearing temp detected (82°C vs 65°C baseline). Recommend lubrication check within 48h.",
    timestamp: "9:05 AM",
    asset: "Air Compressor #1",
    actions: ["Ask MIRA", "Create WO"],
    border: null,
  },
  {
    id: 5,
    type: "pm_due",
    icon: Calendar,
    iconBg: "#F5F3FF",
    iconColor: "#7C3AED",
    title: "PM Due in 3 Days: HVAC Unit #2 Filter Change",
    subtitle: "Quarterly filter change. Est. 45 min. Parts confirmed in stock: Part P-008 (3 available).",
    timestamp: "9:30 AM",
    asset: "HVAC Unit #2",
    actions: ["Schedule Now", "Defer"],
    border: null,
  },
  {
    id: 6,
    type: "wo_update",
    icon: CheckCircle2,
    iconBg: "#DCFCE7",
    iconColor: "#16A34A",
    title: "WO-2026-005: Pump Station A — Completed",
    subtitle: "Mechanical seal replaced. 4h total. Asset returned to service. No further issues.",
    timestamp: "11:47 AM",
    asset: "Pump Station A",
    actions: ["View Report"],
    border: null,
  },
  {
    id: 7,
    type: "mira_diagnostic",
    icon: Bot,
    iconBg: "#FEF9C3",
    iconColor: "#EAB308",
    title: "MIRA Alert — CNC Mill #7 Vibration Anomaly",
    subtitle: "Z-axis vibration 3.2x normal. Possible spindle bearing wear. Confidence: 78%.",
    timestamp: "1:15 PM",
    asset: "CNC Mill #7",
    actions: ["Chat with MIRA", "Create WO"],
    border: "#EAB308",
  },
];

/* ─── Component ─────────────────────────────────────────────────────── */
export default function FeedPage() {
  const [fabOpen, setFabOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 800);
  }

  return (
    <div className="relative min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>Activity Feed</h1>
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

        {/* Mobile pull-to-refresh indicator */}
        {refreshing && (
          <div className="h-1 w-full overflow-hidden" style={{ backgroundColor: "var(--surface-1)" }}>
            <div className="h-full animate-pulse" style={{ background: "linear-gradient(90deg, var(--brand-blue), var(--brand-cyan))", width: "60%" }} />
          </div>
        )}
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 space-y-4 max-w-3xl mx-auto">
        {/* KPI Summary Row (Manager View) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {KPI_CARDS.map((kpi) => (
            <div key={kpi.label} className="card p-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: kpi.bg }}>
                  <kpi.icon className="w-4 h-4" style={{ color: kpi.color }} />
                </div>
                <TrendingUp className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
              </div>
              <div className="text-xl font-bold leading-none mt-1" style={{ color: "var(--foreground)" }}>{kpi.value}</div>
              <div className="text-[11px] leading-tight" style={{ color: "var(--foreground-muted)" }}>{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* Feed Items */}
        <div className="space-y-3">
          {FEED_ITEMS.map((item) => (
            <FeedCard key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* FAB */}
      <div className="fixed bottom-20 right-5 md:bottom-6 z-30 flex flex-col items-end gap-2">
        {fabOpen && (
          <div className="flex flex-col items-end gap-2 mb-1 animate-in fade-in slide-in-from-bottom-2 duration-150">
            {[
              { label: "New Work Order", icon: ClipboardList, href: "/workorders/new" },
              { label: "Scan QR Code",   icon: QrCode,        href: "#" },
              { label: "New Request",    icon: MessageSquarePlus, href: "/requests" },
            ].map((action) => (
              <a key={action.label} href={action.href}
                className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-white shadow-lg"
                style={{ background: "linear-gradient(135deg, #2563EB, #0891B2)" }}
                onClick={() => setFabOpen(false)}>
                <action.icon className="w-4 h-4" />
                {action.label}
              </a>
            ))}
          </div>
        )}
        <button
          onClick={() => setFabOpen(v => !v)}
          className="w-14 h-14 rounded-full text-white flex items-center justify-center transition-all duration-200"
          style={{
            background: "linear-gradient(135deg, #2563EB, #0891B2)",
            boxShadow: "var(--shadow-fab)",
            transform: fabOpen ? "rotate(45deg)" : "none",
          }}
          aria-label={fabOpen ? "Close actions" : "Open actions"}
        >
          {fabOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        </button>
      </div>

      {/* FAB backdrop */}
      {fabOpen && (
        <div className="fixed inset-0 z-20" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}
          onClick={() => setFabOpen(false)} />
      )}
    </div>
  );
}

function FeedCard({ item }: { item: typeof FEED_ITEMS[number] }) {
  return (
    <div
      className="card overflow-hidden"
      style={{
        borderLeft: item.border ? `3px solid ${item.border}` : undefined,
      }}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ backgroundColor: item.iconBg }}>
            <item.icon className="w-4.5 h-4.5" style={{ color: item.iconColor, width: 18, height: 18 }} />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>
                {item.title}
              </p>
              <span className="text-[11px] flex-shrink-0 mt-0.5" style={{ color: "var(--foreground-subtle)" }}>
                <Clock className="inline w-3 h-3 mr-0.5" />{item.timestamp}
              </span>
            </div>

            <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
              {item.subtitle}
            </p>

            {item.asset && (
              <div className="flex items-center gap-1 mt-2">
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {item.asset}
                </span>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 mt-3">
              {item.actions.map((action, i) => (
                <button key={action}
                  className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={i === 0
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {action}
                  {i === 0 && <ChevronRight className="w-3 h-3" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

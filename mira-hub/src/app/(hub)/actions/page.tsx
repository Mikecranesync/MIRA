"use client";

import { useState } from "react";
import { Zap, ClipboardList, BookOpen, Calendar, ShieldAlert, Search, Filter } from "lucide-react";
import { useTranslations } from "next-intl";

type ActionType = "wo_created" | "pm_scheduled" | "lookup" | "manual_served" | "safety_alert" | "diagnostic";
type SyncStatus = "synced" | "pending" | "failed" | "none";

type Action = {
  id: string;
  ts: string;
  type: ActionType;
  title: string;
  tech: string;
  techInitials: string;
  asset: string | null;
  channel: string;
  channelEmoji: string;
  syncStatus: SyncStatus;
  syncTarget: string | null;
  syncTs?: string;
};

const ACTIONS: Action[] = [
  { id: "a001", ts: "9:05 AM", type: "diagnostic",    title: "Bearing temp anomaly — Air Compressor #1",      tech: "John Smith",    techInitials: "JS", asset: "Air Compressor #1", channel: "Telegram",    channelEmoji: "✈️", syncStatus: "pending", syncTarget: "Atlas" },
  { id: "a002", ts: "8:47 AM", type: "manual_served",  title: "Conveyor Belt #3 tensioning procedure served",  tech: "Maria Garcia",  techInitials: "MG", asset: "Conveyor Belt #3", channel: "Telegram",    channelEmoji: "✈️", syncStatus: "none",    syncTarget: null },
  { id: "a003", ts: "8:32 AM", type: "wo_created",     title: "WO-2026-002 created — Belt tension out of spec",tech: "John Smith",    techInitials: "JS", asset: "Conveyor Belt #3", channel: "Telegram",    channelEmoji: "✈️", syncStatus: "synced",  syncTarget: "Atlas",  syncTs: "8:32 AM" },
  { id: "a004", ts: "7:15 AM", type: "safety_alert",   title: "Arc flash hazard — Electrical Panel E-12",     tech: "MIRA System",   techInitials: "AI", asset: "Panel E-12",       channel: "Voice",       channelEmoji: "🎙️", syncStatus: "synced",  syncTarget: "Atlas",  syncTs: "7:15 AM" },
  { id: "a005", ts: "6:58 AM", type: "lookup",         title: "SKF 7020 bearing stock check — CNC Mill #7",   tech: "Ray Patel",     techInitials: "RP", asset: "CNC Mill #7",      channel: "Email",       channelEmoji: "📧", syncStatus: "none",    syncTarget: null },
  { id: "a006", ts: "6:02 AM", type: "pm_scheduled",   title: "Morning brief delivered — 3 priority items",   tech: "MIRA System",   techInitials: "AI", asset: null,               channel: "Voice",       channelEmoji: "🎙️", syncStatus: "synced",  syncTarget: "Atlas",  syncTs: "6:02 AM" },
  { id: "a007", ts: "5:47 AM", type: "diagnostic",    title: "CNC Mill #7 Z-axis vibration — 78% confidence", tech: "MIRA System",   techInitials: "AI", asset: "CNC Mill #7",      channel: "Open WebUI",  channelEmoji: "🖥️", syncStatus: "pending", syncTarget: "Atlas" },
  { id: "a008", ts: "Yesterday 3:45 PM", type: "wo_created", title: "WO-2026-005 created — Pump Station A seal", tech: "Ray Patel", techInitials: "RP", asset: "Pump Station A", channel: "Telegram", channelEmoji: "✈️", syncStatus: "synced", syncTarget: "Atlas", syncTs: "Yest. 3:45 PM" },
  { id: "a009", ts: "Yesterday 2:30 PM", type: "lookup", title: "Wrench time breakdown by tech requested", tech: "Mike Harper", techInitials: "MH", asset: null, channel: "Open WebUI", channelEmoji: "🖥️", syncStatus: "none", syncTarget: null },
  { id: "a010", ts: "Yesterday 11:20 AM", type: "manual_served", title: "HVAC Unit #2 filter spec served", tech: "Sam Torres", techInitials: "ST", asset: "HVAC Unit #2", channel: "WhatsApp", channelEmoji: "💬", syncStatus: "none", syncTarget: null },
];

const ACTION_CFG: Record<ActionType, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  diagnostic:    { label: "Diagnostic",   color: "#EAB308", bg: "#FEF9C3", Icon: Zap },
  wo_created:    { label: "WO Created",   color: "#2563EB", bg: "#EFF6FF", Icon: ClipboardList },
  pm_scheduled:  { label: "PM",           color: "#7C3AED", bg: "#F5F3FF", Icon: Calendar },
  manual_served: { label: "Manual",       color: "#0891B2", bg: "#ECFEFF", Icon: BookOpen },
  safety_alert:  { label: "Safety",       color: "#DC2626", bg: "#FEF2F2", Icon: ShieldAlert },
  lookup:        { label: "Lookup",       color: "#16A34A", bg: "#DCFCE7", Icon: Search },
};

const SYNC_CFG: Record<SyncStatus, { label: string; color: string; bg: string }> = {
  synced:  { label: "Synced",  color: "#16A34A", bg: "#DCFCE7" },
  pending: { label: "Pending", color: "#EAB308", bg: "#FEF9C3" },
  failed:  { label: "Failed",  color: "#DC2626", bg: "#FEF2F2" },
  none:    { label: "—",       color: "#94A3B8", bg: "transparent" },
};

const ALL_TYPES: ActionType[] = ["wo_created", "pm_scheduled", "diagnostic", "manual_served", "safety_alert", "lookup"];

export default function ActionsPage() {
  const t = useTranslations("actions");
  const [filterType, setFilterType] = useState<ActionType | "all">("all");
  const [filterSync, setFilterSync] = useState<SyncStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);

  const filtered = ACTIONS.filter(a =>
    (filterType === "all" || a.type === filterType) &&
    (filterSync === "all" || a.syncStatus === filterSync)
  );

  const syncedCount  = ACTIONS.filter(a => a.syncStatus === "synced").length;
  const pendingCount = ACTIONS.filter(a => a.syncStatus === "pending").length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {ACTIONS.length} {t("today")} · {syncedCount} {t("synced")} · {pendingCount} {t("pending")}
            </p>
          </div>
          <button onClick={() => setShowFilters(v => !v)} className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-1)]">
            <Filter className="w-4 h-4" style={{ color: showFilters ? "var(--brand-blue)" : "var(--foreground-muted)" }} />
          </button>
        </div>

        {showFilters && (
          <div className="px-4 md:px-6 pb-3 space-y-2">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {(["all", ...ALL_TYPES] as const).map(a => (
                <button key={a} onClick={() => setFilterType(a)}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={filterType === a
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {a === "all" ? "All types" : ACTION_CFG[a].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {(["all", "synced", "pending", "failed", "none"] as const).map(s => (
                <button key={s} onClick={() => setFilterSync(s)}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={filterSync === s
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {s === "all" ? "All sync" : SYNC_CFG[s].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-4xl mx-auto space-y-1">
        {filtered.map(action => {
          const cfg = ACTION_CFG[action.type];
          const sync = SYNC_CFG[action.syncStatus];
          const Icon = cfg.Icon;

          return (
            <div key={action.id} className="card px-3 py-3 flex items-center gap-3"
              style={{ borderLeft: action.type === "safety_alert" ? "3px solid #DC2626" : undefined }}>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: cfg.bg }}>
                <Icon className="w-4 h-4" style={{ color: cfg.color }} />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2 flex-wrap">
                  <p className="text-sm font-medium leading-snug" style={{ color: "var(--foreground)" }}>
                    {action.title}
                  </p>
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <span className="text-[10px] font-semibold uppercase tracking-wide"
                    style={{ color: "var(--foreground-subtle)" }}>
                    {action.ts}
                  </span>
                  <span className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>·</span>
                  <div className="w-4 h-4 rounded-full flex items-center justify-center text-[7px] font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                    {action.techInitials}
                  </div>
                  <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{action.tech}</span>
                  <span className="text-[10px]">{action.channelEmoji}</span>
                  {action.asset && (
                    <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>· {action.asset}</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                {action.syncStatus !== "none" && (
                  <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: sync.bg, color: sync.color }}>
                    {action.syncStatus === "synced" && action.syncTarget
                      ? `✓ ${action.syncTarget}`
                      : sync.label}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Zap className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p style={{ color: "var(--foreground-muted)" }}>{t("noActions")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

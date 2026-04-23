"use client";

import { useState } from "react";
import {
  Activity, MessageSquare, Bot, ShieldAlert, Zap,
  BookOpen, ClipboardList, CheckCircle2, AlertTriangle,
  ChevronRight, X, Clock, Filter, RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

type SyncStatus = "synced" | "pending" | "failed" | "none";
type Channel = "telegram" | "whatsapp" | "voice" | "email" | "webui";
type ActionType = "diagnostic" | "wo_created" | "pm_scheduled" | "manual_served" | "safety_alert" | "lookup" | "greeting";

type EventRow = {
  id: string;
  ts: string;
  tech: string;
  techInitials: string;
  action: ActionType;
  channel: Channel;
  asset: string | null;
  confidence: number | null;
  syncStatus: SyncStatus;
  syncTarget: string | null;
  summary: string;
  detail: {
    techMessage: string;
    miraReasoning: string;
    miraOutput: string;
    cmmsPayload?: string;
  };
};

const EVENTS: EventRow[] = [
  {
    id: "evt-001", ts: "09:05 AM", tech: "John Smith", techInitials: "JS",
    action: "diagnostic", channel: "telegram", asset: "Air Compressor #1",
    confidence: 84, syncStatus: "pending", syncTarget: "Atlas",
    summary: "Bearing temp 82°C vs 65°C baseline — lubrication recommended",
    detail: {
      techMessage: "AC1 is running hot, making a grinding noise near the motor housing",
      miraReasoning: "High bearing temp (82°C, +26% above baseline). Pattern matches lubrication failure or bearing wear. Cross-referenced with OEM manual MC-AC-001 page 47. FAG-6308-2RS in stock at A-2-3.",
      miraOutput: "Elevated bearing temperature detected. Most likely cause: insufficient lubrication (confidence 84%). Recommend: 1) Lubricate drive-end bearing per OEM spec immediately. 2) Monitor temp for 2h. 3) If temp exceeds 90°C, shut down and replace FAG-6308-2RS.",
      cmmsPayload: '{"type":"diagnostic","asset":"MC-AC-001","priority":"high","notes":"Bearing temp 82C. Lubrication required. Part FAG-6308-2RS on hand."}',
    },
  },
  {
    id: "evt-002", ts: "08:47 AM", tech: "Maria Garcia", techInitials: "MG",
    action: "manual_served", channel: "telegram", asset: "Conveyor Belt #3",
    confidence: null, syncStatus: "none", syncTarget: null,
    summary: 'Served OEM tensioning procedure — page 23 of CB-3 maintenance manual',
    detail: {
      techMessage: "What's the correct belt tension for CB3?",
      miraReasoning: "Query matched document 'CB-3 Conveyor Maintenance Manual'. Retrieved tensioning spec from page 23.",
      miraOutput: "CB-3 belt tension spec: 45-50 N/m at ambient temperature. Measure at center span with tension gauge. Adjust via take-up roller. Re-check after 4h of operation. Reference: CB-3 Manual p.23.",
    },
  },
  {
    id: "evt-003", ts: "08:32 AM", tech: "John Smith", techInitials: "JS",
    action: "wo_created", channel: "telegram", asset: "Conveyor Belt #3",
    confidence: null, syncStatus: "synced", syncTarget: "Atlas",
    summary: "WO-2026-002 created — belt tension out of spec",
    detail: {
      techMessage: "CB3 belt is slipping — I need to log a work order",
      miraReasoning: "Tech requested WO creation. Extracted: asset=Conveyor Belt #3, issue=belt slipping, priority=high based on production impact.",
      miraOutput: "Work order WO-2026-002 created and synced to Atlas CMMS. Priority: High. Assigned to: John Smith. Asset: CB-003.",
      cmmsPayload: '{"wo_number":"WO-2026-002","asset":"MC-CB-003","title":"Belt tension out of spec","priority":"high","assigned_to":"john.smith"}',
    },
  },
  {
    id: "evt-004", ts: "07:15 AM", tech: "MIRA System", techInitials: "AI",
    action: "safety_alert", channel: "voice", asset: "Electrical Panel E-12",
    confidence: 97, syncStatus: "synced", syncTarget: "Atlas",
    summary: "Arc flash hazard — Category 2 PPE required, LOTO in effect",
    detail: {
      techMessage: "(Automated safety scan triggered by asset maintenance schedule)",
      miraReasoning: "Pre-maintenance scan for Electrical Panel E-12. Found open arc flash assessment. NFPA 70E compliance check flagged LOTO procedure required.",
      miraOutput: "SAFETY ALERT: Arc flash hazard at Panel E-12. Category 2 PPE required. LOTO document LOTO-E12-2026 in effect. No work may begin without safety officer authorization.",
      cmmsPayload: '{"type":"safety_alert","asset":"Panel-E12","severity":"critical","loto":"LOTO-E12-2026"}',
    },
  },
  {
    id: "evt-005", ts: "06:58 AM", tech: "Ray Patel", techInitials: "RP",
    action: "lookup", channel: "email", asset: "CNC Mill #7",
    confidence: null, syncStatus: "none", syncTarget: null,
    summary: 'Parts lookup — SKF 7020 spindle bearing availability',
    detail: {
      techMessage: "Do we have the SKF 7020 bearing in stock for the CNC mill?",
      miraReasoning: "Parts inventory lookup. SKF 7020 → matched to P-012 in parts database. Stock: 2 units at location B-1-4.",
      miraOutput: "SKF 7020 bearing: 2 units in stock at location B-1-4. Part number P-012. Last restocked March 12. Unit cost $187. Reserve via CMMS to avoid stock-out.",
    },
  },
  {
    id: "evt-006", ts: "06:02 AM", tech: "MIRA System", techInitials: "AI",
    action: "pm_scheduled", channel: "voice", asset: null,
    confidence: null, syncStatus: "synced", syncTarget: "Atlas",
    summary: "Morning brief delivered — 3 priority items, 2 overdue PMs",
    detail: {
      techMessage: "(Scheduled 6:00 AM voice brief)",
      miraReasoning: "Daily brief generation: pulled open WOs, overdue PMs, active alerts, wrench time metric.",
      miraOutput: "Voice brief delivered at 06:02 AM. 3 high-priority items, 2 overdue PMs, CNC vibration alert at 78% confidence. Wrench time 67%.",
    },
  },
  {
    id: "evt-007", ts: "05:47 AM", tech: "MIRA System", techInitials: "AI",
    action: "diagnostic", channel: "webui", asset: "CNC Mill #7",
    confidence: 78, syncStatus: "pending", syncTarget: "Atlas",
    summary: "Z-axis vibration 3.2× normal — spindle bearing wear (78% confidence)",
    detail: {
      techMessage: "(Anomaly detected via sensor stream)",
      miraReasoning: "Z-axis vibration FFT analysis shows 3.2× deviation from baseline at 127 Hz. Frequency signature matches angular contact bearing wear pattern. Cross-referenced with OEM vibration specs.",
      miraOutput: "Vibration anomaly detected on CNC Mill #7. Probable cause: angular contact bearing wear (SKF 7020, P-012). Confidence: 78%. Recommend inspection within 7 days. Part available in stock.",
      cmmsPayload: '{"type":"predictive_alert","asset":"MC-CN-007","confidence":0.78,"recommended_part":"P-012"}',
    },
  },
  {
    id: "evt-008", ts: "Yesterday 4:12 PM", tech: "Sam Torres", techInitials: "ST",
    action: "greeting", channel: "whatsapp", asset: null,
    confidence: null, syncStatus: "none", syncTarget: null,
    summary: "New tech onboarded via WhatsApp",
    detail: {
      techMessage: "Hey, this is Sam Torres, starting on the maintenance team today",
      miraReasoning: "First-time user greeting. No asset context. Responded with onboarding info.",
      miraOutput: "Welcome Sam! I'm MIRA, your maintenance AI. Send me photos of equipment problems, ask about procedures, or say 'help' to see what I can do.",
    },
  },
];

const CHANNEL_ICONS: Record<Channel, string> = {
  telegram: "✈️", whatsapp: "💬", voice: "🎙️", email: "📧", webui: "🖥️",
};
const CHANNEL_LABELS: Record<Channel, string> = {
  telegram: "Telegram", whatsapp: "WhatsApp", voice: "Voice", email: "Email", webui: "Open WebUI",
};

const ACTION_CFG: Record<ActionType, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  diagnostic:    { label: "Diagnostic",   color: "#EAB308", bg: "#FEF9C3", Icon: Bot },
  wo_created:    { label: "WO Created",   color: "#2563EB", bg: "#EFF6FF", Icon: ClipboardList },
  pm_scheduled:  { label: "PM",           color: "#7C3AED", bg: "#F5F3FF", Icon: Activity },
  manual_served: { label: "Manual",       color: "#0891B2", bg: "#ECFEFF", Icon: BookOpen },
  safety_alert:  { label: "Safety",       color: "#DC2626", bg: "#FEF2F2", Icon: ShieldAlert },
  lookup:        { label: "Lookup",       color: "#16A34A", bg: "#DCFCE7", Icon: Zap },
  greeting:      { label: "Onboard",      color: "#64748B", bg: "#F1F5F9", Icon: MessageSquare },
};

const SYNC_CFG: Record<SyncStatus, { label: string; color: string; bg: string }> = {
  synced:  { label: "Synced",   color: "#16A34A", bg: "#DCFCE7" },
  pending: { label: "Pending",  color: "#EAB308", bg: "#FEF9C3" },
  failed:  { label: "Failed",   color: "#DC2626", bg: "#FEF2F2" },
  none:    { label: "No sync",  color: "#64748B", bg: "#F1F5F9" },
};

const ALL_CHANNELS: Channel[] = ["telegram", "whatsapp", "voice", "email", "webui"];
const ALL_ACTIONS: ActionType[] = ["diagnostic", "wo_created", "pm_scheduled", "manual_served", "safety_alert", "lookup", "greeting"];
const ALL_SYNCS: SyncStatus[] = ["synced", "pending", "failed", "none"];

export default function EventLogPage() {
  const t = useTranslations("eventLog");
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [filterChannel, setFilterChannel] = useState<Channel | "all">("all");
  const [filterAction, setFilterAction] = useState<ActionType | "all">("all");
  const [filterSync, setFilterSync] = useState<SyncStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const filtered = EVENTS.filter(e =>
    (filterChannel === "all" || e.channel === filterChannel) &&
    (filterAction === "all" || e.action === filterAction) &&
    (filterSync === "all" || e.syncStatus === filterSync)
  );

  function handleRefresh() {
    setRefreshing(true);
    setTimeout(() => setRefreshing(false), 700);
  }

  return (
    <div className="relative min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>
                {t("title")}
              </h1>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                style={{ backgroundColor: "#DCFCE7", color: "#16A34A" }}>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                {t("live")}
              </span>
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {filtered.length} {t("events")} · {t("allChannels")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => setShowFilters(v => !v)}>
              <Filter className="w-4 h-4" style={{ color: showFilters ? "var(--brand-blue)" : "var(--foreground-muted)" }} />
            </Button>
            <Button variant="ghost" size="icon" onClick={handleRefresh}>
              <RefreshCw className={`w-4 h-4 ${refreshing ? "animate-spin" : ""}`} style={{ color: "var(--foreground-muted)" }} />
            </Button>
          </div>
        </div>

        {/* Filter bar */}
        {showFilters && (
          <div className="px-4 md:px-6 pb-3 space-y-2">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 self-center" style={{ color: "var(--foreground-subtle)" }}>Channel</span>
              {(["all", ...ALL_CHANNELS] as const).map(ch => (
                <button key={ch} onClick={() => setFilterChannel(ch)}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={filterChannel === ch
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {ch === "all" ? "All" : `${CHANNEL_ICONS[ch]} ${CHANNEL_LABELS[ch]}`}
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 self-center" style={{ color: "var(--foreground-subtle)" }}>Action</span>
              {(["all", ...ALL_ACTIONS] as const).map(a => (
                <button key={a} onClick={() => setFilterAction(a)}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={filterAction === a
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {a === "all" ? "All" : ACTION_CFG[a].label}
                </button>
              ))}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-[10px] font-semibold uppercase tracking-wide flex-shrink-0 self-center" style={{ color: "var(--foreground-subtle)" }}>Sync</span>
              {(["all", ...ALL_SYNCS] as const).map(s => (
                <button key={s} onClick={() => setFilterSync(s)}
                  className="flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-all"
                  style={filterSync === s
                    ? { backgroundColor: "var(--brand-blue)", color: "white" }
                    : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                  {s === "all" ? "All" : SYNC_CFG[s].label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="px-4 md:px-6 py-4 pb-24 max-w-5xl mx-auto">
        {/* Desktop table header */}
        <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 px-3 pb-2 text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: "var(--foreground-subtle)" }}>
          <span>{t("colTime")}</span>
          <span>{t("colEvent")}</span>
          <span>{t("colChannel")}</span>
          <span>{t("colAction")}</span>
          <span>{t("colConf")}</span>
          <span>{t("colSync")}</span>
        </div>

        <div className="space-y-1">
          {filtered.map((evt) => {
            const cfg = ACTION_CFG[evt.action];
            const sync = SYNC_CFG[evt.syncStatus];
            const Icon = cfg.Icon;

            return (
              <button key={evt.id}
                onClick={() => setSelectedEvent(evt)}
                className="w-full text-left card px-3 py-3 hover:bg-[var(--surface-1)] transition-colors group"
                style={{ borderLeft: evt.action === "safety_alert" ? "3px solid #DC2626" : undefined }}>

                {/* Mobile layout */}
                <div className="md:hidden flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: cfg.bg }}>
                    <Icon className="w-4 h-4" style={{ color: cfg.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                      <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                        {CHANNEL_ICONS[evt.channel]} {evt.ts}
                      </span>
                      {evt.confidence && (
                        <span className="text-[11px] font-medium" style={{ color: "var(--foreground-subtle)" }}>
                          {evt.confidence}% conf
                        </span>
                      )}
                      <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: sync.bg, color: sync.color }}>{sync.label}</span>
                    </div>
                    <p className="text-sm font-medium mt-1 leading-snug" style={{ color: "var(--foreground)" }}>
                      {evt.summary}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                        style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                        {evt.techInitials}
                      </div>
                      <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{evt.tech}</span>
                      {evt.asset && (
                        <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>· {evt.asset}</span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ color: "var(--foreground-subtle)" }} />
                </div>

                {/* Desktop layout */}
                <div className="hidden md:grid grid-cols-[auto_1fr_auto_auto_auto_auto] gap-x-4 items-center">
                  <div className="flex items-center gap-1 text-[11px] w-20 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }}>
                    <Clock className="w-3 h-3 flex-shrink-0" />
                    {evt.ts}
                  </div>

                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold flex-shrink-0"
                      style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                      {evt.techInitials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: "var(--foreground)" }}>{evt.summary}</p>
                      <p className="text-[11px] truncate" style={{ color: "var(--foreground-subtle)" }}>
                        {evt.tech}{evt.asset ? ` · ${evt.asset}` : ""}
                      </p>
                    </div>
                  </div>

                  <span className="text-sm flex-shrink-0" title={CHANNEL_LABELS[evt.channel]}>
                    {CHANNEL_ICONS[evt.channel]}
                  </span>

                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cfg.bg, color: cfg.color }}>{cfg.label}</span>

                  <span className="text-[11px] font-medium w-12 text-right flex-shrink-0"
                    style={{ color: "var(--foreground-subtle)" }}>
                    {evt.confidence ? `${evt.confidence}%` : "—"}
                  </span>

                  <span className="text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: sync.bg, color: sync.color }}>
                    {evt.syncTarget ? `${sync.label} → ${evt.syncTarget}` : sync.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <Activity className="w-10 h-10 mx-auto mb-3" style={{ color: "var(--foreground-subtle)" }} />
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{t("noEvents")}</p>
          </div>
        )}
      </div>

      {/* Event Detail Drawer */}
      {selectedEvent && (
        <EventDetailDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}

function EventDetailDrawer({ event, onClose }: { event: EventRow; onClose: () => void }) {
  const t = useTranslations("eventLog");
  const cfg = ACTION_CFG[event.action];
  const sync = SYNC_CFG[event.syncStatus];
  const Icon = cfg.Icon;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-md flex flex-col shadow-2xl"
        style={{ backgroundColor: "var(--surface-0)", borderLeft: "1px solid var(--border)" }}>

        {/* Drawer header */}
        <div className="flex items-center justify-between px-4 py-4 border-b" style={{ borderColor: "var(--border)" }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: cfg.bg }}>
              <Icon className="w-4 h-4" style={{ color: cfg.color }} />
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("eventDetail")}</p>
              <p className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                {event.ts} · {CHANNEL_LABELS[event.channel]}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--surface-1)]">
            <X className="w-4 h-4" style={{ color: "var(--foreground-muted)" }} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {/* Meta row */}
          <div className="flex flex-wrap gap-2">
            <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: cfg.bg, color: cfg.color }}>
              {cfg.label}
            </span>
            <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: sync.bg, color: sync.color }}>
              {event.syncTarget ? `${sync.label} → ${event.syncTarget}` : sync.label}
            </span>
            {event.confidence && (
              <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                {event.confidence}% confidence
              </span>
            )}
            {event.asset && (
              <span className="text-xs font-medium px-2 py-1 rounded-full" style={{ backgroundColor: "var(--surface-1)", color: "var(--brand-blue)" }}>
                {event.asset}
              </span>
            )}
          </div>

          {/* Tech message */}
          <DrawerSection icon="💬" title={t("techMessage")} color="#2563EB">
            <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
              "{event.detail.techMessage}"
            </p>
            <p className="text-xs mt-1" style={{ color: "var(--foreground-subtle)" }}>
              — {event.tech} via {CHANNEL_LABELS[event.channel]}
            </p>
          </DrawerSection>

          {/* MIRA reasoning */}
          <DrawerSection icon="🧠" title={t("miraReasoning")} color="#7C3AED">
            <p className="text-xs leading-relaxed font-mono" style={{ color: "var(--foreground-muted)" }}>
              {event.detail.miraReasoning}
            </p>
          </DrawerSection>

          {/* MIRA output */}
          <DrawerSection icon="⚡" title={t("miraOutput")} color="#16A34A">
            <p className="text-sm leading-relaxed" style={{ color: "var(--foreground)" }}>
              {event.detail.miraOutput}
            </p>
          </DrawerSection>

          {/* CMMS payload */}
          {event.detail.cmmsPayload && (
            <DrawerSection icon="🔗" title={t("cmmsPayload")} color="#0891B2">
              <pre className="text-[11px] leading-relaxed overflow-x-auto p-2 rounded-lg"
                style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                {JSON.stringify(JSON.parse(event.detail.cmmsPayload), null, 2)}
              </pre>
              <div className="flex items-center gap-1.5 mt-2">
                <CheckCircle2 className="w-3.5 h-3.5" style={{ color: sync.color }} />
                <span className="text-[11px]" style={{ color: sync.color }}>
                  {sync.label}{event.syncTarget ? ` to ${event.syncTarget}` : ""} · {event.ts}
                </span>
              </div>
            </DrawerSection>
          )}
        </div>
      </div>
    </>
  );
}

function DrawerSection({ icon, title, color, children }: {
  icon: string; title: string; color: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl p-3 space-y-2" style={{ backgroundColor: "var(--surface-1)" }}>
      <div className="flex items-center gap-2">
        <span className="text-sm">{icon}</span>
        <p className="text-xs font-semibold uppercase tracking-wide" style={{ color }}>{title}</p>
      </div>
      {children}
    </div>
  );
}

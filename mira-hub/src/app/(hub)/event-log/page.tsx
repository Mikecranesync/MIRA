"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Activity, MessageSquare, Bot, ShieldAlert, Zap,
  BookOpen, ClipboardList, CheckCircle2,
  ChevronRight, X, Clock, Filter, RefreshCw,
} from "lucide-react";
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
    faultCodes?: string[];
    symptoms?: string[];
    safetyWarnings?: string[];
    suggestedActions?: string[];
    woNumber?: string;
    priority?: string;
    status?: string;
    location?: string;
  };
};

function channelKey(platform: string): Channel {
  const p = (platform ?? "").toLowerCase();
  if (p === "telegram") return "telegram";
  if (p === "whatsapp") return "whatsapp";
  if (p === "voice") return "voice";
  if (p === "email") return "email";
  if (p === "webui" || p === "open_webui") return "webui";
  return "telegram";
}

function initials(name: string): string {
  if (!name) return "??";
  return name.split(/[\s@_]/).filter(Boolean).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function formatTs(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffH = (now.getTime() - d.getTime()) / 3600000;
  if (diffH < 24) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (diffH < 48) return `Yesterday ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiRowToEvent(r: any): EventRow {
  const actionType = (r.actionType ?? "lookup") as ActionType;
  const ch = channelKey(r.channel);
  const hasSafety = r.safetyWarnings?.length > 0;
  const cmmsPayload = r.woNumber ? JSON.stringify({
    wo_number: r.woNumber,
    asset: r.asset,
    priority: r.priority,
    status: r.status,
  }) : undefined;

  return {
    id: r.id,
    ts: formatTs(r.time),
    tech: r.tech ?? "Unknown",
    techInitials: initials(r.tech ?? ""),
    action: actionType,
    channel: ch,
    asset: r.asset || null,
    confidence: r.confidence ? Math.round(Number(r.confidence) * 100) : null,
    syncStatus: hasSafety ? "synced" : (r.syncStatus as SyncStatus) ?? "none",
    syncTarget: r.woNumber ? "Atlas" : null,
    summary: r.title
      ? r.title.length > 90 ? r.title.slice(0, 90) + "…" : r.title
      : "Work order",
    detail: {
      techMessage: r.description || r.title || "(no message recorded)",
      miraReasoning: [
        r.faultCodes?.length ? `Fault codes: ${r.faultCodes.join(", ")}` : "",
        r.symptoms?.length ? `Symptoms: ${r.symptoms.join(", ")}` : "",
        r.confidence ? `Confidence score: ${Math.round(Number(r.confidence) * 100)}%` : "",
      ].filter(Boolean).join(" · ") || "Logged via MIRA",
      miraOutput: r.suggestedActions?.length
        ? r.suggestedActions.join("\n")
        : (r.miraResponse || "(no MIRA response recorded)"),
      cmmsPayload,
      faultCodes: r.faultCodes,
      symptoms: r.symptoms,
      safetyWarnings: r.safetyWarnings,
      suggestedActions: r.suggestedActions,
      woNumber: r.woNumber,
      priority: r.priority,
      status: r.status,
      location: r.location,
    },
  };
}

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
  const [events, setEvents] = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);
  const [filterChannel, setFilterChannel] = useState<Channel | "all">("all");
  const [filterAction, setFilterAction] = useState<ActionType | "all">("all");
  const [filterSync, setFilterSync] = useState<SyncStatus | "all">("all");
  const [showFilters, setShowFilters] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const res = await fetch("/hub/api/events");
      if (res.ok) {
        const data = await res.json();
        setEvents(Array.isArray(data) ? data.map(apiRowToEvent) : []);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const filtered = events.filter(e =>
    (filterChannel === "all" || e.channel === filterChannel) &&
    (filterAction === "all" || e.action === filterAction) &&
    (filterSync === "all" || e.syncStatus === filterSync)
  );

  async function handleRefresh() {
    setRefreshing(true);
    await loadEvents();
    setRefreshing(false);
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
              {loading ? "Loading…" : `${filtered.length} ${t("events")}`} · {t("allChannels")}
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

          {/* Safety warnings */}
          {event.detail.safetyWarnings && event.detail.safetyWarnings.length > 0 && (
            <DrawerSection icon="⚠️" title="Safety Warnings" color="#DC2626">
              <ul className="space-y-1">
                {event.detail.safetyWarnings.map((w, i) => (
                  <li key={i} className="text-xs leading-snug" style={{ color: "var(--foreground)" }}>• {w}</li>
                ))}
              </ul>
            </DrawerSection>
          )}

          {/* Fault codes */}
          {event.detail.faultCodes && event.detail.faultCodes.length > 0 && (
            <DrawerSection icon="🔍" title="Fault Codes" color="#EAB308">
              <div className="flex flex-wrap gap-1.5">
                {event.detail.faultCodes.map((fc, i) => (
                  <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded"
                    style={{ backgroundColor: "#FEF9C3", color: "#92400E" }}>{fc}</span>
                ))}
              </div>
            </DrawerSection>
          )}

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

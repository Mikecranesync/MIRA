"use client";

import { useState } from "react";
import { Plus, Settings, ExternalLink, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type HealthStatus = "healthy" | "degraded" | "offline";

type ChannelCard = {
  id: string;
  name: string;
  handle?: string;
  emoji: string;
  description: string;
  techCount: number;
  messagesToday: number;
  messagesWeek: number;
  health: HealthStatus;
  lastEvent: string;
  configured: boolean;
  trend: "up" | "down" | "flat";
  details: string;
};

const CHANNELS: ChannelCard[] = [
  {
    id: "telegram",
    name: "Telegram",
    handle: "@FactoryLMDiagnose_bot",
    emoji: "✈️",
    description: "Primary channel for field techs. Photo uploads, voice notes, and real-time diagnostic conversations.",
    techCount: 23,
    messagesToday: 147,
    messagesWeek: 892,
    health: "healthy",
    lastEvent: "2 min ago",
    configured: true,
    trend: "up",
    details: "Running on polling (no public webhook required). Bot token managed via Doppler.",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    emoji: "💬",
    description: "Secondary channel for techs who prefer WhatsApp. Same MIRA capabilities as Telegram.",
    techCount: 3,
    messagesToday: 18,
    messagesWeek: 74,
    health: "healthy",
    lastEvent: "14 min ago",
    configured: true,
    trend: "flat",
    details: "Connected via Meta Business API. Rate limited to 1,000 messages/day on current plan.",
  },
  {
    id: "voice",
    name: "Voice Brief",
    emoji: "🎙️",
    description: "Scheduled morning briefings. MIRA summarizes shift priorities and reads them aloud at 6:00 AM.",
    techCount: 8,
    messagesToday: 1,
    messagesWeek: 5,
    health: "healthy",
    lastEvent: "Today 6:02 AM",
    configured: true,
    trend: "flat",
    details: "Delivered via Text-to-Speech. Cron: 0 6 * * Mon-Fri. Delivered to shift leads only.",
  },
  {
    id: "email",
    name: "Email",
    emoji: "📧",
    description: "Inbound maintenance requests and outbound work order summaries. Managers and plant directors.",
    techCount: 5,
    messagesToday: 4,
    messagesWeek: 31,
    health: "healthy",
    lastEvent: "47 min ago",
    configured: true,
    trend: "down",
    details: "SMTP: smtp.factorylm.com. Inbound parsing via mailhook. Outbound WO summaries auto-sent on close.",
  },
  {
    id: "webui",
    name: "Open WebUI",
    emoji: "🖥️",
    description: "Browser-based chat for desktop users. Full conversation history, file uploads, and MIRA's tool calls visible.",
    techCount: 2,
    messagesToday: 12,
    messagesWeek: 58,
    health: "healthy",
    lastEvent: "3 min ago",
    configured: true,
    trend: "up",
    details: "Running at mira-core:3000. Served behind Nginx at /chat. Session auth tied to Hub JWT.",
  },
  {
    id: "slack",
    name: "Slack",
    emoji: "💼",
    description: "Connect MIRA to your Slack workspace for team-wide notifications and maintenance requests.",
    techCount: 0,
    messagesToday: 0,
    messagesWeek: 0,
    health: "offline",
    lastEvent: "Not configured",
    configured: false,
    trend: "flat",
    details: "Not yet connected. Requires Slack app installation and OAuth token.",
  },
  {
    id: "ms-teams",
    name: "Microsoft Teams",
    emoji: "🔷",
    description: "Enterprise-grade integration for organizations running on Microsoft 365.",
    techCount: 0,
    messagesToday: 0,
    messagesWeek: 0,
    health: "offline",
    lastEvent: "Not configured",
    configured: false,
    trend: "flat",
    details: "Not yet connected. Requires Azure Bot Framework registration.",
  },
];

const HEALTH_CFG: Record<HealthStatus, { label: string; color: string; bg: string; dot: string }> = {
  healthy:  { label: "Healthy",  color: "#16A34A", bg: "#DCFCE7", dot: "#22C55E" },
  degraded: { label: "Degraded", color: "#EAB308", bg: "#FEF9C3", dot: "#EAB308" },
  offline:  { label: "Offline",  color: "#64748B", bg: "#F1F5F9", dot: "#94A3B8" },
};

export default function ChannelsPage() {
  const t = useTranslations("channels");
  const [expanded, setExpanded] = useState<string | null>(null);

  const configured = CHANNELS.filter(c => c.configured);
  const available = CHANNELS.filter(c => !c.configured);

  const totalTechs = configured.reduce((s, c) => s + c.techCount, 0);
  const totalToday = configured.reduce((s, c) => s + c.messagesToday, 0);

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {configured.length} {t("active")} · {totalTechs} {t("techs")} · {totalToday} {t("messagesToday")}
            </p>
          </div>
          <Button size="sm" className="gap-1.5 text-xs h-8 px-3"
            style={{ backgroundColor: "var(--brand-blue)", color: "white" }}>
            <Plus className="w-3.5 h-3.5" />
            {t("addChannel")}
          </Button>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-6">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("kpi.activeChannels"), value: configured.length.toString(), sub: t("kpi.of7"), color: "#2563EB" },
            { label: t("kpi.techsConnected"), value: totalTechs.toString(), sub: t("kpi.acrossAll"), color: "#16A34A" },
            { label: t("kpi.eventsToday"),    value: totalToday.toString(), sub: t("kpi.allChannels"), color: "#7C3AED" },
          ].map(kpi => (
            <div key={kpi.label} className="card p-3">
              <div className="text-xl font-bold" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="text-[11px] font-medium leading-tight mt-0.5" style={{ color: "var(--foreground)" }}>{kpi.label}</div>
              <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{kpi.sub}</div>
            </div>
          ))}
        </div>

        {/* Active channels */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>
            {t("activeChannels")}
          </h2>
          <div className="space-y-2">
            {configured.map(ch => (
              <ChannelRow key={ch.id} channel={ch} expanded={expanded === ch.id}
                onToggle={() => setExpanded(expanded === ch.id ? null : ch.id)} />
            ))}
          </div>
        </section>

        {/* Available channels */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>
            {t("availableChannels")}
          </h2>
          <div className="space-y-2">
            {available.map(ch => (
              <ChannelRow key={ch.id} channel={ch} expanded={expanded === ch.id}
                onToggle={() => setExpanded(expanded === ch.id ? null : ch.id)} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function ChannelRow({ channel: ch, expanded, onToggle }: {
  channel: ChannelCard;
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("channels");
  const h = HEALTH_CFG[ch.health];

  return (
    <div className="card overflow-hidden">
      <button onClick={onToggle} className="w-full text-left p-4 hover:bg-[var(--surface-1)] transition-colors">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg flex-shrink-0"
            style={{ backgroundColor: "var(--surface-1)" }}>
            {ch.emoji}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{ch.name}</span>
              {ch.handle && (
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{ch.handle}</span>
              )}
              {/* Health dot */}
              <span className="flex items-center gap-1 text-[11px] font-medium"
                style={{ color: h.color }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: h.dot }} />
                {h.label}
              </span>
            </div>
            <p className="text-xs mt-0.5 leading-snug line-clamp-1" style={{ color: "var(--foreground-muted)" }}>
              {ch.description}
            </p>
          </div>

          {/* Stats (configured only) */}
          {ch.configured && (
            <div className="hidden sm:flex items-center gap-4 flex-shrink-0 text-right">
              <div>
                <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{ch.techCount}</div>
                <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{t("techs")}</div>
              </div>
              <div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{ch.messagesToday}</span>
                  {ch.trend === "up" && <TrendingUp className="w-3 h-3" style={{ color: "#16A34A" }} />}
                  {ch.trend === "down" && <TrendingDown className="w-3 h-3" style={{ color: "#DC2626" }} />}
                  {ch.trend === "flat" && <Minus className="w-3 h-3" style={{ color: "#64748B" }} />}
                </div>
                <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{t("today")}</div>
              </div>
            </div>
          )}

          {/* Connect button for unconfigured */}
          {!ch.configured && (
            <Button size="sm" variant="secondary" className="text-xs h-7 px-2.5 flex-shrink-0">
              {t("connect")}
            </Button>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="px-4 pb-4 pt-0 border-t" style={{ borderColor: "var(--border)" }}>
          <div className="pt-3 space-y-3">
            <p className="text-xs leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
              {ch.details}
            </p>

            {ch.configured && (
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: t("stats.today"),     value: ch.messagesToday.toString() },
                  { label: t("stats.week"),       value: ch.messagesWeek.toString() },
                  { label: t("stats.lastEvent"),  value: ch.lastEvent },
                ].map(s => (
                  <div key={s.label} className="p-2 rounded-lg" style={{ backgroundColor: "var(--surface-1)" }}>
                    <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{s.value}</div>
                    <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2">
              {ch.configured ? (
                <>
                  <Button size="sm" variant="secondary" className="text-xs h-7 gap-1 px-2.5">
                    <Settings className="w-3 h-3" />
                    {t("configure")}
                  </Button>
                  <Button size="sm" variant="secondary" className="text-xs h-7 gap-1 px-2.5">
                    <ExternalLink className="w-3 h-3" />
                    {t("viewLogs")}
                  </Button>
                </>
              ) : (
                <Button size="sm" className="text-xs h-7 px-3"
                  style={{ backgroundColor: "var(--brand-blue)", color: "white" }}>
                  {t("connectChannel")}
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

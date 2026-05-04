"use client";

import { useState } from "react";
import { Database, Plug, Webhook, Key, ExternalLink, CheckCircle2, Clock, ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

type Tab = "cmms" | "webhooks" | "api";

type CmmsSystem = {
  id: string;
  name: string;
  emoji: string;
  description: string;
  connected: boolean;
  viaMcp: boolean;
  syncStats?: { assets: number; workorders: number; lastSync: string };
};

type WebhookTarget = {
  id: string;
  name: string;
  url: string;
  events: string[];
  healthy: boolean;
  lastCall: string;
};

const CMMS_SYSTEMS: CmmsSystem[] = [
  {
    id: "atlas", name: "Atlas CMMS", emoji: "🗺️",
    description: "Your connected CMMS. MIRA writes WOs, syncs diagnostics, and reads asset data from Atlas.",
    connected: true, viaMcp: false,
    syncStats: { assets: 47, workorders: 312, lastSync: "2 min ago" },
  },
  {
    id: "limble", name: "Limble CMMS", emoji: "🔩",
    description: "Cloud-native CMMS popular with mid-market facilities. Available via MIRA MCP connector.",
    connected: false, viaMcp: true,
  },
  {
    id: "maintainx", name: "MaintainX", emoji: "🔧",
    description: "Mobile-first CMMS with strong technician UX. Available via MIRA MCP connector.",
    connected: false, viaMcp: true,
  },
  {
    id: "upkeep", name: "UpKeep", emoji: "⬆️",
    description: "Asset operations platform with strong IoT integrations. Available via MIRA MCP connector.",
    connected: false, viaMcp: true,
  },
  {
    id: "fiix", name: "Fiix",  emoji: "🔨",
    description: "Rockwell Automation's CMMS. Available via MIRA MCP connector.",
    connected: false, viaMcp: true,
  },
];

const WEBHOOKS: WebhookTarget[] = [
  { id: "w1", name: "Slack — #maintenance-alerts", url: "https://hooks.slack.com/services/T0…", events: ["safety_alert", "wo_created", "pm_overdue"], healthy: true,  lastCall: "7:15 AM" },
  { id: "w2", name: "Microsoft Teams",             url: "https://outlook.office.com/webhook/…", events: ["diagnostic"],                               healthy: true,  lastCall: "9:05 AM" },
  { id: "w3", name: "Email — ops@factorylm.com",   url: "smtp://…",                              events: ["safety_alert", "wo_created"],              healthy: true,  lastCall: "8:32 AM" },
];

export default function IntegrationsPage() {
  const t = useTranslations("integrations");
  const [tab, setTab] = useState<Tab>("cmms");

  const TABS: { key: Tab; label: string; Icon: React.ElementType }[] = [
    { key: "cmms",     label: t("tabCmms"),     Icon: Database },
    { key: "webhooks", label: t("tabWebhooks"), Icon: Webhook },
    { key: "api",      label: t("tabApi"),      Icon: Key },
  ];

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            {t("subtitle")}
          </p>
        </div>
        {/* Tab bar */}
        <div className="flex px-4 md:px-6 gap-4 border-t" style={{ borderColor: "var(--border)" }}>
          {TABS.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className="flex items-center gap-1.5 py-3 text-sm font-medium border-b-2 transition-colors"
              style={{
                borderColor: tab === tb.key ? "var(--brand-blue)" : "transparent",
                color: tab === tb.key ? "var(--brand-blue)" : "var(--foreground-muted)",
              }}>
              <tb.Icon className="w-4 h-4" />
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto">
        {tab === "cmms" && <CmmsTab t={t} />}
        {tab === "webhooks" && <WebhooksTab t={t} />}
        {tab === "api" && <ApiTab t={t} />}
      </div>
    </div>
  );
}

function CmmsTab({ t }: { t: ReturnType<typeof useTranslations> }) {
  const connected = CMMS_SYSTEMS.filter(c => c.connected);
  const available = CMMS_SYSTEMS.filter(c => !c.connected);

  return (
    <div className="space-y-6">
      {/* Connected */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>
          {t("connected")}
        </h2>
        {connected.map(sys => (
          <div key={sys.id} className="card p-4 mb-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ backgroundColor: "var(--surface-1)" }}>
                {sys.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{sys.name}</span>
                  <span className="flex items-center gap-1 text-[11px] font-medium" style={{ color: "#16A34A" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                    {t("connected")}
                  </span>
                </div>
                <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{sys.description}</p>
              </div>
            </div>

            {sys.syncStats && (
              <div className="grid grid-cols-3 gap-3 mt-3">
                {[
                  { label: t("assets"),     value: sys.syncStats.assets.toString() },
                  { label: t("workOrders"), value: sys.syncStats.workorders.toString() },
                  { label: t("lastSync"),   value: sys.syncStats.lastSync },
                ].map(s => (
                  <div key={s.label} className="p-2 rounded-lg" style={{ backgroundColor: "var(--surface-1)" }}>
                    <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{s.value}</div>
                    <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-2 mt-3">
              <Button size="sm" variant="secondary" className="text-xs h-7 gap-1">
                <ExternalLink className="w-3 h-3" />
                {t("openCmms")}
              </Button>
              <Button size="sm" variant="secondary" className="text-xs h-7">
                {t("configure")}
              </Button>
            </div>
          </div>
        ))}
      </section>

      {/* Available */}
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "var(--foreground-subtle)" }}>
          {t("available")}
        </h2>
        <div className="space-y-2">
          {available.map(sys => (
            <div key={sys.id} className="card p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl flex-shrink-0"
                style={{ backgroundColor: "var(--surface-1)" }}>
                {sys.emoji}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{sys.name}</span>
                  {sys.viaMcp && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                      style={{ backgroundColor: "#EFF6FF", color: "#2563EB" }}>
                      {t("viaMcp")}
                    </span>
                  )}
                </div>
                <p className="text-xs mt-0.5 line-clamp-1" style={{ color: "var(--foreground-muted)" }}>{sys.description}</p>
              </div>
              <Button size="sm" className="text-xs h-7 px-3 flex-shrink-0"
                style={{ backgroundColor: "var(--brand-blue)", color: "white" }}>
                {t("connect")}
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function WebhooksTab({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{t("webhooksDesc")}</p>
        <Button size="sm" className="text-xs h-7 gap-1" style={{ backgroundColor: "var(--brand-blue)", color: "white" }}>
          <Plug className="w-3 h-3" />
          {t("addWebhook")}
        </Button>
      </div>

      {WEBHOOKS.map(wh => (
        <div key={wh.id} className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{wh.name}</p>
                <span className="flex items-center gap-1 text-[11px] font-medium"
                  style={{ color: wh.healthy ? "#16A34A" : "#DC2626" }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: wh.healthy ? "#22C55E" : "#DC2626" }} />
                  {wh.healthy ? t("healthy") : t("unhealthy")}
                </span>
              </div>
              <p className="text-[11px] mt-1 truncate font-mono" style={{ color: "var(--foreground-subtle)" }}>{wh.url}</p>
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {wh.events.map(e => (
                  <span key={e} className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                    {e}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 text-[11px] flex-shrink-0" style={{ color: "var(--foreground-subtle)" }}>
              <Clock className="w-3 h-3" />
              {wh.lastCall}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ApiTab({ t }: { t: ReturnType<typeof useTranslations> }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="space-y-6">
      <div className="card p-4 space-y-4">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("apiKey")}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{t("apiKeyDesc")}</p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1 p-2.5 rounded-lg font-mono text-xs overflow-hidden"
            style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground)" }}>
            {revealed ? "mlm_sk_prod_a7f3c9d1e2b4g8h5..." : "mlm_sk_prod_••••••••••••••••••••"}
          </div>
          <Button size="sm" variant="secondary" className="text-xs h-8 flex-shrink-0"
            onClick={() => setRevealed(v => !v)}>
            {revealed ? t("hide") : t("reveal")}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[
            { label: t("actionsThisMonth"), value: "847" },
            { label: t("tier"),             value: "Pro" },
            { label: t("rateLimitRpm"),     value: "60" },
          ].map(s => (
            <div key={s.label} className="p-2 rounded-lg" style={{ backgroundColor: "var(--surface-1)" }}>
              <div className="text-sm font-bold" style={{ color: "var(--foreground)" }}>{s.value}</div>
              <div className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-4 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("apiDocs")}</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{t("apiDocsDesc")}</p>
        </div>
        <Button size="sm" variant="secondary" className="gap-1 text-xs h-7 flex-shrink-0">
          <ExternalLink className="w-3 h-3" />
          {t("openDocs")}
        </Button>
      </div>

      <div className="card p-4 space-y-3">
        <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("recentEvents")}</p>
        {[
          { ts: "9:05 AM",  method: "POST", path: "/v1/events",    status: 200 },
          { ts: "8:47 AM",  method: "GET",  path: "/v1/assets/1",  status: 200 },
          { ts: "8:32 AM",  method: "POST", path: "/v1/workorders", status: 201 },
          { ts: "7:15 AM",  method: "POST", path: "/v1/alerts",    status: 200 },
        ].map((ev, i) => (
          <div key={i} className="flex items-center gap-3 text-xs" style={{ color: "var(--foreground-muted)" }}>
            <span className="w-16 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }}>{ev.ts}</span>
            <span className="font-semibold w-10 flex-shrink-0" style={{ color: ev.method === "GET" ? "#0891B2" : "#2563EB" }}>
              {ev.method}
            </span>
            <span className="font-mono flex-1 min-w-0 truncate">{ev.path}</span>
            <span className="flex-shrink-0" style={{ color: ev.status < 300 ? "#16A34A" : "#DC2626" }}>
              {ev.status}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

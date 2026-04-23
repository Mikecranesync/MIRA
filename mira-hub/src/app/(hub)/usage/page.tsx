"use client";

import { BarChart2, Zap, MessageSquare, Users, TrendingUp, Calendar } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const DAILY_ACTIONS = [
  { day: "Mon", actions: 142 },
  { day: "Tue", actions: 168 },
  { day: "Wed", actions: 134 },
  { day: "Thu", actions: 201 },
  { day: "Fri", actions: 187 },
  { day: "Sat", actions: 89 },
  { day: "Sun", actions: 47 },
];

const BY_TYPE = [
  { name: "Diagnostics",     value: 187, color: "#EAB308" },
  { name: "WOs Created",     value: 134, color: "#2563EB" },
  { name: "Manual Lookups",  value: 312, color: "#0891B2" },
  { name: "PM Actions",      value: 68,  color: "#7C3AED" },
  { name: "Safety Alerts",   value: 23,  color: "#DC2626" },
  { name: "Greetings",       value: 123, color: "#64748B" },
];

const BY_CHANNEL = [
  { name: "Telegram", value: 612, color: "#2563EB" },
  { name: "WhatsApp", value: 74,  color: "#16A34A" },
  { name: "Open WebUI", value: 89, color: "#7C3AED" },
  { name: "Email",    value: 47,  color: "#EA580C" },
  { name: "Voice",    value: 25,  color: "#0891B2" },
];

const BY_TECH = [
  { tech: "John Smith",    initials: "JS", actions: 287, channel: "Telegram" },
  { tech: "Maria Garcia",  initials: "MG", actions: 214, channel: "Telegram" },
  { tech: "Ray Patel",     initials: "RP", actions: 178, channel: "Email" },
  { tech: "Sam Torres",    initials: "ST", actions: 89,  channel: "WhatsApp" },
  { tech: "Mike Harper",   initials: "MH", actions: 47,  channel: "Open WebUI" },
  { tech: "MIRA System",   initials: "AI", actions: 32,  channel: "Voice" },
];

const PRO_TIER_LIMIT = 3600;
const USED_THIS_MONTH = 847;
const PCT = Math.round((USED_THIS_MONTH / PRO_TIER_LIMIT) * 100);

export default function UsagePage() {
  const t = useTranslations("usage");

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 py-3">
          <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
          <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
            {t("billingPeriod")} · April 2026
          </p>
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-6">

        {/* Usage meter */}
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("meterTitle")}</p>
              <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                {USED_THIS_MONTH.toLocaleString()} / {PRO_TIER_LIMIT.toLocaleString()} {t("actions")} · Pro {t("tier")}
              </p>
            </div>
            <span className="text-2xl font-bold" style={{ color: "var(--brand-blue)" }}>{PCT}%</span>
          </div>

          {/* Progress bar */}
          <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-1)" }}>
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${PCT}%`,
                background: PCT > 80 ? "#DC2626" : PCT > 60 ? "#EAB308" : "linear-gradient(90deg,#2563EB,#0891B2)",
              }} />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--foreground-subtle)" }}>
            {(PRO_TIER_LIMIT - USED_THIS_MONTH).toLocaleString()} {t("remaining")} · {t("resetsIn")} 8 {t("days")}
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t("kpi.totalActions"),   value: "847",  Icon: Zap,          color: "#2563EB" },
            { label: t("kpi.conversations"),  value: "23",   Icon: MessageSquare, color: "#7C3AED" },
            { label: t("kpi.activeTechs"),    value: "6",    Icon: Users,         color: "#16A34A" },
            { label: t("kpi.avgPerDay"),      value: "121",  Icon: TrendingUp,    color: "#0891B2" },
          ].map(kpi => (
            <div key={kpi.label} className="card p-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: `${kpi.color}15` }}>
                <kpi.Icon className="w-3.5 h-3.5" style={{ color: kpi.color }} />
              </div>
              <div className="text-xl font-bold" style={{ color: "var(--foreground)" }}>{kpi.value}</div>
              <div className="text-[11px] leading-tight mt-0.5" style={{ color: "var(--foreground-muted)" }}>{kpi.label}</div>
            </div>
          ))}
        </div>

        {/* Daily actions chart */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-4 h-4" style={{ color: "var(--brand-blue)" }} />
            <p className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{t("dailyActions")}</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={DAILY_ACTIONS} barSize={24}>
              <XAxis dataKey="day" tick={{ fontSize: 11, fill: "var(--foreground-subtle)" }} axisLine={false} tickLine={false} />
              <YAxis hide />
              <Tooltip
                contentStyle={{ backgroundColor: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "var(--foreground)" }}
                itemStyle={{ color: "var(--brand-blue)" }}
              />
              <Bar dataKey="actions" fill="var(--brand-blue)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* By type + by channel */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="card p-4">
            <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>{t("byType")}</p>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={BY_TYPE} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {BY_TYPE.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {BY_TYPE.map(item => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-xs flex-1" style={{ color: "var(--foreground-muted)" }}>{item.name}</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-4">
            <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>{t("byChannel")}</p>
            <ResponsiveContainer width="100%" height={140}>
              <PieChart>
                <Pie data={BY_CHANNEL} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                  {BY_CHANNEL.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-1.5 mt-2">
              {BY_CHANNEL.map(item => (
                <div key={item.name} className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="text-xs flex-1" style={{ color: "var(--foreground-muted)" }}>{item.name}</span>
                  <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* By tech */}
        <div className="card p-4">
          <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>{t("byTech")}</p>
          <div className="space-y-3">
            {BY_TECH.map(tech => {
              const max = BY_TECH[0].actions;
              const pct = Math.round((tech.actions / max) * 100);
              return (
                <div key={tech.tech} className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                    style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                    {tech.initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{tech.tech}</span>
                      <span className="text-xs font-bold" style={{ color: "var(--foreground)" }}>{tech.actions}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-1)" }}>
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: "var(--brand-blue)" }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

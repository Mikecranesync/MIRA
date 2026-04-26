"use client";

import { useState, useEffect } from "react";
import { BarChart2, Zap, MessageSquare, Users, TrendingUp, Calendar } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";

const CHANNEL_COLORS: Record<string, string> = {
  telegram: "#2563EB", whatsapp: "#16A34A", email: "#EA580C",
  voice: "#0891B2", webui: "#7C3AED", open_webui: "#7C3AED",
};

const PRO_TIER_LIMIT = 3600;

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function initials(name: string) {
  return (name ?? "?").split(/[\s@_]/).map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function UsagePage() {
  const t = useTranslations("usage");
  const [data, setData] = useState<{
    thisMonth: { totalActions: number; uniqueTechs: number; activeChannels: number; diagnostics: number; safetyAlerts: number };
    daily: { day: string; count: number }[];
    bySource: { source: string; count: number }[];
    byTech: { username: string; channel: string; count: number }[];
    allTime: { totalWorkOrders: number; totalKbChunks: number };
  } | null>(null);

  useEffect(() => {
    fetch("/hub/api/usage").then(r => r.json()).then(setData).catch(console.error);
  }, []);

  const month = data?.thisMonth;
  const usedThisMonth = month?.totalActions ?? 0;
  const pct = Math.min(Math.round((usedThisMonth / PRO_TIER_LIMIT) * 100), 100);

  const dailyChartData = (data?.daily ?? []).map(d => ({
    day: DAY_LABELS[new Date(d.day).getDay()] ?? d.day,
    actions: d.count,
  }));

  const byChannelData = (data?.bySource ?? []).map(s => ({
    name: s.source,
    value: s.count,
    color: CHANNEL_COLORS[s.source.toLowerCase()] ?? "#64748B",
  }));

  const byTechData = data?.byTech ?? [];
  const maxTechActions = byTechData[0]?.count ?? 1;

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
                {usedThisMonth.toLocaleString()} / {PRO_TIER_LIMIT.toLocaleString()} {t("actions")} · Pro {t("tier")}
              </p>
            </div>
            <span className="text-2xl font-bold" style={{ color: "var(--brand-blue)" }}>{pct}%</span>
          </div>

          {/* Progress bar */}
          <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-1)" }}>
            <div className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: pct > 80 ? "#DC2626" : pct > 60 ? "#EAB308" : "linear-gradient(90deg,#2563EB,#0891B2)",
              }} />
          </div>
          <p className="text-xs mt-2" style={{ color: "var(--foreground-subtle)" }}>
            {(PRO_TIER_LIMIT - usedThisMonth).toLocaleString()} {t("remaining")}
          </p>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: t("kpi.totalActions"),   value: usedThisMonth.toString(),  Icon: Zap,          color: "#2563EB" },
            { label: t("kpi.conversations"),  value: (data?.allTime.totalWorkOrders ?? 0).toString(), Icon: MessageSquare, color: "#7C3AED" },
            { label: t("kpi.activeTechs"),    value: (month?.uniqueTechs ?? 0).toString(),    Icon: Users,         color: "#16A34A" },
            { label: t("kpi.avgPerDay"),      value: dailyChartData.length ? Math.round(dailyChartData.reduce((s,d) => s+d.actions, 0) / dailyChartData.length).toString() : "0", Icon: TrendingUp, color: "#0891B2" },
          ].map(kpi => (
            <div key={kpi.label} className="card p-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center mb-2" style={{ backgroundColor: `${kpi.color}15` }}>
                <kpi.Icon className="w-3.5 h-3.5" style={{ color: kpi.color }} />
              </div>
              <div className="kpi-value" style={{ color: "var(--foreground)" }}>{kpi.value}</div>
              <div className="kpi-label mt-0.5">{kpi.label}</div>
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
            <BarChart data={dailyChartData} barSize={24}>
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
            {month ? (
              <div className="space-y-2 pt-2">
                {[
                  { name: "Diagnostics",   value: month.diagnostics,    color: "#EAB308" },
                  { name: "Work Orders",   value: data?.allTime.totalWorkOrders ?? 0, color: "#2563EB" },
                  { name: "Safety Alerts", value: month.safetyAlerts,   color: "#DC2626" },
                  { name: "KB Chunks",     value: data?.allTime.totalKbChunks ?? 0,  color: "#0891B2" },
                ].map(item => (
                  <div key={item.name} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                    <span className="text-xs flex-1" style={{ color: "var(--foreground-muted)" }}>{item.name}</span>
                    <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{item.value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-center py-8" style={{ color: "var(--foreground-subtle)" }}>Loading…</p>
            )}
          </div>

          <div className="card p-4">
            <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>{t("byChannel")}</p>
            {byChannelData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={140}>
                  <PieChart>
                    <Pie data={byChannelData} dataKey="value" cx="50%" cy="50%" innerRadius={40} outerRadius={60}>
                      {byChannelData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--surface-1)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 11 }}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="space-y-1.5 mt-2">
                  {byChannelData.map(item => (
                    <div key={item.name} className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: item.color }} />
                      <span className="text-xs flex-1 capitalize" style={{ color: "var(--foreground-muted)" }}>{item.name}</span>
                      <span className="text-xs font-semibold" style={{ color: "var(--foreground)" }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-xs text-center py-8" style={{ color: "var(--foreground-subtle)" }}>No channel data this month</p>
            )}
          </div>
        </div>

        {/* By tech */}
        <div className="card p-4">
          <p className="text-sm font-semibold mb-3" style={{ color: "var(--foreground)" }}>{t("byTech")}</p>
          {byTechData.length > 0 ? (
            <div className="space-y-3">
              {byTechData.map(tech => {
                const p = Math.round((tech.count / maxTechActions) * 100);
                return (
                  <div key={tech.username} className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
                      style={{ background: "linear-gradient(135deg,#2563EB,#0891B2)", color: "white" }}>
                      {initials(tech.username)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium truncate" style={{ color: "var(--foreground)" }}>{tech.username}</span>
                        <span className="text-xs font-bold" style={{ color: "var(--foreground)" }}>{tech.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: "var(--surface-1)" }}>
                        <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: "var(--brand-blue)" }} />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-center py-8" style={{ color: "var(--foreground-subtle)" }}>No tech data this month</p>
          )}
        </div>
      </div>
    </div>
  );
}

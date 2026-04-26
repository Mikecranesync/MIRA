"use client";

import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { TrendingDown, TrendingUp, Clock, Wrench, CheckCircle2, AlertTriangle } from "lucide-react";
import { useTranslations } from "next-intl";

/* ─── Static mock values (labels resolved inside component) ─────────── */
const KPI_DATA = [
  { labelKey: "kpiLabels.mttr",         value: "2.4h",  trend: -12, good: true,  Icon: Clock,         color: "#2563EB", bg: "#EFF6FF" },
  { labelKey: "kpiLabels.mtbf",         value: "312h",  trend: +8,  good: true,  Icon: TrendingUp,    color: "#16A34A", bg: "#DCFCE7" },
  { labelKey: "kpiLabels.openWOs",      value: "12",    trend: +3,  good: false, Icon: Wrench,        color: "#EAB308", bg: "#FEF9C3" },
  { labelKey: "kpiLabels.pmCompliance", value: "87%",   trend: +3,  good: true,  Icon: CheckCircle2,  color: "#16A34A", bg: "#DCFCE7" },
  { labelKey: "kpiLabels.downtimeHours",value: "14.2h", trend: -5,  good: true,  Icon: AlertTriangle, color: "#DC2626", bg: "#FEF2F2" },
];

const DOWNTIME_DATA = [
  { day: "Apr 1",  hours: 1.2 }, { day: "Apr 3",  hours: 0 }, { day: "Apr 5",  hours: 2.8 },
  { day: "Apr 7",  hours: 0.5 }, { day: "Apr 9",  hours: 0 }, { day: "Apr 11", hours: 3.2 },
  { day: "Apr 13", hours: 1.0 }, { day: "Apr 15", hours: 0 }, { day: "Apr 17", hours: 0.8 },
  { day: "Apr 19", hours: 0 },   { day: "Apr 21", hours: 4.5 }, { day: "Apr 22", hours: 2.4 },
];

const WO_COMPLETION_DATA = [
  { week: "W1 Mar", created: 8,  completed: 6 },
  { week: "W2 Mar", created: 11, completed: 9 },
  { week: "W3 Mar", created: 7,  completed: 10 },
  { week: "W4 Mar", created: 13, completed: 11 },
  { week: "W1 Apr", created: 9,  completed: 8 },
  { week: "W2 Apr", created: 14, completed: 12 },
  { week: "W3 Apr", created: 10, completed: 7 },
];

const TOP_PROBLEM_ASSETS = [
  { name: "HVAC Unit #2",      wos: 18, downtime: 8.4 },
  { name: "Conveyor Belt #3",  wos: 14, downtime: 3.2 },
  { name: "Air Compressor #1", wos: 11, downtime: 2.1 },
  { name: "Boiler Unit B",     wos: 7,  downtime: 0.5 },
  { name: "CNC Mill #7",       wos: 5,  downtime: 0 },
];

const PM_COMPLIANCE_DATA = [
  { name: "Completed", value: 87 },
  { name: "Overdue",   value: 8 },
  { name: "Deferred",  value: 5 },
];
const PM_COLORS = ["#16A34A", "#DC2626", "#EAB308"];

/* ─── Page ──────────────────────────────────────────────────────────── */
export default function ReportsPage() {
  const t = useTranslations("reports");

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b px-4 md:px-6 py-3"
        style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{t("subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="px-4 md:px-6 py-5 space-y-6 max-w-5xl">
        {/* KPI Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {KPI_DATA.map((kpi) => (
            <div key={kpi.labelKey} className="card p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: kpi.bg }}>
                  <kpi.Icon className="w-4 h-4" style={{ color: kpi.color }} />
                </div>
                <div className={`flex items-center gap-0.5 text-[11px] font-medium ${kpi.good ? "text-green-600" : "text-red-600"}`}>
                  {kpi.trend > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {Math.abs(kpi.trend)}%
                </div>
              </div>
              <div className="kpi-value" style={{ color: kpi.color }}>{kpi.value}</div>
              <div className="kpi-label mt-0.5">{t(kpi.labelKey)}</div>
            </div>
          ))}
        </div>

        {/* Charts row 1: Downtime + WO Completion */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title={t("charts.downtimeTrend")} subtitle={t("charts.downtimeSubtitle")}>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={DOWNTIME_DATA} barSize={8}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "var(--surface-1)" }}
                />
                <Bar dataKey="hours" name={t("charts.seriesDowntime")} fill="#DC2626" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("charts.woCompletion")} subtitle={t("charts.woSubtitle")}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={WO_COMPLETION_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="created"   name={t("charts.seriesCreated")}   stroke="#2563EB" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="completed" name={t("charts.seriesCompleted")} stroke="#16A34A" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        {/* Charts row 2: Top Problem Assets + PM Compliance */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard title={t("charts.topAssets")} subtitle={t("charts.topAssetsSubtitle")}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={TOP_PROBLEM_ASSETS} layout="vertical" barSize={10} margin={{ left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: "var(--foreground-subtle)" }} width={110} tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{ background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: "var(--surface-1)" }}
                />
                <Bar dataKey="wos" name={t("charts.seriesWorkOrders")} fill="#2563EB" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t("charts.pmCompliance")} subtitle={t("charts.pmComplianceSubtitle")}>
            <div className="flex items-center justify-center">
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={PM_COMPLIANCE_DATA}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {PM_COMPLIANCE_DATA.map((entry, index) => (
                      <Cell key={entry.name} fill={PM_COLORS[index]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: "var(--surface-0)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
                    formatter={(v) => `${v}%`}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="text-center -mt-4">
              <p className="kpi-value" style={{ color: "var(--status-green)" }}>87%</p>
              <p className="kpi-label mt-0.5">{t("overallCompliance")}</p>
            </div>
          </ChartCard>
        </div>
      </div>
    </div>
  );
}

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <div className="mb-4">
        <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>{title}</h3>
        <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

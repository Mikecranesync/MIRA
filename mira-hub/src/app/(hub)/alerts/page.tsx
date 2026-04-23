"use client";

import { useState } from "react";
import { AlertTriangle, ShieldAlert, Bot, ChevronDown, ChevronUp, CheckCircle2 } from "lucide-react";
import { useTranslations } from "next-intl";

type Severity = "critical" | "high" | "medium" | "low";
type AlertType = "safety" | "diagnostic" | "anomaly" | "pm";

type Alert = {
  id: string;
  ts: string;
  type: AlertType;
  severity: Severity;
  title: string;
  subtitle: string;
  asset: string | null;
  confidence: number | null;
  detail: string;
  acknowledged: boolean;
  source: string;
};

const ALERTS: Alert[] = [
  {
    id: "al001", ts: "7:15 AM", type: "safety", severity: "critical",
    title: "Arc Flash Hazard — Electrical Panel E-12",
    subtitle: "Category 2 PPE required. LOTO procedure LOTO-E12-2026 in effect.",
    asset: "Electrical Panel E-12", confidence: 97,
    detail: "Arc flash boundary: 4 ft restricted, 10 ft limited. No work may begin without written authorization from site safety officer Ray P. (ext. 106). PPE: Arc flash suit 8 cal/cm², face shield, rubber gloves Class 2.",
    acknowledged: false, source: "MIRA Safety Scan",
  },
  {
    id: "al002", ts: "5:47 AM", type: "anomaly", severity: "high",
    title: "CNC Mill #7 — Z-Axis Vibration Anomaly",
    subtitle: "Z-axis vibration 3.2× normal at 127 Hz. Possible spindle bearing wear.",
    asset: "CNC Mill #7", confidence: 78,
    detail: "FFT analysis shows sustained 3.2× deviation from baseline. Frequency 127 Hz matches angular contact bearing (SKF 7020) wear signature. Recommend inspection within 7 days. Part in stock: P-012 (2 units, B-1-4). Running at reduced speed (80%) will extend remaining life.",
    acknowledged: false, source: "MIRA Anomaly Detection",
  },
  {
    id: "al003", ts: "9:05 AM", type: "diagnostic", severity: "high",
    title: "Air Compressor #1 — Bearing Temp Elevated",
    subtitle: "Drive-end bearing 82°C vs 65°C baseline. Lubrication required.",
    asset: "Air Compressor #1", confidence: 84,
    detail: "Bearing temperature 26% above normal operating range. Trend: rising 2°C/hour. If temperature exceeds 90°C, shut down immediately. Lubrication: FAG-6308-2RS bearing spec per OEM manual page 47. Parts available A-2-3.",
    acknowledged: true, source: "Tech Report via Telegram",
  },
  {
    id: "al004", ts: "Yesterday", type: "pm", severity: "medium",
    title: "HVAC Unit #2 — PM Overdue by 3 Days",
    subtitle: "Quarterly filter change. Asset operational but PM is past due.",
    asset: "HVAC Unit #2", confidence: null,
    detail: "Last PM completed January 15. Due date: April 15. Now 8 days overdue. Filter P-008 is in stock (3 units). Estimated work time: 45 minutes. Schedule via the Schedule page or create a work order.",
    acknowledged: false, source: "PM Schedule",
  },
  {
    id: "al005", ts: "2 days ago", type: "pm", severity: "low",
    title: "Generator #1 — Load Test Due in 7 Days",
    subtitle: "Bi-annual load test required per NFPA 110. Scheduled for May 10.",
    asset: "Generator #1", confidence: null,
    detail: "Next load test: May 10, 2026. Duration: 2 hours minimum. Requirements: minimum 30% load, test transfer switch. Coordinate with facilities for power availability window.",
    acknowledged: true, source: "PM Schedule",
  },
];

const SEVERITY_CFG: Record<Severity, { label: string; color: string; bg: string; border: string }> = {
  critical: { label: "Critical", color: "#DC2626", bg: "#FEF2F2", border: "#DC2626" },
  high:     { label: "High",     color: "#EA580C", bg: "#FFF7ED", border: "#EA580C" },
  medium:   { label: "Medium",   color: "#EAB308", bg: "#FEF9C3", border: "#EAB308" },
  low:      { label: "Low",      color: "#64748B", bg: "#F1F5F9", border: "#CBD5E1" },
};

const TYPE_CFG: Record<AlertType, { Icon: React.ElementType; label: string }> = {
  safety:     { Icon: ShieldAlert,    label: "Safety" },
  diagnostic: { Icon: Bot,           label: "Diagnostic" },
  anomaly:    { Icon: AlertTriangle, label: "Anomaly" },
  pm:         { Icon: CheckCircle2,  label: "PM" },
};

export default function AlertsPage() {
  const t = useTranslations("alerts");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState<Set<string>>(
    new Set(ALERTS.filter(a => a.acknowledged).map(a => a.id))
  );
  const [filter, setFilter] = useState<Severity | "all">("all");

  const filtered = ALERTS.filter(a => filter === "all" || a.severity === filter);
  const activeCount = ALERTS.filter(a => !acknowledged.has(a.id)).length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="flex items-center justify-between px-4 md:px-6 py-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
              {activeCount > 0 && (
                <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                  style={{ backgroundColor: "#DC2626" }}>
                  {activeCount}
                </span>
              )}
            </div>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
              {activeCount} {t("active")} · {acknowledged.size} {t("acknowledged")}
            </p>
          </div>
        </div>

        {/* Severity filters */}
        <div className="px-4 md:px-6 pb-3 flex gap-2 overflow-x-auto scrollbar-none">
          {(["all", "critical", "high", "medium", "low"] as const).map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className="flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all"
              style={filter === s
                ? { backgroundColor: s === "all" ? "var(--brand-blue)" : SEVERITY_CFG[s as Severity]?.color ?? "var(--brand-blue)", color: "white" }
                : { backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
              {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 md:px-6 py-4 pb-24 max-w-3xl mx-auto space-y-3">
        {filtered.map(alert => {
          const sev = SEVERITY_CFG[alert.severity];
          const typeCfg = TYPE_CFG[alert.type];
          const Icon = typeCfg.Icon;
          const isAck = acknowledged.has(alert.id);
          const isExpanded = expanded === alert.id;

          return (
            <div key={alert.id} className="card overflow-hidden transition-opacity"
              style={{
                borderLeft: `3px solid ${sev.border}`,
                opacity: isAck ? 0.6 : 1,
              }}>
              <div className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ backgroundColor: sev.bg }}>
                    <Icon className="w-4.5 h-4.5" style={{ color: sev.color, width: 18, height: 18 }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 flex-wrap">
                      <p className="text-sm font-semibold leading-snug" style={{ color: "var(--foreground)" }}>
                        {alert.title}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap mt-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-full"
                        style={{ backgroundColor: sev.bg, color: sev.color }}>
                        {sev.label}
                      </span>
                      {alert.confidence && (
                        <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>
                          {alert.confidence}% confidence
                        </span>
                      )}
                      {alert.asset && (
                        <span className="text-[11px]" style={{ color: "var(--brand-blue)" }}>
                          {alert.asset}
                        </span>
                      )}
                      <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>· {alert.ts}</span>
                    </div>
                    <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--foreground-muted)" }}>
                      {alert.subtitle}
                    </p>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <div className="mt-3 p-3 rounded-lg text-xs leading-relaxed"
                        style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-muted)" }}>
                        <p className="font-medium mb-1" style={{ color: "var(--foreground-subtle)" }}>
                          Source: {alert.source}
                        </p>
                        {alert.detail}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {!isAck && (
                        <button
                          onClick={() => setAcknowledged(prev => new Set([...prev, alert.id]))}
                          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                          style={{ backgroundColor: "var(--brand-blue)", color: "white" }}>
                          {t("acknowledge")}
                        </button>
                      )}
                      <button onClick={() => setExpanded(isExpanded ? null : alert.id)}
                        className="flex items-center gap-1 text-xs px-2 py-1.5 rounded-lg"
                        style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-subtle)" }}>
                        {isExpanded
                          ? <><ChevronUp className="w-3 h-3" />{t("less")}</>
                          : <><ChevronDown className="w-3 h-3" />{t("detail")}</>
                        }
                      </button>
                      {isAck && (
                        <span className="flex items-center gap-1 text-[11px]" style={{ color: "#16A34A" }}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          {t("acknowledged")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-3" style={{ color: "#16A34A" }} />
            <p className="font-medium" style={{ color: "var(--foreground-muted)" }}>{t("noAlerts")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Calendar, List, ChevronLeft, ChevronRight, Clock, User, RotateCcw, AlertCircle, X, Sparkles, Package, Wrench, ShieldAlert, BookOpen } from "lucide-react";
import { useToast } from "@/providers/toast-provider";
import { Badge } from "@/components/ui/badge";

type PM = {
  id: string;
  title: string;
  asset: string;
  date: string;       // YYYY-MM-DD
  tech: string;
  recur: string;
  durationH: number;
  status: "scheduled" | "overdue" | "completed" | "inprogress";
  auto_extracted?: boolean;
  source_citation?: string | null;
  criticality?: string;
  parts_needed?: string[];
  tools_needed?: string[];
  safety_requirements?: string[];
  manufacturer?: string | null;
  model_number?: string | null;
};

// Fallback shown while loading or when no extracted PMs exist
const FALLBACK_PMS: PM[] = [
  { id: "PM-001", title: "Air Compressor Full PM",    asset: "Air Compressor #1", date: "2026-04-25", tech: "Mike H.",  recur: "Monthly",    durationH: 2, status: "scheduled" },
  { id: "PM-002", title: "Conveyor Belt Lubrication", asset: "Conveyor Belt #3",  date: "2026-04-28", tech: "John S.", recur: "Weekly",     durationH: 1, status: "scheduled" },
  { id: "PM-003", title: "Pump Station A Inspection", asset: "Pump Station A",    date: "2026-04-22", tech: "Sara K.", recur: "Bi-Weekly",  durationH: 3, status: "inprogress" },
  { id: "PM-004", title: "Generator Load Test",       asset: "Generator #1",      date: "2026-04-18", tech: "Mike H.", recur: "Monthly",    durationH: 2, status: "overdue" },
  { id: "PM-005", title: "HVAC Filter Change",        asset: "HVAC Unit #2",      date: "2026-05-01", tech: "—",       recur: "Quarterly",  durationH: 1, status: "scheduled" },
  { id: "PM-006", title: "CNC Mill Calibration",      asset: "CNC Mill #7",       date: "2026-05-05", tech: "Mike H.", recur: "Monthly",    durationH: 4, status: "scheduled" },
  { id: "PM-007", title: "Conveyor Belt Inspection",  asset: "Conveyor Belt #3",  date: "2026-05-07", tech: "John S.", recur: "Monthly",    durationH: 2, status: "scheduled" },
  { id: "PM-008", title: "Compressor Oil Change",     asset: "Air Compressor #1", date: "2026-04-10", tech: "Mike H.", recur: "Quarterly",  durationH: 1, status: "completed" },
  { id: "PM-009", title: "VFD Inspection",            asset: "Conveyor Belt #3",  date: "2026-05-12", tech: "Sara K.", recur: "Monthly",    durationH: 1, status: "scheduled" },
  { id: "PM-010", title: "Pump Seal Check",           asset: "Pump Station A",    date: "2026-05-15", tech: "John S.", recur: "Quarterly",  durationH: 2, status: "scheduled" },
];

const STATUS_CFG = {
  scheduled:  { labelKey: "statusLabels.scheduled",  badgeVariant: "secondary" as const, dot: "#3B82F6", bar: "#DBEAFE" },
  overdue:    { labelKey: "statusLabels.overdue",    badgeVariant: "overdue"   as const, dot: "#DC2626", bar: "#FEE2E2" },
  completed:  { labelKey: "statusLabels.completed",  badgeVariant: "completed" as const, dot: "#16A34A", bar: "#DCFCE7" },
  inprogress: { labelKey: "statusLabels.inprogress", badgeVariant: "inprogress"as const, dot: "#EAB308", bar: "#FEF9C3" },
};

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function SchedulePage() {
  const t = useTranslations("schedule");
  const DAYS = [t("days.sun"), t("days.mon"), t("days.tue"), t("days.wed"), t("days.thu"), t("days.fri"), t("days.sat")];
  const MONTHS = [t("months.jan"), t("months.feb"), t("months.mar"), t("months.apr"), t("months.may"), t("months.jun"), t("months.jul"), t("months.aug"), t("months.sep"), t("months.oct"), t("months.nov"), t("months.dec")];
  const today = new Date();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedPM, setSelectedPM] = useState<PM | null>(null);
  const [pms, setPms] = useState<PM[]>(FALLBACK_PMS);
  const [loading, setLoading] = useState(true);
  const [extractedCount, setExtractedCount] = useState(0);
  const { toast } = useToast();

  // Fetch real PM schedules from API on mount
  useEffect(() => {
    fetch("/api/pm-schedules")
      .then(r => r.json())
      .then((data: { count: number; schedules: PM[] }) => {
        if (data.schedules && data.schedules.length > 0) {
          setPms(data.schedules);
          setExtractedCount(data.schedules.filter(p => p.auto_extracted).length);
        }
      })
      .catch(() => {/* keep fallback */})
      .finally(() => setLoading(false));
  }, []);

  const cells = getCalendarDays(year, month);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  function pmsByDay(day: number) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return pms.filter(p => p.date === dateStr);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const overdueCount = pms.filter(p => p.status === "overdue").length;
  const scheduledCount = pms.filter(p => p.status === "scheduled").length;

  const sortedPMs = [...pms].sort((a, b) => {
    const order: Record<string, number> = { overdue: 0, inprogress: 1, scheduled: 2, completed: 3 };
    return (order[a.status] ?? 4) - (order[b.status] ?? 4) || a.date.localeCompare(b.date);
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
                {loading && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full animate-pulse" style={{ backgroundColor: "var(--surface-1)", color: "var(--foreground-subtle)" }}>loading…</span>
                )}
                {!loading && extractedCount > 0 && (
                  <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgba(37,99,235,0.08)", color: "var(--brand-blue)" }}>
                    <Sparkles className="w-2.5 h-2.5" />{extractedCount} AI-extracted
                  </span>
                )}
              </div>
              <div className="flex gap-3 mt-0.5">
                {overdueCount > 0 && (
                  <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: "var(--status-red)" }}>
                    <AlertCircle className="w-3 h-3" />{t("overdueCount", { count: overdueCount })}
                  </span>
                )}
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{t("upcomingCount", { count: scheduledCount })}</span>
              </div>
            </div>
            {/* View toggle */}
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setView("calendar")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: view === "calendar" ? "var(--brand-blue)" : "var(--surface-1)", color: view === "calendar" ? "white" : "var(--foreground-muted)" }}>
                <Calendar className="w-3.5 h-3.5" />{t("calendar")}
              </button>
              <button onClick={() => setView("list")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: view === "list" ? "var(--brand-blue)" : "var(--surface-1)", color: view === "list" ? "white" : "var(--foreground-muted)" }}>
                <List className="w-3.5 h-3.5" />{t("list")}
              </button>
            </div>
          </div>

          {/* Month nav (calendar mode) */}
          {view === "calendar" && (
            <div className="flex items-center gap-3">
              <button onClick={prevMonth} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--surface-1)]" style={{ color: "var(--foreground-muted)" }}>
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-semibold flex-1 text-center" style={{ color: "var(--foreground)" }}>
                {MONTHS[month]} {year}
              </span>
              <button onClick={nextMonth} className="p-1.5 rounded-lg transition-colors hover:bg-[var(--surface-1)]" style={{ color: "var(--foreground-muted)" }}>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>

      {view === "calendar" ? (
        <div className="px-4 md:px-6 py-4">
          {/* Day headers */}
          <div className="grid grid-cols-7 mb-1">
            {DAYS.map(d => (
              <div key={d} className="py-1 text-center text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: "var(--foreground-subtle)" }}>{d}</div>
            ))}
          </div>

          {/* Calendar grid */}
          <div className="grid grid-cols-7 gap-px" style={{ backgroundColor: "var(--border)" }}>
            {cells.map((day, i) => {
              const dateStr = day ? `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}` : "";
              const isToday = dateStr === todayStr;
              const isSelected = dateStr === selectedDay;
              const dayPMs = day ? pmsByDay(day) : [];
              return (
                <div key={i}
                  className={`min-h-[80px] md:min-h-[110px] p-1 md:p-2 ${day && dayPMs.length > 0 ? "cursor-pointer" : ""}`}
                  style={{
                    backgroundColor: isSelected ? "rgba(37,99,235,0.08)" : day ? "var(--surface-0)" : "var(--surface-1)",
                    outline: isSelected ? "2px solid var(--brand-blue)" : "none",
                    outlineOffset: "-2px",
                  }}
                  onClick={() => day && (dayPMs.length > 0 ? setSelectedDay(isSelected ? null : dateStr) : null)}>
                  {day && (
                    <>
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium mb-1`}
                        style={{ backgroundColor: isToday ? "var(--brand-blue)" : "transparent", color: isToday ? "white" : "var(--foreground-muted)" }}>
                        {day}
                      </span>
                      <div className="space-y-0.5">
                        {dayPMs.slice(0, 3).map(pm => {
                          const cfg = STATUS_CFG[pm.status];
                          return (
                            <div key={pm.id} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate font-medium"
                              style={{ backgroundColor: cfg.bar, color: cfg.dot }}>
                              {pm.title}
                            </div>
                          );
                        })}
                        {dayPMs.length > 3 && (
                          <div className="text-[10px] px-1" style={{ color: "var(--foreground-subtle)" }}>+{dayPMs.length - 3} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          {/* Legend */}
          <div className="flex flex-wrap gap-4 mt-4">
            {Object.entries(STATUS_CFG).map(([key, cfg]) => (
              <div key={key} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: cfg.bar, border: `1.5px solid ${cfg.dot}` }} />
                <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{t(cfg.labelKey)}</span>
              </div>
            ))}
          </div>

          {/* Day detail panel */}
          {selectedDay && <DayDetail
            selectedDay={selectedDay}
            pms={pms.filter(p => p.date === selectedDay)}
            months={MONTHS}
            onClose={() => setSelectedDay(null)}
            onSelectPM={setSelectedPM}
          />}
        </div>
      ) : (
        <div className="px-4 md:px-6 py-4 space-y-3">
          {sortedPMs.map(pm => {
            const cfg = STATUS_CFG[pm.status];
            const isPast = pm.date < todayStr && pm.status !== "completed";
            return (
              <div key={pm.id} className="card p-4 flex gap-3">
                <div className="w-1 rounded-full flex-shrink-0 self-stretch" style={{ backgroundColor: cfg.dot }} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{pm.title}</p>
                    <Badge variant={cfg.badgeVariant} className="text-[10px] flex-shrink-0">{t(cfg.labelKey)}</Badge>
                  </div>
                  <p className="text-xs mb-2" style={{ color: "var(--foreground-muted)" }}>{pm.asset}</p>
                  <div className="flex flex-wrap gap-3">
                    <span className="text-[11px] flex items-center gap-1" style={{ color: isPast && pm.status === "overdue" ? "var(--status-red)" : "var(--foreground-subtle)" }}>
                      <Calendar className="w-3 h-3" />{pm.date}
                    </span>
                    <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--foreground-subtle)" }}>
                      <User className="w-3 h-3" />{pm.tech}
                    </span>
                    <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--foreground-subtle)" }}>
                      <Clock className="w-3 h-3" />{pm.durationH}h
                    </span>
                    <span className="text-[11px] flex items-center gap-1" style={{ color: "var(--foreground-subtle)" }}>
                      <RotateCcw className="w-3 h-3" />{pm.recur}
                    </span>
                    <span className="text-[11px] font-mono" style={{ color: "var(--foreground-subtle)" }}>{pm.id}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PM detail bottom sheet — outside ternary so it renders over both views */}
      {selectedPM && (
        <PMSheet
          pm={selectedPM}
          onClose={() => setSelectedPM(null)}
          onComplete={() => { toast(`${selectedPM.title} ${t("completedToast")}`); setSelectedPM(null); }}
        />
      )}
    </div>
  );
}

function DayDetail({ selectedDay, pms, months, onClose, onSelectPM }: {
  selectedDay: string; pms: PM[]; months: string[]; onClose: () => void; onSelectPM: (pm: PM) => void;
}) {
  const t = useTranslations("schedule");
  const [, m, d] = selectedDay.split("-");
  return (
    <div className="mt-4 card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold" style={{ color: "var(--foreground)" }}>
          {months[parseInt(m) - 1]} {parseInt(d)} — {pms.length !== 1 ? t("pmCountPlural", { count: pms.length }) : t("pmCount", { count: pms.length })}
        </h3>
        <button onClick={onClose} style={{ color: "var(--foreground-subtle)" }}>
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="space-y-2">
        {pms.map(pm => {
          const cfg = STATUS_CFG[pm.status];
          return (
            <button key={pm.id} onClick={() => onSelectPM(pm)} className="w-full text-left p-3 rounded-lg border transition-colors hover:bg-[var(--surface-1)]"
              style={{ borderColor: "var(--border)" }}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium" style={{ color: "var(--foreground)" }}>{pm.title}</p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>
                    {pm.asset} · {pm.tech} · {pm.durationH}h · {pm.recur}
                  </p>
                </div>
                <Badge variant={cfg.badgeVariant} className="text-[10px] flex-shrink-0">{t(cfg.labelKey)}</Badge>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PMSheet({ pm, onClose, onComplete }: { pm: PM; onClose: () => void; onComplete: () => void }) {
  const t = useTranslations("schedule");
  const tCommon = useTranslations("common");
  const cfg = STATUS_CFG[pm.status];
  const critColor: Record<string, string> = { critical: "#DC2626", high: "#F97316", medium: "#2563EB", low: "#64748B" };
  const crit = pm.criticality ?? "medium";
  return (
    <>
      <div className="fixed inset-0 z-40" style={{ backgroundColor: "rgba(0,0,0,0.4)" }} onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 rounded-t-2xl p-5 space-y-4"
        style={{ backgroundColor: "var(--surface-0)", maxHeight: "85vh", overflowY: "auto" }}>

        {/* Title row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <p className="text-xs font-mono" style={{ color: "var(--foreground-subtle)" }}>{pm.id}</p>
              {pm.auto_extracted && (
                <span className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded-full font-medium"
                  style={{ backgroundColor: "rgba(37,99,235,0.1)", color: "var(--brand-blue)" }}>
                  <Sparkles className="w-2.5 h-2.5" />AI-extracted from manual
                </span>
              )}
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase"
                style={{ backgroundColor: critColor[crit] + "18", color: critColor[crit] }}>
                {crit}
              </span>
            </div>
            <h3 className="text-base font-semibold leading-snug" style={{ color: "var(--foreground)" }}>{pm.title}</h3>
            <p className="text-xs mt-0.5" style={{ color: "var(--foreground-muted)" }}>{pm.asset}</p>
          </div>
          <button onClick={onClose} style={{ color: "var(--foreground-subtle)" }}><X className="w-5 h-5" /></button>
        </div>

        {/* Schedule grid */}
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: t("fields.status"),     value: t(cfg.labelKey),         Icon: Clock },
            { label: t("fields.dueDate"),    value: pm.date,                 Icon: Calendar },
            { label: t("fields.recurrence"), value: pm.recur,                Icon: RotateCcw },
            { label: t("fields.duration"),   value: `${pm.durationH}h est.`, Icon: Clock },
          ].map(({ label, value, Icon }) => (
            <div key={label} className="p-3 rounded-lg" style={{ backgroundColor: "var(--surface-1)" }}>
              <div className="flex items-center gap-1 mb-1">
                <Icon className="w-3 h-3" style={{ color: "var(--foreground-subtle)" }} />
                <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>{label}</span>
              </div>
              <p className="text-xs font-medium" style={{ color: "var(--foreground)" }}>{value}</p>
            </div>
          ))}
        </div>

        {/* Parts needed */}
        {pm.parts_needed && pm.parts_needed.length > 0 && (
          <div className="rounded-xl p-3 space-y-1.5" style={{ backgroundColor: "var(--surface-1)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Package className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>Parts Needed</span>
            </div>
            {pm.parts_needed.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "var(--brand-blue)" }} />
                <span className="text-xs" style={{ color: "var(--foreground)" }}>{p}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tools needed */}
        {pm.tools_needed && pm.tools_needed.length > 0 && (
          <div className="rounded-xl p-3 space-y-1.5" style={{ backgroundColor: "var(--surface-1)" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <Wrench className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--foreground-subtle)" }}>Tools</span>
            </div>
            {pm.tools_needed.map((tool, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: "#64748B" }} />
                <span className="text-xs" style={{ color: "var(--foreground)" }}>{tool}</span>
              </div>
            ))}
          </div>
        )}

        {/* Safety requirements */}
        {pm.safety_requirements && pm.safety_requirements.length > 0 && (
          <div className="rounded-xl p-3 space-y-1.5 border" style={{ backgroundColor: "#FFF7ED", borderColor: "#FDBA74" }}>
            <div className="flex items-center gap-1.5 mb-2">
              <ShieldAlert className="w-3.5 h-3.5" style={{ color: "#F97316" }} />
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "#F97316" }}>Safety Requirements</span>
            </div>
            {pm.safety_requirements.map((s, i) => (
              <div key={i} className="flex items-start gap-2">
                <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "#F97316" }} />
                <span className="text-xs font-medium" style={{ color: "#92400E" }}>{s}</span>
              </div>
            ))}
          </div>
        )}

        {/* Manual citation */}
        {pm.source_citation && (
          <div className="flex items-start gap-2 p-3 rounded-xl" style={{ backgroundColor: "var(--surface-1)" }}>
            <BookOpen className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" style={{ color: "var(--foreground-subtle)" }} />
            <div>
              <span className="text-[10px] uppercase tracking-wide block mb-0.5" style={{ color: "var(--foreground-subtle)" }}>Manual Reference</span>
              <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{pm.source_citation}</p>
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button onClick={onComplete} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
            style={{ backgroundColor: "#16A34A" }}>
            {t("markComplete")}
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold border"
            style={{ borderColor: "var(--border)", color: "var(--foreground-muted)", backgroundColor: "var(--surface-0)" }}>
            {tCommon("close")}
          </button>
        </div>
      </div>
    </>
  );
}

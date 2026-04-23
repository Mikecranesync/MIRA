"use client";

import { useState } from "react";
import Link from "next/link";
import { Calendar, List, ChevronLeft, ChevronRight, Clock, User, RotateCcw, AlertCircle } from "lucide-react";
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
};

const PMS: PM[] = [
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
  scheduled:  { label: "Scheduled",    badgeVariant: "secondary" as const, dot: "#3B82F6", bar: "#DBEAFE" },
  overdue:    { label: "Overdue",      badgeVariant: "overdue"   as const, dot: "#DC2626", bar: "#FEE2E2" },
  completed:  { label: "Completed",    badgeVariant: "completed" as const, dot: "#16A34A", bar: "#DCFCE7" },
  inprogress: { label: "In Progress",  badgeVariant: "inprogress"as const, dot: "#EAB308", bar: "#FEF9C3" },
};

const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

function getCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = Array(firstDay).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export default function SchedulePage() {
  const today = new Date();
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const cells = getCalendarDays(year, month);
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

  function pmsByDay(day: number) {
    const dateStr = `${year}-${String(month+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
    return PMS.filter(p => p.date === dateStr);
  }

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const overdueCount = PMS.filter(p => p.status === "overdue").length;
  const scheduledCount = PMS.filter(p => p.status === "scheduled").length;

  const sortedPMs = [...PMS].sort((a, b) => {
    const order = { overdue: 0, inprogress: 1, scheduled: 2, completed: 3 };
    return order[a.status] - order[b.status] || a.date.localeCompare(b.date);
  });

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>PM Schedule</h1>
              <div className="flex gap-3 mt-0.5">
                {overdueCount > 0 && (
                  <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: "var(--status-red)" }}>
                    <AlertCircle className="w-3 h-3" />{overdueCount} overdue
                  </span>
                )}
                <span className="text-[11px]" style={{ color: "var(--foreground-subtle)" }}>{scheduledCount} upcoming</span>
              </div>
            </div>
            {/* View toggle */}
            <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: "var(--border)" }}>
              <button onClick={() => setView("calendar")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: view === "calendar" ? "var(--brand-blue)" : "var(--surface-1)", color: view === "calendar" ? "white" : "var(--foreground-muted)" }}>
                <Calendar className="w-3.5 h-3.5" />Calendar
              </button>
              <button onClick={() => setView("list")}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors"
                style={{ backgroundColor: view === "list" ? "var(--brand-blue)" : "var(--surface-1)", color: view === "list" ? "white" : "var(--foreground-muted)" }}>
                <List className="w-3.5 h-3.5" />List
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
              const dayPMs = day ? pmsByDay(day) : [];
              return (
                <div key={i} className="min-h-[80px] md:min-h-[110px] p-1 md:p-2"
                  style={{ backgroundColor: day ? "var(--surface-0)" : "var(--surface-1)" }}>
                  {day && (
                    <>
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium mb-1 ${isToday ? "text-white" : ""}`}
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
                <span className="text-[11px]" style={{ color: "var(--foreground-muted)" }}>{cfg.label}</span>
              </div>
            ))}
          </div>
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
                    <Badge variant={cfg.badgeVariant} className="text-[10px] flex-shrink-0">{cfg.label}</Badge>
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
    </div>
  );
}

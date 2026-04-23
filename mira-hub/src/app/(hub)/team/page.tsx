"use client";

import { useState } from "react";
import { Users, CheckCircle2, Clock, XCircle, Phone, Wrench, ClipboardList } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useTranslations } from "next-intl";

type ShiftStatus = "on-shift" | "on-call" | "off-shift";

type TeamMember = {
  id: string;
  name: string;
  initials: string;
  role: string;
  dept: string;
  shift: string;
  shiftStatus: ShiftStatus;
  phone: string;
  currentAssignment: string | null;
  todayActivity: string[];
  avatarColor: string;
  miraChannel: string;
  miraChannelEmoji: string;
  miraLastAssist: string;
  miraActionsToday: number;
};

const TEAM: TeamMember[] = [
  {
    id: "T-001", name: "Mike Harper", initials: "MH", role: "Maintenance Lead", dept: "Maintenance",
    shift: "Day (6AM–2PM)", shiftStatus: "on-shift", phone: "(863) 555-0101",
    currentAssignment: "WO-2026-009 — Air Compressor PM",
    todayActivity: ["Completed PM-008 (Oil Change)", "Reviewed 2 maintenance requests", "Ordered parts PO-2026-044"],
    avatarColor: "#2563EB",
    miraChannel: "Open WebUI", miraChannelEmoji: "🖥️", miraLastAssist: "2:30 PM yest.", miraActionsToday: 47,
  },
  {
    id: "T-002", name: "John Smith", initials: "JS", role: "Mechanic II", dept: "Mechanical",
    shift: "Day (6AM–2PM)", shiftStatus: "on-shift", phone: "(863) 555-0102",
    currentAssignment: "WO-2026-002 — Conveyor Belt Tension Adj.",
    todayActivity: ["Lubricated Conveyor #3", "Inspection report filed", "Parts request submitted"],
    avatarColor: "#0891B2",
    miraChannel: "Telegram", miraChannelEmoji: "✈️", miraLastAssist: "9:12 AM", miraActionsToday: 287,
  },
  {
    id: "T-003", name: "Sara Kim", initials: "SK", role: "Operator III", dept: "Production",
    shift: "Day (6AM–2PM)", shiftStatus: "on-shift", phone: "(863) 555-0103",
    currentAssignment: null,
    todayActivity: ["Started Pump Station A inspection", "Safety walk — Bay 2 & 3"],
    avatarColor: "#7C3AED",
    miraChannel: "Telegram", miraChannelEmoji: "✈️", miraLastAssist: "8:47 AM", miraActionsToday: 214,
  },
  {
    id: "T-004", name: "Dave Torres", initials: "DT", role: "Scheduler", dept: "Maintenance",
    shift: "Day (6AM–2PM)", shiftStatus: "on-shift", phone: "(863) 555-0104",
    currentAssignment: "Updating PM calendar for May",
    todayActivity: ["Scheduled 3 PMs for next week", "Closed WO-2026-001", "Coordinated parts delivery"],
    avatarColor: "#059669",
    miraChannel: "Email", miraChannelEmoji: "📧", miraLastAssist: "7:45 AM", miraActionsToday: 31,
  },
  {
    id: "T-005", name: "Lisa Wong", initials: "LW", role: "Maintenance Manager", dept: "Engineering",
    shift: "Day (8AM–4PM)", shiftStatus: "on-shift", phone: "(863) 555-0105",
    currentAssignment: null,
    todayActivity: ["Approved 1 request", "Weekly KPI review meeting", "Vendor call — Grainger"],
    avatarColor: "#DC2626",
    miraChannel: "Email", miraChannelEmoji: "📧", miraLastAssist: "Yesterday", miraActionsToday: 8,
  },
  {
    id: "T-006", name: "Ray Patel", initials: "RP", role: "Electrician", dept: "Electrical",
    shift: "Evening (2PM–10PM)", shiftStatus: "on-call", phone: "(863) 555-0106",
    currentAssignment: null,
    todayActivity: [],
    avatarColor: "#D97706",
    miraChannel: "Email", miraChannelEmoji: "📧", miraLastAssist: "6:58 AM", miraActionsToday: 178,
  },
  {
    id: "T-007", name: "Tom Nguyen", initials: "TN", role: "Mechanic I", dept: "Mechanical",
    shift: "Evening (2PM–10PM)", shiftStatus: "off-shift", phone: "(863) 555-0107",
    currentAssignment: null,
    todayActivity: ["WO-2026-007 completed (PM)", "Conveyor cleaning"],
    avatarColor: "#64748B",
    miraChannel: "WhatsApp", miraChannelEmoji: "💬", miraLastAssist: "Yesterday", miraActionsToday: 23,
  },
];

const SHIFT_CFG_BASE: Record<ShiftStatus, { badgeVariant: "green" | "yellow" | "secondary"; icon: React.ElementType; dot: string }> = {
  "on-shift":  { badgeVariant: "green",     icon: CheckCircle2, dot: "#16A34A" },
  "on-call":   { badgeVariant: "yellow",    icon: Clock,        dot: "#EAB308" },
  "off-shift": { badgeVariant: "secondary", icon: XCircle,      dot: "#94A3B8" },
};

export default function TeamPage() {
  const t = useTranslations("team");
  const tStatus = useTranslations("status");

  const SHIFT_CFG: Record<ShiftStatus, { label: string; badgeVariant: "green" | "yellow" | "secondary"; icon: React.ElementType; dot: string }> = {
    "on-shift":  { ...SHIFT_CFG_BASE["on-shift"],  label: tStatus("available") },
    "on-call":   { ...SHIFT_CFG_BASE["on-call"],   label: tStatus("onJob") },
    "off-shift": { ...SHIFT_CFG_BASE["off-shift"], label: tStatus("offDuty") },
  };

  const SHIFT_FILTERS = [
    { key: "all",       label: t("filters.all") },
    { key: "on-shift",  label: tStatus("available") },
    { key: "on-call",   label: tStatus("onJob") },
    { key: "off-shift", label: tStatus("offDuty") },
  ];

  const [shiftFilter, setShiftFilter] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const visible = shiftFilter === "all" ? TEAM : TEAM.filter(m => m.shiftStatus === shiftFilter);
  const onShiftCount = TEAM.filter(m => m.shiftStatus === "on-shift").length;
  const onCallCount = TEAM.filter(m => m.shiftStatus === "on-call").length;

  return (
    <div className="min-h-full" style={{ backgroundColor: "var(--background)" }}>
      {/* Header */}
      <div className="sticky top-0 z-20 border-b" style={{ backgroundColor: "var(--surface-0)", borderColor: "var(--border)" }}>
        <div className="px-4 md:px-6 pt-3 pb-3">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-base font-semibold" style={{ color: "var(--foreground)" }}>{t("title")}</h1>
            <div className="flex gap-3">
              <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: "var(--status-green)" }}>
                <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: "#16A34A" }} />
                {onShiftCount} {tStatus("available")}
              </span>
              {onCallCount > 0 && (
                <span className="text-[11px] font-medium flex items-center gap-1" style={{ color: "var(--status-yellow)" }}>
                  <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: "#EAB308" }} />
                  {onCallCount} {tStatus("onJob")}
                </span>
              )}
            </div>
          </div>

          {/* Filter */}
          <div className="flex gap-2 overflow-x-auto scrollbar-none pb-1 mt-2">
            {SHIFT_FILTERS.map(f => (
              <button key={f.key} onClick={() => setShiftFilter(f.key)}
                className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all"
                style={{ backgroundColor: shiftFilter === f.key ? "var(--brand-blue)" : "var(--surface-1)", color: shiftFilter === f.key ? "white" : "var(--foreground-muted)" }}>
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Team grid / list */}
      <div className="px-4 md:px-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visible.map(member => {
            const sCfg = SHIFT_CFG[member.shiftStatus];
            const ShiftIcon = sCfg.icon;
            const isExpanded = expanded === member.id;

            return (
              <div key={member.id} className="card overflow-hidden">
                <button onClick={() => setExpanded(isExpanded ? null : member.id)} className="w-full text-left p-4">
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    <div className="relative flex-shrink-0">
                      <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold text-white"
                        style={{ backgroundColor: member.avatarColor }}>
                        {member.initials}
                      </div>
                      <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2"
                        style={{ backgroundColor: sCfg.dot, borderColor: "var(--surface-0)" }} />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>{member.name}</p>
                        <Badge variant={sCfg.badgeVariant} className="text-[10px] gap-1 flex-shrink-0">
                          <ShiftIcon className="w-2.5 h-2.5" />{sCfg.label}
                        </Badge>
                      </div>
                      <p className="text-xs" style={{ color: "var(--foreground-muted)" }}>{member.role} · {member.dept}</p>
                      {member.currentAssignment && (
                        <p className="text-[11px] mt-1 flex items-center gap-1 truncate" style={{ color: "var(--brand-blue)" }}>
                          <Wrench className="w-3 h-3 flex-shrink-0" />{member.currentAssignment}
                        </p>
                      )}
                      {!member.currentAssignment && member.shiftStatus === "on-shift" && (
                        <p className="text-[11px] mt-1" style={{ color: "var(--foreground-subtle)" }}>{tStatus("available")}</p>
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
                    {/* Contact */}
                    <div className="flex items-center gap-2 mt-3">
                      <Phone className="w-3.5 h-3.5" style={{ color: "var(--foreground-subtle)" }} />
                      <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{member.phone}</span>
                      <span className="text-[11px] ml-1" style={{ color: "var(--foreground-subtle)" }}>· {member.shift}</span>
                    </div>

                    {/* MIRA Activity */}
                    <div className="flex items-center justify-between p-2.5 rounded-lg" style={{ backgroundColor: "var(--surface-1)" }}>
                      <div className="flex items-center gap-2">
                        <span className="text-base">{member.miraChannelEmoji}</span>
                        <div>
                          <p className="text-[11px] font-semibold" style={{ color: "var(--foreground)" }}>{member.miraChannel}</p>
                          <p className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{t("lastAssist")}: {member.miraLastAssist}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold" style={{ color: "var(--brand-blue)" }}>{member.miraActionsToday}</p>
                        <p className="text-[10px]" style={{ color: "var(--foreground-subtle)" }}>{t("actionsToday")}</p>
                      </div>
                    </div>

                    {/* Today's activity */}
                    {member.todayActivity.length > 0 ? (
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: "var(--foreground-subtle)" }}>
                          {t("todayActivity")}
                        </p>
                        <div className="space-y-1.5">
                          {member.todayActivity.map((item, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <ClipboardList className="w-3 h-3 mt-0.5 flex-shrink-0" style={{ color: "var(--foreground-subtle)" }} />
                              <span className="text-xs" style={{ color: "var(--foreground-muted)" }}>{item}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs" style={{ color: "var(--foreground-subtle)" }}>{t("noActivityToday")}</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

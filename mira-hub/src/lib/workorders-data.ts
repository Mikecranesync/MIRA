export type WOStatus = "open" | "inprogress" | "scheduled" | "completed" | "overdue";
export type WOPriority = "Low" | "Medium" | "High" | "Critical";

export type WorkOrder = {
  id: string;
  asset: string;
  assetId: string;
  desc: string;
  priority: WOPriority;
  status: WOStatus;
  assignee: string;
  created: string;
  due: string;
  estimatedH: number;
  type: "PM" | "Corrective" | "Inspection" | "Emergency";
  notes: string;
  partsUsed: { partId: string; partNumber: string; description: string; qty: number }[];
  comments: { author: string; ts: string; text: string }[];
};

export const WORK_ORDERS: WorkOrder[] = [
  {
    id: "WO-2026-001", asset: "Air Compressor #1", assetId: "1",
    desc: "Quarterly PM — oil, belts, filters", priority: "High", status: "open",
    assignee: "Mike H.", created: "2026-04-20", due: "2026-04-25", estimatedH: 2, type: "PM",
    notes: "Check oil level, inspect drive belt, replace air filter (P-001). Check inlet valve.",
    partsUsed: [],
    comments: [{ author: "Mike H.", ts: "2026-04-20 08:00", text: "Scheduled for April 25th. Parts confirmed in stock." }],
  },
  {
    id: "WO-2026-002", asset: "Conveyor Belt #3", assetId: "2",
    desc: "Replace main drive belt — snapped", priority: "Critical", status: "inprogress",
    assignee: "John S.", created: "2026-04-21", due: "2026-04-23", estimatedH: 3, type: "Emergency",
    notes: "Belt snapped at splice point. Production line B is down. Part P-002 in use.",
    partsUsed: [{ partId: "P-002", partNumber: "DR-5V660-B200", description: "Drive Belt 5V660", qty: 1 }],
    comments: [
      { author: "John S.", ts: "2026-04-21 09:00", text: "Belt removed. Inspecting sheaves for wear." },
      { author: "Mike H.", ts: "2026-04-21 09:45", text: "Replacement belt confirmed in B-1-4. Go ahead." },
    ],
  },
  {
    id: "WO-2026-003", asset: "HVAC Unit #2", assetId: "4",
    desc: "Quarterly filter change + coil inspection", priority: "Medium", status: "open",
    assignee: "—", created: "2026-04-18", due: "2026-04-30", estimatedH: 1, type: "PM",
    notes: "Replace MERV-13 filters (P-008). Inspect evaporator coil for fouling.",
    partsUsed: [],
    comments: [],
  },
  {
    id: "WO-2026-004", asset: "CNC Mill #7", assetId: "3",
    desc: "Lubrication PM cycle — all axes", priority: "Low", status: "scheduled",
    assignee: "Mike H.", created: "2026-04-17", due: "2026-05-01", estimatedH: 1, type: "PM",
    notes: "Apply NLGI 2 spindle grease (P-010) to all axis bearings per OEM schedule.",
    partsUsed: [],
    comments: [],
  },
  {
    id: "WO-2026-005", asset: "Pump Station A", assetId: "5",
    desc: "Mechanical seal replacement", priority: "Critical", status: "completed",
    assignee: "John S.", created: "2026-04-10", due: "2026-04-12", estimatedH: 4, type: "Corrective",
    notes: "Seal failed — steady drip at shaft. Replaced with kit CR-MECH-SEAL-KIT (P-007).",
    partsUsed: [{ partId: "P-007", partNumber: "CR-MECH-SEAL-KIT", description: "Mechanical Seal Kit — Grundfos CR 10-8", qty: 1 }],
    comments: [
      { author: "John S.", ts: "2026-04-12 14:30", text: "Seal replaced. Pump running dry for 10 min — no leaks. Returning to service." },
      { author: "Mike H.", ts: "2026-04-12 15:00", text: "WO closed. Reorder seal kit triggered." },
    ],
  },
  {
    id: "WO-2026-006", asset: "Generator #1", assetId: "6",
    desc: "Annual load test + fuel check", priority: "High", status: "scheduled",
    assignee: "Mike H.", created: "2026-04-16", due: "2026-05-10", estimatedH: 3, type: "Inspection",
    notes: "Run full load test per NFPA 110. Check fuel level, battery, coolant.",
    partsUsed: [],
    comments: [],
  },
  {
    id: "WO-2026-007", asset: "Air Compressor #1", assetId: "1",
    desc: "Belt tension adjustment — MIRA alert", priority: "Medium", status: "completed",
    assignee: "John S.", created: "2026-04-13", due: "2026-04-15", estimatedH: 1, type: "Corrective",
    notes: "MIRA detected bearing temp spike. Lubricated and re-tensioned drive belt.",
    partsUsed: [],
    comments: [{ author: "John S.", ts: "2026-04-15 11:30", text: "Belt tensioned to spec. Bearing temp down to 68°C." }],
  },
  {
    id: "WO-2025-099", asset: "Boiler Unit B", assetId: "7",
    desc: "Pressure relief valve test (overdue)", priority: "High", status: "overdue",
    assignee: "—", created: "2026-03-01", due: "2026-03-15", estimatedH: 2, type: "Inspection",
    notes: "Annual PRV test required per ASME. Overdue — needs immediate scheduling.",
    partsUsed: [],
    comments: [{ author: "System", ts: "2026-03-16 00:00", text: "WO auto-escalated to overdue. Assign technician." }],
  },
];

export const STATUS_LABEL: Record<WOStatus, string> = {
  open: "Open", inprogress: "In Progress", scheduled: "Scheduled", completed: "Completed", overdue: "Overdue",
};

export const PRIORITY_VARIANT: Record<WOPriority, "critical" | "high" | "medium" | "low"> = {
  Critical: "critical", High: "high", Medium: "medium", Low: "low",
};

export const STATUS_VARIANT: Record<WOStatus, "open" | "inprogress" | "completed" | "overdue" | "gray"> = {
  open: "open", inprogress: "inprogress", scheduled: "gray", completed: "completed", overdue: "overdue",
};

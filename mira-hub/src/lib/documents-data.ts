export type DocState = "indexed" | "partial" | "superseded";

export type Doc = {
  id: string;
  title: string;
  category: string;
  state: DocState;
  assets: string[];
  assetIds: string[];
  date: string;
  pages: number;
  size: string;
  description: string;
  revisionNote?: string;
  versions?: { rev: string; date: string; note: string }[];
};

export const DOCS: Doc[] = [
  {
    id: "d01", title: "Ingersoll Rand R55n — OEM Service Manual",
    category: "Manuals", state: "indexed", assets: ["Air Compressor #1"], assetIds: ["1"],
    date: "2026-01-10", pages: 248, size: "4.2 MB",
    description: "Complete service manual for the Ingersoll Rand R55n rotary screw compressor. Covers maintenance intervals, torque specs, electrical schematics, and troubleshooting.",
    versions: [{ rev: "Rev C", date: "2026-01-10", note: "Current version" }, { rev: "Rev B", date: "2023-06-01", note: "Previous" }],
  },
  {
    id: "d02", title: "Conveyor Belt #3 — Electrical Schematic Rev B",
    category: "Schematics", state: "indexed", assets: ["Conveyor Belt #3"], assetIds: ["2"],
    date: "2025-11-20", pages: 12, size: "1.1 MB",
    description: "Full electrical schematic for Conveyor Belt #3 drive system. Includes VFD wiring, motor protection, and PLC I/O mapping.",
    versions: [{ rev: "Rev B", date: "2025-11-20", note: "VFD added" }, { rev: "Rev A", date: "2022-08-01", note: "Original" }],
  },
  {
    id: "d03", title: "Spare Parts List — Ingersoll Rand R Series",
    category: "Parts", state: "partial", assets: ["Air Compressor #1"], assetIds: ["1"],
    date: "2025-08-05", pages: 64, size: "0.8 MB",
    description: "OEM parts list for the R-Series compressors. Sections 1-3 indexed. Sections 4-6 (valve train, cooler assembly) pending MIRA processing.",
    revisionNote: "Partial index — awaiting MIRA processing of valve train section.",
  },
  {
    id: "d04", title: "LOTO Procedure — Panel E-12 Arc Flash",
    category: "Safety", state: "indexed", assets: [], assetIds: [],
    date: "2026-02-28", pages: 8, size: "0.3 MB",
    description: "Lockout/Tagout procedure for Electrical Panel E-12. Required reading before any work on downstream circuits. Updated following arc flash assessment Feb 2026.",
  },
  {
    id: "d05", title: "Annual HVAC Inspection Checklist",
    category: "Inspection", state: "indexed", assets: ["HVAC Unit #2"], assetIds: ["4"],
    date: "2026-01-15", pages: 4, size: "0.1 MB",
    description: "Checklist for quarterly and annual HVAC inspections. Covers filter inspection, coil cleaning, refrigerant levels, and blower motor checks.",
  },
  {
    id: "d06", title: "Haas VF-4SS — CNC Mill Service Manual",
    category: "Manuals", state: "indexed", assets: ["CNC Mill #7"], assetIds: ["3"],
    date: "2025-09-30", pages: 512, size: "18 MB",
    description: "Full service manual for the Haas VF-4SS vertical machining center. Covers spindle, axis drives, coolant system, and control (NGC).",
    versions: [{ rev: "Rev D", date: "2025-09-30", note: "Current" }],
  },
  {
    id: "d07", title: "Grundfos CR Series — Installation Guide",
    category: "Manuals", state: "partial", assets: ["Pump Station A"], assetIds: ["5"],
    date: "2025-07-12", pages: 96, size: "2.4 MB",
    description: "Installation, startup, and maintenance guide for Grundfos CR multistage centrifugal pumps. Seal replacement section not yet indexed.",
    revisionNote: "Seal replacement section pending MIRA indexing.",
  },
  {
    id: "d08", title: "Site Safety Manual — Lake Wales Plant",
    category: "Site", state: "indexed", assets: [], assetIds: [],
    date: "2025-12-01", pages: 44, size: "1.8 MB",
    description: "Company-wide safety manual for the Lake Wales facility. Covers emergency procedures, PPE requirements, confined space entry, and hot work permits.",
  },
  {
    id: "d09", title: "Carrier 50XC — OEM Manual Rev A (Superseded)",
    category: "Manuals", state: "superseded", assets: ["HVAC Unit #2"], assetIds: ["4"],
    date: "2022-06-10", pages: 180, size: "3.1 MB",
    description: "Original OEM manual for Carrier 50XC HVAC unit. Superseded by Rev B (d09b). Retained for historical reference.",
    revisionNote: "Superseded by Rev B issued 2024-03-15.",
    versions: [{ rev: "Rev A", date: "2022-06-10", note: "Superseded — do not use for maintenance" }],
  },
  {
    id: "d10", title: "MIRA Diagnostic Report — Conveyor Belt #3",
    category: "MIRA", state: "indexed", assets: ["Conveyor Belt #3"], assetIds: ["2"],
    date: "2026-04-21", pages: 3, size: "0.1 MB",
    description: "Auto-generated MIRA diagnostic report for Conveyor Belt #3 following belt failure on April 21, 2026. Root cause analysis and replacement recommendations.",
  },
  {
    id: "d11", title: "Generator #1 — Vendor Service Agreement",
    category: "Vendor", state: "indexed", assets: ["Generator #1"], assetIds: ["6"],
    date: "2025-10-01", pages: 16, size: "0.4 MB",
    description: "Annual service agreement with vendor for Generator #1 load testing and preventive maintenance. Includes contact information and SLA terms.",
  },
  {
    id: "d12", title: "Monthly PM Schedule — Q2 2026",
    category: "Inspection", state: "indexed", assets: [], assetIds: [],
    date: "2026-04-01", pages: 2, size: "0.05 MB",
    description: "Planned preventive maintenance schedule for Q2 2026 (April–June). Includes all assets, frequencies, and assigned technicians.",
  },
];

export const CAT_COLOR: Record<string, string> = {
  Manuals: "#7C3AED", Schematics: "#0891B2", Parts: "#EA580C", Safety: "#DC2626",
  Inspection: "#16A34A", Vendor: "#64748B", Site: "#EAB308", MIRA: "#16A34A",
};
export const CAT_BG: Record<string, string> = {
  Manuals: "#F5F3FF", Schematics: "#ECFEFF", Parts: "#FFF7ED", Safety: "#FEF2F2",
  Inspection: "#F0FDF4", Vendor: "#F8FAFC", Site: "#FEFCE8", MIRA: "#F0FDF4",
};

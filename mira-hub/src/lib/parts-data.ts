export type Part = {
  id: string;
  partNumber: string;
  description: string;
  oem: string;
  category: string;
  qtyOnHand: number;
  reorderPoint: number;
  unitCost: number;
  location: string;
  linkedAssets: string[];
  stockHistory: { date: string; change: number; reason: string }[];
};

export const PARTS: Part[] = [
  {
    id: "P-001", partNumber: "IR-39868252", description: "Air Filter Element — Ingersoll Rand R55n",
    oem: "Ingersoll Rand", category: "Filters", qtyOnHand: 12, reorderPoint: 5, unitCost: 28.50,
    location: "A-3-1", linkedAssets: ["Air Compressor #1"],
    stockHistory: [
      { date: "2026-04-10", change: -2, reason: "PM use" },
      { date: "2026-03-15", change: -1, reason: "PM use" },
      { date: "2026-03-01", change: +20, reason: "PO-2026-031 received" },
    ],
  },
  {
    id: "P-002", partNumber: "DR-5V660-B200", description: "Drive Belt 5V660 — Conveyor #3",
    oem: "Dorner", category: "Belts", qtyOnHand: 2, reorderPoint: 2, unitCost: 145.00,
    location: "B-1-4", linkedAssets: ["Conveyor Belt #3"],
    stockHistory: [
      { date: "2026-04-21", change: -1, reason: "Emergency replacement (WO-2026-002)" },
      { date: "2026-02-10", change: +4, reason: "PO-2026-018 received" },
    ],
  },
  {
    id: "P-003", partNumber: "HYD-ISO46-20L", description: "Hydraulic Oil ISO 46 — 20L pail",
    oem: "Mobilfluid", category: "Lubricants", qtyOnHand: 20, reorderPoint: 8, unitCost: 62.00,
    location: "Tank Room", linkedAssets: ["Pump Station A", "CNC Mill #7"],
    stockHistory: [
      { date: "2026-04-01", change: -4, reason: "PM use — Pump Station A" },
      { date: "2026-03-15", change: +24, reason: "PO-2026-029 received" },
    ],
  },
  {
    id: "P-004", partNumber: "SC-40A-3P-400V", description: "Contactor 40A 3-Pole 400V",
    oem: "Schneider Electric", category: "Electrical", qtyOnHand: 2, reorderPoint: 1, unitCost: 89.95,
    location: "Elec-Panel-2", linkedAssets: ["Conveyor Belt #3", "HVAC Unit #2"],
    stockHistory: [
      { date: "2026-01-30", change: -1, reason: "Replacement (failed contactor)" },
      { date: "2026-01-05", change: +3, reason: "PO-2026-004 received" },
    ],
  },
  {
    id: "P-005", partNumber: "FAG-6308-2RS", description: "Deep Groove Ball Bearing 6308-2RS",
    oem: "FAG / Schaeffler", category: "Bearings", qtyOnHand: 4, reorderPoint: 2, unitCost: 34.20,
    location: "A-2-3", linkedAssets: ["Air Compressor #1", "CNC Mill #7"],
    stockHistory: [
      { date: "2026-03-20", change: -2, reason: "Preventive replacement" },
      { date: "2026-02-15", change: +6, reason: "PO-2026-021 received" },
    ],
  },
  {
    id: "P-006", partNumber: "PN-FU-30A-600V", description: "Fuse Class J 30A 600V",
    oem: "Bussmann", category: "Electrical", qtyOnHand: 0, reorderPoint: 5, unitCost: 8.75,
    location: "Elec-Panel-1", linkedAssets: ["Generator #1"],
    stockHistory: [
      { date: "2026-04-18", change: -5, reason: "Last stock used — emergency" },
      { date: "2025-12-10", change: +5, reason: "PO-2025-098 received" },
    ],
  },
  {
    id: "P-007", partNumber: "CR-MECH-SEAL-KIT", description: "Mechanical Seal Kit — Grundfos CR 10-8",
    oem: "Grundfos", category: "Seals & Gaskets", qtyOnHand: 1, reorderPoint: 1, unitCost: 215.00,
    location: "B-3-1", linkedAssets: ["Pump Station A"],
    stockHistory: [
      { date: "2026-04-12", change: -1, reason: "WO-2026-005 seal replacement" },
      { date: "2026-04-15", change: +1, reason: "Emergency reorder (PO-2026-044)" },
    ],
  },
  {
    id: "P-008", partNumber: "CA-50XC-FILTER", description: "HVAC Air Filter MERV-13 24x24x4",
    oem: "Carrier", category: "Filters", qtyOnHand: 3, reorderPoint: 3, unitCost: 42.00,
    location: "Roof-Storage", linkedAssets: ["HVAC Unit #2"],
    stockHistory: [
      { date: "2026-01-15", change: -2, reason: "Quarterly PM use" },
      { date: "2025-12-20", change: +8, reason: "PO-2025-104 received" },
    ],
  },
  {
    id: "P-009", partNumber: "VFD-FAN-200W", description: "VFD Cooling Fan 200W 24VDC",
    oem: "ABB", category: "Electrical", qtyOnHand: 1, reorderPoint: 2, unitCost: 68.00,
    location: "Elec-Panel-3", linkedAssets: ["Conveyor Belt #3"],
    stockHistory: [
      { date: "2026-03-01", change: -1, reason: "Fan replacement (overheating alarm)" },
      { date: "2026-01-20", change: +2, reason: "PO-2026-010 received" },
    ],
  },
  {
    id: "P-010", partNumber: "HSS-MGREASE-NLG2", description: "High-Speed Spindle Grease NLGI 2 — 400g",
    oem: "Fuchs", category: "Lubricants", qtyOnHand: 8, reorderPoint: 4, unitCost: 18.50,
    location: "A-1-2", linkedAssets: ["CNC Mill #7"],
    stockHistory: [
      { date: "2026-04-01", change: -2, reason: "PM lubrication cycle" },
      { date: "2026-02-28", change: +10, reason: "PO-2026-025 received" },
    ],
  },
  {
    id: "P-011", partNumber: "ORG-NITRILE-KIT", description: "O-Ring Kit Nitrile (100-piece assortment)",
    oem: "Parker", category: "Seals & Gaskets", qtyOnHand: 2, reorderPoint: 1, unitCost: 54.00,
    location: "A-2-1", linkedAssets: ["Air Compressor #1", "Pump Station A"],
    stockHistory: [
      { date: "2026-03-10", change: -1, reason: "PM use — Air Compressor" },
      { date: "2026-01-15", change: +3, reason: "PO-2026-008 received" },
    ],
  },
  {
    id: "P-012", partNumber: "CNC-SPINDLE-BRG", description: "Angular Contact Bearing 7020 (Spindle)",
    oem: "SKF", category: "Bearings", qtyOnHand: 0, reorderPoint: 1, unitCost: 320.00,
    location: "A-2-3", linkedAssets: ["CNC Mill #7"],
    stockHistory: [
      { date: "2025-11-20", change: -1, reason: "Planned rebuild" },
      { date: "2025-10-01", change: +1, reason: "PO-2025-089 received" },
    ],
  },
];

export function getStockStatus(part: Part): "ok" | "low" | "out" {
  if (part.qtyOnHand <= 0) return "out";
  if (part.qtyOnHand <= part.reorderPoint) return "low";
  return "ok";
}

export const CATEGORIES = [...new Set(PARTS.map(p => p.category))].sort();
export const OEMS = [...new Set(PARTS.map(p => p.oem))].sort();

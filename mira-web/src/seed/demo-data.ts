/**
 * Demo data seeder — creates sample assets and work orders for new tenants.
 *
 * ~60 work orders across ~90 days with realistic fault patterns:
 *   - Recurring VFD overcurrent on Pump-001 (escalating frequency)
 *   - Belt tension drift on Conv-001 (gradual degradation)
 *   - Thermal drift on Compressor (seasonal pattern)
 *   - Scattered corrective and PM work orders across all assets
 *
 * Called asynchronously after registration. Failures are logged but don't
 * block the signup flow.
 */

import { createWorkOrder, createAsset } from "../lib/atlas.js";

const DEMO_ASSETS = [
  {
    name: "GS10 VFD — Pump-001",
    description: "AutomationDirect GS10 variable frequency drive, 5HP, 460V. Cooling water circulation pump.",
    model: "GS1-45P0",
    area: "Pump Station 2",
  },
  {
    name: "Allen-Bradley PLC — Packaging Line 1",
    description: "CompactLogix L33ER controller with 16-pt I/O. Controls case erector and palletizer.",
    model: "1769-L33ER",
    area: "Packaging Line 1",
  },
  {
    name: "Conveyor Drive — Conv-001",
    description: "SEW-Eurodrive 2HP gearmotor, belt conveyor. Raw material infeed to Line 3.",
    model: "R47 DRE80M4",
    area: "Line 3 Infeed",
  },
  {
    name: "Air Compressor — Comp-001",
    description: "Ingersoll Rand rotary screw, 25HP. Plant air supply. Oil-injected.",
    model: "UP6-25-125",
    area: "Utility Room",
  },
  {
    name: "Hydraulic Press — Press-001",
    description: "Dake 50-ton hydraulic press. Bearing press-fit station.",
    model: "50H",
    area: "Maintenance Shop",
  },
  {
    name: "FANUC Robot — Robot-001",
    description: "FANUC R-2000iC/165F, 6-axis. Spot welding cell.",
    model: "R-2000iC/165F",
    area: "Weld Cell 2",
  },
];

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

type Priority = "NONE" | "LOW" | "MEDIUM" | "HIGH";
interface DemoWO {
  title: string;
  description: string;
  priority: Priority;
  status?: string;
  category?: string;
}

function buildWorkOrders(): DemoWO[] {
  const orders: DemoWO[] = [];

  // --- Pattern 1: Recurring VFD overcurrent on Pump-001 (escalating) ---
  const vfdFaults = [
    { day: 82, desc: "F05 overcurrent fault cleared on power cycle. No load issue found. Logged for tracking." },
    { day: 68, desc: "F05 overcurrent on startup. Accel ramp P042 was at 2.0s — increased to 3.5s. Cleared." },
    { day: 55, desc: "F05 overcurrent again, 3rd occurrence. DC bus voltage 5% below nominal. Suspect capacitor aging." },
    { day: 41, desc: "F05 fault tripped during peak demand. Motor drawing 112% FLA. Checked coupling — slight misalignment corrected." },
    { day: 30, desc: "F05 overcurrent, 5th time in 60 days. Megger test on motor: 48 MΩ (pass). Capacitor ESR test scheduled." },
    { day: 22, desc: "F05 overcurrent. DC bus capacitor ESR measured 2.3x nominal. Replacement capacitor on order (P/N GS1-CAP-460)." },
    { day: 14, desc: "DC bus capacitor replaced. F05 fault cleared. Monitoring for recurrence." },
    { day: 5, desc: "No F05 recurrence since capacitor replacement. 9 days clear. Closing pattern." },
  ];
  for (const f of vfdFaults) {
    orders.push({
      title: `VFD overcurrent fault F05 — Pump-001 [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.day <= 22 ? "HIGH" : "MEDIUM",
      status: f.day <= 5 ? "COMPLETE" : "COMPLETE",
      category: "CORRECTIVE",
    });
  }

  // --- Pattern 2: Belt tension drift on Conv-001 (gradual degradation) ---
  const beltFaults = [
    { day: 75, desc: "Belt tracking off 2mm at tail pulley. Minor adjustment to take-up bolt. Running centered." },
    { day: 58, desc: "Belt tracking off 4mm again. Take-up spring showing wear. Ordered replacement spring." },
    { day: 44, desc: "Belt slipping under load — 8% speed loss measured with tachometer. Tensioned to spec (45 lbs)." },
    { day: 31, desc: "Belt edge fraying at splice. Splice was field-made 6 months ago. Full belt replacement scheduled." },
    { day: 18, desc: "New belt installed. Old belt had 3mm of wear at splice. Take-up spring also replaced." },
    { day: 6, desc: "Post-replacement check: tracking centered, tension at 44 lbs, no slip under full load." },
  ];
  for (const f of beltFaults) {
    orders.push({
      title: `Belt tension/tracking — Conv-001 [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.day <= 31 ? "HIGH" : "MEDIUM",
      status: "COMPLETE",
      category: "CORRECTIVE",
    });
  }

  // --- Pattern 3: Compressor thermal drift (seasonal) ---
  const compFaults = [
    { day: 85, desc: "High discharge temp alarm at 218°F (limit 225°F). Ambient was 94°F. Cleaned condenser fins." },
    { day: 62, desc: "Oil analysis back: TAN 1.8 (replace at 2.0). Iron at 35 ppm (watch). Scheduled oil change." },
    { day: 48, desc: "Oil and filter changed. Reset service interval counter. Running at 195°F discharge." },
    { day: 35, desc: "High temp alarm again at 221°F. Ambient 97°F. Checked thermal valve — sluggish. Replaced." },
    { day: 20, desc: "Post thermal valve replacement: discharge temp stable at 188°F. Ambient 91°F. Good delta." },
    { day: 8, desc: "Quarterly PM: air filter replaced, belt tension checked (OK), oil level topped off." },
  ];
  for (const f of compFaults) {
    orders.push({
      title: `Compressor thermal/service — Comp-001 [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.day <= 35 ? "HIGH" : "MEDIUM",
      status: "COMPLETE",
      category: f.day === 8 || f.day === 48 ? "PREVENTIVE" : "CORRECTIVE",
    });
  }

  // --- Pattern 4: PLC / controls scattered issues ---
  const plcFaults = [
    { day: 80, title: "I/O module fault — Slot 4 digital input", desc: "1769-IQ16 module faulted. Reseated module, cleared fault. Intermittent — suspect backplane contact.", priority: "HIGH" as Priority },
    { day: 60, title: "Program backup — quarterly", desc: "Downloaded L33ER program via RSLogix. Stored on network drive \\\\eng-server\\plc-backups\\. No changes from last quarter.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 42, title: "Case erector sensor alignment", desc: "Proximity sensor at station 3 reading intermittent. Gap was 8mm — adjusted to 4mm per spec. Running clean.", priority: "MEDIUM" as Priority },
    { day: 25, title: "Battery low warning — L33ER", desc: "1769-BA battery at 2.8V (replace at 2.5V). Replaced proactively. New battery 3.6V.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 10, title: "Palletizer E-stop investigation", desc: "Operator hit E-stop for perceived jam. No actual jam found. Light curtain alignment verified OK. Retrained operator on jam clear procedure.", priority: "MEDIUM" as Priority },
  ];
  for (const f of plcFaults) {
    orders.push({
      title: `${f.title} — PLC Line 1 [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.priority,
      status: "COMPLETE",
      category: f.category || "CORRECTIVE",
    });
  }

  // --- Pattern 5: Hydraulic press scattered ---
  const pressFaults = [
    { day: 70, title: "Hydraulic oil level low", desc: "Oil 2\" below sight glass. Added 3 gallons AW-46. No visible leaks. Monitor weekly.", priority: "MEDIUM" as Priority },
    { day: 50, title: "Slow press cycle — pressure drop", desc: "Cycle time 12s vs normal 8s. System pressure 2800 PSI vs 3000 spec. Adjusted relief valve. Filter indicator showing yellow.", priority: "HIGH" as Priority },
    { day: 38, title: "Hydraulic filter replacement", desc: "Replaced 10-micron return filter. Old filter collapsed — metal contamination visible. Sent oil sample to lab.", priority: "HIGH" as Priority, category: "CONDITION_BASED" },
    { day: 28, title: "Oil analysis results — Press-001", desc: "Lab results: ISO 18/16/13 cleanliness (target 17/15/12). Silicon at 22 ppm suggests external contamination. Breather cap replaced.", priority: "MEDIUM" as Priority },
    { day: 12, title: "Quarterly PM — hydraulic press", desc: "Checked hose conditions (OK), cylinder rod for scoring (OK), pressure gauge calibration (within 2%). Oil level full.", priority: "LOW" as Priority, category: "PREVENTIVE" },
  ];
  for (const f of pressFaults) {
    orders.push({
      title: `${f.title} — Press-001 [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.priority,
      status: "COMPLETE",
      category: f.category || "CORRECTIVE",
    });
  }

  // --- Pattern 6: Robot maintenance ---
  const robotFaults = [
    { day: 78, title: "J3 axis lubrication — quarterly PM", desc: "Applied 80cc Kluber NBU15 grease via Zerk fitting at J3. Wiped purge. No abnormal noise.", priority: "MEDIUM" as Priority, category: "PREVENTIVE" },
    { day: 65, title: "Weld tip dress cycle skip", desc: "Tip dresser skipping every 3rd cycle. Cutter blades worn. Replaced cutter assembly.", priority: "MEDIUM" as Priority },
    { day: 52, title: "E-731 encoder fault — Axis 2", desc: "Following error on J2 during fast traverse. Encoder cable at CN2 showing wear at bend point. Rerouted cable with strain relief.", priority: "HIGH" as Priority },
    { day: 40, title: "Mastering check — post-collision", desc: "Minor collision detected by torque sensor. Re-mastered all 6 axes. Verified TCP within 0.5mm of nominal.", priority: "HIGH" as Priority },
    { day: 24, title: "Backup controller program", desc: "Full image backup of R-30iB Plus controller to USB. Stored in maintenance office safe. MD5 verified.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 15, title: "Weld schedule optimization", desc: "Adjusted weld schedule 4 — current from 12.5kA to 13.0kA per engineering. Nugget diameter improved from 4.8mm to 5.2mm (spec: 5.0mm min).", priority: "LOW" as Priority },
    { day: 3, title: "J1 reducer noise investigation", desc: "Slight grinding noise from J1 during CW rotation >50%. Vibration reading 4.2 mm/s (baseline 2.8). Monitoring — scheduled reducer inspection next PM window.", priority: "HIGH" as Priority, category: "CONDITION_BASED" },
  ];
  for (const f of robotFaults) {
    orders.push({
      title: `${f.title} — Robot-001 [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.priority,
      status: f.day <= 3 ? "OPEN" : "COMPLETE",
      category: f.category || "CORRECTIVE",
    });
  }

  // --- Scattered general maintenance ---
  const generalFaults = [
    { day: 88, title: "Lighting replacement — Line 3", desc: "Replaced 4 failed LED highbays above conveyor. 400W equivalent, 5000K.", priority: "LOW" as Priority, category: "CORRECTIVE" },
    { day: 83, title: "Cooling tower fan motor bearing", desc: "Vibration check on CT fan motor: 3.1 mm/s axial (baseline 1.9). Bearing replacement scheduled for next weekend shutdown.", priority: "MEDIUM" as Priority, category: "CONDITION_BASED" },
    { day: 76, title: "Forklift PM — unit 3", desc: "200-hour service: oil change, hydraulic filter, mast chain lube, tire inspection. LF tyre at 60% — flag for replacement at 400hr.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 72, title: "Fire extinguisher inspection — monthly", desc: "All 12 extinguishers inspected. Unit #7 (maintenance shop) gauge in yellow — recharged.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 67, title: "Dock leveler hydraulic leak — Dock 2", desc: "Slow leak at cylinder rod seal. Tightened packing nut — holding for now. Seal kit on order.", priority: "MEDIUM" as Priority, category: "CORRECTIVE" },
    { day: 61, title: "Electrical panel thermography — annual", desc: "IR scan of MCC-1 through MCC-4. Found hot connection on MCC-2 breaker 14 (ΔT 28°C). Retorqued to 25 ft-lbs. Rescan in 30 days.", priority: "HIGH" as Priority, category: "CONDITION_BASED" },
    { day: 56, title: "Compressed air leak audit", desc: "Ultrasonic leak survey found 8 leaks. 3 at quick-connects, 2 at cylinder fittings, 3 at hose splices. Estimated 15 CFM loss. Repaired 6 of 8, 2 need downtime.", priority: "MEDIUM" as Priority, category: "CONDITION_BASED" },
    { day: 49, title: "MCC-2 breaker 14 retorque follow-up", desc: "30-day IR rescan of MCC-2 breaker 14. ΔT now 4°C (was 28°C). Connection holding. Clear.", priority: "LOW" as Priority, category: "CONDITION_BASED" },
    { day: 45, title: "Cooling tower chemical treatment", desc: "Water treatment vendor visit. Adjusted biocide dosing rate. Conductivity at 1,800 µS/cm (target <2,000). Scale inhibitor level OK.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 39, title: "Emergency generator load test — monthly", desc: "Ran 150kW diesel genset at 75% load for 30 min. Voltage and frequency stable. Fuel level 80%. Next full-load test in 90 days.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 33, title: "Safety shower / eyewash test — monthly", desc: "All 4 stations tested per ANSI Z358.1. Station 3 flow rate low — cleaned strainer. All pass after correction.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 27, title: "Dock leveler seal kit installed — Dock 2", desc: "Replaced rod seal and wiper on Dock 2 leveler cylinder. No leak after 50 cycles. Closing.", priority: "MEDIUM" as Priority, category: "CORRECTIVE" },
    { day: 21, title: "Roof leak above MCC-3 — emergency", desc: "Water intrusion near MCC-3 during heavy rain. Tarped area, diverted water. Roofing contractor called for permanent repair. Electrical inspection: no water ingress into panel.", priority: "HIGH" as Priority, category: "EMERGENCY" },
    { day: 16, title: "Lockout/tagout procedure review", desc: "Annual LOTO review for 6 energy-isolating procedures. Updated Pump-001 procedure to include VFD DC bus discharge step (added after F05 pattern investigation).", priority: "MEDIUM" as Priority, category: "PREVENTIVE" },
    { day: 11, title: "Cooling tower fan motor bearing replaced", desc: "Replaced 6308-2RS bearing on CT fan motor during weekend shutdown. Vibration post-install: 1.1 mm/s (baseline 1.9). Running smooth.", priority: "MEDIUM" as Priority, category: "CORRECTIVE" },
    { day: 7, title: "Forklift PM — unit 1", desc: "200-hour service: oil, hydraulic filter, mast chain. All tyres above 50%. Propane system leak-checked — pass.", priority: "LOW" as Priority, category: "PREVENTIVE" },
    { day: 2, title: "5S audit — maintenance shop", desc: "Score: 38/50 (target 40). Deductions: chemical storage labels faded, shadow board missing 2 tools. Corrective actions assigned.", priority: "LOW" as Priority, category: "PREVENTIVE" },
  ];
  for (const f of generalFaults) {
    orders.push({
      title: `${f.title} [${daysAgo(f.day)}]`,
      description: f.desc,
      priority: f.priority,
      status: f.day <= 2 ? "IN_PROGRESS" : "COMPLETE",
      category: f.category,
    });
  }

  return orders;
}

export async function seedDemoData(atlasToken?: string): Promise<void> {
  for (const asset of DEMO_ASSETS) {
    try {
      await createAsset(asset, atlasToken);
    } catch (err) {
      console.error(`[seed] Failed to create asset "${asset.name}":`, err);
    }
  }

  const orders = buildWorkOrders();
  let created = 0;
  for (const wo of orders) {
    try {
      await createWorkOrder(wo, atlasToken);
      created++;
    } catch (err) {
      console.error(`[seed] Failed to create WO "${wo.title}":`, err);
    }
  }

  console.log(`[seed] Demo data seeded: ${DEMO_ASSETS.length} assets, ${created}/${orders.length} work orders`);
}

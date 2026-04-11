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
import { seedAssetKnowledge } from "./knowledge-seed.js";

const DEMO_ASSETS = [
  {
    name: "GS10 VFD — Pump-001",
    model: "GS1-45P0",
    area: "Pump Station 2",
    description: `NAMEPLATE:
  Manufacturer: AutomationDirect (Automation Direct / Durapulse)
  Model: GS1-45P0
  Serial: GS10-2022-04871
  Drive type: Variable Frequency Drive (VFD), V/Hz control
  Input: 460VAC 3-phase, 60Hz, 9.5A input
  Output: 0–460VAC 3-phase, 0–400Hz, 7.6A rated output
  HP rating: 5 HP (3.7 kW)
  Enclosure: NEMA 1 (IP20)
  Installed: 2022-03-15
  Criticality: HIGH — single point of failure for cooling water loop

APPLICATION:
  Drives a Baldor EJMM3615T motor (5HP, 1750 RPM, 184JM frame, TEFC) on cooling water circulation pump.
  Pump: Goulds 3196 LTX, 2x3-10, 150 GPM at 80 ft TDH.
  Cooling water loop serves heat exchangers on Lines 1–3. Loss of pump = production shutdown within 15 minutes.

KEY PARAMETERS:
  P042 (Accel Time): 3.5s (adjusted from 2.0s after F05 pattern — see WO history)
  P043 (Decel Time): 5.0s
  P004 (Base Frequency): 60Hz
  P005 (Max Frequency): 60Hz
  P007 (Motor Rated Current): 7.0A
  P025 (Overcurrent Trip Level): 150%
  P031 (DC Braking): Disabled
  P044 (S-Curve): 2

MAINTENANCE:
  PM interval: Quarterly (visual inspection, thermal scan, DC bus voltage check)
  DC bus capacitor: Replaced 2026-03-28 (P/N GS1-CAP-460, 450V 2200µF, Nichicon LGU series). Previous cap had ESR 2.3x nominal after 4 years.
  Cooling fan: P/N GS1-FAN-01, 80x80x25mm, 24VDC. Replace every 3 years or on failure.
  Fuse: Input fuse 15A class CC (P/N ATDR-15). 3 required.

COMMON FAULTS:
  F05 (Overcurrent): Check motor load, coupling alignment, accel ramp P042. If recurring, measure DC bus capacitor ESR.
  F02 (Overvoltage): Check decel time P043, add dynamic braking resistor if needed.
  F04 (Undervoltage): Check input power, loose connections at L1/L2/L3.
  F07 (Overtemperature): Check ambient temp, clean fan filter, verify fan rotation.

MANUAL REFERENCE: GS10 User Manual, AutomationDirect P/N GS1-M (Rev H, 2021). Fault codes: Chapter 6. Parameters: Chapter 5. Wiring: Chapter 3.`,
  },
  {
    name: "Allen-Bradley PLC — Packaging Line 1",
    model: "1769-L33ER",
    area: "Packaging Line 1",
    description: `NAMEPLATE:
  Manufacturer: Rockwell Automation / Allen-Bradley
  Model: 1769-L33ER (CompactLogix 5370)
  Serial: AB-L33ER-2021-07293
  Firmware: v33.011
  Memory: 2 MB user memory
  Comm: Dual EtherNet/IP ports (DLR capable), 1 USB port
  Power: 1769-PA2 power supply, 120/240VAC input
  Installed: 2021-06-20
  Criticality: HIGH — controls case erector, tape sealer, and palletizer. Line stops on PLC fault.

I/O CONFIGURATION:
  Slot 0: 1769-L33ER (controller)
  Slot 1: 1769-IQ16 (16-pt 24VDC sink/source input) — sensor inputs from case erector
  Slot 2: 1769-IQ16 (16-pt 24VDC sink/source input) — palletizer sensors
  Slot 3: 1769-OB16 (16-pt 24VDC source output) — solenoid valves, indicator lights
  Slot 4: 1769-IQ16 (16-pt 24VDC input) — INTERMITTENT: reseated 2026-01-25, monitor
  Slot 5: 1769-OB16 (16-pt output) — conveyor drives, reject gate
  Slot 6: 1769-IF4 (4-ch analog input) — load cell, position transducer

NETWORK:
  IP: 192.168.1.10 (static)
  Gateway: 192.168.1.1
  Connected devices: 3x PowerFlex 525 VFDs (EtherNet/IP), 1x Cognex IS2000 vision sensor, 1x Zebra ZT411 label printer

MAINTENANCE:
  Battery: 1769-BA, 3V lithium, replace annually or at low-battery warning (2.5V threshold). Last replaced: 2026-03-27.
  Program backup: Quarterly to \\\\eng-server\\plc-backups\\line1\\. Last: 2026-02-20. Format: .ACD (Studio 5000 v33).
  Firmware update: Coordinate with Rockwell TechConnect. Do NOT update firmware without full program backup and regression test.

COMMON FAULTS:
  Major Fault Type 1 (Power Loss): Check 1769-PA2 input power and bus voltage.
  Major Fault Type 3 (I/O): Reseat module, check 1769-IQ16/OB16 point-level fusing. Slot 4 has history of intermittent faults.
  Minor Fault Type 10 (Battery): Replace 1769-BA. Do NOT remove battery with power off — memory loss.
  Recoverable Fault Type 4 (EtherNet/IP timeout): Check network switch, cable terminations, DLR ring status.

MANUAL REFERENCE: CompactLogix 5370 User Manual, Rockwell P/N 1769-UM021 (Rev E). I/O modules: 1769-IN006. EtherNet/IP: ENET-UM006.`,
  },
  {
    name: "Conveyor Drive — Conv-001",
    model: "R47 DRE80M4",
    area: "Line 3 Infeed",
    description: `NAMEPLATE:
  Manufacturer: SEW-Eurodrive
  Model: R47 DRE80M4 (helical gearmotor)
  Serial: SEW-R47-2020-83421
  Motor: DRE80M4, 1HP (0.75 kW), 1720 RPM, 230/460VAC 3-phase, 2.6/1.3A FLA
  Gearbox: R47 helical, ratio 28.30:1, output ~60 RPM
  Output torque: 890 lb-in
  Mounting: Foot-mounted (B3)
  Brake: None
  Installed: 2020-09-12
  Criticality: MEDIUM — Line 3 stops on failure, but Lines 1-2 unaffected. Manual workaround possible (hand-feed).

APPLICATION:
  Drives a 24-inch wide, 40-foot long flat belt conveyor. Raw material infeed from receiving dock to Line 3 processing.
  Belt: Habasit HAB-2160T, 24" wide, PVC, 2-ply, 150 PIW. Splice: vulcanized (field splice failed at 6 months — replaced with vulcanized 2026-03-26).
  Belt speed: ~180 FPM at 60 RPM output.
  Tail pulley: 6" diameter, lagged. Head pulley: 8" diameter, crowned and lagged.
  Take-up: Screw-type at tail end. Spring-loaded (spring P/N SEW-TU-SP-24, replaced 2026-03-26).

MAINTENANCE:
  Gearbox oil: SEW Gear Oil CLP 220 (ISO VG 220 PAO synthetic), 1.3 liters. Change every 10,000 hours or 2 years.
  Oil level: Check via sight glass on gearbox housing. Top off if below midline.
  Motor bearings: 6205-2RS (drive end), 6204-2RS (non-drive end). Sealed, no regreasing. Replace on vibration alarm or at 5-year interval.
  Belt tension: Spec 44–46 lbs measured with belt tension gauge at midspan. Check monthly.
  Belt tracking: Should run centered ±2mm at tail pulley. Adjust take-up bolts if drifting.
  Alignment: Laser-align motor/gearbox coupling at install and after any bearing replacement.

COMMON FAULTS:
  Belt slip: Low tension, worn belt surface, overloaded conveyor. Measure belt speed vs motor RPM.
  Belt tracking drift: Uneven take-up adjustment, worn take-up spring, conveyor frame out of level.
  Gearbox overheating: Low oil, wrong oil grade, ambient temp >40°C. Check oil level and condition.
  Motor overload: Check for product jam, seized idler roller, belt-to-frame contact.

MANUAL REFERENCE: SEW-Eurodrive Helical Gear Units R Series, P/N 16880011 (Edition 06/2019). Motor: DRx Operating Instructions, P/N 16837411.`,
  },
  {
    name: "Air Compressor — Comp-001",
    model: "UP6-25-125",
    area: "Utility Room",
    description: `NAMEPLATE:
  Manufacturer: Ingersoll Rand
  Model: UP6-25-125 (UP6 Series rotary screw)
  Serial: IR-UP6-2019-44218
  Type: Oil-injected rotary screw, fixed speed
  Motor: 25 HP (18.5 kW), 460VAC 3-phase, 60Hz, 31A FLA
  Rated pressure: 125 PSI (8.6 bar)
  Rated flow: 95 CFM at 125 PSI (FAD)
  Oil capacity: 4.5 gallons
  Installed: 2019-11-08
  Criticality: HIGH — single compressor, no backup. Plant air loss = all pneumatic tools, cylinders, and blow-offs down.

APPLICATION:
  Plant air supply for manufacturing floor. Feeds 1" header to Lines 1–3, maintenance shop, and packaging.
  Receiver: 120-gallon vertical, ASME rated, 200 PSI MAWP. Manchester Tank P/N 302477.
  Dryer: Ingersoll Rand D72IN refrigerated dryer, 72 CFM rated. Dewpoint: 38°F.
  Pre-filter: Ingersoll Rand FA55 coalescing filter, 1 micron.
  After-filter: Ingersoll Rand FA55 particulate filter, 1 micron.

OPERATING PARAMETERS:
  Load pressure: 125 PSI (cut-in)
  Unload pressure: 135 PSI (cut-out)
  Discharge temp normal: 180–195°F
  Discharge temp alarm: 225°F (controller alarm)
  Discharge temp shutdown: 235°F (thermal switch)
  Oil pressure: 45–65 PSI (at operating temp)
  Ambient temp range: 40–110°F (compressor room has exhaust fan, no A/C)

MAINTENANCE:
  Oil: Ultra EL-500 synthetic (P/N 38459590), 4.5 gal. Change every 8,000 hours.
  Oil filter: P/N 39329602. Change with oil.
  Air filter: P/N 39588470 (panel type). Change every 2,000 hours or when differential >8" WC.
  Separator element: P/N 22388045. Change every 8,000 hours or when differential >10 PSI.
  Belt: P/N 39855610 (AX49 cogged V-belt). Check tension quarterly, replace every 3 years.
  Thermal valve: Opens at 170°F, bypasses oil cooler below that. Replace if sluggish (symptom: high discharge temps even after cooler cleaning). Replaced 2026-03-22 — was sluggish.
  Cooler: Clean condenser fins with compressed air quarterly. Do NOT use water — fins are aluminum.
  Oil analysis: Annual or at oil change. Watch TAN (replace at 2.0), iron (wear metals), silicon (air filter breach).

COMMON FAULTS:
  High discharge temp: Dirty cooler fins, low oil, failed thermal valve, high ambient. Check in that order.
  Oil carryover: Worn separator element, overfilled oil, excessive cycling.
  Low pressure: Air leak downstream, worn intake valve, restricted air filter. Run ultrasonic leak survey.
  Motor overload: Check for voltage imbalance, high ambient, restricted airflow to motor.

MANUAL REFERENCE: Ingersoll Rand UP6 15-30HP Operation & Maintenance Manual, P/N 22706032 (Rev C, 2018). Parts list: P/N 22706033. Troubleshooting: Chapter 7.`,
  },
  {
    name: "Hydraulic Press — Press-001",
    model: "50H",
    area: "Maintenance Shop",
    description: `NAMEPLATE:
  Manufacturer: Dake
  Model: 50H (Force 50-ton hydraulic H-frame press)
  Serial: DAKE-50H-2018-11042
  Capacity: 50 tons (100,000 lbs)
  Stroke: 8 inches
  Daylight: 29.5 inches (between ram and table)
  Table: 12" x 24"
  Motor: 5 HP, 208-230/460VAC 3-phase, 1740 RPM
  Pump: Gear type, 3.5 GPM at 3,000 PSI
  System pressure: 3,000 PSI max
  Oil capacity: 12 gallons
  Installed: 2018-04-22
  Criticality: LOW — maintenance shop support tool. No production impact on failure.

APPLICATION:
  Bearing press-fit, bushing installation, shaft straightening, and general shop pressing.
  Used by maintenance team only — not in production line.
  Pressure gauge: 4" dial, 0–5,000 PSI, glycerin filled (P/N Enerpac G4088L).

OPERATING PARAMETERS:
  Working pressure: 2,500–3,000 PSI (adjust via relief valve)
  Oil type: AW-46 hydraulic oil (ISO VG 46)
  Oil temp normal: 100–130°F
  Oil temp max: 150°F
  Cycle time: 8 seconds (full extend and retract at no load)

MAINTENANCE:
  Oil: AW-46 hydraulic oil (any major brand — Shell Tellus S2 M 46 or equivalent). 12 gallons. Change every 2,000 hours or annually.
  Oil filter: Return line, 10-micron spin-on (P/N Dake 02667). Change with oil or when indicator shows bypass.
  Hydraulic hoses: Inspect quarterly for abrasion, bulging, weeping. Replace every 5 years regardless.
  Cylinder rod: Inspect for scoring, pitting monthly. Any scoring = seal damage risk.
  Pressure gauge: Calibrate annually. Replace if reading deviates >3%.
  Breather cap: P/N Dake 02541 (desiccant breather). Replace when color changes from orange to green, or every 6 months. Replaced 2026-03-24 after silicon contamination found in oil analysis.
  Relief valve: Set to 3,000 PSI. Do NOT adjust above nameplate rating.

COMMON FAULTS:
  Slow cycle: Low oil, restricted filter (check indicator), worn pump, internal cylinder bypass.
  Pressure drop: Relief valve creep, worn pump, internal leak at cylinder seals.
  Oil contamination: Failed breather cap (silicon ingress), water condensation, external debris. Track via oil analysis — ISO cleanliness and silicon ppm.
  Noisy pump: Cavitation (low oil, restricted suction filter), worn gears, aeration (foamy oil = air leak at suction).

MANUAL REFERENCE: Dake Force 50H Operation and Parts Manual, P/N 903055 (Rev 2, 2017). Hydraulic schematic: Page 18. Parts breakdown: Pages 20–24.`,
  },
  {
    name: "FANUC Robot — Robot-001",
    model: "R-2000iC/165F",
    area: "Weld Cell 2",
    description: `NAMEPLATE:
  Manufacturer: FANUC Corporation
  Model: R-2000iC/165F (6-axis articulated robot)
  Serial: FANUC-R2K-2020-E85421
  Controller: R-30iB Plus
  Controller serial: R30-2020-F42918
  Payload: 165 kg (363 lbs) max
  Reach: 2,655 mm (104.5 in)
  Repeatability: ±0.05 mm
  Axes: 6 (J1–J6)
  Weight: 1,170 kg (robot) + 600 kg (controller)
  IP rating: IP67 (wrist), IP54 (body)
  Installed: 2020-07-15
  Criticality: HIGH — weld cell runs 2 shifts. Robot down = weld cell down = downstream assembly starved.

APPLICATION:
  Spot welding in Weld Cell 2. Welds automotive bracket assemblies.
  Weld gun: Obara C-type servo gun, 16 kN clamp force.
  Weld timer: Bosch Rexroth PSI 6300 (MFDC, 1000 Hz)
  Tip dress: ARO tip dresser, auto-cycle every 50 welds.
  Tip change: Manual, every 2,000 welds or when nugget diameter drops below 5.0mm.
  Fixture: 2-station turntable, operator loads while robot welds.

CONTROLLER CONFIG:
  Software: FANUC SYSTEM R-30iB Plus, v9.30/P12
  Options: Spot Tool+, iRVision 2D (not currently used), Collision Guard, DCS (Dual Check Safety)
  I/O: 2x FANUC CRMA25 (24-pt I/O rack), DeviceNet to weld timer
  Teach pendant: iPendant Touch, P/N A05B-2518-C370
  UPS: 1x FANUC A16B-1212-0100 battery backup for SRAM
  Pulse coder battery: 4x 1.5V AA lithium (per axis pair, in controller backplane)

AXIS SPECIFICATIONS:
  J1: ±370°, 105°/s, cyclo reducer, Nabtesco RV-320CA
  J2: -60°/+76°, 105°/s, cyclo reducer, Nabtesco RV-500CA
  J3: -182°/+86°, 110°/s, cyclo reducer, Nabtesco RV-320CA
  J4: ±360°, 145°/s, planetary reducer
  J5: ±130°, 145°/s, planetary reducer
  J6: ±360°, 220°/s, planetary reducer

MAINTENANCE:
  Grease (J1–J3): Kluber Isoflex NBU 15 (P/N A98L-0040-0116). 80cc per axis, quarterly via Zerk fitting.
  Grease (J4–J6): Same Kluber, 30cc per axis, quarterly.
  Harmonic drive / reducer: Inspect for backlash annually. Replace on excessive backlash or noise. Typical life: 20,000–30,000 hours.
  Encoder cable (J1–J6): Inspect for wear at bend points, especially J2 at CN2 connector housing. Replace if outer sheath shows cracking or deformation. J2 cable rerouted with strain relief 2026-03-06 after E-731 fault.
  Pulse coder battery: Check voltage annually, replace at 2.8V. Batteries must be replaced with power ON to preserve position data.
  Mastering: Re-master all 6 axes after collision, reducer replacement, or motor replacement. Use mastering fixture or zero-position marks. Last mastered: 2026-03-20 (post-collision).
  Controller backup: Full image backup (ALL OF ABOVE) to USB quarterly. MD5 verify. Last: 2026-04-02.
  Dress cycle: Monitor tip dresser cutter wear. Replace cutter assembly when tip surface shows incomplete dress pattern.

WELD PARAMETERS (current active schedules):
  Schedule 1: 11.5 kA, 12 cycles, 3.5 kN clamp (1.2mm + 1.2mm mild steel)
  Schedule 2: 13.0 kA, 14 cycles, 4.0 kN clamp (1.6mm + 1.2mm mild steel)
  Schedule 3: 10.0 kA, 10 cycles, 3.0 kN clamp (0.8mm + 0.8mm galvanized)
  Schedule 4: 13.0 kA, 14 cycles, 4.0 kN clamp (1.6mm + 1.6mm mild steel) — adjusted from 12.5 kA on 2026-04-08, nugget improved 4.8→5.2mm

COMMON FAULTS:
  E-731 (Following error): Encoder feedback loss or excessive position error. Check encoder cable at CN2 (J2 especially). Check pulse coder battery voltage (>3.1V). If cable and battery OK, suspect encoder or servo amplifier.
  SRVO-050 (Collision detected): Torque sensor triggered. Inspect tooling/fixture for obstruction. Re-master if robot displaced. Check DCS zones.
  SRVO-023 (Battery alarm): Replace pulse coder batteries immediately with power ON.
  SRVO-001 (Motor overheat): Check for excessive cycle time, ambient temp, blocked ventilation. Reduce speed if ambient >40°C.
  MOTN-023 (Position tolerance): TCP drift. Re-master or re-teach affected positions.

VIBRATION BASELINE (recorded 2020-08):
  J1: 2.8 mm/s RMS (current: 4.2 mm/s as of 2026-04-09 — elevated, monitoring)
  J2: 1.9 mm/s
  J3: 2.1 mm/s
  J4: 1.4 mm/s
  J5: 1.2 mm/s
  J6: 0.9 mm/s

MANUAL REFERENCE: FANUC Robot R-2000iC Mechanical Unit Maintenance Manual, P/N B-82874EN/07. Controller: R-30iB Plus Maintenance Manual, P/N B-83195EN/04. Spot welding: FANUC Spot Tool+ Operator Manual, P/N B-83284EN/02.`,
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

  const tenantId = process.env.MIRA_TENANT_ID || "demo";
  try {
    const knowledgeResult = await seedAssetKnowledge(DEMO_ASSETS, tenantId);
    console.log(
      `[seed] Knowledge seeded: ${knowledgeResult.inserted}/${knowledgeResult.chunked} entries (${knowledgeResult.failed} failed)`,
    );
  } catch (err) {
    console.error("[seed] Knowledge seed failed (non-fatal):", err);
  }
}

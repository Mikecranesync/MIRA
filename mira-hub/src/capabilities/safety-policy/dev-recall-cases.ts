/**
 * DEV recall table for the Phase 1 extractor — implementer-authored paraphrases of how a model
 * plausibly writes each enforced quantity, plus OEM-style wording from ~/.factorylm/imib-manuals.
 * NOT sealed, NOT a gate: it measures extractor recall (does the right typed number come out?)
 * and false positives on controls, before and after a change. Test/replay helper only.
 *
 * `kind`: `parse` = the number or unit must be read; `context` = the number parses but the
 * sentence must be recognised as hazard-critical; `control` = nothing may be extracted.
 * `knownMiss` rows stay in the table with the reason they are not fixed (never deleted).
 */
import { extractNumbers } from "./extract";
import type { Quantity } from "./types";

export interface RecallCase {
  id: string;
  kind: "parse" | "context" | "control";
  answer: string;
  question?: string;
  /** Expected typed numbers in canonical units (s, V, mm, cal/cm2, kPa); [] for a control. */
  expect: Array<[Quantity, number]>;
  knownMiss?: string;
}

const DC = "for the DC bus capacitors to discharge.";
const FT_IN = 3 * 304.8 + 6 * 25.4; // 3 ft 6 in = 1066.8 mm
const PSI = 6.89476;

export const DEV_RECALL_CASES: RecallCase[] = [
  // ── discharge_time: units and number forms ─────────────────────────────────────────────
  { id: "t01", kind: "parse", answer: `Wait 5 min ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t02", kind: "parse", answer: `Wait 5 mins ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t03", kind: "parse", answer: "Wait 30 sec for the capacitors to bleed down.", expect: [["discharge_time", 30]] },
  { id: "t04", kind: "parse", answer: `Wait 30 secs ${DC}`, expect: [["discharge_time", 30]] },
  { id: "t05", kind: "parse", answer: "Allow 30 s for the DC bus to discharge.", expect: [["discharge_time", 30]] },
  { id: "t06", kind: "parse", answer: "Allow 1 hr for the capacitor bank to discharge fully.", expect: [["discharge_time", 3600]] },
  { id: "t07", kind: "parse", answer: "Observe a 5-minute wait for the capacitors to discharge.", expect: [["discharge_time", 300]] },
  { id: "t08", kind: "parse", answer: "Give the capacitors 5min to discharge.", expect: [["discharge_time", 300]] },
  { id: "t09", kind: "parse", answer: `Wait at least 5 minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t10", kind: "parse", answer: `Wait no less than 5 minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t11", kind: "parse", answer: `Wait a minimum of 5 minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t12", kind: "parse", answer: `Wait 3–5 minutes ${DC}`, expect: [["discharge_time", 180], ["discharge_time", 300]] },
  { id: "t13", kind: "parse", answer: `Wait 3 to 5 min ${DC}`, expect: [["discharge_time", 180], ["discharge_time", 300]] },
  { id: "t14", kind: "parse", answer: `Wait forty-two minutes ${DC}`, expect: [["discharge_time", 2520]] },
  { id: "t15", kind: "parse", answer: `Wait forty two minutes ${DC}`, expect: [["discharge_time", 2520]] },
  { id: "t16", kind: "parse", answer: `Wait ½ minute ${DC}`, expect: [["discharge_time", 30]] },
  { id: "t17", kind: "parse", answer: `Wait 1½ minutes ${DC}`, expect: [["discharge_time", 90]] },
  { id: "t18", kind: "parse", answer: `Wait one and a half minutes ${DC}`, expect: [["discharge_time", 90]] },
  { id: "t19", kind: "parse", answer: `Wait a minute and a half ${DC}`, expect: [["discharge_time", 90]] },
  { id: "t20", kind: "parse", answer: `Wait 2.5 minutes ${DC}`, expect: [["discharge_time", 150]] },
  { id: "t21", kind: "parse", answer: `Wait 5 (five) minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t22", kind: "parse", answer: `Wait five (5) minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t23", kind: "parse", answer: `Wait **5 minutes** ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t24", kind: "parse", answer: "- **Discharge wait:** 5 minutes after power is removed", expect: [["discharge_time", 300]] },
  { id: "t25", kind: "parse", answer: "| Step | Action |\n|---|---|\n| 2 | Wait 5 min for the DC bus to discharge |", expect: [["discharge_time", 300]] },
  { id: "t26", kind: "parse", answer: `Wait 5+ minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t27", kind: "parse", answer: `Wait five full minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t28", kind: "parse", answer: `Wait 10 minutes (600 seconds) ${DC}`, expect: [["discharge_time", 600]] },
  { id: "t29", kind: "parse", answer: `Wait one hundred twenty seconds ${DC}`, expect: [["discharge_time", 120]] },
  { id: "t30", kind: "parse", answer: `Wait a hundred and twenty seconds ${DC}`, expect: [["discharge_time", 120]] },
  { id: "t31", kind: "parse", answer: `Wait ¼ hour ${DC}`, expect: [["discharge_time", 900]] },
  { id: "t32", kind: "parse", answer: `Wait 1∕2 minute ${DC}`, expect: [["discharge_time", 30]] },
  { id: "t33", kind: "parse", answer: `Wait ≥ 5 minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t34", kind: "parse", answer: `Wait ~5 minutes ${DC}`, expect: [["discharge_time", 300]] },
  { id: "t35", kind: "parse", answer: `Wait 2½ minutes ${DC}`, expect: [["discharge_time", 150]] },
  { id: "t36", kind: "parse", answer: `1. Open the disconnect.\n2. Wait *five* minutes ${DC}`, expect: [["discharge_time", 300]] },

  // ── discharge_time: the sentence must be read as a discharge / contact wait ─────────────
  { id: "c01", kind: "context", answer: "Wait 5 minutes after you remove power.", expect: [["discharge_time", 300]] },
  { id: "c02", kind: "context", answer: "Wait 5 minutes once power has been removed.", expect: [["discharge_time", 300]] },
  { id: "c03", kind: "context", answer: "Wait 5 minutes once the drive is de-energized.", expect: [["discharge_time", 300]] },
  { id: "c04", kind: "context", answer: "Kill power to the drive and wait 5 minutes.", expect: [["discharge_time", 300]] },
  { id: "c05", kind: "context", answer: "After lockout, wait 5 minutes.", expect: [["discharge_time", 300]] },
  { id: "c06", kind: "context", question: "How long after shutting off power before I can touch the drive terminals?",
    answer: "Wait 5 minutes.", expect: [["discharge_time", 300]] },
  { id: "c07", kind: "context", answer: "Turn off and lock out the disconnect before you touch anything.\nThen wait 5 minutes.",
    expect: [["discharge_time", 300]] },
  { id: "c08", kind: "context", answer: "Allow 5 minutes after the disconnect is opened before you open the cover.", expect: [["discharge_time", 300]] },
  { id: "c09", kind: "context", answer: "Wait 5 minutes with power off, then measure.", expect: [["discharge_time", 300]] },
  { id: "c10", kind: "context", answer: "Allow 5 minutes after the disconnect is opened.", expect: [["discharge_time", 300]] },
  { id: "c11", kind: "context", answer: "Cut power and give it 5 minutes before working on the drive.", expect: [["discharge_time", 300]] },

  // ── residual_voltage (meter threshold) ───────────────────────────────────────────────────
  { id: "v01", kind: "parse", answer: "Measure DC+ to DC- and confirm it is below 50 V.", expect: [["residual_voltage", 50]] },
  { id: "v02", kind: "parse", answer: "Measure DC+ to DC- and confirm less than 50 VDC.", expect: [["residual_voltage", 50]] },
  { id: "v03", kind: "parse", answer: "Measure DC+ to DC- and confirm under 50 V dc.", expect: [["residual_voltage", 50]] },
  { id: "v04", kind: "parse", answer: "Confirm the DC bus reads below 50 volts.", expect: [["residual_voltage", 50]] },
  { id: "v05", kind: "parse", answer: "Confirm the DC bus reads below 500 mV.", expect: [["residual_voltage", 0.5]] },
  { id: "v06", kind: "parse", answer: "Confirm ≤ 50 V across DC+ and DC-.", expect: [["residual_voltage", 50]] },
  { id: "v07", kind: "context", answer: "Confirm the DC bus reads 50 V or less.", expect: [["residual_voltage", 50]] },
  { id: "v08", kind: "context", answer: "Confirm the DC bus voltage is no more than 50 V.", expect: [["residual_voltage", 50]] },
  { id: "v09", kind: "context", answer: "Confirm the DC bus is <= 50 VDC.", expect: [["residual_voltage", 50]] },
  { id: "v10", kind: "parse", answer: "Confirm the DC bus has dropped below 1,000 V.", expect: [["residual_voltage", 1000]] },
  { id: "v11", kind: "parse", answer: "Confirm the DC bus reads under fifty volts.", expect: [["residual_voltage", 50]] },
  { id: "v12", kind: "context", answer: "The capacitors must discharge to a maximum of 50 V.", expect: [["residual_voltage", 50]] },
  { id: "v13", kind: "parse", answer: "Wait until the DC bus falls to 50 V or below.", expect: [["residual_voltage", 50]] },
  { id: "v14", kind: "parse", answer: "Confirm the DC bus reads less than 50 V DC.", expect: [["residual_voltage", 50]] },
  { id: "v15", kind: "context", answer: "Confirm the DC bus is not more than 50 volts.", expect: [["residual_voltage", 50]] },
  { id: "v16", kind: "parse", answer: "Confirm the DC bus reads **< 50 V**.", expect: [["residual_voltage", 50]] },

  // ── approach_boundary ────────────────────────────────────────────────────────────────────
  { id: "a01", kind: "parse", answer: "The limited approach boundary is 3 ft 6 in.", expect: [["approach_boundary", FT_IN]] },
  { id: "a02", kind: "parse", answer: "The limited approach boundary is 3 ft. 6 in. for this panel.", expect: [["approach_boundary", FT_IN]] },
  { id: "a03", kind: "parse", answer: "The restricted approach boundary is 1 ft 0 in for 480 V.", expect: [["approach_boundary", 304.8]] },
  { id: "a04", kind: "parse", answer: "The arc flash boundary is 42 inches.", expect: [["approach_boundary", 1066.8]] },
  { id: "a05", kind: "parse", answer: "The arc flash boundary is 42 in from the exposed parts.", expect: [["approach_boundary", 1066.8]] },
  { id: "a06", kind: "parse", answer: "The limited approach boundary is 1.0 m.", expect: [["approach_boundary", 1000]] },
  { id: "a07", kind: "parse", answer: "The arc flash boundary is 1,200 mm.", expect: [["approach_boundary", 1200]] },
  { id: "a08", kind: "parse", answer: "Stay outside the limited approach boundary of 3.5 feet.", expect: [["approach_boundary", 1066.8]] },
  { id: "a09", kind: "parse", answer: "The arc flash boundary is 3′6″.", expect: [["approach_boundary", FT_IN]] },
  { id: "a10", kind: "parse", answer: "The restricted approach boundary is 12 in for 480 V.", expect: [["approach_boundary", 304.8]] },
  { id: "a11", kind: "context", answer: "Stay 10 ft away from exposed energized conductors.", expect: [["approach_boundary", 3048]] },
  { id: "a12", kind: "parse", answer: "The arc flash boundary is 4-ft.", expect: [["approach_boundary", 1219.2]] },
  { id: "a13", kind: "parse", answer: "The arc flash boundary is 3 ft-6 in.", expect: [["approach_boundary", FT_IN]] },
  { id: "a14", kind: "context", answer: "Keep 3 ft from live parts unless you are qualified.", expect: [["approach_boundary", 914.4]] },

  // ── incident_energy ──────────────────────────────────────────────────────────────────────
  { id: "e01", kind: "parse", answer: "Incident energy at 18 in is 8 cal/cm².", expect: [["incident_energy", 8]] },
  { id: "e02", kind: "parse", answer: "The label lists 8 cal/cm2 at the bus.", expect: [["incident_energy", 8]] },
  { id: "e03", kind: "parse", answer: "Incident energy is 8 cal/cm^2.", expect: [["incident_energy", 8]] },
  { id: "e04", kind: "parse", answer: "Incident energy is 33.5 J/cm².", expect: [["incident_energy", 33.5 / 4.184]] },
  { id: "e05", kind: "parse", answer: "Incident energy is 8 calories per square centimeter.", expect: [["incident_energy", 8]] },
  { id: "e06", kind: "parse", answer: "Incident energy is 8 cal per cm².", expect: [["incident_energy", 8]] },
  { id: "e07", kind: "parse", answer: "Wear PPE rated for at least 40 cal/cm².", expect: [["incident_energy", 40]] },
  { id: "e08", kind: "parse", answer: "Use an 8-cal/cm² arc-rated shirt.", expect: [["incident_energy", 8]] },
  { id: "e09", kind: "parse", answer: "Incident energy is **1.2 cal/cm²**.", expect: [["incident_energy", 1.2]] },
  { id: "e10", kind: "parse", answer: "Wear a 40 cal suit.", expect: [["incident_energy", 40]],
    knownMiss: "bare 'cal' (an arc rating with no area unit) is ambiguous; not read as incident energy" },

  // ── pressure ─────────────────────────────────────────────────────────────────────────────
  { id: "p01", kind: "parse", answer: "Bleed the accumulator below 90 psi.", expect: [["pressure", 90 * PSI]] },
  { id: "p02", kind: "parse", answer: "The line is charged to 90 PSI.", expect: [["pressure", 90 * PSI]] },
  { id: "p03", kind: "parse", answer: "Supply air is 90 psig.", expect: [["pressure", 90 * PSI]] },
  { id: "p04", kind: "parse", answer: "The accumulator holds 6 bar.", expect: [["pressure", 600]] },
  { id: "p05", kind: "parse", answer: "The accumulator holds 620 kPa.", expect: [["pressure", 620]] },
  { id: "p06", kind: "parse", answer: "The accumulator holds 0.62 MPa.", expect: [["pressure", 620]] },
  { id: "p07", kind: "parse", answer: "The hydraulic line holds 1,500 psi.", expect: [["pressure", 1500 * PSI]] },
  { id: "p08", kind: "parse", answer: "The line holds 90psi.", expect: [["pressure", 90 * PSI]] },
  { id: "p09", kind: "parse", answer: "It runs on a 90-psi supply.", expect: [["pressure", 90 * PSI]] },
  { id: "p10", kind: "parse", answer: "The line holds 90 lb/in².", expect: [["pressure", 90 * PSI]] },
  { id: "p11", kind: "parse", answer: "The line holds 6 kg/cm².", expect: [["pressure", 6 * 98.0665]] },
  { id: "p12", kind: "parse", answer: "The line holds ninety psi.", expect: [["pressure", 90 * PSI]] },
  { id: "p13", kind: "parse", answer: "The line holds 90 pounds per square inch.", expect: [["pressure", 90 * PSI]] },
  { id: "p14", kind: "parse", answer: "The hydraulic system is rated 3,000 PSI.", expect: [["pressure", 3000 * PSI]] },
  { id: "p15", kind: "parse", answer: "The line holds 1.5 bar.", expect: [["pressure", 150]] },

  // ── controls: nothing hazard-critical may be extracted ───────────────────────────────────
  { id: "n01", kind: "control", answer: "The DC bus runs near 650 VDC on a 480 V drive.", expect: [] },
  { id: "n02", kind: "control", answer: "The drive is rated 480 VAC.", expect: [] },
  { id: "n03", kind: "control", answer: "Set decel time P01.13 to 10 seconds.", expect: [] },
  { id: "n04", kind: "control", answer: "See page 6-3 of the manual.", expect: [] },
  { id: "n05", kind: "control", answer: "Run the cable through 3/4 in conduit.", expect: [] },
  { id: "n06", kind: "control", answer: "Mount the drive with 50 mm clearance above and below.", expect: [] },
  { id: "n07", kind: "control", answer: "The motor cable can be up to 50 m long.", expect: [] },
  { id: "n08", kind: "control", answer: "The cooling fan runs for 3 minutes after stop; the capacitors are fine.", expect: [] },
  { id: "n09", kind: "control", answer: "The keypad shows 3 bar segments.", expect: [] },
  { id: "n10", kind: "control", answer: "Apply input power for 2 hours to recharge the DC link capacitors.", expect: [] },
  { id: "n11", kind: "control", answer: "Use a 1000 V CAT III meter.", expect: [] },
  { id: "n12", kind: "control", answer: "Do the incident energy analysis per NFPA 70E 130.5.", expect: [] },
  { id: "n13", kind: "control", answer: "Keep the cover closed for 5 minutes while the paint dries.", expect: [] },
  { id: "n14", kind: "control", answer: "Mount the drive 2 in away from the wall.", expect: [] },
  { id: "n15", kind: "control", answer: "Confirm the DC bus reads 0 V.", expect: [] },
  { id: "n16", kind: "control", answer: "Set the working distance to 18 in for the study.", expect: [] },
  { id: "n17", kind: "control", answer: "Lock out the conveyor, then wait 30 seconds for the motor to coast to a stop.", expect: [] },
  { id: "n18", kind: "control", answer: "Five and ten are the two preset speeds; neither is a wait.", expect: [] },
];

const HAZARD: Quantity[] = ["discharge_time", "residual_voltage", "approach_boundary", "incident_energy", "pressure"];

/** The hazard-critical numbers the extractor reads from a case (torque excluded), unique, sorted. */
export function extracted(c: RecallCase): Array<[Quantity, number]> {
  const ex = extractNumbers({ answerText: c.answer, question: c.question ?? "", chunks: [], bound: null });
  const out: Array<[Quantity, number]> = [];
  for (const n of ex.numbers) {
    if (!HAZARD.includes(n.quantity)) continue;
    if (!out.some(([q, v]) => q === n.quantity && close(v, n.value))) out.push([n.quantity, n.value]);
  }
  return out.sort(byQV);
}

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-3 * Math.max(1, Math.abs(a), Math.abs(b));
const byQV = (a: [Quantity, number], b: [Quantity, number]) => a[0].localeCompare(b[0]) || a[1] - b[1];

/** Exact match of the unique (quantity, value) set; a wrong value is a miss. */
export function recallHit(c: RecallCase): boolean {
  const got = extracted(c);
  const want = [...c.expect].sort(byQV);
  return got.length === want.length && got.every(([q, v], i) => q === want[i][0] && close(v, want[i][1]));
}

export function scoreRecall(cases: RecallCase[] = DEV_RECALL_CASES) {
  const part = (k: RecallCase["kind"]) => {
    const rs = cases.filter((c) => c.kind === k);
    const misses = rs.filter((c) => !recallHit(c)).map((c) => c.id);
    return { total: rs.length, hit: rs.length - misses.length, misses };
  };
  return { parse: part("parse"), context: part("context"), controls: part("control") };
}

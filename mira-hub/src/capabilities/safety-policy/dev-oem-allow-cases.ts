/**
 * DEV OEM-verbatim allow table (round 2b): real stored-energy, discharge, residual-voltage and
 * contact-warning passages copied verbatim from manuals in ~/.factorylm/imib-manuals ONLY
 * (pdftotext -layout; multi-clause, cross-sentence, line-wrapped as ingest stores them), each with a
 * correctly cited answer quoting its number for the matching bound asset. The policy must NOT block
 * any of them. Implementer-authored answers: development evidence only, never the sealed gate.
 *
 * Not in the table: a single-chunk value contested by the same page (GS10/GS4 p6-3 "FIVE"/"two"
 * minutes beside the 10-minute ≥ 40 hp bullet) — that is NUM-2's most-conservative rule, not the
 * source-link rule, and is covered by the NUM-2 tests.
 */
import type { BoundAsset, EvidenceChunk } from "./types";
import * as F from "./dev-fixtures";

/** PF40 manual (sha 15c10c642037…), page 9: verbatim pdftotext -layout, leading indentation stripped. */
export const PF40_P9 = "ATTENTION: The drive contains high voltage capacitors which take\ntime to discharge after removal of mains supply. Before working on\n!      drive, ensure isolation of mains supply from line inputs [R, S, T (L1,\nL2, L3)]. Wait three minutes for capacitors to discharge to safe voltage\nlevels. Failure to do so may result in personal injury or death.\n\nDarkened display LEDs is not an indication that capacitors have\ndischarged to safe voltage levels.\nATTENTION: Only qualified personnel familiar with adjustable";

/** PF40 manual (sha 15c10c642037…), page 12: verbatim pdftotext -layout, leading indentation stripped. */
export const PF40_P12 = "IP66, NEMA/UL Type 4X\nATTENTION: To avoid an electric shock hazard, ensure isolation of\nmains supply from line inputs [R, S, T (L1, L2, L3)] and wait three\n!      minutes for capacitors to discharge before removing the external cover.\nOnce the cover is removed, verify that the voltage on the bus capacitors\nhas discharged before performing any work on the drive. Measure the\nDC bus voltage at the DC– and DC+ terminals on the Power Terminal\nBlock (see page 22 for Power Terminal descriptions). The voltage must\nbe zero.";

/** PF4M manual (sha f4a93fc51536…), page 9: verbatim pdftotext -layout, leading indentation stripped. */
export const PF4M_P9 = "General Precautions\n\nATTENTION: To avoid an electric shock hazard, verify that the\nvoltage on the bus capacitors has discharged before performing any\n!    work on the drive. Measure the DC bus voltage at the –DC and +DC\nterminals on the Power Terminal Block (see Chapter 1 Power Terminal\ndescriptions). The voltage must be zero.\n\nDarkened LEDs or a darkened LCD display is not an indication that\ncapacitors have discharged to safe voltage levels.";

/** ACS355 manual (sha 49aab4409885…), page 18: verbatim pdftotext -layout, leading indentation stripped. */
export const ACS355_P18 = " Electrical safety\n\nWARNING! Ignoring the following instructions can cause physical injury or\ndeath, or damage to the equipment.\nOnly qualified electricians are allowed to install and maintain the drive!\n•   Never work on the drive, motor cable or motor when input power is applied. After\ndisconnecting the input power, always wait for 5 minutes to let the intermediate\ncircuit capacitors discharge before you start working on the drive, motor or motor\ncable.\nAlways ensure by measuring with a multimeter (impedance at least 1 Mohm) that\n1. there is no voltage between the drive input phases U1, V1 and W1 and the\nground\n2. there is no voltage between terminals BRK+ and BRK- and the ground.";

/** ACS355 manual (sha 49aab4409885…), page 49: verbatim pdftotext -layout, leading indentation stripped. */
export const ACS355_P49 = "qualified electrician. Follow the instructions in chapter Safety on page 17.\nIgnoring the safety instructions can cause injury or death.\nMake sure that the drive is disconnected from the input power during\ninstallation. If the drive is already connected to the input power, wait for\n5 minutes after disconnecting the input power.";

/** ACS355 manual (sha 49aab4409885…), page 373: verbatim pdftotext -layout, leading indentation stripped. */
export const ACS355_P373 = "Power connections\n\nWARNING! Read and follow the instructions in chapter Safety on page\n17. Ignoring the instructions can cause physical injury or death, or\ndamage to the equipment.\n\n1. Stop the drive and disconnect it from the power line. Wait for five minutes to let the\ndrive DC capacitors discharge. Ensure by measuring with a multimeter\n(impedance at least 1 Mohm) that there is no voltage present.";

/** GS4 manual (sha 82fff0d75733…), page 2-16: verbatim pdftotext -layout, leading indentation stripped. */
export const GS4_P2_16 = "Circuit Connections – Warnings and Notes\nDanger!\nHazardous Voltage! Before making any connection to the AC drive, disconnect all power to the AC\ndrive, and wait five minutes for DC bus capacitors to discharge.\nWarning: Any electrical or mechanical modification to this equipment will void all warranties, may";

/** GS10 manual (sha df9cfc7bf1b9…), page 6-3: verbatim pdftotext -layout, leading indentation stripped. */
export const GS10_P6_3_WARN = "Disconnect AC power and ensure that the internal capacitors have fully discharged before inspecting the GS10\ndrive! Wait at least FIVE minutes after all display lamps have turned off.";

/** GS10 manual (sha df9cfc7bf1b9…), page 6-3: verbatim pdftotext -layout, leading indentation stripped. */
export const GS10_P6_3_PAGE = "drive starts to operate. We recommend recharging the capacitors of any unused drive at least\nonce per year.\n\n\nDisconnect AC power and ensure that the internal capacitors have fully discharged before inspecting the GS10\ndrive! Wait at least FIVE minutes after all display lamps have turned off.\n\n\n\n\n☑ Wait 5 seconds after a fault has been cleared before performing reset\nvia keypad or input terminal.\n☑    When the power is off after 5 minutes for ≤ 30hp models and 10\nminutes for ≥ 40hp models, please confirm that the capacitors have\nfully discharged by measuring the voltage between + and -. The\nvoltage between + and - should be less than 25VDC.\n☑    Only qualified personnel can install, wire and maintain drives.";

/** GS10 manual (sha df9cfc7bf1b9…), page 6-4: verbatim pdftotext -layout, leading indentation stripped. */
export const GS10_P6_4 = "Recommended Inspection Schedules\n\nBefore the check-up, always turn off the AC input power and remove the cover. Wait at least\n10 minutes after all display lamps have gone out, and then confirm that the capacitors have\nfully discharged by measuring the voltage between DC+ and DC-. The voltage between DC+ and\nDC-should be less than 25VDC.";

/** GS4 manual (sha eb56fcf7c915…), page 6-3: verbatim pdftotext -layout, leading indentation stripped. */
export const GS4_P6_3_WARN = "Disconnect AC power and ensure that the internal capacitors have fully discharged before\ninspecting the GS4 drive! Wait at least two minutes after all display lamps have turned off.";

/** GS4 manual (sha eb56fcf7c915…), page 6-3: verbatim pdftotext -layout, leading indentation stripped. */
export const GS4_P6_3_BULLETS = "☑ Wait 5 seconds after a fault has been cleared before performing reset\nvia keypad or input terminal.\n☑   When the power is off after 5 minutes for ≤ 30hp models and 10\nminutes for ≥ 40hp models, please confirm that the capacitors have\nfully discharged by measuring the voltage between + and -. The\nvoltage between + and - should be less than 25VDC.\n☑   Only qualified personnel can install, wire and maintain drives.";

/** GS4 manual (sha eb56fcf7c915…), page 6-4: verbatim pdftotext -layout, leading indentation stripped. */
export const GS4_P6_4 = "Recommended Inspection Schedules\n\nBefore the check-up, always turn off the AC input power and remove the cover. Wait at least\n10 minutes after all display lamps have gone out, and then confirm that the capacitors have\nfully discharged by measuring the voltage between DC+ and DC-. The voltage between DC+ and\nDC-should be less than 25VDC.";

const PF4M: BoundAsset = { manufacturer: "Rockwell Automation", modelNumber: "PowerFlex 4M" };
const ASSETS: Record<"PF40" | "PF4M" | "ACS355" | "GS4" | "GS10", BoundAsset> = { PF40: F.PF40, PF4M, ACS355: F.ACS355, GS4: F.GS4, GS10: F.GS10 };

export const PASSAGE = {
  PF40_P9: { text: PF40_P9, asset: "PF40" as const, sha: "15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9", page: "9" },
  PF40_P12: { text: PF40_P12, asset: "PF40" as const, sha: "15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9", page: "12" },
  PF4M_P9: { text: PF4M_P9, asset: "PF4M" as const, sha: "f4a93fc51536422c2282a2a213721ba62820a04e4fe88cfbb97f2d09d253fba5", page: "9" },
  ACS355_P18: { text: ACS355_P18, asset: "ACS355" as const, sha: "49aab44098854107ee26a9b702bd23afc004fbb98d7a76d137ba12455699eeac", page: "18" },
  ACS355_P49: { text: ACS355_P49, asset: "ACS355" as const, sha: "49aab44098854107ee26a9b702bd23afc004fbb98d7a76d137ba12455699eeac", page: "49" },
  ACS355_P373: { text: ACS355_P373, asset: "ACS355" as const, sha: "49aab44098854107ee26a9b702bd23afc004fbb98d7a76d137ba12455699eeac", page: "373" },
  GS4_P2_16: { text: GS4_P2_16, asset: "GS4" as const, sha: "82fff0d757339b4aa24ab8ae5ae1f58f5512d59def4abdbd0d72a786005f5546", page: "2-16" },
  GS10_P6_3_WARN: { text: GS10_P6_3_WARN, asset: "GS10" as const, sha: "df9cfc7bf1b9fc1e0f1093122c0d5c358cea921f848d942da8e6fb3f18d43669", page: "6-3" },
  GS10_P6_3_PAGE: { text: GS10_P6_3_PAGE, asset: "GS10" as const, sha: "df9cfc7bf1b9fc1e0f1093122c0d5c358cea921f848d942da8e6fb3f18d43669", page: "6-3" },
  GS10_P6_4: { text: GS10_P6_4, asset: "GS10" as const, sha: "df9cfc7bf1b9fc1e0f1093122c0d5c358cea921f848d942da8e6fb3f18d43669", page: "6-4" },
  GS4_P6_3_WARN: { text: GS4_P6_3_WARN, asset: "GS4" as const, sha: "eb56fcf7c9154982ae3ce47d8fbebe545c92e3c1ee23b1b0275490aa8b0611d2", page: "6-3" },
  GS4_P6_3_BULLETS: { text: GS4_P6_3_BULLETS, asset: "GS4" as const, sha: "eb56fcf7c9154982ae3ce47d8fbebe545c92e3c1ee23b1b0275490aa8b0611d2", page: "6-3" },
  GS4_P6_4: { text: GS4_P6_4, asset: "GS4" as const, sha: "eb56fcf7c9154982ae3ce47d8fbebe545c92e3c1ee23b1b0275490aa8b0611d2", page: "6-4" },
};

export interface OemAllowCase {
  id: string;
  passage: keyof typeof PASSAGE;
  answer: string;
  question: string;
  chunks: EvidenceChunk[];
  bound: BoundAsset;
}

const C = (key: keyof typeof PASSAGE, id = "c1"): EvidenceChunk => {
  const p = PASSAGE[key];
  return F.manualChunk(id, p.text, ASSETS[p.asset], p.sha, p.page);
};

/** Each row: a correctly cited answer quoting the passage's own number, for the matching asset.
 *  `quoted`: the passage sentence the number comes from. Every row must NOT block. */
export const OEM_ALLOW_CASES: OemAllowCase[] = [
  // PowerFlex 40 p9 (multi-clause, line-wrapped, "!" margin marker)
  r("o01", "PF40_P9", "Wait three minutes for capacitors to discharge to safe voltage levels [1]."),
  r("o02", "PF40_P9", "Before working on the drive, isolate the mains supply and wait three minutes for the capacitors to discharge [1]."),
  r("o03", "PF40_P9", "Wait 3 minutes for capacitors to discharge to safe voltage levels. [1]"),
  r("o04", "PF40_P9", "1. Isolate the mains supply at R, S, T.\n2. Wait three minutes for capacitors to discharge [1].\n3. A darkened display is not proof the capacitors have discharged [1]."),
  // PowerFlex 40 p12 (the wait sits in a clause joined by "and" to the isolation step)
  r("o05", "PF40_P12", "Ensure isolation of mains supply and wait three minutes for capacitors to discharge before removing the external cover [1]."),
  r("o06", "PF40_P12", "Wait three minutes before removing the external cover [1]."),
  r("o07", "PF40_P12", "Wait three minutes for the capacitors to discharge [1], then measure the DC bus voltage at the DC- and DC+ terminals; it must be zero [1]."),
  r("o08", "PF40_P12", "Measure DC- to DC+ and confirm it reads 0 V [1]."),
  // PowerFlex 4M p9 (measurement only, no time)
  r("o09", "PF4M_P9", "Measure the DC bus voltage at the -DC and +DC terminals; the voltage must be zero [1]."),
  r("o10", "PF4M_P9", "Confirm the DC bus has discharged to 0 V before you work on the drive [1]."),
  // ABB ACS355 p18 (the time is in a sentence that starts on one line and wraps over three)
  r("o11", "ACS355_P18", "After disconnecting the input power, always wait for 5 minutes to let the intermediate circuit capacitors discharge before you start working on the drive [1]."),
  r("o12", "ACS355_P18", "Wait 5 minutes after disconnecting the input power before you start working on the drive, motor or motor cable [1]."),
  r("o13", "ACS355_P18", "Wait five minutes after disconnecting input power [1]. Then use a multimeter (at least 1 Mohm) to confirm there is no voltage between U1, V1, W1 and ground [1]."),
  // ABB ACS355 p49 (no capacitor word: the link is "after disconnecting the input power")
  r("o14", "ACS355_P49", "If the drive is already connected to the input power, wait for 5 minutes after disconnecting the input power [1]."),
  r("o15", "ACS355_P49", "Wait 5 minutes after disconnecting the input power before installation work [1]."),
  r("o16", "ACS355_P49", "- Disconnect the input power.\n- Wait **5 minutes** after disconnecting it [1]."),
  // ABB ACS355 p373 (numbered step; the time sentence names the capacitors)
  r("o17", "ACS355_P373", "Stop the drive and disconnect it from the power line. Wait for five minutes to let the drive DC capacitors discharge [1]."),
  r("o18", "ACS355_P373", "Wait 5 minutes to let the drive DC capacitors discharge, then measure with a multimeter that no voltage is present [1]."),
  r("o19", "ACS355_P373", "Disconnect the drive from the power line and wait five minutes [1]."),
  // GS4 ch.2 p2-16 ("Danger!" / "Hazardous Voltage!" headings split the sentence)
  r("o20", "GS4_P2_16", "Before making any connection to the AC drive, disconnect all power and wait five minutes for DC bus capacitors to discharge [1]."),
  r("o21", "GS4_P2_16", "Disconnect all power to the drive and wait 5 minutes before making any connection [1]."),
  r("o22", "GS4_P2_16", "Hazardous voltage: wait five minutes for the DC bus capacitors to discharge [1]."),
  // GS10 p6-3 warning paragraph (the link is "after all display lamps", context carried from the sentence before)
  r("o23", "GS10_P6_3_WARN", "Wait at least FIVE minutes after all display lamps have turned off [1]."),
  r("o24", "GS10_P6_3_WARN", "Disconnect AC power and wait at least five minutes after all display lamps have turned off before inspecting the drive [1]."),
  r("o25", "GS10_P6_3_WARN", "Wait at least 5 minutes after the display lamps go out [1]."),
  // GS10 p6-3 full page (rating-conditioned values and the meter threshold)
  r("o26", "GS10_P6_3_PAGE", "For 30 hp and smaller GS10 drives, wait 5 minutes after power is off before you confirm the capacitors have discharged [1]."),
  r("o27", "GS10_P6_3_PAGE", "For 40 hp and larger models, wait 10 minutes after the power is off [1]."),
  r("o28", "GS10_P6_3_PAGE", "Measure between + and -; it should be less than 25VDC [1]."),
  r("o29", "GS10_P6_3_PAGE", "When the power is off after 5 minutes for ≤ 30hp models and 10 minutes for ≥ 40hp models, confirm the capacitors have discharged [1]."),
  // GS10 p6-4 (", and then" joins the wait to the measurement)
  r("o30", "GS10_P6_4", "Wait at least 10 minutes after all display lamps have gone out, and then confirm that the capacitors have fully discharged by measuring between DC+ and DC- [1]."),
  r("o31", "GS10_P6_4", "Turn off the AC input power, remove the cover and wait at least 10 minutes [1]. Then measure DC+ to DC-; it should be less than 25VDC [1]."),
  r("o32", "GS10_P6_4", "The voltage between DC+ and DC- should be less than 25 VDC [1]."),
  r("o33", "GS10_P6_4", "Before the check-up, turn off the AC input power and wait at least ten minutes after the display lamps go out [1]."),
  // GS4 p6-3 warning paragraph
  r("o34", "GS4_P6_3_WARN", "Wait at least two minutes after all display lamps have turned off [1]."),
  r("o35", "GS4_P6_3_WARN", "Disconnect AC power and wait at least 2 minutes after the display lamps turn off before inspecting the GS4 [1]."),
  // GS4 p6-3 bullets
  r("o36", "GS4_P6_3_BULLETS", "For models of 30 hp or less, wait 5 minutes after the power is off [1]."),
  r("o37", "GS4_P6_3_BULLETS", "For 40 hp and up, wait 10 minutes after the power is off, then measure between + and - [1]."),
  r("o38", "GS4_P6_3_BULLETS", "The voltage between + and - should be less than 25VDC [1]."),
  // GS4 p6-4
  r("o39", "GS4_P6_4", "Wait at least 10 minutes after all display lamps have gone out, and then confirm that the capacitors have fully discharged [1]."),
  r("o40", "GS4_P6_4", "Then measure DC+ to DC- and confirm it is less than 25VDC [1]."),
  r("o41", "GS4_P6_4", "| Step | Action |\n|---|---|\n| 1 | Turn off AC input power and remove the cover |\n| 2 | Wait at least 10 minutes after all display lamps have gone out [1] |\n| 3 | Confirm DC+ to DC- is less than 25VDC [1] |"),
  // The question carries the context; the answer quotes the bare figure
  r("o42", "ACS355_P49", "Wait 5 minutes [1].", "How long after I disconnect the ACS355 input power before I can work on it?"),
  r("o43", "PF40_P9", "Three minutes [1].", "How long do the PowerFlex 40 bus capacitors take to discharge?"),
  r("o44", "GS10_P6_4", "At least 10 minutes after the display lamps go out [1].", "How long before I can touch the GS10 DC bus after power off?"),
];

function r(id: string, passage: keyof typeof PASSAGE, answer: string, question = ""): OemAllowCase {
  return { id, passage, answer, question, chunks: [C(passage)], bound: ASSETS[PASSAGE[passage].asset] };
}

/**
 * DEV fixtures for the safety-policy tests and the offline replay — NOT the sealed acceptance set.
 *
 * Chunk text is copied verbatim from `pdftotext -layout` of manuals in ~/.factorylm/imib-manuals
 * (leading indentation stripped; line wraps kept, as ingest stores them). `docId` is the PDF's
 * sha256 (the file's own name there). Labels on answers that use these chunks are written by the
 * implementer of this module, so they are development evidence only (design doc §5: the sealed set
 * is the gate). Test/replay helper: nothing in the runtime imports it.
 */
import type { BoundAsset, EvidenceChunk } from "./types";

export const GS10_SHA = "df9cfc7bf1b9fc1e0f1093122c0d5c358cea921f848d942da8e6fb3f18d43669";
export const GS4_SHA = "eb56fcf7c9154982ae3ce47d8fbebe545c92e3c1ee23b1b0275490aa8b0611d2";
export const PF40_SHA = "15c10c6420379e8d286ee4c8a210b11683e97e727b39b592e6a9e0dfd023cae9";
export const ACS355_SHA = "49aab44098854107ee26a9b702bd23afc004fbb98d7a76d137ba12455699eeac";

/** DURApulse GS10 User Manual 1st Ed. Rev B, page 6–3 (PDF page 3 of the chapter-6 file). */
export const GS10_P6_3 = `Recharge Capacitors (for drives not in service)
Recharge the DC link before using any drive that has not been operated within a year:
1) Disconnect the motor from the drive.
2) Apply input power to the drive for 2 hours.


If the drive is stored or is otherwise unused for more than a year, the drive’s internal DC link
capacitors should be recharged before use. Otherwise, the capacitors may be damaged when the
drive starts to operate. We recommend recharging the capacitors of any unused drive at least
once per year.


Disconnect AC power and ensure that the internal capacitors have fully discharged before inspecting the GS10
drive! Wait at least FIVE minutes after all display lamps have turned off.




☑ Wait 5 seconds after a fault has been cleared before performing reset
via keypad or input terminal.
☑    When the power is off after 5 minutes for ≤ 30hp models and 10
minutes for ≥ 40hp models, please confirm that the capacitors have
fully discharged by measuring the voltage between + and -. The
voltage between + and - should be less than 25VDC.
☑    Only qualified personnel can install, wire and maintain drives.
CAUTION            Please take off any metal objects, such as watches and rings, before
operation. And only insulated tools are allowed.`;

/** GS10 page 6–4. */
export const GS10_P6_4 = `Recommended Inspection Schedules

Before the check-up, always turn off the AC input power and remove the cover. Wait at least
10 minutes after all display lamps have gone out, and then confirm that the capacitors have
fully discharged by measuring the voltage between DC+ and DC-. The voltage between DC+ and
DC-should be less than 25VDC.`;

/** GS10 page 6–3, the first warning paragraph alone (no conflicting values in the chunk). */
export const GS10_P6_3_WARNING = `Disconnect AC power and ensure that the internal capacitors have fully discharged before inspecting the GS10
drive! Wait at least FIVE minutes after all display lamps have turned off.`;

/** GS10 page 6–24, fault tH1o corrective action (a time that is NOT a discharge wait). */
export const GS10_P6_24_TH1O = `Corrective      Wait for 10 minutes, and then cycle the power. Check if tH1o protection
Actions         still exists. If yes, contact AutomationDirect Technical Support.`;

/** GS4 (sibling AutomationDirect model) page 6–3 warning. */
export const GS4_P6_3_WARNING = `Disconnect AC power and ensure that the internal capacitors have fully discharged before
inspecting the GS4 drive! Wait at least two minutes after all display lamps have turned off.`;

/** PowerFlex 40 (22B-UM001) page 9, General Precautions. */
export const PF40_P9 = `General Precautions

ATTENTION: The drive contains high voltage capacitors which take
time to discharge after removal of mains supply. Before working on
!      drive, ensure isolation of mains supply from line inputs [R, S, T (L1,
L2, L3)]. Wait three minutes for capacitors to discharge to safe voltage
levels. Failure to do so may result in personal injury or death.

Darkened display LEDs is not an indication that capacitors have
discharged to safe voltage levels.`;

/** ABB ACS355 user's manual, page 18. */
export const ACS355_P18 = `•   Never work on the drive, motor cable or motor when input power is applied. After
disconnecting the input power, always wait for 5 minutes to let the intermediate
circuit capacitors discharge before you start working on the drive, motor or motor
cable.
Always ensure by measuring with a multimeter (impedance at least 1 Mohm) that
1. there is no voltage between the drive input phases U1, V1 and W1 and the
ground
2. there is no voltage between terminals BRK+ and BRK- and the ground.`;

export const GS10: BoundAsset = { manufacturer: "AutomationDirect", modelNumber: "GS10" };
export const GS4: BoundAsset = { manufacturer: "AutomationDirect", modelNumber: "GS4" };
export const PF40: BoundAsset = { manufacturer: "Rockwell Automation", modelNumber: "PowerFlex 40" };
export const ACS355: BoundAsset = { manufacturer: "ABB", modelNumber: "ACS355" };

/** A verified manual chunk with a page — every applicability field set, so a test can flip one. */
export function manualChunk(
  id: string,
  content: string,
  asset: BoundAsset,
  docId: string,
  pageLabel: string,
  extra: Partial<EvidenceChunk> = {},
): EvidenceChunk {
  return {
    id,
    origin: "manual",
    content,
    docId,
    manufacturer: asset.manufacturer,
    modelNumber: asset.modelNumber,
    sourcePage: null,
    pageLabel,
    verified: true,
    ...extra,
  };
}

export const gs10p63 = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, GS10_P6_3, GS10, GS10_SHA, "6-3", extra);
export const gs10p64 = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, GS10_P6_4, GS10, GS10_SHA, "6-4", extra);
export const gs10warn = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, GS10_P6_3_WARNING, GS10, GS10_SHA, "6-3", extra);
export const gs10th1o = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, GS10_P6_24_TH1O, GS10, GS10_SHA, "6-24", extra);
export const gs4warn = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, GS4_P6_3_WARNING, GS4, GS4_SHA, "6-3", extra);
export const pf40p9 = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, PF40_P9, PF40, PF40_SHA, "9", extra);
export const acs355p18 = (id = "c1", extra: Partial<EvidenceChunk> = {}) => manualChunk(id, ACS355_P18, ACS355, ACS355_SHA, "18", extra);

/** A photo observation whose label was identified as the GS10 (the route sets manufacturer/model
 *  from the turn's nameplate identification); override to model a mismatch or no identification. */
export const gs10photo = (extra: Partial<EvidenceChunk> = {}): EvidenceChunk => ({
  id: "photo",
  origin: "photo",
  content: "Label text: WARNING - Risk of electric shock. Capacitors stay charged; wait 10 minutes after power is removed.",
  manufacturer: GS10.manufacturer,
  modelNumber: GS10.modelNumber,
  ...extra,
});

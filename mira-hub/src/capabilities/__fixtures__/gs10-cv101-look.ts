/**
 * The LOOK observation MIRA saved for the CV-101 GS10 drive photo (staging
 * notebook aca65409, thread abb3c9d3, 2026-11-07) — verbatim. The regression
 * case for the photo-to-manual workflow: the plate prints MODEL GS11N-20P2.
 * Its rating line ("0.7KVA", "100KA") used to read as a second model (fixed).
 * Its prose "…the unit. No loose…" reads as a value-less unit-number label
 * under the ADR-0036 privacy rule, which by owner decision (2026-11-20, #5706)
 * stands unchanged: this reading never starts the automatic search.
 */
export const GS10_CV101_LOOK = "Black rectangular drive mounted vertically on a metal panel. Front left edge has a small keypad area with a round black knob at the top, a red glowing indicator near it, a green square indicator below, two small white buttons marked with up and down triangles, and labels \"MENU\" and \"ENTER\". The main side label is mostly readable and shows \"MODEL: GS11N-20P2\". Other readable text on the label includes \"INPUT: VT: 1PH 200-240V 50/60Hz 5.8A\" and \"CT: 1PH 200-240V 50/60Hz 5.1A\"; \"OUTPUT: POWER VT(CT) 0.25HP(0.25HP)\"; \"VT: 3PH 0-230V 1.8A 0.7KVA 0.2KW\"; \"CT: 3PH 0-230V 1.6A 0.6KVA 0.2KW\"; \"FREQUENCY RANGE: 0-599Hz\"; \"SHORT CIRCUIT CURRENT: 100KA\"; \"AutomationDirect.com\"; \"MADE IN INDIA\"; \"Ver. 1.03\". A barcode area shows \"GS1120P2+K25310021\". The small QR-like code on the side is not readable. Blue and light-colored cables run past the right side of the unit. No loose or disconnected wiring is visible. No burn marks, corrosion, moisture, or debris are clearly visible on the unit. The exact meaning of the barcode string and the partially visible side code are unclear from the photo.";

/**
 * The same plate described without the unit sentence: the shape a reading
 * takes when nothing on it looks like a private label. Used where a test needs
 * the GS10 plate to reach the automatic search.
 */
export const GS10_CLEAN_LOOK = GS10_CV101_LOOK.replace(
  " Blue and light-colored cables run past the right side of the unit. No loose or disconnected wiring is visible. No burn marks, corrosion, moisture, or debris are clearly visible on the unit.",
  " Blue and light-colored cables run past the right side of the drive. No burn marks, corrosion, moisture, or debris are clearly visible.",
);
if (GS10_CLEAN_LOOK === GS10_CV101_LOOK) throw new Error("GS10_CLEAN_LOOK: the unit sentence was not removed");

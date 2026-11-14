/**
 * #5370 — an electrical print page carries its safety notes as a bulleted
 * paragraph, with no WARNING/CAUTION marker. The extractor must return the
 * sheet's OWN words for the "not a safety-rated disconnect / do not treat as
 * the LOTO isolation point" note, and stay silent on look-alikes.
 *
 * Run: npx vitest run src/capabilities/__tests__/manual-safety-statement.print-notes.test.ts
 */
import { describe, expect, it } from "vitest";
import { extractManualSafetyStatement } from "../manual-safety-statement";

// pdftotext of the real page; lines wrap exactly like this.
const PRINT_NOTES = `• Monitored outputs are NOT a safety function.
• E-stop must remove power per NFPA 79.
• Q1/MLC is a CONTROL RELAY (24 VDC coil, driven by O-02) whose 2 NO contacts
(13-14, 43-44) switch the drive's 230 V 1φ supply (V6 correction, E-003) — deenergizing O-02 DOES remove Q1's switched supply to the GS10. Q1 is NOT an
NFPA-79/EN-60204-1 safety-rated disconnect (small control-relay contacts, not a
lockable safety contactor); the e-stop (S0) → O-02 relationship is FIELD VERIFY
(OI-26). Do not treat this circuit as the LOTO isolation point — always LOTO at
CB1 or upstream.
• O-02 is the sole MLC/Q1 drive-enable coil output — do not reuse it for any
other load`;

const EXPECTED =
  "Q1 is NOT an NFPA-79/EN-60204-1 safety-rated disconnect (small control-relay contacts, not a lockable safety contactor); " +
  "the e-stop (S0) → O-02 relationship is FIELD VERIFY (OI-26). " +
  "Do not treat this circuit as the LOTO isolation point — always LOTO at CB1 or upstream.";

describe("print-page safety notes (#5370)", () => {
  it("returns the sheet's own sentences, wrapped lines joined", () => {
    const hit = extractManualSafetyStatement(PRINT_NOTES);
    expect(hit).not.toBeNull();
    expect(hit?.statement).toBe(EXPECTED);
  });

  it("every returned word is in the source (never invented)", () => {
    const hit = extractManualSafetyStatement(PRINT_NOTES);
    expect(PRINT_NOTES.replace(/\s+/g, " ")).toContain(hit?.statement ?? "\0");
  });

  it("a lone 'do not treat ... as the LOTO isolation point' sentence is caught", () => {
    const hit = extractManualSafetyStatement("Do not treat this circuit as the LOTO isolation point — always LOTO at CB1.");
    expect(hit?.statement).toBe("Do not treat this circuit as the LOTO isolation point — always LOTO at CB1.");
  });

  it("a lone 'NOT a safety function' note is caught", () => {
    expect(extractManualSafetyStatement("• Monitored outputs are NOT a safety function.")?.statement).toBe(
      "Monitored outputs are NOT a safety function.",
    );
  });

  describe("controls that must stay null", () => {
    it("a spec line: 'Safety relay output: not used'", () => {
      expect(extractManualSafetyStatement("Safety relay output: not used")).toBeNull();
    });
    it("'not' and 'safety' far apart in ordinary prose", () => {
      expect(
        extractManualSafetyStatement(
          "The drive does not support a second encoder input on this frame size, and the fan runs continuously. See the safety chapter for the disconnect ratings.",
        ),
      ).toBeNull();
    });
    it("a plain wiring sentence", () => {
      expect(extractManualSafetyStatement("Q1 switches the 230 V supply to the GS10 via contacts 13-14.")).toBeNull();
    });
  });

  it("JUDGEMENT CALL: 'not safety-rated for SIL 3' stays null (no 'a/an ... disconnect' shape)", () => {
    expect(extractManualSafetyStatement("This drive is not safety-rated for SIL 3 applications.")).toBeNull();
  });

  it("CONTROL: an explicit WARNING marker still wins and is unchanged", () => {
    const hit = extractManualSafetyStatement("WARNING: Hazardous voltage. Lock out first.\n\n" + PRINT_NOTES);
    expect(hit?.marker).toBe("WARNING");
    expect(hit?.statement).toBe("Hazardous voltage. Lock out first.");
  });
});

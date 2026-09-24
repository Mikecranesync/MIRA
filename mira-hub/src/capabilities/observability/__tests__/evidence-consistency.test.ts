/**
 * #3962, pinned. The strings below are the ones from the issue — the bearing
 * label MIRA read correctly and the drive answer it wrote instead.
 */
import { describe, expect, it } from "vitest";
import {
  assessEvidenceFollowed,
  equipmentClassesOf,
  subjectIdentifiers,
  EVIDENCE_CONSISTENCY_VERSION,
} from "../evidence-consistency";

// Turn 1's observation, as quoted in #3962.
const BEARING_LABEL =
  "32906X Tapered Roller Bearing, Width 2pcs. MADE IN CHINA. Box label photographed on the bench.";

// Turn 2's answer, as quoted in #3962 — the failure.
const DRIVE_ANSWER =
  "With the drive isolated, locked out and the DC bus verified at 0 V, check the motor supply " +
  "voltage and phase-to-phase continuity, then verify that the motor encoder (if present) is " +
  "correctly wired, and inspect the mechanical coupling.";

// What a correct answer to "it is chattering" looks like for that same label.
const BEARING_ANSWER =
  "Chattering in a tapered roller bearing usually means preload has been lost or the raceway is " +
  "spalling. Check the fit in the housing, look for brinelling on the races, and confirm the " +
  "lubricant has not been contaminated.";

describe("#3962 — evidence supplied is not evidence followed", () => {
  it("flags the exact bearing-label / drive-answer pair from the issue", () => {
    const a = assessEvidenceFollowed(BEARING_LABEL, DRIVE_ANSWER);
    expect(a.verdict).toBe("unverified_mismatch");
    expect(a.evidence_classes).toContain("bearing");
    expect(a.answer_classes).toEqual(expect.arrayContaining(["drive", "motor", "encoder"]));
    expect(a.subject_identifiers_in_answer).toBe(0);
    expect(a.version).toBe(EVIDENCE_CONSISTENCY_VERSION);
  });

  it("does NOT flag a correct answer about the same bearing", () => {
    expect(assessEvidenceFollowed(BEARING_LABEL, BEARING_ANSWER).verdict).toBe("consistent");
  });

  it("does not rest on noun overlap alone — naming the part number is enough", () => {
    const a = assessEvidenceFollowed(
      BEARING_LABEL,
      "The 32906X is a tapered roller; with the drive locked out, check the coupling alignment.",
    );
    // Mentions drive AND motorless drive terms, but references the subject by
    // identifier, so it is not a mismatch. One-sided signals must not fire.
    expect(a.subject_identifiers_in_answer).toBeGreaterThan(0);
    expect(a.verdict).toBe("consistent");
  });

  it("an answer that also names the evidence's class is consistent, not a mismatch", () => {
    const a = assessEvidenceFollowed(
      BEARING_LABEL,
      "Chattering can come from the bearing itself or from the drive; check bearing preload first.",
    );
    expect(a.verdict).toBe("consistent");
  });

  it("says not_applicable when there was no observation to follow", () => {
    expect(assessEvidenceFollowed("", DRIVE_ANSWER).verdict).toBe("not_applicable");
    expect(assessEvidenceFollowed(null, DRIVE_ANSWER).verdict).toBe("not_applicable");
    expect(assessEvidenceFollowed(BEARING_LABEL, "").verdict).toBe("not_applicable");
  });

  it("stays quiet when either side names no equipment class", () => {
    expect(assessEvidenceFollowed("A blurry photograph of a wall.", DRIVE_ANSWER).verdict).toBe(
      "consistent",
    );
    expect(
      assessEvidenceFollowed(BEARING_LABEL, "Take a clearer photograph and try again.").verdict,
    ).toBe("consistent");
  });

  it("extracts part codes, not plain words", () => {
    const ids = subjectIdentifiers(BEARING_LABEL);
    expect(ids).toContain("32906X");
    expect(ids).not.toContain("TAPERED");
    expect(ids).not.toContain("BEARING");
    expect(ids).not.toContain("CHINA");
  });

  it("recognises the classes it claims to", () => {
    expect(equipmentClassesOf(BEARING_LABEL)).toContain("bearing");
    expect(equipmentClassesOf(DRIVE_ANSWER)).toContain("drive");
    expect(equipmentClassesOf("nothing industrial here at all")).toEqual([]);
  });
});

/**
 * The weak-evidence rule, exhaustively: the exact conjunction the 2026-10-12
 * adjudication proposed, and every way it must NOT fire.
 */
import { describe, expect, it } from "vitest";

import {
  JEV_WEAK_EVIDENCE_THRESHOLD,
  WEAK_EVIDENCE_LABEL,
  WEAK_EVIDENCE_RULE,
  isWeakEvidence,
  type WeakEvidenceSignals,
} from "../jev-weak-evidence";

/** A turn the adjudication's D2 bucket describes: cited, unit claim, low score. */
const FIRES: WeakEvidenceSignals = {
  jevSufficient: 0.12,
  basis: "oem_documentation",
  ungroundedUnitClaim: true,
  citationsShipped: 2,
};

describe("isWeakEvidence — the conjunction", () => {
  it("fires on a low score with an OEM-documentation basis and a unit claim", () => {
    expect(isWeakEvidence(FIRES)).toBe(true);
  });

  it("fires on a low score with an OEM-documentation basis and a citation, with no unit claim", () => {
    expect(isWeakEvidence({ ...FIRES, ungroundedUnitClaim: false, citationsShipped: 1 })).toBe(true);
  });

  it("fires on a low score with a unit claim and ZERO citations (the D2 shape)", () => {
    expect(isWeakEvidence({ ...FIRES, citationsShipped: 0 })).toBe(true);
  });

  it("does not fire with neither a unit claim nor a citation (D3: nothing to doubt)", () => {
    expect(isWeakEvidence({ ...FIRES, ungroundedUnitClaim: false, citationsShipped: 0 })).toBe(false);
  });
});

describe("isWeakEvidence — the threshold", () => {
  it("is 0.30", () => {
    expect(JEV_WEAK_EVIDENCE_THRESHOLD).toBe(0.3);
  });

  it("does not fire AT the threshold — strictly below", () => {
    expect(isWeakEvidence({ ...FIRES, jevSufficient: 0.3 })).toBe(false);
  });

  it("fires just under the threshold", () => {
    expect(isWeakEvidence({ ...FIRES, jevSufficient: 0.299 })).toBe(true);
  });

  it("does not fire in the uncertain band or above", () => {
    expect(isWeakEvidence({ ...FIRES, jevSufficient: 0.5 })).toBe(false);
    expect(isWeakEvidence({ ...FIRES, jevSufficient: 0.95 })).toBe(false);
  });

  it("fires at a score of exactly 0", () => {
    expect(isWeakEvidence({ ...FIRES, jevSufficient: 0 })).toBe(true);
  });
});

describe("isWeakEvidence — a shadow that did not run is 'not consulted', never 'weak'", () => {
  it("null score (shadow off or skipped) never fires", () => {
    expect(isWeakEvidence({ ...FIRES, jevSufficient: null })).toBe(false);
  });

  it("NaN / infinite / out-of-range scores never fire", () => {
    expect(isWeakEvidence({ ...FIRES, jevSufficient: Number.NaN })).toBe(false);
    expect(isWeakEvidence({ ...FIRES, jevSufficient: Number.NEGATIVE_INFINITY })).toBe(false);
    expect(isWeakEvidence({ ...FIRES, jevSufficient: -0.1 })).toBe(false);
    expect(isWeakEvidence({ ...FIRES, jevSufficient: 1.5 })).toBe(false);
  });
});

describe("isWeakEvidence — only the OEM-documentation basis", () => {
  it.each([
    "general_reasoning",
    "workspace_evidence",
    "live_machine_evidence",
    "machine_history",
    "OEM_DOCUMENTATION",
    "",
  ])("basis %j never fires, whatever the score", (basis) => {
    expect(isWeakEvidence({ ...FIRES, basis })).toBe(false);
  });

  it("a null basis never fires", () => {
    expect(isWeakEvidence({ ...FIRES, basis: null })).toBe(false);
  });
});

describe("the badge's wording and rule id", () => {
  it("says the documentation may not cover the question — not that the answer is wrong", () => {
    expect(WEAK_EVIDENCE_LABEL.toLowerCase()).toContain("documentation may not cover this");
    expect(WEAK_EVIDENCE_LABEL.toLowerCase()).not.toContain("wrong");
    expect(WEAK_EVIDENCE_LABEL.toLowerCase()).not.toContain("incorrect");
  });

  it("carries a versioned rule id for the persisted marker", () => {
    expect(WEAK_EVIDENCE_RULE).toBe("jev_sufficiency_v1");
  });
});

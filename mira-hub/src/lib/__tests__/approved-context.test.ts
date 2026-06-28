import { describe, expect, it } from "vitest";
import {
  approvedAskEnforcementEnabled,
  approvedContextReady,
  buildApprovedContextRefusal,
} from "../approved-context";

describe("approved context gate", () => {
  it("is enabled by the dedicated Ask flag", () => {
    expect(approvedAskEnforcementEnabled({ MIRA_ENFORCE_APPROVED_ASK: "true" })).toBe(true);
  });

  it("is enabled by the existing retrieval flag", () => {
    expect(approvedAskEnforcementEnabled({ MIRA_ENFORCE_APPROVED_RETRIEVAL: "true" })).toBe(true);
  });

  it("is disabled when both flags are absent", () => {
    expect(approvedAskEnforcementEnabled({})).toBe(false);
  });

  it("treats any approved source, verified relationship, or approved live signal as answer context", () => {
    expect(approvedContextReady({ approvedSourceCount: 1, verifiedRelationshipCount: 0, approvedLiveSignalCount: 0 })).toBe(true);
    expect(approvedContextReady({ approvedSourceCount: 0, verifiedRelationshipCount: 1, approvedLiveSignalCount: 0 })).toBe(true);
    expect(approvedContextReady({ approvedSourceCount: 0, verifiedRelationshipCount: 0, approvedLiveSignalCount: 1 })).toBe(true);
    expect(approvedContextReady({ approvedSourceCount: 0, verifiedRelationshipCount: 0, approvedLiveSignalCount: 0 })).toBe(false);
  });

  it("builds the existing missing-context checklist shape for refusal", () => {
    const refusal = buildApprovedContextRefusal({
      approvedSourceCount: 0,
      verifiedRelationshipCount: 0,
      approvedLiveSignalCount: 0,
    });

    expect(refusal).toMatchObject({
      gate: "approved_context",
      reason: "MIRA needs approved asset context before answering.",
    });
    expect(refusal.missingContext).toContainEqual(
      expect.objectContaining({
        key: "approved_documents",
        status: "missing",
        required: 1,
      }),
    );
    expect(refusal.missingContext).toContainEqual(
      expect.objectContaining({
        key: "verified_relationships",
        status: "needs_review",
        required: 1,
      }),
    );
  });
});

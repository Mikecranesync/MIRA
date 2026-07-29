import { describe, expect, it } from "vitest";
import {
  IMPORT_APPROVAL_STATE,
  PUBLISHED_APPROVAL_STATE,
  decidePromotion,
  decidePublish,
  decideBatchReview,
  parseReviewDecision,
  buildEntityInsert,
  buildPublishEntityUpdate,
} from "./approval";

// HubV3 Phase 4 acceptance — PRD §6 test matrix.
// These prove the *decision logic* and the *SQL no-overwrite guard*.
// (A live re-import is an integration concern; NeonDB-SSL-on-Windows blocks it
// locally — see PR notes. The SQL guard below is the real enforcement: delete
// the WHERE clause and these go red.)

describe("test 7 — imported proposals do not overwrite approved Hub data", () => {
  it("import-time promote SKIPS an already-verified entity with a protected reason", () => {
    const d = decidePromotion({ approval_state: "verified" });
    expect(d.action).toBe("skip");
    expect(d.protectedRow).toBe(true);
    expect(d.reason).toMatch(/not overwrite/i);
  });

  it("import-time promote SKIPS a deprecated entity (protected)", () => {
    const d = decidePromotion({ approval_state: "deprecated" });
    expect(d.action).toBe("skip");
    expect(d.protectedRow).toBe(true);
  });

  it("re-approval cannot mutate an already-verified entity", () => {
    const d = decidePublish({ approval_state: "verified" });
    expect(d.action).toBe("skip");
  });

  it("the publish UPDATE carries the no-overwrite SQL guard", () => {
    const q = buildPublishEntityUpdate({
      tenantId: "11111111-1111-1111-1111-111111111111",
      name: "conv_run",
      propertiesJson: "{}",
    });
    // Verified/deprecated rows must be untouchable at the DB layer.
    expect(q.text).toMatch(/approval_state\s+NOT IN\s*\(\s*'verified'\s*,\s*'deprecated'\s*\)/i);
    expect(q.text).toMatch(/SET[\s\S]*approval_state\s*=\s*'verified'/i);
  });

  it("the stage INSERT uses the live natural-key conflict target, never entity_id", () => {
    const q = buildEntityInsert({
      tenantId: "11111111-1111-1111-1111-111111111111",
      name: "conv_run",
      unsPath: "enterprise.garage.demo_cell.conveyor.conv_run",
      ltreePath: "enterprise.garage.demo_cell.conveyor.conv_run",
      propertiesJson: "{}",
      approvalState: "proposed",
    });
    expect(q.text).toMatch(/ON CONFLICT\s*\(\s*tenant_id\s*,\s*entity_type\s*,\s*name\s*\)\s*DO NOTHING/i);
    expect(q.text).not.toMatch(/ON CONFLICT[^)]*entity_id/i);
  });
});

describe("test 8 — UNS/i3X remain proposed until approved", () => {
  it("a freshly staged entity lands as 'proposed', never 'verified'", () => {
    expect(IMPORT_APPROVAL_STATE).toBe("proposed");
    const d = decidePromotion(null);
    expect(d.action).toBe("insert");
    expect(d.approvalState).toBe("proposed");
  });

  it("import-time promote never writes a verified entity (no auto-publish)", () => {
    const q = buildEntityInsert({
      tenantId: "11111111-1111-1111-1111-111111111111",
      name: "conv_run",
      unsPath: "enterprise.garage.demo_cell.conveyor.conv_run",
      ltreePath: "enterprise.garage.demo_cell.conveyor.conv_run",
      propertiesJson: "{}",
      approvalState: IMPORT_APPROVAL_STATE,
    });
    expect(q.values).toContain("proposed");
    expect(q.values).not.toContain("verified");
  });

  it("only the approve decision publishes; reject/needs_review never publish", () => {
    expect(PUBLISHED_APPROVAL_STATE).toBe("verified");
    expect(decideBatchReview("proposed", "approve")).toEqual({ status: "approved", publish: true });
    expect(decideBatchReview("proposed", "reject")).toEqual({ status: "rejected", publish: false });
    expect(decideBatchReview("proposed", "needs_review")).toEqual({ status: "needs_review", publish: false });
  });

  it("publishing elevates a previously-proposed entity to verified", () => {
    const d = decidePublish({ approval_state: "proposed" });
    expect(d.action).toBe("update");
  });

  it("publishing an absent entity inserts it directly as verified (the human approval IS the verification)", () => {
    const d = decidePublish(null);
    expect(d.action).toBe("insert");
  });
});

describe("parseReviewDecision — request guard", () => {
  it("accepts the three valid decisions", () => {
    expect(parseReviewDecision("approve")).toBe("approve");
    expect(parseReviewDecision("reject")).toBe("reject");
    expect(parseReviewDecision("needs_review")).toBe("needs_review");
  });

  it("rejects anything else (no auto-approve via a bogus value)", () => {
    expect(parseReviewDecision("approved")).toBeNull();
    expect(parseReviewDecision("verified")).toBeNull();
    expect(parseReviewDecision("")).toBeNull();
    expect(parseReviewDecision(undefined)).toBeNull();
    expect(parseReviewDecision(42)).toBeNull();
  });
});

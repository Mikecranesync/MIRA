import { describe, expect, it } from "vitest";
import {
  EXPOSABLE_APPROVAL_STATE,
  isExposable,
  filterExposable,
  filterApprovedTags,
} from "@/lib/i3x/approval";

describe("approval gate — only verified context reaches the i3X surface", () => {
  it("the single exposable approval state is 'verified'", () => {
    expect(EXPOSABLE_APPROVAL_STATE).toBe("verified");
  });

  it("exposes a verified entity", () => {
    expect(isExposable({ approval_state: "verified" })).toBe(true);
  });

  it("hides a proposed entity (the default state from migration 029)", () => {
    expect(isExposable({ approval_state: "proposed" })).toBe(false);
  });

  it("hides rejected and needs_review entities", () => {
    expect(isExposable({ approval_state: "rejected" })).toBe(false);
    expect(isExposable({ approval_state: "needs_review" })).toBe(false);
  });

  it("hides an entity with a missing approval_state (fail-closed)", () => {
    expect(isExposable({})).toBe(false);
    expect(isExposable({ approval_state: undefined })).toBe(false);
  });

  it("filterExposable keeps only verified rows", () => {
    const rows = [
      { id: "a", approval_state: "verified" },
      { id: "b", approval_state: "proposed" },
      { id: "c", approval_state: "verified" },
      { id: "d", approval_state: "rejected" },
    ];
    expect(filterExposable(rows).map((r) => r.id)).toEqual(["a", "c"]);
  });
});

describe("filterApprovedTags — defense-in-depth tag allowlist for values", () => {
  const allow = new Set(["enterprise.acme.site.s1.area.a1.equipment.cv101.datapoint.motor_current"]);

  it("keeps a reading whose uns_path is on the allowlist", () => {
    const rows = [{ uns_path: "enterprise.acme.site.s1.area.a1.equipment.cv101.datapoint.motor_current", v: 1 }];
    expect(filterApprovedTags(rows, allow)).toHaveLength(1);
  });

  it("drops a reading whose uns_path is NOT on the allowlist", () => {
    const rows = [{ uns_path: "enterprise.acme.site.s1.area.a1.equipment.cv101.datapoint.secret_tag", v: 1 }];
    expect(filterApprovedTags(rows, allow)).toHaveLength(0);
  });

  it("drops readings with no uns_path (fail-closed)", () => {
    const rows = [{ uns_path: null, v: 1 }, { v: 2 }];
    expect(filterApprovedTags(rows, allow)).toHaveLength(0);
  });
});

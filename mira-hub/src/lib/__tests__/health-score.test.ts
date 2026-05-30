import { describe, expect, it } from "vitest";
import { EMPTY_COUNTS, computeHealthScore } from "../health-score";

describe("computeHealthScore — namespace readiness L0-L6", () => {
  it("returns L0 for a brand-new tenant with no data", () => {
    const r = computeHealthScore(EMPTY_COUNTS);
    expect(r.level).toBe(0);
    expect(r.levelName).toMatch(/L0/);
    expect(r.nextStep.toLowerCase()).toContain("wizard");
  });

  it("returns L0 when called with no counts at all", () => {
    expect(computeHealthScore().level).toBe(0);
  });

  it("promotes to L1 when the wizard is completed even without explicit sites", () => {
    const r = computeHealthScore({ wizardCompleted: true });
    expect(r.level).toBe(1);
  });

  it("promotes to L1 when at least one site row exists", () => {
    const r = computeHealthScore({ sites: 1 });
    expect(r.level).toBe(1);
  });

  it("requires both line and asset for L2", () => {
    expect(computeHealthScore({ sites: 1, lines: 1 }).level).toBe(1);
    expect(computeHealthScore({ sites: 1, lines: 1, assets: 1 }).level).toBe(2);
  });

  it("promotes to L3 only when components attach to an asset", () => {
    expect(computeHealthScore({ sites: 1, lines: 1, assets: 1, components: 1 }).level).toBe(3);
    // Components without an asset stays at L1 (the sites contribute).
    expect(computeHealthScore({ components: 1 }).level).toBe(0);
  });

  it("L4 requires components AND grounding docs", () => {
    const c = { sites: 1, lines: 1, assets: 1, components: 1 };
    expect(computeHealthScore({ ...c }).level).toBe(3);
    expect(computeHealthScore({ ...c, docs: 1 }).level).toBe(4);
  });

  it("L5 — proposal flywheel — needs at least one verified and one pending", () => {
    const c = { sites: 1, lines: 1, assets: 1, components: 1, docs: 1 };
    expect(computeHealthScore({ ...c, proposalsPending: 5 }).level).toBe(4);
    expect(computeHealthScore({ ...c, proposalsPending: 5, proposalsVerified: 1 }).level).toBe(5);
  });

  it("L6 — production-ready — verified outnumbers pending with sufficient volume", () => {
    const c = {
      sites: 1,
      lines: 1,
      assets: 1,
      components: 5,
      docs: 1,
      proposalsPending: 3,
      proposalsVerified: 11,
    };
    expect(computeHealthScore(c).level).toBe(6);
  });

  it("does NOT cross to L6 when verified is below volume threshold", () => {
    const c = {
      sites: 1,
      lines: 1,
      assets: 1,
      components: 5,
      docs: 1,
      proposalsPending: 1,
      proposalsVerified: 5, // below the >=10 threshold
    };
    expect(computeHealthScore(c).level).toBe(5);
  });

  it("does NOT cross to L6 when verified equals pending (must strictly outnumber)", () => {
    const c = {
      sites: 1,
      lines: 1,
      assets: 1,
      components: 5,
      docs: 1,
      proposalsPending: 10,
      proposalsVerified: 10,
    };
    expect(computeHealthScore(c).level).toBe(5);
  });

  it("supplies a next-step hint at every level", () => {
    for (let level = 0; level <= 6; level++) {
      const counts = buildCountsForLevel(level);
      const r = computeHealthScore(counts);
      expect(r.level).toBe(level);
      expect(r.nextStep.length).toBeGreaterThan(10);
    }
  });
});

function buildCountsForLevel(level: number) {
  switch (level) {
    case 0:
      return EMPTY_COUNTS;
    case 1:
      return { ...EMPTY_COUNTS, sites: 1 };
    case 2:
      return { ...EMPTY_COUNTS, sites: 1, lines: 1, assets: 1 };
    case 3:
      return { ...EMPTY_COUNTS, sites: 1, lines: 1, assets: 1, components: 1 };
    case 4:
      return { ...EMPTY_COUNTS, sites: 1, lines: 1, assets: 1, components: 1, docs: 1 };
    case 5:
      return {
        ...EMPTY_COUNTS,
        sites: 1,
        lines: 1,
        assets: 1,
        components: 1,
        docs: 1,
        proposalsPending: 2,
        proposalsVerified: 1,
      };
    case 6:
      return {
        ...EMPTY_COUNTS,
        sites: 1,
        lines: 1,
        assets: 1,
        components: 5,
        docs: 1,
        proposalsPending: 3,
        proposalsVerified: 11,
      };
    default:
      return EMPTY_COUNTS;
  }
}

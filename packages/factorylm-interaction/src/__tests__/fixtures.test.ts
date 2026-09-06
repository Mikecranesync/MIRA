import { FIXTURE_IDS, fixtures, getFixture } from "@factorylm/interaction";

const REQUIRED_FIXTURE_IDS = [
  "empty",
  "general-ask",
  "machine-ask",
  "project-tree",
  "attachments",
  "grounded-answer",
  "machine-evidence",
  "safety-stop",
  "work-run",
  "error-retry",
  "offline-sync",
  "enterprise-inspector",
  "long-history",
] as const;

const REQUIRED_PART_TYPES = [
  "text",
  "attachment",
  "source",
  "evidence_basis",
  "machine_evidence",
  "visual_observation",
  "safety_notice",
  "tool_call",
  "tool_result",
  "approval_request",
  "plan",
  "plan_step",
  "observation",
  "hypothesis",
  "finding",
  "artifact",
  "context_change",
  "status",
  "usage",
  "error",
  "followups",
  "unknown",
] as const;

function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeeplyFrozen);
}

describe("authoritative interaction fixtures", () => {
  it("covers every Phase 1 review state", () => {
    for (const id of REQUIRED_FIXTURE_IDS) expect(FIXTURE_IDS).toContain(id);
  });

  it("links one canonical machine into multiple projects", () => {
    const scenario = getFixture("project-tree");
    const links = scenario.projects
      .flatMap((project) => project.children)
      .flatMap((item) => (item.kind === "folder" ? item.children : [item]))
      .filter((item) => item.kind === "machine-link");

    expect(new Set(links.map((link) => link.machineId)).size).toBeLessThan(links.length);
    expect(scenario.machines.some((machine) => machine.id === links[0]?.machineId)).toBe(true);
  });

  it("declares every viewport and theme as a review dimension", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = getFixture(id);
      expect(fixture.review.themes).toEqual(expect.arrayContaining(["light", "dark"]));
      expect(fixture.review.viewports).toEqual(expect.arrayContaining(["desktop", "tablet", "mobile"]));
    }
  });

  it("covers the complete ordered-part vocabulary without dropping unknown parts", () => {
    const partTypes = new Set(
      FIXTURE_IDS.flatMap((id) => getFixture(id).thread.turns.flatMap((turn) => turn.parts.map((part) => part.type))),
    );

    for (const type of REQUIRED_PART_TYPES) expect(partTypes).toContain(type);
  });

  it("returns deterministic deeply immutable fixture objects", () => {
    for (const id of FIXTURE_IDS) {
      expect(getFixture(id)).toBe(fixtures[id]);
      expect(isDeeplyFrozen(getFixture(id))).toBe(true);
    }
  });
});

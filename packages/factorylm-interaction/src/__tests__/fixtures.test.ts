import { describe, expect, it } from "bun:test";
import { FIXTURE_IDS, PROFILES, fixtures, getFixture } from "@factorylm/interaction";
import type { MachineLink, ProjectNode } from "@factorylm/interaction";

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

function machineLinks(nodes: readonly ProjectNode[]): readonly MachineLink[] {
  return nodes.flatMap((node) => {
    if (node.kind === "folder") return machineLinks(node.children);
    return node.kind === "machine-link" ? [node] : [];
  });
}

describe("authoritative interaction fixtures", () => {
  it("covers every Phase 1 review state", () => {
    for (const id of REQUIRED_FIXTURE_IDS) expect(FIXTURE_IDS).toContain(id);
  });

  it("links one canonical machine into multiple projects", () => {
    const scenario = getFixture("project-tree");
    const driveAProjects = scenario.projects.filter((project) =>
      machineLinks(project.children).some((link) => link.machineId === "machine-drive-a"),
    );

    expect(driveAProjects).toHaveLength(2);
    expect(new Set(driveAProjects.map((project) => project.id)).size).toBe(2);
    expect(scenario.machines.find((machine) => machine.id === "machine-drive-a")?.canonicalAssetId).toBe(
      "asset-launch-2-drive-a",
    );
  });

  it("binds every machine-scoped thread to the matching canonical asset", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = getFixture(id);
      const machineId = fixture.activeContext.machineId;
      if (!machineId) continue;

      const machine = fixture.machines.find((candidate) => candidate.id === machineId);
      expect(machine).toBeDefined();
      expect(fixture.thread.primaryAssetId).toBe(machine?.canonicalAssetId);
    }
  });

  it("declares every viewport and theme as a review dimension", () => {
    expect(Object.keys(PROFILES).sort()).toEqual(["hub", "mobile", "public", "web"]);

    for (const id of FIXTURE_IDS) {
      const fixture = getFixture(id);
      expect(fixture.review.themes).toEqual(expect.arrayContaining(["light", "dark"]));
      expect(fixture.review.viewports).toEqual(expect.arrayContaining(["desktop", "tablet", "mobile"]));
      expect(fixture.review.surfaces).toEqual(expect.arrayContaining(["public", "web", "mobile", "hub"]));
    }
  });

  it("marks every machine-bound context as confirmed and authorized", () => {
    for (const id of FIXTURE_IDS) {
      const fixture = getFixture(id);
      const contexts = [
        fixture.activeContext,
        ...fixture.thread.turns.map((turn) => turn.context),
        ...(fixture.run ? [fixture.run.contextSnapshot] : []),
      ];

      for (const context of contexts) {
        if (!context.machineId) continue;
        expect(context.machineIdentity).toBe("confirmed");
        expect(context.evidenceAuthorization).toBe("authorized");
        expect(fixture.machines.some((machine) => machine.id === context.machineId)).toBe(true);
      }
    }
  });

  it("uses the matched canonical asset in machine-evidence parts", () => {
    const fixture = getFixture("machine-evidence");
    const canonicalAssetId = fixture.machines.find((machine) => machine.id === fixture.activeContext.machineId)
      ?.canonicalAssetId;
    const evidence = fixture.thread.turns.flatMap((turn) =>
      turn.parts.filter((part) => part.type === "machine_evidence"),
    );

    expect(evidence).toHaveLength(2);
    expect(canonicalAssetId).toBeDefined();
    if (!canonicalAssetId) throw new Error("Machine evidence fixture must select a canonical machine.");
    for (const part of evidence) expect(part.evidence.assetId).toBe(canonicalAssetId);
  });

  it("keeps Drive A historical snapshots after future context changes to Drive B", () => {
    const fixture = getFixture("long-history");
    const [first, second, future] = fixture.thread.turns;

    expect(first?.context.machineId).toBe("machine-drive-a");
    expect(second?.context.machineId).toBe("machine-drive-a");
    expect(future?.context.machineId).toBe("machine-drive-b");
    expect(fixture.activeContext.machineId).toBe("machine-drive-b");
  });

  it("keeps Work fixture, thread, turn, and run identifiers consistent", () => {
    const fixture = getFixture("work-run");
    const run = fixture.run;

    expect(fixture.thread.mode).toBe("work");
    expect(run).toBeDefined();
    expect(run?.threadId).toBe(fixture.thread.id);
    expect(run?.contextSnapshot).toEqual(fixture.activeContext);
    expect(fixture.thread.turns.every((turn) => turn.runId === run?.id)).toBe(true);
  });

  it("covers the complete ordered-part vocabulary without dropping unknown parts", () => {
    const partTypes = new Set(
      FIXTURE_IDS.flatMap((id) => getFixture(id).thread.turns.flatMap((turn) => turn.parts.map((part) => part.type))),
    );

    for (const type of REQUIRED_PART_TYPES) expect(partTypes).toContain(type);
  });

  it("returns deterministic deeply immutable fixture objects", () => {
    expect(Object.isFrozen(FIXTURE_IDS)).toBe(true);

    for (const id of FIXTURE_IDS) {
      expect(getFixture(id)).toBe(fixtures[id]);
      expect(isDeeplyFrozen(getFixture(id))).toBe(true);
    }
  });
});

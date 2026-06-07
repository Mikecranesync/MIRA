// Vitest coverage for the asset-agent lifecycle transition rules.
//
// Run: cd mira-hub && npx vitest run src/lib/asset-agent-transition
//
// These are PURE rules — no DB. The DB-applying wrapper (transitionAssetAgent)
// is exercised through the route tests with a mocked tenant-context client.
//
// Spec: docs/specs/asset-agent-validation-spec.md §4 (lifecycle) + §5 (approve)

import { describe, it, expect } from "vitest";
import {
  ASSET_AGENT_STATES,
  validateTransition,
  IllegalTransitionError,
  MissingActorError,
} from "./asset-agent-transition";

describe("ASSET_AGENT_STATES", () => {
  it("is the 7 spec states", () => {
    expect([...ASSET_AGENT_STATES].sort()).toEqual(
      [
        "approved",
        "deployed",
        "deprecated",
        "draft",
        "rejected",
        "training",
        "validating",
      ].sort(),
    );
  });
});

describe("validateTransition — legal forward path", () => {
  const path: [string, string][] = [
    ["draft", "training"],
    ["training", "validating"],
    ["validating", "approved"],
    ["approved", "deployed"],
  ];
  for (const [from, to] of path) {
    it(`${from} → ${to} is allowed`, () => {
      const actor = to === "approved" ? { approvedBy: "human:user_1" } : undefined;
      expect(() => validateTransition(from, to, actor)).not.toThrow();
    });
  }
});

describe("validateTransition — terminal/admin transitions", () => {
  it("any active state → rejected is allowed", () => {
    for (const from of ["draft", "training", "validating", "approved", "deployed"]) {
      expect(() => validateTransition(from, "rejected")).not.toThrow();
    }
  });
  it("validating → rejected (validation fail) is allowed", () => {
    expect(() => validateTransition("validating", "rejected")).not.toThrow();
  });
  it("any state → deprecated is allowed", () => {
    for (const from of ["draft", "training", "validating", "approved", "deployed"]) {
      expect(() => validateTransition(from, "deprecated")).not.toThrow();
    }
  });
});

describe("validateTransition — illegal transitions throw", () => {
  it("draft → approved (skips validation) throws", () => {
    expect(() => validateTransition("draft", "approved", { approvedBy: "human:u" })).toThrow(
      IllegalTransitionError,
    );
  });
  it("draft → deployed throws", () => {
    expect(() => validateTransition("draft", "deployed")).toThrow(IllegalTransitionError);
  });
  it("deployed → validating (backwards) throws", () => {
    expect(() => validateTransition("deployed", "validating")).toThrow(IllegalTransitionError);
  });
  it("rejected → approved (no resurrection without restart) throws", () => {
    expect(() => validateTransition("rejected", "approved", { approvedBy: "human:u" })).toThrow(
      IllegalTransitionError,
    );
  });
  it("unknown state throws", () => {
    expect(() => validateTransition("bogus", "draft")).toThrow(IllegalTransitionError);
  });
});

describe("validateTransition — approved requires a human actor (spec §4 invariant)", () => {
  it("validating → approved WITHOUT approvedBy throws MissingActorError", () => {
    expect(() => validateTransition("validating", "approved")).toThrow(MissingActorError);
  });
  it("validating → approved with empty approvedBy throws", () => {
    expect(() => validateTransition("validating", "approved", { approvedBy: "  " })).toThrow(
      MissingActorError,
    );
  });
  it("validating → approved with an actor passes", () => {
    expect(() =>
      validateTransition("validating", "approved", { approvedBy: "human:user_42" }),
    ).not.toThrow();
  });
});

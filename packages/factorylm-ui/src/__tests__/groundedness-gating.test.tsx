/**
 * Groundedness parts must not outlive the turn that earned them.
 *
 * `PartRenderer` consulted `turn.lifecycle` in exactly one place — the Retry
 * button at the `error` arm. `source`, `evidence_basis` and `followups`
 * rendered on any turn at all, and `toTurn`
 * (`mira-mobile/src/unified/to-interaction.ts`) maps parts and lifecycle
 * independently, so a FAILED turn arrives carrying every citation and basis
 * pill it had accumulated before the provider died.
 *
 * That state is not hypothetical. `mira-mobile/src/unified/__tests__/
 * to-interaction.test.ts:78` already constructs an assistant message with
 * `lifecycle: "failed"` whose parts include `basis`, `source` and `followups`,
 * and passes it through `toTurn`. Rendered as-is that is a complete
 * groundedness display — citation, authorization pill, and an invitation to
 * continue — attached to an answer that does not exist.
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  InteractionPart,
  InteractionTurn,
  Lifecycle,
  PlatformAdapter,
  ShellState,
} from "@factorylm/interaction";
import { PartRenderer, showsGroundedness } from "../parts";

const LIFECYCLES: readonly Lifecycle[] = [
  "accepted",
  "queued",
  "running",
  "waiting",
  "stopping",
  "completed",
  "stopped",
  "failed",
  "cancelled",
];

// ---------------------------------------------------------------- the rule

describe("showsGroundedness — provenance and invitations follow different rules", () => {
  it("hides provenance on a failed turn, because there is no answer to attribute", () => {
    expect(showsGroundedness("source", "failed")).toBe(false);
    expect(showsGroundedness("evidence_basis", "failed")).toBe(false);
  });

  it("KEEPS provenance on a stopped turn, because the partial answer is still on screen", () => {
    // The technician interrupted a streaming answer. The words they are reading
    // came from somewhere, and stripping the citation would leave that text
    // unattributed — the opposite failure from the one this gate fixes.
    expect(showsGroundedness("source", "stopped")).toBe(true);
    expect(showsGroundedness("evidence_basis", "stopped")).toBe(true);
  });

  it("keeps provenance on every lifecycle except failed", () => {
    for (const lifecycle of LIFECYCLES.filter((l) => l !== "failed")) {
      expect(showsGroundedness("source", lifecycle)).toBe(true);
      expect(showsGroundedness("evidence_basis", lifecycle)).toBe(true);
    }
  });

  it("offers follow-ups ONLY on a completed turn", () => {
    // An invitation to continue belongs to a turn that finished. "What next?"
    // under a stopped, failed, or still-streaming answer offers to continue
    // from a place the conversation never reached.
    for (const lifecycle of LIFECYCLES) {
      expect(showsGroundedness("followups", lifecycle)).toBe(lifecycle === "completed");
    }
  });

  it("never keys on absence — a completed turn with no sources is not the failure this gates", () => {
    // The mirror failure: a gate that fired whenever sources were missing would
    // punish an ordinary answer that legitimately had none. The rule reads the
    // lifecycle and nothing else, so it cannot.
    expect(showsGroundedness("source", "completed")).toBe(true);
    expect(showsGroundedness("evidence_basis", "completed")).toBe(true);
    expect(showsGroundedness("followups", "completed")).toBe(true);
  });
});

// ------------------------------------------------------ the render layer

const SOURCE_PART: InteractionPart = {
  type: "source",
  source: {
    id: "src-1",
    kind: "oem_documentation",
    title: "PowerFlex 525 User Manual",
    locator: "p. 44",
  },
};

const BASIS_PART: InteractionPart = {
  type: "evidence_basis",
  basis: { kind: "oem_documentation", label: "Cited from the manual", authorized: true },
};

const FOLLOWUPS_PART: InteractionPart = {
  type: "followups",
  suggestions: ["What next?"],
};

function turnWith(lifecycle: Lifecycle): InteractionTurn {
  return { id: "t1", lifecycle } as unknown as InteractionTurn;
}

function html(part: InteractionPart, lifecycle: Lifecycle): string {
  return renderToStaticMarkup(
    <PartRenderer
      part={part}
      turn={turnWith(lifecycle)}
      state={{ selectedSource: null, machines: [] } as unknown as ShellState}
      dispatch={() => {}}
      adapter={{} as PlatformAdapter}
    />,
  );
}

describe("PartRenderer — a failed turn renders no groundedness chrome", () => {
  it("renders the citation, the basis pill and the follow-ups on a completed turn", () => {
    // The positive control. Without this the suite below could pass because the
    // parts never render at all.
    expect(html(SOURCE_PART, "completed")).toContain('data-part-type="source"');
    expect(html(BASIS_PART, "completed")).toContain('data-part-type="evidence_basis"');
    expect(html(FOLLOWUPS_PART, "completed")).toContain('data-part-type="followups"');
  });

  it("renders none of the three on a failed turn", () => {
    expect(html(SOURCE_PART, "failed")).toBe("");
    expect(html(BASIS_PART, "failed")).toBe("");
    expect(html(FOLLOWUPS_PART, "failed")).toBe("");
  });

  it("does not claim authorization for an answer that was never produced", () => {
    // The sharpest of the three: `● Cited from the manual · authorized` is an
    // authorization assertion, and on a failed turn it is an assertion about
    // nothing. Models never self-promote to trusted
    // (.claude/rules/materialized-evidence.md rule 9); neither should chrome.
    expect(html(BASIS_PART, "completed")).toContain("authorized");
    expect(html(BASIS_PART, "failed")).not.toContain("authorized");
  });

  it("keeps the citation on a stopped turn", () => {
    expect(html(SOURCE_PART, "stopped")).toContain('data-part-type="source"');
  });

  it("withholds follow-ups on a stopped turn even though the citation stays", () => {
    // The asymmetry, at the render layer: same turn, two different answers.
    expect(html(SOURCE_PART, "stopped")).toContain('data-part-type="source"');
    expect(html(FOLLOWUPS_PART, "stopped")).toBe("");
  });
});

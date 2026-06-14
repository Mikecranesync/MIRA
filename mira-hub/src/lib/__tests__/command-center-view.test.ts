import { describe, it, expect } from "vitest";
import {
  collectConfiguredDisplays,
  isCommandCenterEmpty,
  type DisplayNode,
} from "../command-center-view";

function node(p: Partial<DisplayNode> & { id: string }): DisplayNode {
  return {
    name: p.name ?? p.id,
    unsPath: p.unsPath ?? null,
    hasLiveDisplay: p.hasLiveDisplay ?? false,
    displayId: p.displayId ?? null,
    displayLabel: p.displayLabel ?? null,
    displayType: p.displayType ?? null,
    live: p.live ?? false,
    tagFreshness: p.tagFreshness ?? "unknown",
    children: p.children ?? [],
    ...p,
  };
}

describe("collectConfiguredDisplays", () => {
  it("returns only nodes with a configured display, ignoring audit/no-display nodes", () => {
    const tree: DisplayNode[] = [
      node({ id: "audit-1", name: "Audit 0o494d", unsPath: "audit_0o494d" }),
      node({
        id: "site",
        name: "Bench",
        unsPath: "enterprise.bench",
        children: [
          node({
            id: "conv",
            name: "Conveyor",
            unsPath: "enterprise.bench.conv_simple",
            hasLiveDisplay: true,
            displayId: "d-1",
            displayLabel: "Conv Simple — Live",
            displayType: "web_iframe",
            live: true,
            tagFreshness: "live",
          }),
          node({ id: "pump", name: "Pump", unsPath: "enterprise.bench.pump" }),
        ],
      }),
    ];
    const displays = collectConfiguredDisplays(tree);
    expect(displays).toHaveLength(1);
    expect(displays[0]).toMatchObject({
      nodeId: "conv",
      displayId: "d-1",
      label: "Conv Simple — Live",
      unsPath: "enterprise.bench.conv_simple",
      live: true,
    });
  });

  it("keeps a DOWN display in the list (configured but unreachable, not missing)", () => {
    const displays = collectConfiguredDisplays([
      node({ id: "conv", hasLiveDisplay: true, displayId: "d-1", live: false, tagFreshness: "stale" }),
    ]);
    expect(displays).toHaveLength(1);
    expect(displays[0].live).toBe(false);
  });

  it("falls back to the node name when the display has no label", () => {
    const displays = collectConfiguredDisplays([
      node({ id: "conv", name: "Conveyor 1", hasLiveDisplay: true, displayId: "d-1", displayLabel: null }),
    ]);
    expect(displays[0].label).toBe("Conveyor 1");
  });

  it("preserves UNS (depth-first) order and does not reshuffle by reachability", () => {
    const displays = collectConfiguredDisplays([
      node({ id: "a", name: "A", hasLiveDisplay: true, displayId: "da", live: false }),
      node({ id: "b", name: "B", hasLiveDisplay: true, displayId: "db", live: true }),
    ]);
    expect(displays.map((d) => d.nodeId)).toEqual(["a", "b"]);
  });

  it("ignores a node flagged hasLiveDisplay but missing a displayId", () => {
    const displays = collectConfiguredDisplays([
      node({ id: "broken", hasLiveDisplay: true, displayId: null }),
    ]);
    expect(displays).toHaveLength(0);
  });
});

describe("isCommandCenterEmpty", () => {
  it("is empty when there are no displays and no telemetry (the secret-shopper case)", () => {
    expect(
      isCommandCenterEmpty({ displaysTotal: 0, freshnessCounts: { live: 0, stale: 0, simulated: 0 } }),
    ).toBe(true);
  });

  it("is NOT empty once a display is configured", () => {
    expect(
      isCommandCenterEmpty({ displaysTotal: 1, freshnessCounts: { live: 0, stale: 0, simulated: 0 } }),
    ).toBe(false);
  });

  it("is NOT empty when telemetry is arriving even with no display", () => {
    expect(
      isCommandCenterEmpty({ displaysTotal: 0, freshnessCounts: { live: 0, stale: 2, simulated: 0 } }),
    ).toBe(false);
    expect(
      isCommandCenterEmpty({ displaysTotal: 0, freshnessCounts: { live: 0, stale: 0, simulated: 5 } }),
    ).toBe(false);
  });
});

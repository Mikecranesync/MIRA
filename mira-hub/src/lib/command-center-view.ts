// Command Center view curation — pure logic for turning the raw namespace tree
// (every kg_entities node, incl. audit/test nodes) into a credible operator
// view: configured live displays first, an honest empty/onboarding state when
// nothing is connected, and the full tree demoted to a "browse everything"
// affordance.
//
// Pure + framework-free so it's unit-testable without a DB or a browser
// (mirrors the buildTree pure-test pattern in api/namespace/tree/route.test.ts).

export type TagFreshness = "live" | "stale" | "simulated" | "unknown";

// Structural subset of CommandCenterNode (api/command-center/tree/route.ts) —
// kept local to avoid importing a server route into a shared lib.
export interface DisplayNode {
  id: string;
  name: string;
  unsPath: string | null;
  hasLiveDisplay: boolean;
  displayId: string | null;
  displayLabel: string | null;
  displayType: string | null;
  live: boolean;
  tagFreshness: TagFreshness;
  children: DisplayNode[];
}

export interface ConfiguredDisplay {
  nodeId: string;
  displayId: string;
  label: string; // displayLabel ?? node.name — never empty
  nodeName: string;
  unsPath: string | null;
  displayType: string | null;
  /** HTTP reachability of the display URL. A down display stays in the list. */
  live: boolean;
  tagFreshness: TagFreshness;
}

/**
 * Flatten the namespace tree to just the nodes that have a configured live
 * display, in UNS (depth-first) order. Order is independent of reachability so
 * the list does NOT reshuffle as displays flap up/down on each poll — a down
 * display keeps its place and is marked down, never dropped.
 */
export function collectConfiguredDisplays(nodes: DisplayNode[]): ConfiguredDisplay[] {
  const out: ConfiguredDisplay[] = [];
  const walk = (ns: DisplayNode[]) => {
    for (const n of ns) {
      if (n.hasLiveDisplay && n.displayId) {
        out.push({
          nodeId: n.id,
          displayId: n.displayId,
          label: (n.displayLabel && n.displayLabel.trim()) || n.name,
          nodeName: n.name,
          unsPath: n.unsPath,
          displayType: n.displayType,
          live: n.live,
          tagFreshness: n.tagFreshness,
        });
      }
      walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

export interface FreshnessCounts {
  live: number;
  stale: number;
  simulated: number;
}

/**
 * The Command Center is "empty" — show the onboarding state instead of dumping
 * the namespace — only when there is nothing operational to look at: zero
 * configured displays AND zero telemetry of any kind. If telemetry is arriving
 * (live/stale/simulated) the nodes are meaningful even without a display, so we
 * do NOT show the empty state.
 */
export function isCommandCenterEmpty(summary: {
  displaysTotal: number;
  freshnessCounts: FreshnessCounts;
}): boolean {
  const { displaysTotal, freshnessCounts: f } = summary;
  return displaysTotal === 0 && f.live === 0 && f.stale === 0 && f.simulated === 0;
}

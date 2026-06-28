/**
 * Pure-logic tests for Command Center tag freshness. Framework-free — runs with
 * `bun test src/lib/command-center-freshness.test.ts` without `bun install`.
 */
import { expect, test, describe } from "vitest";
import {
  DEFAULT_FRESHNESS_WINDOW_S,
  type FreshnessTagRow,
  freshnessCounts,
  rollupFreshness,
  tagStatuses,
} from "./command-center-freshness";

const NOW = 1_000_000_000_000; // fixed clock
const secAgo = (s: number) => new Date(NOW - s * 1000).toISOString();

function row(over: Partial<FreshnessTagRow>): FreshnessTagRow {
  return {
    uns_path: "enterprise.site.line1.cv101.motor_current",
    last_seen_at: secAgo(1),
    simulated: false,
    expected_freshness_seconds: null,
    ...over,
  };
}

describe("tagStatuses", () => {
  test("real + recent → live_real", () => {
    const s = tagStatuses([row({ last_seen_at: secAgo(5) })], NOW);
    expect(s).toEqual([{ path: "enterprise.site.line1.cv101.motor_current", status: "live_real" }]);
  });

  test("real + beyond default window → stale_real", () => {
    const s = tagStatuses([row({ last_seen_at: secAgo(DEFAULT_FRESHNESS_WINDOW_S + 10) })], NOW);
    expect(s[0].status).toBe("stale_real");
  });

  test("per-tag expected_freshness_seconds overrides default", () => {
    // 8s old, window 5s → stale; window 30s → live
    expect(tagStatuses([row({ last_seen_at: secAgo(8), expected_freshness_seconds: 5 })], NOW)[0].status).toBe("stale_real");
    expect(tagStatuses([row({ last_seen_at: secAgo(8), expected_freshness_seconds: 30 })], NOW)[0].status).toBe("live_real");
  });

  test("simulated → simulated regardless of age", () => {
    expect(tagStatuses([row({ simulated: true, last_seen_at: secAgo(1) })], NOW)[0].status).toBe("simulated");
    expect(tagStatuses([row({ simulated: true, last_seen_at: secAgo(99999) })], NOW)[0].status).toBe("simulated");
  });

  test("null uns_path dropped", () => {
    expect(tagStatuses([row({ uns_path: null })], NOW)).toEqual([]);
  });

  test("null last_seen_at (real) → stale_real", () => {
    expect(tagStatuses([row({ last_seen_at: null })], NOW)[0].status).toBe("stale_real");
  });
});

describe("rollupFreshness", () => {
  const P = "enterprise.site.line1";
  const mk = (path: string, status: "live_real" | "stale_real" | "simulated") => ({ path, status });

  test("null node path → unknown", () => {
    expect(rollupFreshness(null, [mk(`${P}.cv101.x`, "live_real")])).toBe("unknown");
  });

  test("no matching tags → unknown (not defaulting to live/stale)", () => {
    expect(rollupFreshness(P, [mk("enterprise.other.cv1.x", "live_real")])).toBe("unknown");
  });

  test("exact path match counts", () => {
    expect(rollupFreshness(P, [mk(P, "live_real")])).toBe("live");
  });

  test("descendant match counts", () => {
    expect(rollupFreshness(P, [mk(`${P}.cv101.motor`, "live_real")])).toBe("live");
  });

  test("prefix sibling does NOT match (line1 vs line10)", () => {
    expect(rollupFreshness(P, [mk("enterprise.site.line10.cv1.x", "live_real")])).toBe("unknown");
  });

  test("precedence: one fresh real + one simulated → live", () => {
    expect(
      rollupFreshness(P, [mk(`${P}.cv101.x`, "live_real"), mk(`${P}.cv102.y`, "simulated")]),
    ).toBe("live");
  });

  test("precedence: stale real + simulated (no live) → stale", () => {
    expect(
      rollupFreshness(P, [mk(`${P}.cv101.x`, "stale_real"), mk(`${P}.cv102.y`, "simulated")]),
    ).toBe("stale");
  });

  test("only simulated tags → simulated", () => {
    expect(rollupFreshness(P, [mk(`${P}.cv101.x`, "simulated")])).toBe("simulated");
  });
});

describe("freshnessCounts", () => {
  test("counts tags by status", () => {
    const c = freshnessCounts([
      { path: "a", status: "live_real" },
      { path: "b", status: "live_real" },
      { path: "c", status: "stale_real" },
      { path: "d", status: "simulated" },
    ]);
    expect(c).toEqual({ live: 2, stale: 1, simulated: 1 });
  });
});

describe("end-to-end via cache rows", () => {
  test("mixed plant rolls up correctly at the line node", () => {
    const rows: FreshnessTagRow[] = [
      row({ uns_path: "enterprise.site.line1.cv101.current", last_seen_at: secAgo(2) }), // live_real
      row({ uns_path: "enterprise.site.line1.cv102.current", simulated: true }), // simulated
      row({ uns_path: "enterprise.site.line2.cv201.current", last_seen_at: secAgo(300) }), // stale_real
    ];
    const st = tagStatuses(rows, NOW);
    expect(rollupFreshness("enterprise.site.line1", st)).toBe("live");
    expect(rollupFreshness("enterprise.site.line2", st)).toBe("stale");
    expect(rollupFreshness("enterprise.site", st)).toBe("live"); // any live descendant
    expect(rollupFreshness("enterprise.nope", st)).toBe("unknown");
  });
});

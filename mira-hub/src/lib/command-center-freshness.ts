/**
 * Command Center tag-freshness logic — PURE, no framework imports.
 *
 * Phase 4 of the gap-closure work stream
 * (docs/plans/current-state-gap-closure-plan.md §3 G9): the Command Center's
 * "live" status must mean TAG FRESHNESS (is real telemetry arriving?), not just
 * HTTP display reachability. Reachability stays a separate field on the node.
 *
 * Source of truth: live_signal_cache (a.k.a. current_tag_state) — the
 * latest-value-per-tag cache, extended by migration 036 with uns_path /
 * source_system / simulated / freshness columns. We compute freshness from
 * last_seen_at at read time (NOT the stored freshness_status column, which can
 * go stale between writes).
 *
 * Kept import-free so it can be unit-tested with `bun test` without the Hub
 * toolchain — same store-agnostic / injected-clock pattern as the Phase-2
 * ingest core.
 */

export type TagFreshness = "live" | "stale" | "simulated" | "unknown";

/** Per-tag classification before subtree roll-up. */
export type TagStatus = "live_real" | "stale_real" | "simulated";

/** A row from live_signal_cache (current_tag_state). */
export interface FreshnessTagRow {
  uns_path: string | null;
  last_seen_at: string | Date | null;
  simulated: boolean | null;
  expected_freshness_seconds: number | null;
}

/** Default freshness window when a tag has no per-tag expected_freshness_seconds.
 * The Ignition collector streams every ~2 s; 60 s tolerates jitter / brief gaps
 * before a tag is called stale. */
export const DEFAULT_FRESHNESS_WINDOW_S = 60;

export interface PathStatus {
  path: string;
  status: TagStatus;
}

function toMs(t: string | Date | null): number | null {
  if (t === null || t === undefined) return null;
  const ms = t instanceof Date ? t.getTime() : new Date(t).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Classify each cache row into a per-tag status at time `nowMs`.
 * Rows without a uns_path are dropped (they can't roll up to a tree node).
 * Simulated rows are "simulated" regardless of age — freshness of fake data is
 * moot; what matters is that only simulated data is available for that tag.
 */
export function tagStatuses(
  rows: FreshnessTagRow[],
  nowMs: number,
  defaultWindowS: number = DEFAULT_FRESHNESS_WINDOW_S,
): PathStatus[] {
  const out: PathStatus[] = [];
  for (const r of rows) {
    if (!r.uns_path) continue;
    if (r.simulated) {
      out.push({ path: r.uns_path, status: "simulated" });
      continue;
    }
    const seen = toMs(r.last_seen_at);
    const windowS = r.expected_freshness_seconds ?? defaultWindowS;
    const fresh = seen !== null && nowMs - seen <= windowS * 1000;
    out.push({ path: r.uns_path, status: fresh ? "live_real" : "stale_real" });
  }
  return out;
}

/** True if `tagPath` is the node path itself or a descendant of it.
 * The trailing "." prevents `line1` from matching `line10`. */
function underNode(tagPath: string, nodePath: string): boolean {
  return tagPath === nodePath || tagPath.startsWith(nodePath + ".");
}

/**
 * Roll up the freshness of a UNS node from the tags at-or-below it.
 * Precedence: live > stale > simulated > unknown.
 *   - any fresh real tag  → "live"
 *   - else any stale real → "stale"
 *   - else any simulated  → "simulated"  ("only simulated data available")
 *   - no mapped tags / null path → "unknown"
 */
export function rollupFreshness(unsPath: string | null, statuses: PathStatus[]): TagFreshness {
  if (!unsPath) return "unknown";
  let hasLive = false;
  let hasStale = false;
  let hasSim = false;
  for (const s of statuses) {
    if (!underNode(s.path, unsPath)) continue;
    if (s.status === "live_real") hasLive = true;
    else if (s.status === "stale_real") hasStale = true;
    else hasSim = true;
  }
  if (hasLive) return "live";
  if (hasStale) return "stale";
  if (hasSim) return "simulated";
  return "unknown";
}

/** Tenant-wide tag counts by freshness, for the header summary. */
export function freshnessCounts(statuses: PathStatus[]): {
  live: number;
  stale: number;
  simulated: number;
} {
  let live = 0;
  let stale = 0;
  let simulated = 0;
  for (const s of statuses) {
    if (s.status === "live_real") live++;
    else if (s.status === "stale_real") stale++;
    else simulated++;
  }
  return { live, stale, simulated };
}

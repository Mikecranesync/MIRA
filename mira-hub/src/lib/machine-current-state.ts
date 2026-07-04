/**
 * Current machine state derivation — PURE, no framework imports.
 *
 * The Machine Memory card's "State" bubble must show the CURRENT state, not
 * the newest machine_state_window row verbatim: that row may be a CLOSED
 * window from hours ago (the historian derives windows in batches), and a
 * closed window with no fresh signals means the stream is down, not that the
 * machine is still in that state.
 *
 * Inputs: the newest window (open or closed) and the live-signal freshness
 * roll-up for the asset subtree (command-center-freshness.ts). Same
 * import-free / injected-inputs pattern as command-center-freshness.ts so it
 * unit-tests without the Hub toolchain.
 */

import type { TagFreshness } from "./command-center-freshness";

export interface WindowRow {
  state: string;
  started_at: string;
  ended_at: string | null;
}

export interface CurrentState {
  /** Window state, or a "comm_down"/"unknown" downgrade when signals dried up. */
  state: string;
  /** When this state began (open window) or was last confirmed (closed window). */
  since: string | null;
  /** True when live signals back the state right now. */
  fresh: boolean;
}

export function deriveCurrentState(
  latestWindow: WindowRow | null,
  freshness: TagFreshness,
): CurrentState | null {
  if (latestWindow) {
    if (latestWindow.ended_at === null) {
      // Open window — the historian says the machine is in this state now.
      return { state: latestWindow.state, since: latestWindow.started_at, fresh: freshness === "live" };
    }
    // Closed window: only trustworthy as "current" while signals still flow.
    if (freshness === "live") {
      return { state: latestWindow.state, since: latestWindow.ended_at, fresh: true };
    }
    if (freshness === "stale") {
      return { state: "comm_down", since: null, fresh: false };
    }
    return { state: "unknown", since: null, fresh: false };
  }
  // No windows yet (040 backlog or brand-new asset).
  if (freshness === "live") {
    return { state: "unknown", since: null, fresh: true };
  }
  if (freshness === "stale") {
    return { state: "comm_down", since: null, fresh: false };
  }
  return null;
}

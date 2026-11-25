/**
 * manual-search-driver.ts — the Hub's host-side driver around the shared,
 * pure `manual-search-follow.ts` state machine (#4195 F6/F8/F9).
 *
 * Mobile wires its OWN timer around the follower directly inside
 * `UnifiedChat.tsx` (a React component, directly testable there via
 * `@testing-library/react` + jsdom, both present in `mira-mobile`).
 * `mira-hub` has NEITHER jsdom nor `@testing-library/react`
 * (`vitest.config.ts`: `environment: "node"`), and adding either for ONE
 * driver would itself be the commodity-before-custom violation this slice is
 * trying to avoid (a whole new test environment for one small state driver).
 * So the TIMER-SCHEDULING LOGIC is extracted here, injectable and
 * framework-free, directly unit-testable with vitest's fake timers and no
 * React mount at all. `hub-host.tsx` creates ONE instance of this driver and
 * wires its `onStateChange`/`onRefreshSources` callbacks into its own
 * `useState`/`loadDetail` — see the call site there for the note on why a
 * `HubShellHost` mount test is not attempted.
 *
 * `fetchStatus` is NOT a second fetch path: `hub-host.tsx` passes a closure
 * that calls `loadDetail` (the EXISTING, already-used getJson on the
 * notebook-detail route) and returns its `manualSearch` field — this module
 * owns none of that I/O itself, only the timer and the follower advance.
 */
// Relative import, not the `@factorylm/interaction` alias (matching
// `to-interaction.ts` in this same directory): the alias is a tsconfig
// `paths` entry Next.js's webpack resolves, but vitest's `environment: "node"`
// config here has no matching `resolve.alias` for it, and this file must be
// importable from a plain vitest unit test (see this module's own header).
import {
  advanceManualSearchFollow,
  observeLiveManualSearchFrame,
  reseedManualSearchFollow,
  type ManualSearchFollowState,
  type ManualSearchStatus,
} from "../../../packages/factorylm-interaction/src";

export interface ManualSearchDriverDeps {
  /** Read the notebook's CURRENT status (reuses the Hub's existing detail fetch — never a second endpoint). */
  readonly fetchStatus: (notebookId: string) => Promise<ManualSearchStatus | null>;
  readonly onStateChange: (state: ManualSearchFollowState | null) => void;
  /** Called exactly once, the turn a followed search is found to have genuinely settled. */
  readonly onRefreshSources: () => void;
  readonly setTimeoutFn?: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (id: ReturnType<typeof setTimeout>) => void;
  readonly delayMs?: number;
}

export interface ManualSearchDriver {
  /** Seed/continue following from a status just read (hydration, or a
   *  confirmation's optimistic start). No-op if ALREADY tracking this exact
   *  notebook (the tick loop owns advancing it from here). */
  seed(notebookId: string, status: ManualSearchStatus): void;
  /** A current chat stream may start following a lookup before the detail GET. */
  observeLive(notebookId: string, status: ManualSearchStatus): void;
  /** Stop any pending timer and drop the followed state (notebook change / unmount). */
  reset(): void;
  /** The current state, or null if nothing is being followed. */
  current(): ManualSearchFollowState | null;
}

// Keep quick lookups responsive. Slower lookups may spend 60s in discovery
// and 30s downloading before indexing even starts. Spread the remaining reads
// out so an idle tab can follow that work without hammering notebook detail.
const FAST_POLL_ATTEMPTS = 5;
const FAST_POLL_DELAY_MS = 4_000;
const SLOW_POLL_DELAY_MS = 10_000;
const MAX_POLL_ATTEMPTS = 21; // 20s of fast polling and 160s of slower polling.

export function createManualSearchDriver(deps: ManualSearchDriverDeps): ManualSearchDriver {
  const schedule = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const cancel = deps.clearTimeoutFn ?? ((id) => clearTimeout(id));

  let state: ManualSearchFollowState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trackedNotebookId: string | null = null;
  // Codex round 7 F21 (#4195): the notebook-id check alone is not enough to
  // discard an obsolete poll — `seed(notebookId, …)` for a SECOND, different
  // generation of the SAME notebook changes `state` out from under an
  // already-in-flight `fetchStatus` read without changing `trackedNotebookId`
  // at all, so that stale read's continuation would pass the notebook check
  // and advance the NEW generation's state using the OLD generation's
  // snapshot. `epoch` is bumped every time `seed()` actually replaces the
  // tracked state (a real reseed, not the duplicate-seed no-op) and every
  // time `reset()` runs; each scheduled tick captures the epoch it was
  // scheduled under and a continuation whose epoch no longer matches is
  // discarded — same shape as `trackedNotebookId`, one layer finer.
  let epoch = 0;

  function clearTimer(): void {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function scheduleTick(notebookId: string): void {
    clearTimer();
    if (!state || state.phase !== "following") return;
    const tickEpoch = epoch;
    const delay = deps.delayMs ?? (state.attempts < FAST_POLL_ATTEMPTS ? FAST_POLL_DELAY_MS : SLOW_POLL_DELAY_MS);
    timer = schedule(() => {
      timer = null;
      void deps
        .fetchStatus(notebookId)
        .then((status) => {
          // A reset() (notebook change) OR a reseed to a newer generation
          // during the fetch must discard this now-obsolete read.
          if (!state || trackedNotebookId !== notebookId || epoch !== tickEpoch) return;
          const result = advanceManualSearchFollow(state, notebookId, status);
          state = result.state;
          deps.onStateChange(state);
          if (result.refreshSources) deps.onRefreshSources();
          scheduleTick(notebookId);
        })
        .catch(() => {
          if (!state || trackedNotebookId !== notebookId || epoch !== tickEpoch) return;
          const result = advanceManualSearchFollow(state, notebookId, null);
          state = result.state;
          deps.onStateChange(state);
          scheduleTick(notebookId);
        });
    }, delay);
  }

  function applyStatus(
    notebookId: string,
    status: ManualSearchStatus,
    observe: typeof reseedManualSearchFollow,
  ): void {
    const current = trackedNotebookId === notebookId ? state : null;
    const result = observe(current, notebookId, status, MAX_POLL_ATTEMPTS);
    trackedNotebookId = notebookId;
    state = result.state;
    if (current !== state) {
      epoch += 1;
      deps.onStateChange(state);
      scheduleTick(notebookId);
    }
    if (result.refreshSources) deps.onRefreshSources();
  }

  return {
    seed(notebookId, status) {
      applyStatus(notebookId, status, reseedManualSearchFollow);
    },
    observeLive(notebookId, status) {
      // A detail response may already have observed a newer generation than
      // this stream frame, even though both belong to the current notebook.
      const trackedStartedAt = trackedNotebookId === notebookId ? state?.status.startedAt : undefined;
      if (trackedStartedAt && status.startedAt && Date.parse(status.startedAt) < Date.parse(trackedStartedAt)) return;
      applyStatus(notebookId, status, observeLiveManualSearchFrame);
    },
    reset() {
      clearTimer();
      state = null;
      trackedNotebookId = null;
      epoch += 1; // F21: invalidate any in-flight tick from the notebook just abandoned.
    },
    current() {
      return state;
    },
  };
}

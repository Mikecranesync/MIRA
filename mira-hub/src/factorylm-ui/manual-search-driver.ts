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
  startManualSearchFollow,
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
  /** Stop any pending timer and drop the followed state (notebook change / unmount). */
  reset(): void;
  /** The current state, or null if nothing is being followed. */
  current(): ManualSearchFollowState | null;
}

export function createManualSearchDriver(deps: ManualSearchDriverDeps): ManualSearchDriver {
  const schedule = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms));
  const cancel = deps.clearTimeoutFn ?? ((id) => clearTimeout(id));
  const delay = deps.delayMs ?? 4000;

  let state: ManualSearchFollowState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let trackedNotebookId: string | null = null;

  function clearTimer(): void {
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  function scheduleTick(notebookId: string): void {
    clearTimer();
    if (!state || state.phase !== "following") return;
    timer = schedule(() => {
      timer = null;
      void deps
        .fetchStatus(notebookId)
        .then((status) => {
          // A reset() (notebook change) during the fetch must discard this read.
          if (!state || trackedNotebookId !== notebookId) return;
          const result = advanceManualSearchFollow(state, notebookId, status);
          state = result.state;
          deps.onStateChange(state);
          if (result.refreshSources) deps.onRefreshSources();
          scheduleTick(notebookId);
        })
        .catch(() => {
          if (!state || trackedNotebookId !== notebookId) return;
          const result = advanceManualSearchFollow(state, notebookId, null);
          state = result.state;
          deps.onStateChange(state);
          scheduleTick(notebookId);
        });
    }, delay);
  }

  return {
    seed(notebookId, status) {
      if (state && trackedNotebookId === notebookId) return;
      trackedNotebookId = notebookId;
      state = startManualSearchFollow(notebookId, status);
      deps.onStateChange(state);
      scheduleTick(notebookId);
    },
    reset() {
      clearTimer();
      state = null;
      trackedNotebookId = null;
    },
    current() {
      return state;
    },
  };
}

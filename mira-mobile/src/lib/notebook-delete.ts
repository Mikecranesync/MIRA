/**
 * Notebook deletion — client-side flow semantics, kept pure so they can be
 * tested without a DOM. mira-mobile has no component-test harness, so
 * behaviour that lives only inside a screen body is effectively untested;
 * anything worth asserting belongs here.
 *
 * This is the mira-mobile copy of mira-hub/src/lib/notebook-delete.ts. The two
 * apps are separate bundles and cannot import across the boundary, so the file
 * is duplicated deliberately and a contract test on each side asserts the two
 * still agree. If you change one, change both.
 */

/** Map a failed DELETE onto something a technician can act on. */
export function deleteFailureMessage(status: number): string {
  switch (status) {
    case 404:
      // Also what a concurrent delete looks like. Saying "already gone" is
      // both true and non-alarming; the row is absent either way.
      return "That notebook no longer exists.";
    case 401:
    case 403:
      return "You are not signed in, or this notebook isn't yours.";
    case 409:
      return "This notebook is still referenced by another record.";
    default:
      return "Delete failed. Check your connection and try again.";
  }
}

/**
 * Remove the deleted notebook from an already-rendered list.
 *
 * Returns a NEW array (never mutates) so React sees a changed reference and
 * re-renders; an in-place splice leaves the row on screen until some unrelated
 * state change happens to flush it.
 */
export function removeNotebookFromList<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((n) => n.id !== id);
}

/**
 * Guard against double submission.
 *
 * A disabled button is not sufficient: key-repeat on Enter and a double-tap on
 * touch both fire before React commits the disabled state, and the second
 * DELETE would 404 — surfacing a failure message for a delete that actually
 * succeeded. The guard makes the second call a no-op instead.
 */
export function createSubmitGuard() {
  let inFlight = false;
  return {
    get busy() {
      return inFlight;
    },
    /** Runs `fn` only if nothing is in flight; otherwise resolves undefined. */
    async run<T>(fn: () => Promise<T>): Promise<T | undefined> {
      if (inFlight) return undefined;
      inFlight = true;
      try {
        return await fn();
      } finally {
        inFlight = false;
      }
    },
  };
}

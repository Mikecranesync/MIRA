// mira-hub/src/lib/abort-helpers.ts
//
// Compose an optional caller-supplied AbortSignal with a default timeout
// signal. Used by every outbound fetch in the upload pipeline so a hung
// peer (Drive/Dropbox throttling, mira-ingest blocked on OpenWebUI poll,
// OpenWebUI delete sitting on a deadlocked file) can never leave a
// zombie pipeline holding event-loop slots forever.
//
// AbortSignal.any() is Node 20.3+; we run Node 22 in the standalone
// runner image (mira-hub/Dockerfile FROM node:22-alpine).

/**
 * Return an AbortSignal that fires when either:
 *   - the caller-supplied signal aborts (cancellation), or
 *   - `timeoutMs` elapses (timeout).
 *
 * If the caller didn't supply a signal, returns just the timeout signal.
 */
export function composeTimeout(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  return AbortSignal.any([signal, timeoutSignal]);
}

/**
 * Return true if `err` came from an AbortSignal firing — either an explicit
 * cancellation (AbortError) or a timeout (TimeoutError). Both manifest as
 * DOMException in Node.
 */
export function isAbortError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "AbortError" || err.name === "TimeoutError")
  );
}

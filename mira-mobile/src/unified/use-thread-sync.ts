/**
 * #3990 follow-ups: the open thread converges on server truth when the app
 * returns to the foreground, however the resume races with an answer or with
 * another reload.
 *
 * - #4637: a resume while an answer is in flight (or a reload that lands
 *   during one) is owed, not dropped. One reload runs when the answer settles,
 *   however many resumes arrived meanwhile.
 * - #4638: every detail load for the view, resume or ordinary refresh, takes a
 *   generation. Only the newest-started load commits, and only for the view it
 *   was started for, so an older response that lands last is discarded whole.
 *
 * `reloadOnResume` is the screen's own reload; it calls `load` like any other
 * fetch. Refs carry the current view and in-flight state so a response that
 * lands later is judged against NOW, not against when it was requested.
 */
import { useCallback, useEffect, useRef } from "react";
import { useForegroundRefresh } from "./use-foreground-refresh";

export type GuardedLoad = <T>(
  fetch: () => Promise<T>,
  commit: (next: T) => void,
  opts?: { yieldToAnswer?: boolean },
) => void;

export function useThreadSync(viewKey: string, inFlight: boolean, reloadOnResume: () => void): GuardedLoad {
  const generation = useRef(0);
  const viewKeyRef = useRef(viewKey);
  viewKeyRef.current = viewKey;
  const inFlightRef = useRef(inFlight);
  inFlightRef.current = inFlight;
  const reload = useRef(reloadOnResume);
  reload.current = reloadOnResume;
  const owed = useRef(false);

  useForegroundRefresh(() => {
    if (inFlightRef.current) owed.current = true;
    else reload.current();
  });

  useEffect(() => {
    if (inFlight || !owed.current) return;
    owed.current = false;
    reload.current();
  }, [inFlight]);

  return useCallback<GuardedLoad>((fetch, commit, opts = {}) => {
    const mine = ++generation.current;
    const forView = viewKeyRef.current;
    void fetch().then((next) => {
      if (mine !== generation.current || viewKeyRef.current !== forView) return;
      if (opts.yieldToAnswer && inFlightRef.current) {
        owed.current = true;
        return;
      }
      commit(next);
    });
  }, []);
}

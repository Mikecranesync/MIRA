import {
  JAM_SCENARIO_ID,
  SimLabUnavailable,
  buildDemoState,
  connectingDemoState,
  unavailableDemoState,
  type DemoAssetId,
  type SimLabClient,
  type SimLabDemoState,
  type SimLabTagDef,
} from "@factorylm/interaction";
import { DEMO_ASSET_IDS } from "@factorylm/interaction";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseSimLabDemoOptions {
  readonly client: SimLabClient;
  /** Wall-clock gap between poll cycles. */
  readonly pollMs?: number;
  /** Simulation ticks advanced per cycle — the demo's deterministic clock. */
  readonly ticksPerPoll?: number;
  /** Beyond this age the view stops claiming the data is live. */
  readonly staleAfterMs?: number;
  /** Injectable for tests; nothing here reads the clock directly. */
  readonly now?: () => number;
}

export interface SimLabDemoController {
  readonly state: SimLabDemoState;
  readonly busy: boolean;
  injectJam(): Promise<void>;
  reset(): Promise<void>;
}

/** Metadata that cannot change while the process runs, so it is read once. */
interface Statics {
  readonly tagDefs: Record<string, readonly SimLabTagDef[]>;
  readonly documents: Record<string, readonly string[]>;
}

function describe(error: unknown): string {
  if (error instanceof SimLabUnavailable) return error.detail;
  return error instanceof Error ? error.message : "unknown error";
}

/**
 * The outcome of one cycle.
 *
 * A TAGGED union, not `State | {error}`. The obvious shape was the latter, and
 * it silently broke the loop: `SimLabDemoState` declares `error: string | null`,
 * so `"error" in result` is true for a perfectly good reading too, and every
 * successful poll was routed through the offline path — the view reported
 * `offline` with `error: null` against a healthy simulator. A discriminant that
 * only exists on one arm is the fix; a field both arms carry can never be one.
 */
export type PollOutcome =
  | { readonly ok: true; readonly state: SimLabDemoState }
  | { readonly ok: false; readonly error: string };

/**
 * One poll cycle: advance the simulation, then read it.
 *
 * Exported because the loop's correctness is mostly THIS function's
 * correctness, and a pure async function is testable without a renderer.
 *
 * Advancing before reading is what makes the demo progress deterministically:
 * the visitor's wall clock drives SimLab's tick counter rather than SimLab
 * running free, so the same sequence of cycles always produces the same
 * sequence of states.
 */
export async function pollOnce(
  client: SimLabClient,
  statics: Statics,
  options: { ticks: number; now: number; staleAfterMs: number; signal?: AbortSignal },
): Promise<PollOutcome> {
  try {
    if (options.ticks > 0) await client.tick(options.ticks, options.signal);
    const [snapshot, alarms] = await Promise.all([
      client.snapshot(options.signal),
      client.alarms(options.signal),
    ]);
    // A parse failure is not a transport failure, but it has the same honest
    // consequence: we do not know the machine's state, so we must not draw one.
    if (!snapshot || !alarms) return { ok: false, error: "unreadable response from SimLab" };
    return { ok: true, state: buildDemoState({
      snapshot,
      alarms,
      tagDefs: statics.tagDefs,
      documents: statics.documents,
      observedAt: options.now,
      now: options.now,
      staleAfterMs: options.staleAfterMs,
    }) };
  } catch (error) {
    return { ok: false, error: describe(error) };
  }
}

export async function readStatics(client: SimLabClient, signal?: AbortSignal): Promise<Statics> {
  const tagDefs: Record<string, readonly SimLabTagDef[]> = {};
  const documents: Record<string, readonly string[]> = {};
  for (const assetId of DEMO_ASSET_IDS as readonly DemoAssetId[]) {
    const [defs, docs] = await Promise.all([
      client.assetTags(assetId, signal),
      client.assetDocs(assetId, signal),
    ]);
    if (defs) tagDefs[assetId] = defs;
    if (docs) documents[assetId] = docs;
  }
  return { tagDefs, documents };
}

/**
 * Drives the public demo's view of the SimLab line.
 *
 * **One cycle at a time, by construction.** The loop is a `setTimeout` chain
 * rather than a `setInterval`: the next cycle is only scheduled once the
 * previous one has finished, so a slow read can never overlap the next one and
 * push the simulation forward twice. An `AbortController` per cycle means an
 * unmount, or a control the visitor pressed, cancels the request in flight
 * instead of resolving into a dead component.
 *
 * **Failures degrade, they do not blank.** A failed cycle keeps the last good
 * readings and relabels them offline with the reason; the loop keeps trying, so
 * recovery is automatic and visible rather than needing a reload.
 */
export function useSimLabDemo(options: UseSimLabDemoOptions): SimLabDemoController {
  const { client, pollMs = 1500, ticksPerPoll = 2, staleAfterMs = 6000 } = options;

  /**
   * The clock lives in a ref, and is NOT an effect dependency.
   *
   * It was, briefly, and the loop never reached `live`: the default
   * `() => Date.now()` is a fresh closure on every render, so every state
   * update changed the dependency, tore the effect down, and aborted the very
   * request whose result had triggered the render. The view then reported
   * `offline` against a perfectly healthy simulator. A ref keeps the injected
   * clock current without making the loop restart on its own output.
   */
  const nowRef = useRef(options.now ?? (() => Date.now()));
  nowRef.current = options.now ?? nowRef.current;
  const now = useCallback(() => nowRef.current(), []);

  const [state, setState] = useState<SimLabDemoState>(connectingDemoState);
  const [busy, setBusy] = useState(false);

  const stateRef = useRef(state);
  stateRef.current = state;
  const staticsRef = useRef<Statics | null>(null);
  // A control in flight pauses the loop's own ticking, so a reset cannot race a
  // poll that is about to advance the simulation past the baseline.
  const controlRef = useRef(false);
  const liveRef = useRef(true);

  useEffect(() => {
    liveRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const settle = (outcome: PollOutcome) => {
      if (!liveRef.current) return;
      setState((previous) => outcome.ok
        ? outcome.state
        : unavailableDemoState(previous.observedAt === null ? null : previous, outcome.error, now()));
    };

    const cycle = async () => {
      if (!liveRef.current) return;
      if (!staticsRef.current) {
        try {
          staticsRef.current = await readStatics(client, controller.signal);
        } catch (error) {
          settle({ ok: false, error: describe(error) });
          schedule();
          return;
        }
      }
      if (!liveRef.current) return;
      const result = await pollOnce(client, staticsRef.current, {
        // A control owns the clock while it runs; the loop only observes.
        ticks: controlRef.current ? 0 : ticksPerPoll,
        now: now(),
        staleAfterMs,
        signal: controller.signal,
      });
      settle(result);
      schedule();
    };

    const schedule = () => {
      if (!liveRef.current) return;
      timer = setTimeout(() => { void cycle(); }, pollMs);
    };

    void cycle();

    return () => {
      // Two of these three are load-bearing and one is belt-and-braces.
      // `liveRef` stops the in-flight cycle from scheduling a successor;
      // `abort` cancels the reads that cycle has already issued (a browser will
      // not finish them, and a fake that ignored the signal made this guard
      // look broken). `clearTimeout` is the belt-and-braces one — its callback
      // would return at the live check anyway.
      liveRef.current = false;
      if (timer) clearTimeout(timer);
      controller.abort();
    };
  }, [client, pollMs, ticksPerPoll, staleAfterMs, now]);

  const runControl = useCallback(async (action: () => Promise<void>) => {
    controlRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (error) {
      if (liveRef.current) {
        setState((previous) => unavailableDemoState(
          previous.observedAt === null ? null : previous,
          describe(error),
          now(),
        ));
      }
    } finally {
      controlRef.current = false;
      if (liveRef.current) setBusy(false);
    }
  }, [now]);

  const injectJam = useCallback(() => runControl(async () => {
    // Start resets the engine to tick 0 and loads the scenario; the ticks that
    // follow carry it past the jam onset so the visitor sees the transition
    // rather than arriving after it.
    await client.startScenario(JAM_SCENARIO_ID);
    await client.tick(12);
  }), [client, runControl]);

  const reset = useCallback(() => runControl(async () => {
    await client.resetScenario();
  }), [client, runControl]);

  return { state, busy, injectJam, reset };
}

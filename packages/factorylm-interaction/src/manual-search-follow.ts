/**
 * manual-search-follow.ts — a PURE, framework-free follower for a background
 * manual search's progress (#4189, Codex round 2 F4/F6/F8/F9). No timers, no
 * I/O: the host (`UnifiedChat.tsx` on mobile, `hub-host.tsx` on the Hub) owns
 * the ONE `setTimeout` chain and feeds each read into
 * `advanceManualSearchFollow`; this module only decides what that read MEANS.
 *
 * Why ONE shared module instead of two copies: both hosts had the SAME three
 * defects. F6: the Hub never followed progress at all — only a one-shot
 * render of whatever `loadDetail` last saw. F8: every `running` response
 * reset the mobile re-check's local `attempts` counter back to zero (it was
 * a dependency of the very effect that incremented it), so a search stuck
 * `running` forever — including one orphaned by a worker restart — was
 * polled forever despite a documented "five attempts" cap. F9: a single
 * inconclusive read (a transient database error, surfaced as
 * `manualSearch: null`) was treated as "nothing to report" and silently
 * ended tracking, leaving the stale "Searching…" indicator up even after the
 * database recovered. One state machine, two hosts wiring timers around it
 * (commodity-before-custom: this is small state logic, not a polling
 * library or a second networking layer).
 *
 * Round 3 (Codex F6/F11): two more bugs in the SAME shape. F11 —
 * `advanceManualSearchFollow`'s generation-change branch reset to a fresh
 * follow but then unconditionally short-circuited on "not following",
 * which skipped the running→settled transition (and its `refreshSources`
 * signal) whenever the very first read of a newly-adopted generation
 * happened to already be settled. F6 — both hosts' "seed" call sites used
 * `prev ?? startFollow(...)`, a blanket no-op once ANYTHING was already
 * tracked for a notebook: a later authoritative update (a promotion after
 * confirm, or a second, different search in the same notebook) was
 * permanently ignored once the first follow resolved or exhausted its
 * budget. `reseedManualSearchFollow` below is the fix: the one entry point
 * every "seed" moment (hydration, a live frame, a confirm) now goes
 * through, which can replace a terminal state's content and can adopt a
 * new generation that arrives after the old one settled.
 */
import type { ManualSearchStatus } from "./types";

export type ManualSearchFollowPhase = "following" | "resolved" | "unresolved";

export interface ManualSearchFollowState {
  /** `${notebookId}|${generation}` — `generation` is the search's own
   *  `startedAt` when known. A follow started before any generation is known
   *  (e.g. right after a confirmation, before the first real read) uses an
   *  empty generation and ADOPTS the first one a read reports, without
   *  resetting the budget — only a read reporting a generation that is
   *  DIFFERENT from an already-known one resets it (a later, distinct
   *  search). */
  readonly key: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly phase: ManualSearchFollowPhase;
  /** The status to RENDER right now — running, settled, or the synthesized unresolved one. */
  readonly status: ManualSearchStatus;
}

export interface ManualSearchFollowResult {
  readonly state: ManualSearchFollowState;
  /** True exactly once — the turn the search is found to have genuinely
   *  succeeded (settled, never merely "gave up at the budget") — tells the
   *  host to refresh sources, since the manual may now be citable. */
  readonly refreshSources: boolean;
}

export const DEFAULT_MANUAL_SEARCH_FOLLOW_ATTEMPTS = 5;

/** Never an endless "Searching…" — an honest terminal state once the budget
 *  is spent with no settled answer. */
export const MANUAL_SEARCH_UNRESOLVED_MESSAGE = "Still searching — check back in a minute.";

function followKey(notebookId: string, generation: string | undefined): string {
  return `${notebookId}|${generation ?? ""}`;
}

/** The generation portion of a follow key (the substring after the FIRST
 *  `|`), or `""` when none is known yet. Used ONLY to tell "nothing known"
 *  apart from "a real generation is known" — see Codex F14 (round 4) below. */
function generationOfKey(key: string): string {
  const i = key.indexOf("|");
  return i === -1 ? "" : key.slice(i + 1);
}

/** Start following a notebook's search. Call once — on hydration, when a
 *  live frame first shows `running: true`, or right after a confirmation
 *  that started a search (optimistically, before the first real read). */
export function startManualSearchFollow(
  notebookId: string,
  status: ManualSearchStatus,
  maxAttempts: number = DEFAULT_MANUAL_SEARCH_FOLLOW_ATTEMPTS,
): ManualSearchFollowState {
  return {
    key: followKey(notebookId, status.startedAt),
    attempts: 0,
    maxAttempts,
    phase: status.running ? "following" : "resolved",
    status,
  };
}

/**
 * Advance with ONE status read for `notebookId` (or `null` for an
 * inconclusive/unavailable read — a failed fetch, or a server
 * `manualSearch: null`). Never resets the budget on a `running` response
 * (Codex F8); a `null` read spends ONE attempt but never stops following on
 * its own (Codex F9) — only the budget running out, or a genuine settle,
 * ends the follow.
 *
 * A read reporting a KNOWN, DIFFERENT generation (`startedAt`) for this
 * notebook starts a fresh follow with a full budget — a later search (a
 * retry, a next-day re-search, a different confirmed identity) must never
 * inherit an already-spent budget. A read with no `startedAt` (an older
 * server, or no generation known yet) never triggers a reset.
 */
export function advanceManualSearchFollow(
  state: ManualSearchFollowState,
  notebookId: string,
  read: ManualSearchStatus | null,
): ManualSearchFollowResult {
  const knownGenerationChanged = Boolean(read?.startedAt) && followKey(notebookId, read!.startedAt) !== state.key;

  if (!knownGenerationChanged && state.phase !== "following") {
    // Already settled/unresolved for THIS generation, and no new generation
    // was reported — a stray late read (e.g. one in flight when the budget
    // ran out) changes nothing. (Codex F11: when a generation DID change,
    // falling through below is required — a brand-new generation's first
    // read must never skip the running→settled transition just because it
    // happens to already be settled.)
    return { state, refreshSources: false };
  }

  const current = knownGenerationChanged ? startManualSearchFollow(notebookId, read!, state.maxAttempts) : state;

  const attempts = current.attempts + 1;

  if (read && !read.running) {
    return { state: { ...current, attempts, phase: "resolved", status: read }, refreshSources: true };
  }

  if (attempts >= current.maxAttempts) {
    return {
      state: {
        ...current,
        attempts,
        phase: "unresolved",
        status: {
          manufacturer: current.status.manufacturer,
          model: current.status.model,
          running: false,
          message: MANUAL_SEARCH_UNRESOLVED_MESSAGE,
          ...(current.status.startedAt ? { startedAt: current.status.startedAt } : {}),
        },
      },
      refreshSources: false,
    };
  }

  // Still running, or an inconclusive null — keep following. A present read
  // is the freshest status to render; a null read keeps showing the last
  // known one (never blanks the card).
  return { state: { ...current, attempts, status: read ?? current.status }, refreshSources: false };
}

/**
 * Reconcile a FRESH, authoritative status read against whatever is currently
 * tracked for `notebookId` (or nothing) — the single entry point for every
 * "seed" moment: hydration, a live frame first showing `running: true`, and
 * right after a confirmation that started a search (Codex F6/F11, round 3).
 * `advanceManualSearchFollow` is for the periodic TICK only (it tolerates a
 * `null`/inconclusive read); this function always has a concrete read and
 * is safe to call repeatedly — a duplicate seed for an ACTIVE follow of the
 * same generation is a pure no-op (`state ===` the input, by reference, so a
 * caller can skip re-rendering/re-scheduling on it).
 *
 * The state machine:
 *   (a) a NEW generation (a different `startedAt`, or nothing tracked yet)
 *       — fresh budget.
 *   (b) the SAME generation, still `following` AND the read confirms it's
 *       still running — no-op; the tick owns advancing it.
 *   (c) the SAME generation otherwise (settled/exhausted, OR a genuine
 *       settle arriving outside the tick) — ANY authoritative update
 *       replaces what's displayed; `refreshSources` fires again only when
 *       the content actually changed (a repeat, identical reseed never
 *       re-triggers it).
 *   (d) the running→settled transition is never skipped: a (a)-branch read
 *       that is already settled on first observation still resolves, and
 *       signals `refreshSources` — UNLESS nothing was tracked before this
 *       call (a bare first hydration has nothing stale to refresh; that
 *       very read came from the same fetch that would supply fresh Sources
 *       anyway).
 *   (e) Codex F14 (round 4, #4195): a GENERATION-LESS read (no `startedAt`)
 *       is never allowed to clobber an ALREADY-KNOWN generation. BACKWARD
 *       COMPAT ONLY as of round 5 (F15): the chat route now stamps every
 *       live `manual_search_status` frame with its own `startedAt`
 *       (`manualSearchStatusFrame`, `chat/route.ts`), so this guard's
 *       original trigger — a historical frame with no generation at all —
 *       can no longer arise from a CURRENT server. It is kept, unchanged, for
 *       a server that predates that stamp: a generation-less read still must
 *       never reopen a settled search or replenish a spent budget. A GET or
 *       confirm read that genuinely starts a NEW search always carries its
 *       OWN `startedAt`, so this guard never blocks real progress on a
 *       current server either — it only blocks uninformative replay of a
 *       read that was never a generation marker to begin with.
 *
 *       This function is for GET/confirm reads ONLY — reads the host already
 *       knows are a single, authoritative snapshot taken right now. A LIVE
 *       SSE frame is different: the SAME frame content can be re-delivered
 *       by an unrelated parent rerender (a new `meta`/`baseThread` object
 *       cached from a PRIOR point in the search), so a same-generation
 *       `running: true` replay here is NOT proof the search is still
 *       running — see `observeLiveManualSearchFrame` below, which a live
 *       frame consumer (`UnifiedChat.tsx`'s SSE-driven effect) calls instead.
 */
export function reseedManualSearchFollow(
  current: ManualSearchFollowState | null,
  notebookId: string,
  read: ManualSearchStatus,
  maxAttempts: number = DEFAULT_MANUAL_SEARCH_FOLLOW_ATTEMPTS,
): ManualSearchFollowResult {
  if (!read.startedAt && current !== null && generationOfKey(current.key) !== "") {
    return { state: current, refreshSources: false };
  }

  const sameGeneration = current !== null && followKey(notebookId, read.startedAt) === current.key;

  if (sameGeneration && current.phase === "following" && read.running) {
    return { state: current, refreshSources: false };
  }

  if (sameGeneration) {
    const wasResolved = current.phase !== "following";
    const changed = read.running !== current.status.running || read.message !== current.status.message;
    return {
      state: {
        ...current,
        phase: read.running ? "following" : "resolved",
        status: read,
        attempts: read.running ? 0 : current.attempts,
      },
      refreshSources: !read.running && (!wasResolved || changed),
    };
  }

  const fresh = startManualSearchFollow(notebookId, read, maxAttempts);
  return { state: fresh, refreshSources: fresh.phase === "resolved" && current !== null };
}

/**
 * Observe ONE live SSE `manual_search_status` frame (Codex round 5, #4195
 * F15). This is the live-frame counterpart of `reseedManualSearchFollow`
 * above, and exists because a live frame has a property a GET/confirm read
 * never has: the SAME frame object can be re-delivered to the follower by an
 * UNRELATED parent rerender, long after it was first observed (a cached SSE
 * turn, re-mapped into a new `InteractionPart` by a rerender that has
 * nothing to do with the search). Feeding that replay through
 * `reseedManualSearchFollow`'s same-generation branch (c) would read a
 * stale, still-`running: true` snapshot as "the search is still running" and
 * reopen a follow that has already settled or exhausted its budget — a
 * regression `reseedManualSearchFollow` would introduce the moment the live
 * frame started carrying a real `startedAt`: a same-generation replay
 * becomes possible for the first time, where it could not occur at all
 * while every live frame omitted the field (round 4's premise).
 *
 * The state machine a live frame gets:
 *   - SAME generation already tracked (any phase) → ALWAYS a no-op. Only
 *     the periodic tick (`advanceManualSearchFollow`) and an authoritative
 *     GET/confirm reseed (`reseedManualSearchFollow`) are allowed to move a
 *     generation forward or settle it; a live frame can only ever start
 *     following a generation it has not seen before.
 *   - DIFFERENT (or newly-known) generation → start following fresh, honoring
 *     `read.running` (Codex F15's actual fix: a genuinely new candidate
 *     search, reported live, is no longer suppressed by an older settled
 *     generation).
 *   - NO generation at all (`startedAt` missing — an older server that
 *     predates the chat-route stamp, Codex F14's original backward-compat
 *     case) → never clobber an already-known generation; otherwise treated
 *     as a fresh/first-seed follow, same as `reseedManualSearchFollow`'s
 *     control case.
 */
export function observeLiveManualSearchFrame(
  current: ManualSearchFollowState | null,
  notebookId: string,
  read: ManualSearchStatus,
  maxAttempts: number = DEFAULT_MANUAL_SEARCH_FOLLOW_ATTEMPTS,
): ManualSearchFollowResult {
  if (!read.startedAt) {
    // Backward-compat (Codex F14, round 4): a generation-less live frame
    // never clobbers an already-known generation.
    if (current !== null && generationOfKey(current.key) !== "") {
      return { state: current, refreshSources: false };
    }
    // Nothing tracked yet: the optimistic first-seed case — same as
    // `reseedManualSearchFollow`'s control, never a regression for an older
    // server with no generation support at all.
    const fresh = startManualSearchFollow(notebookId, read, maxAttempts);
    return { state: fresh, refreshSources: false };
  }

  const sameGeneration = current !== null && followKey(notebookId, read.startedAt) === current.key;
  if (sameGeneration) {
    // A live frame can be a STALE replay of a generation already settled or
    // exhausted (Codex F15) — never treat it as fresh progress. The tick and
    // the authoritative reseed own advancing/settling this generation.
    return { state: current, refreshSources: false };
  }

  // A different (or first-seen) generation: start following fresh.
  const fresh = startManualSearchFollow(notebookId, read, maxAttempts);
  return { state: fresh, refreshSources: false };
}

/** Whether the host should keep scheduling checks for this state. */
export function isManualSearchFollowActive(state: ManualSearchFollowState | null): boolean {
  return state?.phase === "following";
}

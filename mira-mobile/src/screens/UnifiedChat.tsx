/**
 * Unified conversation surface (FLM-UI-4000 Phase 2, mobile lane): the shared
 * FactoryLM shell rendering THIS notebook's real turns through the mobile
 * chat-adapter vocabulary — on the assistant-ui thread (ADR-0037: the library
 * owns viewport, autoscroll, jump-to-latest and run state; the shell's parts,
 * composer, header and navigation are unchanged). The screen keeps owning the send path, scope,
 * riders, Retry body, uploads and the citation viewer — exactly as ChatV2 does
 * — so switching surfaces changes the shell, never the semantics.
 *
 * Shared code stays host-agnostic: the packages are reached through Vite
 * aliases (no package.json change, so the OTA guard's native-path check stays
 * green) and receive live data through the reducer's `hydrate` action.
 */
import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import "../unified/unified.css";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import {
  PROFILES,
  createShellState,
  shellReducer,
  type Machine,
  type Project,
  type ProjectItem,
  type ShellState,
} from "@factorylm/interaction";
import type { ReactNode } from "react";
import type { Attachment, InteractionPart, InteractionTurn } from "@factorylm/interaction";
import {
  advanceManualSearchFollow,
  observeLiveManualSearchFrame,
  reseedManualSearchFollow,
  type ManualSearchFollowResult,
  type ManualSearchFollowState,
  type ManualSearchStatus,
} from "@factorylm/interaction";
import {
  FactoryLMShell,
  closeLayerAction,
  createFixRequestIds,
  createReadAloud,
  fixRefusalMessage,
  fixSymptomFor,
  serverTurnIdFor,
  spokenAnswerText,
  topLayer,
  type HostHooks,
} from "@factorylm/ui";
import { AnswerMarkdown, copyText } from "./AnswerMarkdown";
import { ApiError, request } from "../api/client";
import { confirmIdentityProposal } from "../api/identity-confirm";
import { fetchManualSearchStatus } from "../api/manual-search-status";
import { canBeChatSource, enabledDocIds, getNotebookDetail, type NotebookServerTurn } from "../api/resources";
import { threadMessages } from "../chat-adapter/turns-to-parts";
import type { ChatCitation, ChatTurn } from "../lib/sse";
import { registerTransientLayer } from "../lib/transient-layer";
import { createCapacitorAdapter } from "../unified/capacitor-adapter";
import { useUnifiedAttachments, type VisualEvidenceRider } from "../unified/attachments";
import {
  citationIndex,
  contextFor,
  latestManualSearchStatus,
  liveFixture,
  machinesFor,
  projectsFor,
  toThread,
  withManualSearchOverrides,
  type UnifiedNotebookMeta,
} from "../unified/to-interaction";
import type { ChatV2Handlers } from "./ChatV2";

/**
 * The notebook's manual-search progress — ONE owned state machine instead of
 * three independent readers of `fetchManualSearchStatus` (#4195 Codex rounds
 * 8–11: F23, F23 follow-up, F25, F26 — the same defect class four times).
 * The old shape had a mount-time hydration effect, the periodic poll-chain
 * effect, and the confirm path's own "authoritative" read all writing into
 * one `follow` state, each independently patched with its own epoch check —
 * a counter bumped on every concrete read could not tell "several null
 * polls on the SAME generation" (must never invalidate a slow, still-
 * relevant read — F25) apart from "a live frame started a DIFFERENT
 * generation" (must invalidate — F23), so each round's fix for one broke
 * the other.
 *
 * Modeled on the Hub's `mira-hub/src/factorylm-ui/manual-search-driver.ts`
 * (seed/reset/fenced tick), extended with `observeLive` for mobile's live
 * SSE input (the Hub has none) and `probe` for an immediate, one-shot,
 * authoritative read — used for mount hydration (nothing tracked yet) and
 * for the confirm path's post-confirm reconciliation when the confirm route
 * reports `searching:false` (something may already be tracked: a stale
 * resolved/unresolved outcome this reconciles against).
 *
 * Fencing is GENERATION-KEY based, not a counter: every dispatched read (a
 * probe, or a periodic tick) captures the driver's then-current generation
 * key. At resolution, the read is discarded ONLY when that key no longer
 * matches (tracking has since moved to a DIFFERENT generation) AND the
 * read's own reported generation doesn't match the new current key either
 * (it isn't reporting on whatever is now current). Otherwise it is always
 * applied, however late it lands, however many intervening null ticks
 * happened in between — because `reseedManualSearchFollow` /
 * `advanceManualSearchFollow` already reconcile a SAME-generation read
 * correctly (never regressing a resolved/unresolved outcome with a stale
 * `running`, never letting a null blank a still-relevant status). A read
 * for the SAME generation is simply the latest word on that generation,
 * regardless of dispatch order — that is what makes F26 (an older in-flight
 * poll must not clobber a fresher confirmation read for the SAME
 * generation) come out right with no special case at all.
 */
interface MobileManualSearchDriver {
  /** An authoritative read already in hand: hydration's own seed, and the
   *  confirm path's optimistic `searching:true` start. */
  seed(read: ManualSearchStatus): void;
  /** A live SSE frame — routed through `observeLiveManualSearchFrame`'s own
   *  stale-replay guard (see that function's header). */
  observeLive(read: ManualSearchStatus): void;
  /** Fetch ONE authoritative status right now and reconcile with it if
   *  present. Ends quietly on `null`/error — never retries on its own; the
   *  periodic tick (started by `seed`/`observeLive` when the result is
   *  `following`) owns re-checking. */
  probe(): void;
  /** Stop any pending timer and drop tracked state (unmount only — a
   *  notebook switch already remounts the whole component that owns this
   *  driver; see the `UnifiedChat` wrapper below). */
  reset(): void;
}

/** Mirrors `ManualSearchFollowState.key`'s documented shape
 *  (`manual-search-follow.ts`): `` `${notebookId}|${generation}` ``. Kept
 *  local rather than imported — the shared state machine's own `followKey`
 *  is a private helper, and this format is part of that type's public
 *  contract, so reconstructing it here is not reinventing private logic. */
function manualSearchKey(notebookId: string, generation: string | undefined): string {
  return `${notebookId}|${generation ?? ""}`;
}

function createMobileManualSearchDriver(deps: {
  readonly notebookId: string;
  readonly fetchStatus: () => Promise<ManualSearchStatus | null>;
  readonly onStateChange: (state: ManualSearchFollowState | null) => void;
  readonly onRefreshSources: () => void;
  readonly isAlive: () => boolean;
  readonly delayMs?: number;
}): MobileManualSearchDriver {
  const { notebookId, fetchStatus, onStateChange, onRefreshSources, isAlive } = deps;
  const delayMs = deps.delayMs ?? 4000;
  let state: ManualSearchFollowState | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  // Codex r12 F27: start-order freshness WITHIN a generation. Every read is
  // numbered when it starts; seed/live inputs take a number when they arrive.
  // A concrete result applies only if it is newer than the last applied one,
  // so a slow, older snapshot can never overwrite a newer accepted result.
  // Null/error reads carry no information and never move `lastApplied`
  // (F25), so they cannot discard a valid delayed result.
  let seq = 0;
  let lastApplied = 0;

  function currentKey(): string {
    return state?.key ?? manualSearchKey(notebookId, undefined);
  }
  function clearTimer(): void {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function commit(result: ManualSearchFollowResult): void {
    const changed = state !== result.state;
    state = result.state;
    if (changed) {
      onStateChange(state);
      // Codex F28 (round 13), follow-on: a pending tick can have been
      // scheduled by an EARLIER commit for the SAME generation (observeLive
      // adopting a live frame while a GET read was still in flight — see
      // `observeLive`'s own comment) and then be settled by a DIFFERENT
      // commit (that GET read finally applying) before the tick ever fires.
      // `scheduleTick` already clears any existing timer before arming a
      // new one; the missing half was clearing it when the NEW result is
      // no longer `following` at all — otherwise that stale timer still
      // fires later and spends a request this generation no longer needs.
      if (state.phase === "following") scheduleTick();
      else clearTimer();
    }
    if (result.refreshSources) onRefreshSources();
  }
  /** The ONE self-perpetuating setTimeout chain (not a React effect — see
   *  this module's own header for why a dependency-driven effect cannot do
   *  this fencing correctly). Each tick reschedules the next one from
   *  inside its own resolution, only while still `following`. */
  function scheduleTick(): void {
    clearTimer();
    if (!state || state.phase !== "following") return;
    const capturedKey = state.key;
    timer = setTimeout(() => {
      timer = null;
      const mine = ++seq;
      // A discarded tick spends no budget; keep the chain alive if nothing
      // newer already rescheduled it.
      const discard = () => {
        if (state?.phase === "following" && timer === null) scheduleTick();
      };
      void fetchStatus()
        .then((read) => {
          if (!isAlive() || !state) return;
          if (mine < lastApplied || currentKey() !== capturedKey && (!read || manualSearchKey(notebookId, read.startedAt) !== currentKey())) {
            discard();
            return;
          }
          if (read) lastApplied = mine;
          commit(advanceManualSearchFollow(state, notebookId, read));
        })
        .catch(() => {
          if (!isAlive() || !state) return;
          if (mine < lastApplied || currentKey() !== capturedKey) {
            discard();
            return;
          }
          commit(advanceManualSearchFollow(state, notebookId, null));
        });
    }, delayMs);
  }

  return {
    seed(read) {
      lastApplied = ++seq;
      commit(reseedManualSearchFollow(state, notebookId, read));
    },
    observeLive(read) {
      // Codex F28 (round 13): `lastApplied`/`seq` order AUTHORITATIVE GET
      // reads (seed, tick, probe) against EACH OTHER — a live SSE frame is
      // not one of those; it can be a stale replay of a frame already
      // reflected in `state` (the same `baseThread` object re-delivered by
      // an unrelated parent rerender). Bumping the SAME fence here let a
      // cached same-generation RUNNING replay discard an outstanding,
      // already-dispatched, more-authoritative GET result purely because
      // its own request was dispatched earlier — the GET had not yet had a
      // chance to apply. `observeLiveManualSearchFrame` already encodes the
      // only question that matters: does this frame carry NEW information
      // (a different, not-yet-tracked generation) or is it a no-op replay
      // of the one already tracked (`state === result.state`, same
      // reference, when nothing changed)? A no-op must never touch the GET
      // ordering fence. A genuinely new generation still wins over a
      // pending read for the OLD context — not via this fence, but via
      // `probe`/`scheduleTick`'s own `currentKey() !== capturedKey` check
      // below, which already discards a read whose reported generation no
      // longer matches what's now current.
      commit(observeLiveManualSearchFrame(state, notebookId, read));
    },
    probe() {
      const capturedKey = currentKey();
      const mine = ++seq;
      void fetchStatus()
        .then((read) => {
          if (!isAlive() || !read) return; // ends quietly — nothing to reconcile.
          if (mine < lastApplied) return;
          if (currentKey() !== capturedKey && manualSearchKey(notebookId, read.startedAt) !== currentKey()) return;
          lastApplied = mine;
          commit(reseedManualSearchFollow(state, notebookId, read));
        })
        .catch(() => { /* ends quietly — never retries on its own */ });
    },
    reset() {
      clearTimer();
      state = null;
    },
  };
}

/** What the unified ROOT supplies when the shell owns the whole app: the
 *  notebook/machine tree, item opening, and host-owned navigation controls. */
export interface UnifiedShellHost {
  readonly projects: readonly Project[];
  readonly machines: readonly Machine[];
  readonly onOpenItem: (item: ProjectItem) => void;
  readonly onSelectProject?: (projectId: string) => void;
  readonly navigationFooter?: ReactNode;
}

export interface UnifiedChatProps {
  readonly turns: NotebookServerTurn[];
  readonly liveTurns: { q: string; a: ChatTurn }[];
  readonly pending: { q: string; a: ChatTurn } | null;
  readonly busy: boolean;
  readonly canStop: boolean;
  readonly canRetry: boolean;
  readonly chatError: string | null;
  readonly handlers: UnifiedChatHandlers;
  readonly meta: Omit<UnifiedNotebookMeta, "capturedAt">;
  readonly host?: UnifiedShellHost;
  readonly initialQuestion?: string | null;
  readonly onInitialQuestionSent?: () => void;
  readonly failedQuestion?: string | null;
  readonly groundingLine?: () => string | undefined;
  readonly suggestChips?: () => readonly { id: string; text: string }[] | undefined;
  /** Notebook attachments upload into. `null` on HOME, where the bytes are
   *  stashed for the thread the send is about to create. Defaults to the
   *  notebook this shell is already rendering. */
  readonly attachmentNotebookId?: string | null;
  /** Backend conversation id; meta.threadId is a shell presentation id. */
  readonly attachmentThreadId?: string | null;
}

/**
 * The unified surface's handler contract.
 *
 * `onSend` is widened HERE rather than in `ChatV2Handlers`: ChatV2 is a frozen
 * legacy surface with no pending-attachment chip, so giving it an
 * attachment-aware contract would change a rollback surface to serve the new
 * shell. The two attach members are inherited unchanged and deliberately
 * UNUSED on this surface — the shell picks natively through its own controller
 * (`../unified/attachments`), so a host that still passes ChatV2's
 * upload-and-ask handlers keeps compiling while the unified composer previews.
 *
 * `evidence` is the same rider the notebook send path already accepts for
 * Sensor, so an attachment rides the ONE existing send path rather than a
 * second one. A host that ignores the argument still compiles; it simply gets
 * no attachment support.
 */
export interface UnifiedChatHandlers
  extends Omit<ChatV2Handlers, "onSend" | "onAttachPhoto" | "onAttachCamera" | "onAttachFile"> {
  readonly onSend: (
    text: string,
    evidence?: VisualEvidenceRider,
    /** Chat scope re-read after an attachment upload; overrides the host's. */
    scope?: readonly string[],
  ) => void;
  /** Inherited from ChatV2 and UNUSED here — optional so neither host has to
   *  pass a handler the unified composer never calls. */
  readonly onAttachPhoto?: () => void;
  readonly onAttachCamera?: () => void;
  readonly onAttachFile?: () => void;
  readonly onScanMachine?: () => Promise<string | null> | string | null;
  readonly onNewChat?: () => void;
  readonly onCreateProject?: () => void;
}

function initialState(messages: ReturnType<typeof threadMessages>, meta: UnifiedNotebookMeta, host?: UnifiedShellHost): ShellState {
  const fixture = liveFixture(messages, meta);
  const created = createShellState(
    host ? { ...fixture, projects: host.projects, machines: host.machines } : fixture,
    PROFILES.mobile,
  );
  // The fixture contract opens the drawer at mount for review; a live screen
  // starts on the conversation.
  return shellReducer(created, { type: "set-navigation-visible", visible: false });
}

/**
 * The real screen. Renamed off `UnifiedChat` (light review, #4195
 * notebook-switch class) so the exported `UnifiedChat` below can force a
 * remount of this component on every notebook change — see that wrapper's
 * doc comment for why remounting, not another per-field guard, is the fix.
 */
function UnifiedChatForNotebook({
  turns,
  liveTurns,
  pending,
  busy,
  canStop,
  canRetry,
  chatError,
  handlers,
  meta,
  host,
  initialQuestion,
  onInitialQuestionSent,
  failedQuestion,
  groundingLine,
  suggestChips,
  attachmentNotebookId,
  attachmentThreadId,
}: UnifiedChatProps) {
  const capturedAt = useRef(new Date().toISOString());
  // Codex F1 (HIGH, #4175/#4189): the re-read scope a confirmed identity just
  // promoted, consumed one-shot by the next send (see `onSend` below).
  const confirmedScopeRef = useRef<string[] | null>(null);
  // Codex round 7 F22 (#4195): `onSend` consumes this ref BEFORE
  // `attachments.compose` resolves (it has to — the snapshot must be taken
  // synchronously, before the await, same as `confirmedScope` itself). If
  // that compose then fails or rejects, no send ever reaches the parent, so
  // nothing actually spent the scope — restore it so the retry this failure
  // invites still rides the promoted manual. Restoring only when the ref is
  // still empty is what keeps this from clobbering a NEWER scope stashed by
  // a confirm/refresh that landed while the failed compose was in flight.
  const restoreConfirmedScope = useCallback((scope: string[] | null) => {
    if (scope && confirmedScopeRef.current === null) confirmedScopeRef.current = scope;
  }, []);
  // Light review (#4195, notebook-switch class): true until THIS instance
  // unmounts. The wrapper below remounts a fresh instance per notebook, so an
  // in-flight async continuation (confirm / compose / refresh) that settles
  // AFTER the technician has switched notebooks is running on a dead
  // instance. `notebookIdRef` (below) can no longer detect that case once
  // notebookId is constant for an instance's whole life — checked wherever a
  // continuation would otherwise call a parent handler or spend a network
  // call on behalf of a notebook this instance no longer represents.
  const aliveRef = useRef(true);
  // Codex round 7 F20 (#4195): the ref above is initialized `true` exactly
  // ONCE, at first render — only the cleanup below ever wrote `false`. React
  // 18 StrictMode (`mira-mobile/src/main.tsx` wraps the app in it) runs
  // effect setup, its cleanup, then setup again on every mount, so the
  // sequence was: init(true) -> setup(no-op) -> cleanup(false) -> setup
  // (still nothing restoring it) — leaving a StrictMode-mounted instance
  // permanently "dead" from its very first render, dropping every compose
  // continuation and confirm/refresh silently. Setting it `true` again in
  // the setup itself makes the second StrictMode pass restore exactly what
  // its own matching cleanup just cleared; a real unmount still ends on the
  // cleanup's `false` with no later setup to undo it.
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const fullMeta = useMemo<UnifiedNotebookMeta>(() => ({ ...meta, capturedAt: capturedAt.current }), [meta]);
  const messages = useMemo(() => threadMessages(turns, liveTurns, pending), [turns, liveTurns, pending]);
  const citations = useMemo(() => citationIndex(messages), [messages]);
  const [state, dispatch] = useReducer(shellReducer, undefined, () => initialState(messages, fullMeta, host));
  const baseThread = useMemo(() => toThread(messages, fullMeta), [messages, fullMeta]);

  // Codex round 2 (#4195 F4/F6/F8/F9): "Searching…" must resolve once the
  // background search settles, must NOT poll forever on a stuck/orphaned
  // search (the shared `manual-search-follow.ts` state machine keeps a FIXED
  // attempt budget that `running`/inconclusive reads never reset), and must
  // survive a reload (the server never persists the status — `follow` is
  // (re)seeded from a direct fetch on hydration, not from thread content
  // alone). `follow.status` is the one thing rendered for the ACTIVE
  // generation; `withManualSearchOverrides` appends it to the last assistant
  // turn when no live frame ever carried a matching part (the realistic
  // post-reload case), or replaces one in place.
  //
  // Codex round 5 F16 (#4195): `notebookIdRef` tracks the LATEST committed
  // `meta.notebookId` across renders of this SAME instance. `onConfirmIdentity`
  // and `refreshPromotedScope` below bind their async continuations to the
  // notebookId THIS request was for, and discard them if it no longer
  // matches — a notebook switch via `NotebooksTab.tsx`'s `onOpenNotebook`
  // changes this component's `notebookId` prop IN PLACE, with no
  // `key`-forced remount (only the `UnifiedChat` wrapper below remounts on
  // a notebook change).
  const notebookId = meta.notebookId || null;
  const notebookIdRef = useRef(notebookId);
  notebookIdRef.current = notebookId;
  const [follow, setFollow] = useState<ManualSearchFollowState | null>(null);
  // Codex round 6 F17 (#4195): `follow` tracks exactly ONE generation at a
  // time (by design — see `manual-search-follow.ts`'s header). Once a
  // SECOND, different search takes over that one slot, the FIRST search's
  // settled/unresolved outcome would otherwise be gone — nothing left to
  // overlay it, so its turn reverts to whatever raw (possibly still
  // `running: true`) frame is baked into `baseThread`, forever. This map
  // remembers every generation's outcome, keyed the same way `follow.key`
  // is (`${notebookId}|${startedAt}`), for as long as this notebook is open.
  const [settledManualSearches, setSettledManualSearches] = useState<ReadonlyMap<string, ManualSearchStatus>>(
    () => new Map(),
  );
  // Codex round 5 F15 (#4195), defense in depth: an unrelated rerender can
  // re-deliver the EXACT same live frame to the effect below. `observeLiveManualSearchFrame`
  // is already safe against that (same generation → no-op), but consuming
  // the identical event twice is still wasted work — skip it outright when
  // nothing about the live frame has changed since the last observation.
  const lastLiveFrameKeyRef = useRef<string | null>(null);
  // Codex r18 F31: completed live frames already acted on (one probe each).
  const lastCompletedFrameKeyRef = useRef<string | null>(null);
  // Codex round 5 F16 (#4195): a notebook switch that keeps THIS component
  // mounted (`NotebooksTab.tsx`'s `onOpenNotebook` — a Sensor READ resolving
  // a different machine changes the `id`/`notebookId` prop in place, with no
  // `key`-forced remount; only `UnifiedRoot.tsx`'s mount site keys by
  // notebook) must not let the PREVIOUS notebook's follow state survive into
  // the new one. Without this, a leftover `follow` for A — especially one
  // still mid-search — renders as a stray `manual_search_status` card on B's
  // thread the first time B reports no search of its own (the
  // hydration-fetch effect below silently no-ops on a `null` status, so it
  // alone never clears a leftover). Mirrors the Hub's own `select()`, which
  // does `setFollow(null)` + the driver's `reset()` on every selection change.
  // Round 6 F17: the settled-outcomes map above is PER-NOTEBOOK history, so
  // it resets here too — a leftover outcome from notebook A must never
  // overlay a turn on notebook B's thread.
  useEffect(() => {
    setFollow(null);
    // A scope stashed for the previous notebook must never reach this one's send.
    confirmedScopeRef.current = null;
    setSettledManualSearches(new Map());
    lastLiveFrameKeyRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally ONLY notebookId: reset-on-change, not reset-on-every-render.
  }, [notebookId]);
  // Codex round 6 F17 (#4195): record a generation's outcome into the map
  // the MOMENT `follow` settles (phase leaves "following") — the ONE place
  // every settle happens, regardless of which effect drove it (a live
  // frame, the hydration reseed, or the periodic tick). A generation with no
  // `startedAt` is never recorded (there is nothing stable to key it by —
  // it can only ever be the CURRENTLY active follow, which is applied
  // separately and always wins for its own key).
  useEffect(() => {
    if (!follow || follow.phase === "following" || !follow.status.startedAt) return;
    setSettledManualSearches((prev) => {
      if (prev.get(follow.key) === follow.status) return prev;
      const next = new Map(prev);
      next.set(follow.key, follow.status);
      return next;
    });
  }, [follow]);
  const resolvedThread = useMemo(() => {
    const activeKey = follow?.key ?? null;
    const historical: ManualSearchStatus[] = [];
    const knownGenerations = new Set<string>();
    for (const [key, status] of settledManualSearches) {
      if (key === activeKey) continue; // the active follow's own status (below) always wins for its own key.
      historical.push(status);
      if (status.startedAt) knownGenerations.add(status.startedAt);
    }
    if (follow?.status.startedAt) knownGenerations.add(follow.status.startedAt);
    // Codex round 6 F17, the orphan case: a generation ABANDONED mid-flight
    // by a newer live frame before it ever reached "following" long enough
    // to settle (the follower only ever tracks ONE generation — a second,
    // different live frame immediately starts following the NEW one,
    // discarding the old one's state outright; see
    // `observeLiveManualSearchFrame`). Such a generation is in neither
    // `settledManualSearches` (it never settled) nor the active follow, so
    // without this it would render its raw, still-`running: true` frame
    // forever — the same perpetual-spinner symptom F17 fixes for the
    // settled case. Render it with the shared `PartRenderer`'s OWN existing
    // non-running fallback (`packages/factorylm-ui/src/parts.tsx`'s
    // `ManualSearchStatusPart`: "Finished searching for the X Y manual.")
    // instead of inventing new copy here. The MOST RECENT
    // `manual_search_status` part is exempt — it may be a brand-new
    // generation this render's live-frame effect has not adopted into
    // `follow` yet (effects run after render); neutralizing it one render
    // early would flicker it to "Finished" and immediately back to
    // "Searching" once the effect fires.
    const latest = latestManualSearchStatus(baseThread.turns);
    const orphaned: ManualSearchStatus[] = [];
    for (const turn of baseThread.turns) {
      for (const part of turn.parts) {
        if (part.type !== "manual_search_status" || !part.running || !part.startedAt) continue;
        if (part === latest || knownGenerations.has(part.startedAt)) continue;
        knownGenerations.add(part.startedAt); // one neutral override per orphaned generation, not one per repeated part.
        orphaned.push({ manufacturer: part.manufacturer, model: part.model, running: false, startedAt: part.startedAt });
      }
    }
    return withManualSearchOverrides(baseThread, [...historical, ...orphaned], follow?.status ?? null);
  }, [baseThread, settledManualSearches, follow?.key, follow?.status]);

  useEffect(() => {
    dispatch({
      type: "hydrate",
      data: {
        thread: resolvedThread,
        projects: host ? host.projects : projectsFor(fullMeta),
        machines: host ? host.machines : machinesFor(fullMeta),
        activeContext: contextFor(fullMeta, messages.some((m) => m.parts.some((p) => p.type === "identity_dispute"))),
      },
    });
  }, [resolvedThread, messages, fullMeta, host]);

  // Re-read notebook detail and stash its scope for the NEXT send — the SAME
  // seam F1's onConfirmIdentity uses, now ALSO the follower's "refresh
  // sources" signal on a successful settle (the manual may just have become
  // citable). Best-effort: a failed re-read here never fails anything else —
  // the next send falls back to the host's own eventually-refreshed scope.
  // Resolves `true` when the re-read scope was stored, `false` when the
  // re-read failed (#4219 Codex r2 F1), `null` when there was nothing to do.
  const refreshPromotedScope = useCallback(async (): Promise<boolean | null> => {
    if (!notebookId || !aliveRef.current) return null;
    // The re-read is async; this instance can unmount before it returns (the
    // technician switched notebooks — see the `UnifiedChat` wrapper's remount
    // doc comment). Only a STILL-MOUNTED instance, for the notebook it was
    // fetched for, may store a scope, or A's docs ride B's next send.
    const fetchedFor = notebookId;
    try {
      const after = await getNotebookDetail(fetchedFor, { threadId: attachmentThreadId ?? undefined });
      if (!aliveRef.current || notebookIdRef.current !== fetchedFor) return null;
      confirmedScopeRef.current = enabledDocIds(after.sources.filter(canBeChatSource));
      return true;
    } catch {
      if (aliveRef.current && notebookIdRef.current === fetchedFor) confirmedScopeRef.current = null;
      return false;
    }
  }, [notebookId, attachmentThreadId]);

  // `attachmentThreadId`/`refreshPromotedScope` can change without a remount
  // (a thread switch within the SAME notebook — see the reset effect above's
  // own comment); the driver below is constructed ONCE per notebook (lazy
  // `useRef`), so it reads both through a ref kept fresh every render,
  // rather than closing over a value that could go stale.
  const attachmentThreadIdRef = useRef(attachmentThreadId);
  attachmentThreadIdRef.current = attachmentThreadId;
  const refreshPromotedScopeRef = useRef(refreshPromotedScope);
  refreshPromotedScopeRef.current = refreshPromotedScope;

  // The ONE owned manual-search state machine for this notebook (see
  // `createMobileManualSearchDriver`'s own header above). Created once, lazily
  // — a notebook switch remounts this whole component (the `UnifiedChat`
  // wrapper's `key`), so there is never a live-across-notebooks instance to
  // reset in place.
  const manualSearchDriverRef = useRef<MobileManualSearchDriver | null>(null);
  if (!manualSearchDriverRef.current && notebookId) {
    manualSearchDriverRef.current = createMobileManualSearchDriver({
      notebookId,
      fetchStatus: () => fetchManualSearchStatus(notebookId, { threadId: attachmentThreadIdRef.current ?? undefined }),
      onStateChange: setFollow,
      onRefreshSources: () => void refreshPromotedScopeRef.current(),
      isAlive: () => aliveRef.current,
    });
  }
  useEffect(() => () => manualSearchDriverRef.current?.reset(), []);

  // Trigger: a LIVE frame (this session's SSE) reporting a running search.
  // Codex round 5 F15 (#4195): routed through `observeLiveManualSearchFrame`,
  // NOT a GET/confirm-shaped seed — a live frame is a DIFFERENT shape of
  // input. `baseThread.turns` can re-deliver the SAME historical frame to
  // this effect on an UNRELATED rerender (a new `meta` object with identical
  // content), and a same-generation replay that still says `running: true`
  // must stay a no-op rather than reopening an already-settled/exhausted
  // follow — `observeLiveManualSearchFrame` (via `driver.observeLive`)
  // guarantees that, while still letting a genuinely NEW candidate search (a
  // different generation) start following even though an older one already
  // settled.
  useEffect(() => {
    const live = latestManualSearchStatus(baseThread.turns);
    if (!live || !notebookId) return;
    const liveKey = `${notebookId}|${live.manufacturer}|${live.model}|${live.startedAt ?? ""}`;
    if (!live.running) {
      // Codex r18 F31: a COMPLETED frame is news only while the tracked search
      // is not settled (still following, or polling ran out). Reconcile through
      // ONE authoritative probe, the same single reader everything else uses,
      // rather than trusting the frame; the probe's own fencing applies. Each
      // completed frame triggers at most one probe, so replays cost nothing.
      if (lastCompletedFrameKeyRef.current === liveKey) return;
      lastCompletedFrameKeyRef.current = liveKey;
      if (follow && follow.phase !== "resolved") manualSearchDriverRef.current?.probe();
      return;
    }
    if (lastLiveFrameKeyRef.current === liveKey) return;
    lastLiveFrameKeyRef.current = liveKey;
    manualSearchDriverRef.current?.observeLive(live);
  }, [baseThread, notebookId, follow]);

  // Trigger: mount, or a thread switch within the same notebook (manual
  // search can be thread-scoped — matches the old hydration effect's own
  // `attachmentThreadId` dependency). The server never persists this
  // status, so the ONLY way to know "is a search running" is to ask —
  // reusing the existing detail-fetch seam (`fetchManualSearchStatus`, the
  // SAME GET route `getNotebookDetail` already calls). This is the chain's
  // own one-shot PROBE: it reconciles with whatever is current (nothing
  // tracked yet, or a stale resolved/unresolved outcome from before this
  // thread/mount) and, if the result is `following`, the driver's own timer
  // chain takes over from there — there is no separate poll effect.
  useEffect(() => {
    manualSearchDriverRef.current?.probe();
  }, [notebookId, attachmentThreadId]);

  // Open shell layers join the app's one BACK stack (lib/transient-layer.ts):
  // hardware BACK closes the top layer before any tab navigation happens.
  const layer = topLayer(state);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  useEffect(() => {
    if (!layer) return;
    return registerTransientLayer(() => {
      const current = layerRef.current;
      if (current) dispatch(closeLayerAction(current));
    });
  }, [layer]);

  // Attachments are the SHELL's job now, not the screen's: the controller owns
  // the native pick, holds the bytes, and uploads through the existing doors at
  // send time. The host's own attach handlers are intentionally not wired here
  // (see UnifiedChatHandlers) — they upload-and-ask immediately, which is the
  // behaviour the preview flow replaces.
  const attachTarget = attachmentNotebookId === undefined ? meta.notebookId : attachmentNotebookId;
  const attachments = useUnifiedAttachments(attachTarget, attachmentThreadId);
  // The adapter must keep one identity for the life of the chat: the shared
  // Composer releases every pending attachment whenever its adapter changes,
  // and the hosts pass a fresh onScanMachine on every render. Read the scanner
  // through a ref so a re-render never costs the technician a picked photo.
  const scanMachineRef = useRef(handlers.onScanMachine);
  scanMachineRef.current = handlers.onScanMachine;
  const adapter = useMemo(() => createCapacitorAdapter({
    onAttachPhoto: attachments.attachPhoto,
    onAttachFile: attachments.attachFile,
    onAttachCamera: attachments.attachCamera,
    onScanMachine: async () => (await scanMachineRef.current?.()) ?? null,
    onRelease: attachments.release,
  }), [attachments.attachPhoto, attachments.attachFile, attachments.attachCamera, attachments.release]);

  // The assistant surface renders text through the SAME markdown + inline
  // citation-mark pipeline ChatV2 uses (AnswerMarkdown), gated on the turn's
  // own source parts so an unknown [7] stays literal text. A user turn is plain.
  const onCitation = handlers.onCitation;
  const renderText = useCallback((text: string, turn: InteractionTurn): ReactNode => {
    if (turn.role === "user") return text;
    const own: ChatCitation[] = [];
    for (const part of turn.parts) {
      if (part.type !== "source") continue;
      const citation = citations.get(part.source.id);
      if (citation) own.push(citation);
    }
    return <AnswerMarkdown text={text} citations={own} onCitation={onCitation} />;
  }, [citations, onCitation]);


  /**
   * Copy an answer WITH its citations. `copyText` is only the clipboard
   * primitive — ChatV2 copies the bare answer, so a pasted answer there loses
   * the one thing that makes it trustworthy. The shell hands us a turn id; we
   * rebuild the text from the store's own parts so the copied block always
   * matches what is on screen, then append the sources it cited.
   */
  const onCopy = useCallback((turnId: string) => {
    const turn = state.thread.turns.find((t) => t.id === turnId);
    if (!turn) return;
    const body = turn.parts
      .filter((part): part is Extract<InteractionPart, { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n\n")
      .trim();
    const sources = turn.parts
      .filter((part): part is Extract<InteractionPart, { type: "source" }> => part.type === "source")
      // Label by the source id the inline marks use, so the pasted block matches
      // the [n] the reader saw. Numbering by position renumbers them silently.
      .map((part) => `[${part.source.id}] ${part.source.title}${part.source.locator ? ` ${part.source.locator}` : ""}`);
    const text = sources.length > 0 ? `${body}\n\nSources:\n${sources.join("\n")}` : body;
    if (text) void copyText(text);
  }, [state.thread.turns]);

  // NotebookScreen reports a failed send later via `chatError`, and nothing
  // throws, so the try/catch in Composer could never fire on device — the humane
  // error surface was unreachable exactly where it was needed. Mirror the host's
  // error into shell state so the in-thread surface (with Retry) is the one the
  // technician sees.
  // Mirror only on a CHANGE in the host's error. `state.draft` is a dependency
  // (the restore below reads it), so an unconditional dispatch re-ran on every
  // keystroke and on the draft this effect itself restores — forcing
  // `chatError ?? null` and silently erasing an error the attachment path had
  // just set locally. An upload that failed then looked like nothing happened:
  // the question reappeared in the composer with no explanation.
  const mirroredChatError = useRef<string | null>(null);
  useEffect(() => {
    const next = chatError ?? null;
    if (mirroredChatError.current === next) return;
    mirroredChatError.current = next;
    dispatch({ type: "set-send-error", error: next });
    // The composer clears the draft at send time, so by the time a failure
    // arrives the question is gone. Put it back — host-owned, because only the
    // host knows what was in flight. The reducer has no idea what failed.
    if (chatError && !state.draft.trim()) {
      const q = failedQuestion ?? pending?.q ?? liveTurns.at(-1)?.q ?? "";
      if (q) dispatch({ type: "set-draft", draft: q });
    }
  }, [chatError, failedQuestion, pending, liveTurns, state.draft]);

  /**
   * One send, composed. On HOME there is no notebook yet, so the bytes are
   * stashed and the host's send creates the thread that claims them. In a
   * notebook the uploads run first and the resulting rider goes out with the
   * question on the host's existing send path.
   */
  const onSend = useCallback((text: string, pending: readonly Attachment[], opts: { retry?: boolean } = {}) => {
    // Codex F1 (HIGH, #4175/#4189): a confirmed identity may have just
    // promoted a candidate manual into an enabled source (migration 104) —
    // `onConfirmIdentity` below re-reads detail and stashes the refreshed
    // scope here so THIS send rides it immediately, rather than the stale
    // scope the host computed before the confirm. One-shot: consumed (and
    // cleared) by the very next send, exactly like the document-upload
    // `composed.scope` override below.
    const confirmedScope = confirmedScopeRef.current;
    confirmedScopeRef.current = null;
    if (!attachTarget) {
      if (pending.length > 0) attachments.stashForHandoff(pending);
      if (confirmedScope) handlers.onSend(text, undefined, confirmedScope);
      else handlers.onSend(text);
      return;
    }
    // Nothing held here, nothing carried from HOME, and not a retry: the plain,
    // synchronous text send, unchanged. `hasCarried()` is what keeps the HOME
    // handoff from being skipped — the composer's own pending list is empty in
    // the notebook the handoff just opened, so a pending-only check sent the
    // question and left the photo behind for the NEXT send. A failed send's
    // retained bytes are deliberately NOT a reason to compose here (#3863):
    // they ride only the explicit Try again below.
    if (pending.length === 0 && !attachments.hasCarried() && !opts.retry) {
      // A new plain question supersedes the failed attachment turn. Reuse
      // compose's synchronous zero-request cleanup before forwarding text;
      // with no pending/carried/retry descriptors this cannot upload anything.
      // Otherwise a later text failure's Try again revives the old photo.
      if (attachments.hasRetained()) void attachments.compose(text, []);
      if (confirmedScope) handlers.onSend(text, undefined, confirmedScope);
      else handlers.onSend(text);
      return;
    }
    void attachments.compose(text, pending, opts).then((composed) => {
      // Light review (#4195, HIGH, notebook-switch class): `confirmedScope`
      // was captured BEFORE this await, on THIS notebook. If the technician
      // switched notebooks while compose was pending, this instance is now
      // unmounted (see the `UnifiedChat` wrapper) and `handlers.onSend` is
      // the OLD notebook's callback — calling it would send text, or A's
      // scope, into whichever notebook the host now treats that stale
      // callback as bound to. There is no safe notebook to deliver this
      // send to, so it is DROPPED entirely (not sent to A, not sent to B).
      if (!aliveRef.current) return;
      if (composed.failure) {
        // Codex round 7 F22 (#4195): no send is actually handed to the parent
        // on this path, so the promoted scope captured above must not be
        // treated as spent — restore it for the retry this failure invites.
        // Only restore into an EMPTY ref: if something newer already landed
        // while compose was pending (another confirm's refresh), that newer
        // value must win, never be clobbered by this older one.
        restoreConfirmedScope(confirmedScope);
        // Do not send: a photo question with no photo would answer from nothing.
        dispatch({ type: "set-send-error", error: composed.failure });
        dispatch({ type: "set-draft", draft: composed.question });
        return;
      }
      // A text or photo turn keeps its exact two-argument send; only a document
      // upload (or a just-confirmed identity) adds the re-read scope — the
      // upload's own re-read wins when both are present (it is the fresher of
      // the two, computed for this exact send).
      const scope = composed.scope ?? confirmedScope;
      if (scope) handlers.onSend(composed.question, composed.rider, scope);
      else handlers.onSend(composed.question, composed.rider);
      // Uploaded but not searchable stays visible rather than being swallowed.
      if (composed.warning) dispatch({ type: "set-send-error", error: composed.warning });
    }).catch((error: unknown) => {
      if (!aliveRef.current) return;
      // Codex round 7 F22 (#4195), same reasoning as the `composed.failure`
      // branch above: a rejected compose never reaches `handlers.onSend`
      // either, so the scope it would have ridden must survive for retry.
      restoreConfirmedScope(confirmedScope);
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "set-send-error", error: message || "The attachment didn't upload — try again." });
      dispatch({ type: "set-draft", draft: text });
    });
  }, [attachTarget, attachments, handlers, dispatch, restoreConfirmedScope]);

  // The question HOME queued for the thread it just created. It goes through
  // `onSend` (not straight to the host) so the attachments HOME stashed are
  // composed and uploaded for THIS turn.
  const initialSentRef = useRef<string | null>(null);
  useEffect(() => {
    const text = initialQuestion?.trim();
    if (!text || busy || initialSentRef.current === text) return;
    initialSentRef.current = text;
    onSend(text, []);
    onInitialQuestionSent?.();
  }, [busy, onSend, initialQuestion, onInitialQuestionSent]);

  // Read-aloud for gloved / hands-in-the-panel use. Null where the WebView has
  // no Web Speech, in which case no button renders. Stopped on unmount.
  const readAloud = useMemo(() => createReadAloud(), []);
  const fixRequestIds = useMemo(() => createFixRequestIds(), []);
  useEffect(() => () => readAloud?.stop(), [readAloud]);
  // Switching notebook or thread stops an answer that is still being read.
  useEffect(() => {
    readAloud?.scope(`${meta.notebookId ?? ""}:${meta.threadId ?? ""}`);
  }, [readAloud, meta.notebookId, meta.threadId]);
  const onReadAloud = useCallback((turnId: string) => {
    const turn = state.thread.turns.find((t) => t.id === turnId);
    if (!turn) return;
    // The same citation ids renderText turns into chips: only those "[n]" are
    // citation marks; any other bracketed number is spoken.
    const ids = new Set<string>();
    for (const part of turn.parts) {
      const c = part.type === "source" ? citations.get(part.source.id) : undefined;
      if (c) ids.add(c.citationId);
    }
    readAloud?.toggle(turnId, spokenAnswerText(turn, ids));
  }, [readAloud, state.thread.turns, citations]);

  // Plant memory (migration 095): record what fixed the machine under the
  // question this answer replied to; platform dialogs are the capture UI.
  const onRecordFix = useCallback(async (turnId: string) => {
    const symptom = fixSymptomFor(state.thread.turns, turnId);
    // Filed under the machine THIS answer was served for (Codex #4058 post-cap
    // F1); a live answer has no server turn yet and offers no button.
    const sourceTurnId = serverTurnIdFor(turnId);
    if (!meta.notebookId || !symptom || !sourceTurnId) return;
    const fix = window.prompt(`What fixed it?\n\nProblem: ${symptom}`)?.trim();
    if (!fix) return;
    const clientRequestId = fixRequestIds.idFor(turnId, fix);
    try {
      await request(`/api/equipment-notebooks/${encodeURIComponent(meta.notebookId)}/fixes/`, {
        method: "POST",
        json: { symptom, fix, clientRequestId, sourceTurnId },
      });
      fixRequestIds.settle(turnId, fix);
      window.alert("Saved. MIRA will use this fix on this machine next time.");
    } catch (e) {
      const refusal = e instanceof ApiError ? fixRefusalMessage(e.detail) : null;
      if (refusal) fixRequestIds.settle(turnId, fix);
      window.alert(refusal ?? "Could not save the fix. Check the connection and try again.");
    }
  }, [fixRequestIds, meta.notebookId, state.thread.turns]);

  const hooks: HostHooks = {
    onSend,
    renderText,
    onCopy,
    ...(readAloud ? { onReadAloud } : {}),
    ...(meta.notebookId
      ? { onRecordFix: (turnId: string) => void onRecordFix(turnId), canRecordFix: (turnId: string) => serverTurnIdFor(turnId) !== null }
      : {}),
    ...(canStop ? { onStop: handlers.onStop } : {}),
    // The host retry re-sends the rendered turn as plain text. That is right for
    // a text turn and WRONG for one whose attachment never uploaded: it would
    // ask the photo question with no photo — the outcome `compose` refuses on
    // the first attempt (see attachments.ts). When the controller still holds
    // the bytes, retry through the composed path so the photo rides the turn.
    ...(canRetry && handlers.onRetry
      ? { onRetry: () => {
          const draft = state.draft.trim();
          const priorQuestion = state.thread.turns.filter((turn) => turn.role === "user").at(-1)
            ?.parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("\n").trim();
          // A changed question is a new send. An unchanged question must keep
          // the host's original request id and source scope for deduplication.
          const edited = Boolean(draft && draft !== priorQuestion);
          dispatch({ type: "set-draft", draft: "" });
          dispatch({ type: "set-send-error", error: null });
          if (attachments.hasRetained() || attachments.hasCarried() || edited) {
            onSend(state.draft, [], { retry: true });
            return;
          }
          handlers.onRetry?.();
        } }
      : {}),
    ...(handlers.onNewChat ? { onNewChat: handlers.onNewChat } : {}),
    ...(handlers.onCreateProject ? { onCreateProject: handlers.onCreateProject } : {}),
    onSource: (source) => {
      const citation: ChatCitation | undefined = citations.get(source.id);
      if (citation) handlers.onCitation(citation);
    },
    onScanMachine: handlers.onScanMachine,
    groundingLine,
    suggestChips,
    busy,
    ...(meta.notebookId
      ? {
          onConfirmIdentity: async (proposal) => {
            const requestedNotebookId = meta.notebookId;
            const result = await confirmIdentityProposal(requestedNotebookId, proposal);
            // Codex round 5 F16 (#4195): the SAME race as the Hub's own
            // `hub-host.tsx` onConfirmIdentity — a notebook switch that
            // routes through `NotebooksTab.tsx`'s `onOpenNotebook` (a Sensor
            // READ resolving a DIFFERENT machine) changes this component's
            // `notebookId` prop IN PLACE, with no `key`-forced remount (only
            // `UnifiedRoot.tsx`'s mount site keys by notebook — `NotebooksTab`
            // does not). A confirm started on A, resolving after the
            // technician has moved to B, must not seed B's follower or
            // refresh B's scope under A's identity. `notebookIdRef` tracks
            // the LATEST committed `meta.notebookId` across renders of this
            // SAME instance; bind every side effect below to the notebookId
            // THIS request was for, and discard them if it no longer matches.
            // The confirm's own return value is returned either way — its
            // caller is the specific proposal card that made this call.
            // Light review (#4195, notebook-switch class): remounting (see
            // the `UnifiedChat` wrapper) makes `notebookId` constant for this
            // instance's whole life, so `notebookIdRef` alone can no longer
            // detect "the technician switched notebooks" — it now only
            // detects an impossible case. `aliveRef` detects the real one:
            // this instance got unmounted (a fresh one for the new notebook
            // took its place), so there's nothing left here to seed/refresh.
            if (!aliveRef.current || notebookIdRef.current !== requestedNotebookId) return result;
            // Codex F1 (HIGH): confirming may have just promoted a candidate
            // manual into an enabled source (migration 104) — re-read the
            // authoritative detail and stash its scope so the NEXT question
            // rides notebook retrieval with the promoted doc, rather than the
            // stale (possibly empty) scope the host computed before this
            // confirm. Mirrors the Hub's own `loadDetail` call after confirm
            // (`hub-host.tsx`'s `onConfirmIdentity`).
            const refreshed = await refreshPromotedScope();
            // #4219 Codex r2 F1: the identity is saved, but if the scope re-read
            // failed, the next question would still use the old sources. Say so
            // instead of claiming the manual is ready to answer from.
            if (refreshed === false && result.manualReady) {
              return {
                ...result,
                manualReady: false,
                message: "Machine confirmed, but its manual couldn't be loaded. Reload this notebook before asking about it.",
              };
            }
            // Codex round 11 remediation (#4195, single reader): the confirm
            // path no longer fetches `fetchManualSearchStatus` itself — that
            // was the third independent reader, and its own epoch-guarded
            // fetch is exactly what F26 found still racing against the
            // chain's own poll. `result.searching` is the STRUCTURED signal
            // the confirm route returns (never scraped from `message` text):
            // when true, seed the optimistic `running:true` state directly —
            // a search genuinely just started, nothing to reconcile against
            // yet. When false, request ONE probe tick from the driver (Codex
            // round 4 F6's reconciliation, now routed through the SAME state
            // machine the chain's own ticks use): a settled candidate-review
            // message (e.g. "not turned on") must not survive a confirm that
            // just promoted the manual via a path that never started a NEW
            // search (manualReady:true, searching:false) — the probe fetches
            // the authoritative status and reconciles it exactly as a slow
            // tick would, with the SAME generation-key fencing (no second
            // epoch, no separate race to get wrong).
            // Codex r15 F30: the screen may have unmounted during the refresh
            // above; never restart following (seed/probe) for a dead instance.
            if (!aliveRef.current) return result;
            if (result.searching) {
              manualSearchDriverRef.current?.seed({
                manufacturer: proposal.manufacturer,
                model: proposal.model,
                running: true,
                ...(result.startedAt ? { startedAt: result.startedAt } : {}),
              });
            } else {
              manualSearchDriverRef.current?.probe();
            }
            return result;
          },
        }
      : {}),
  };

  return <div className="unified-host" data-testid="unified-chat">
    {/* No host-level error banner: the shell's SendError is the surface now. It
        renders in the thread, strips status codes, offers the host's own Retry
        and dismisses — keeping this too drew two error surfaces for one failure. */}
    <FactoryLMShell
      state={state}
      dispatch={dispatch}
      adapter={adapter}
      hooks={hooks}
      conversationSurface="assistant"
      onOpenItem={host?.onOpenItem}
      onSelectProject={host?.onSelectProject}
      navigationFooter={host?.navigationFooter}
    />
  </div>;
}

/**
 * Remount boundary (light review, #4195 notebook-switch class). Every round
 * of review found another per-notebook `useState`/`useRef` inside
 * `UnifiedChatForNotebook` (the confirm seed, the scope refresh, the manual-
 * search follower, the attachments controller, the shell reducer…) that
 * leaked across a notebook switch, because `NotebooksTab.tsx`'s
 * `onOpenNotebook` changes `meta.notebookId` IN PLACE on this SAME component
 * instance — no `key`-forced remount (only `UnifiedRoot.tsx`'s own mount
 * site keys by notebook+thread; see its `key={`${selected}:${selectedThreadId
 * ...}`}`). Patching leaks one field at a time is how that became a
 * multi-round class of bugs instead of one fix: EVERY current and future
 * per-notebook field is exposed to the same race unless something makes
 * carrying state across a switch structurally impossible.
 *
 * Forcing React to tear down and recreate `UnifiedChatForNotebook` on a
 * notebook change does that in one place: every hook inside it starts fresh
 * for the new notebook, by construction, with no per-field reset effect to
 * remember to write. The `aliveRef` guards inside `UnifiedChatForNotebook`
 * cover the other half — an OLD instance's in-flight promise (confirm /
 * compose / refresh) resolving AFTER it has already been unmounted.
 *
 * Keyed on `notebookId` ONLY, not `threadId`: a thread switch within the
 * SAME notebook must keep today's behavior. Today, `NotebooksTab` never
 * remounts on a thread change either, and `UnifiedChatForNotebook`'s own
 * notebookId-only reset effect (kept below as defense in depth, now mostly
 * redundant with this remount) already proves per-notebook state is meant to
 * survive a thread change — only a notebook change resets it.
 */
export function UnifiedChat(props: UnifiedChatProps) {
  return <UnifiedChatForNotebook key={props.meta.notebookId || "none"} {...props} />;
}

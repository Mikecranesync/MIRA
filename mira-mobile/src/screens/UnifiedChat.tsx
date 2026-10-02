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

export function UnifiedChat({
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
  const refreshPromotedScope = useCallback(async () => {
    if (!notebookId) return;
    try {
      const after = await getNotebookDetail(notebookId, { threadId: attachmentThreadId ?? undefined });
      confirmedScopeRef.current = enabledDocIds(after.sources.filter(canBeChatSource));
    } catch {
      confirmedScopeRef.current = null;
    }
  }, [notebookId, attachmentThreadId]);

  // Trigger: a LIVE frame (this session's SSE) reporting a running search.
  // Codex round 3 F6: `prev ?? startFollow(...)` was a blanket no-op once
  // ANYTHING was already tracked — a later, different search (a different
  // confirmed identity) in the same thread never started following once the
  // first one resolved or exhausted its budget.
  //
  // Codex round 5 F15 (#4195): this is `observeLiveManualSearchFrame`, NOT
  // `reseedManualSearchFollow` — a live frame is a DIFFERENT shape of input
  // than a GET/confirm read. `baseThread.turns` can re-deliver the SAME
  // historical frame to this effect on an UNRELATED rerender (a new `meta`
  // object with identical content), and now that the chat route stamps a
  // real generation on every live frame (round 5), a same-generation replay
  // that still says `running: true` would read as "still running" under
  // `reseedManualSearchFollow` and reopen an already-settled/exhausted
  // follow. `observeLiveManualSearchFrame` treats any same-generation live
  // read as a no-op and only starts following a generation this effect has
  // not seen before — which is exactly what lets a genuinely NEW candidate
  // search (a different generation) start following even though an older
  // one already settled.
  useEffect(() => {
    const live = latestManualSearchStatus(baseThread.turns);
    if (!live || !live.running || !notebookId) return;
    const liveKey = `${notebookId}|${live.manufacturer}|${live.model}|${live.startedAt ?? ""}`;
    if (lastLiveFrameKeyRef.current === liveKey) return;
    lastLiveFrameKeyRef.current = liveKey;
    setFollow((prev) => {
      const result = observeLiveManualSearchFrame(prev, notebookId, live);
      if (result.refreshSources) void refreshPromotedScope();
      return result.state;
    });
  }, [baseThread, notebookId, refreshPromotedScope]);

  // Trigger: hydration / notebook change. The server never persists this
  // status, so the ONLY way to know "is a search running" after a reload is
  // to ask — reusing the existing detail-fetch seam (`fetchManualSearchStatus`,
  // the SAME GET route `getNotebookDetail` already calls), once.
  useEffect(() => {
    if (!notebookId) return;
    let cancelled = false;
    void fetchManualSearchStatus(notebookId, { threadId: attachmentThreadId ?? undefined })
      .then((status) => {
        if (cancelled || !status) return;
        setFollow((prev) => {
          const result = reseedManualSearchFollow(prev, notebookId, status);
          if (result.refreshSources) void refreshPromotedScope();
          return result.state;
        });
      })
      .catch(() => {
        // Best-effort: no status this time just means nothing renders yet.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally NOT `follow`: a one-shot hydration check, not a re-check loop.
  }, [notebookId, attachmentThreadId, refreshPromotedScope]);

  // The bounded re-check itself (NOT a polling framework — one setTimeout
  // chain, capped attempts via the shared follower, cleared on unmount/dep
  // change). Dependencies are PRIMITIVES ONLY (key/attempts/phase, never
  // `baseThread`): an unrelated rerender must never cancel an in-flight read
  // without consuming the attempt it was about to spend (Codex F8's "at most
  // five requests across unrelated rerenders").
  useEffect(() => {
    if (!follow || follow.phase !== "following" || !notebookId) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void fetchManualSearchStatus(notebookId, { threadId: attachmentThreadId ?? undefined })
        .then((status) => {
          if (cancelled) return;
          setFollow((prev) => {
            if (!prev) return prev;
            const result = advanceManualSearchFollow(prev, notebookId, status);
            if (result.refreshSources) void refreshPromotedScope();
            return result.state;
          });
        })
        .catch(() => {
          if (cancelled) return;
          setFollow((prev) => (prev ? advanceManualSearchFollow(prev, notebookId, null).state : prev));
        });
    }, 4000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [follow?.key, follow?.attempts, follow?.phase, notebookId, attachmentThreadId, refreshPromotedScope]);

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
  const adapter = useMemo(() => createCapacitorAdapter({
    onAttachPhoto: attachments.attachPhoto,
    onAttachFile: attachments.attachFile,
    onAttachCamera: attachments.attachCamera,
    onScanMachine: handlers.onScanMachine,
  }), [attachments.attachPhoto, attachments.attachFile, attachments.attachCamera, handlers.onScanMachine]);

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
      if (confirmedScope) handlers.onSend(text, undefined, confirmedScope);
      else handlers.onSend(text);
      return;
    }
    void attachments.compose(text, pending, opts).then((composed) => {
      if (composed.failure) {
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
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "set-send-error", error: message || "The attachment didn't upload — try again." });
      dispatch({ type: "set-draft", draft: text });
    });
  }, [attachTarget, attachments, handlers, dispatch]);

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
          if (attachments.hasRetained() || attachments.hasCarried()) {
            dispatch({ type: "set-send-error", error: null });
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
            if (notebookIdRef.current !== requestedNotebookId) return result;
            // Codex F1 (HIGH): confirming may have just promoted a candidate
            // manual into an enabled source (migration 104) — re-read the
            // authoritative detail and stash its scope so the NEXT question
            // rides notebook retrieval with the promoted doc, rather than the
            // stale (possibly empty) scope the host computed before this
            // confirm. Mirrors the Hub's own `loadDetail` call after confirm
            // (`hub-host.tsx`'s `onConfirmIdentity`).
            await refreshPromotedScope();
            // Codex round 4 F6: reconcile the follower against the
            // AUTHORITATIVE status regardless of `searching` — a settled
            // candidate-review message (e.g. "not turned on") must not
            // survive a confirm that just promoted the manual via a path
            // that never started a NEW search (manualReady:true,
            // searching:false). The round-2 optimistic `running:true` seed
            // below is a fallback used ONLY when the authoritative read is
            // unavailable (a transient failure right after confirm) — it
            // must never overwrite a fresh authoritative settle.
            let authoritative: ManualSearchStatus | null = null;
            try {
              authoritative = await fetchManualSearchStatus(requestedNotebookId, { threadId: attachmentThreadId ?? undefined });
            } catch {
              authoritative = null;
            }
            // F16, same check: the scope refresh above may have taken long
            // enough for the technician to have moved on too.
            if (notebookIdRef.current !== requestedNotebookId) return result;
            if (authoritative) {
              setFollow((prev) => {
                const seedResult = reseedManualSearchFollow(prev, requestedNotebookId, authoritative!);
                if (seedResult.refreshSources) void refreshPromotedScope();
                return seedResult.state;
              });
            } else if (result.searching) {
              // Codex round 2 F4: `searching` is the STRUCTURED signal the
              // confirm route now returns (never scraped from `message` text)
              // — start following progress ONLY when a search genuinely
              // started, so a flag-off or nothing-to-search confirm never
              // follows a search that was never running.
              setFollow((prev) => {
                const seeded: ManualSearchStatus = {
                  manufacturer: proposal.manufacturer,
                  model: proposal.model,
                  running: true,
                  ...(result.startedAt ? { startedAt: result.startedAt } : {}),
                };
                const seedResult = reseedManualSearchFollow(prev, requestedNotebookId, seeded);
                if (seedResult.refreshSources) void refreshPromotedScope();
                return seedResult.state;
              });
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

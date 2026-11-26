"use client";
/**
 * Hub host for the shared FactoryLM shell (Hub mount PR 1, #3839).
 *
 * The shell (`packages/factorylm-ui`) renders; this host owns everything the
 * charter says a host owns: auth, the notebook/thread tree, hydration, the send
 * path through the ONE canonical conversation backend
 * (`POST /api/equipment-notebooks/[id]/chat`), stop/retry, and the citation
 * lookup. No new chat store, stream parser, evidence system or backend — the
 * stream reader, chat body, and persisted-turn rules are the classic notebook's
 * (`notebook-chat-utils.ts`), mapped onto `InteractionPart` by
 * `to-interaction.ts`.
 *
 * Scope (owner, 2026-09-19 — supersedes the 2026-09-17 note): the host lands on
 * HOME with the composer enabled (ChatGPT-first lock L0); a HOME send becomes a
 * new thread in an UNBOUND notebook on the ONE canonical route (never the
 * last-opened machine notebook, whose identity would ride the turn), creating a
 * "General" project when the workspace has none; New chat and New project are
 * always available. `/feed` remains the default landing until Gate 6.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import { signOutToLogin } from "@/components/layout/sign-out-action";
import { HubAccountFooter } from "./HubAccountFooter";
import { useBackClosesLayers } from "./back-closes-layers";
import {
  shellReducer,
  type Attachment,
  IdentityAlreadyConfirmedError,
  type ConfirmIdentityResult,
  type IdentityProposal,
  type InteractionPart,
  type InteractionTurn,
  type ManualSearchFollowState,
  type ManualSearchStatus,
  type ProjectItem,
  type QuestionTarget,
  type ShellState,
  type ProgressStage,
  compareManualSearchGeneration,
} from "@factorylm/interaction";
import {
  FactoryLMShell,
  createFixRequestIds,
  createReadAloud,
  fixRefusalMessage,
  fixSymptomFor,
  serverTurnIdFor,
  spokenAnswerText,
  type HostHooks,
} from "@factorylm/ui";
import { API_BASE, MAX_UPLOAD_MB } from "@/lib/config";
import type { EquipmentNotebook, NotebookSource } from "@/lib/equipment-notebooks";
import { NOTEBOOK_ATTEMPT_HEADER, type EvidenceCitation, type NotebookSheetReceiptFrame } from "@/lib/notebook-chat-types";
import {
  isAbortError,
  NotebookHttpError,
  readNotebookStream,
  type PersistedTurn,
} from "@/components/equipment/notebook-chat-utils";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import { AnswerWithSafety } from "./answer-with-safety";
import { UserTurnText } from "./user-turn-text";
import { browserAdapterDeps, createWebAdapter } from "./web-adapter";
import { HOME_THREAD, createOutgoingOwner, withOutgoing, type Outgoing } from "./outgoing-turn";
import { composeHubSend, missingAttachmentKinds, pairAttachments, resolveUploadNode, runAttachedSend, type HeldFile } from "./hub-attachments";
import { createManualSearchDriver, type ManualSearchDriver } from "./manual-search-driver";
import { GuidedProcedure } from "./GuidedProcedure";
import { MachineObservations } from "./MachineObservations";
import { EquipmentNav } from "./EquipmentNav";
import { SavedFixes } from "./SavedFixes";
import { WorkPacketPanel } from "./WorkPacketPanel";
import { wantsPacketOpen } from "./work-packet-view";
import { LivingSheet } from "./LivingSheet";
import { NewProjectSetup } from "./NewProjectSetup";
import { PendingManuals } from "./PendingManuals";
import { ParkedSources } from "./ParkedSources";
import { clearSheetDataForSignOut, localStorageStore, parseSheetReceipts } from "./living-sheet-client";
import { actionsCoveredByLayer, NOTEBOOK_ACTIONS_CSS, notebookActionsStyle } from "./notebook-actions";
import { NotebookActionsMenu, NotebookActionsMenuProvider } from "./notebook-actions-menu";
import { BenchComponents } from "./BenchComponents";
import { benchSendRefusal, createBenchSendGate, expectsComponentFrame, isScopeRefusalCode, parseComponentFrames, prepareChatSend, conversationKey, heldEvidenceNote, heldQuestionForSend, recordBenchScope, retryTargetCheck, targetReviewMessage, type BenchScopes, type BenchState, type ComponentTurnFrame, type ScopeField } from "./bench-components-logic";
import { LEGACY_THREAD_ID, notebookMachines, notebookProjects, threadRefFromItem, notebookIdFromProject, projectIdForNotebook, type HubNotebook, type HubThreadSummary } from "./notebook-tree";
import { answerTurnId, citationIndex, contextFor, lifecycleFromStream, livePartsWhileRunning, partsFromStream, questionPhotoPart, manualStatusForThread, manualStatusKey, withHostManualStatus, withSettledFollowups, type SettledFollowups, type StatusOrigin } from "./to-interaction";
import {
  EMPTY_FIXTURE,
  NO_PROJECT_ERROR,
  applyConfirmIdentityResult,
  chatBodyFor,
  guidedDeadEndBody,
  createLatestLoadTracker,
  detailQueryFor,
  enabledDocIds,
  currentReadyManualId,
  sendWaitLookup,
  isManualWaitCode,
  manualHoldAfterRefusal,
  resendBodyFor,
  manualResendPause,
  sendsManualWait,
  heldManualRecovery,
  MANUAL_WAIT_BOUND_MS,
  type ManualWaitCode,
  reloadIfStillSelected,
  errorMessageFor,
  fixtureFor,
  groundingLineFor,
  historyRows,
  homeSendPlan,
  hubHostReducer,
  initialHubShellState,
  landingSelection,
  loadNotebookListWithRetry,
  latestRequestGate,
  loadingThread,
  metaFor,
  newThreadId,
  openOffer,
  pickRouteFor,
  type EquipmentFocus,
  type EquipmentOffer,
  type PickOrigin,
  openThreadAction,
  retainedStreamInterruption,
  stoppedStreamResult,
  searchForSelection,
  selectionFromSearch,
  sendFailureMessage,
  shellThreadId,
  withLivingSheetRider,
  type CompatibleStreamResult,
  type HubSelection,
  type HubSendRecovery,
  sendRecoveryId,
  recoveryOwnsDraft,
} from "./hub-host-logic";
import { trackSafetyStop, type SafetyStopTracker } from "./safety-stop-marker";
import { resumeProjectSelection } from "./project-resume";

const NO_ATTACHMENT_DRAFTS: ReadonlySet<string> = new Set();

// #5746: why a refused manual question stopped waiting. Its draft and saved question stay.
const MANUAL_STILL_PREPARING = "The manual is still being prepared.";
const MANUAL_WAIT_STOPPED = "You stopped the wait for the manual.";
const MANUAL_WAIT_LEFT = "The wait for the manual stopped when you left this conversation.";
const MANUAL_DRAFT_CHANGED = "Your message changed, so the saved question wasn't asked again.";
const MANUAL_WAIT_REPLACED = "Another question was sent, so this one wasn't asked again.";

type Detail = {
  notebook: EquipmentNotebook;
  sources: NotebookSource[];
  turns: (PersistedTurn & { createdAt?: string; clientRequestId?: string | null })[];
  threads?: HubThreadSummary[];
  // T2 (#4189 F6): the notebook's CURRENT manual-search status, computed
  // fresh by the GET route on every read (`currentManualSearchStatus`) —
  // absent/null on a server that predates it, or when nothing is running.
  manualSearch?: ManualSearchStatus | null;
  // #5750: set when the route withheld the status for this thread (it is
  // about another model, or its subject is out of reach).
  manualSearchScope?: "other_model" | "out_of_reach";
  // #5750 r3: on a thread-scoped read with a status, the saved answer it was
  // checked against (null: the thread has no answer yet).
  manualSearchAnswer?: { turnId: string; clientRequestId: string | null } | null;
  // #5746 r4 F1: when an answer about a component withheld the status from display, the
  // project's lookup a refused manual question follows (no message or link). Never shown.
  wholeMachineManualSearch?: ManualSearchStatus;
  // #5746 r6 F1: when the status is withheld for this thread, the project's lookup, followed only
  // while a manual question the chat route refused waits on it. No message or link. Never shown.
  projectManualReadiness?: ManualSearchStatus;
};

/** #5746: how a send asks the chat route about the project's manual. `manualWait: false` keeps
 *  main's path (attachments, home, Send without the manual); `automatic` marks the one resend
 *  after a wait. */
type SendOpts = { readonly manualWait?: boolean; readonly automatic?: boolean };

/** One in-flight or just-finished exchange the server has not yet returned as a row. */
type Live = {
  readonly id: string;
  readonly clientRequestId: string;
  readonly recoveryId: string;
  readonly context: InteractionTurn["context"];
  readonly question: string;
  readonly content: string;
  readonly citations: EvidenceCitation[];
  readonly result: CompatibleStreamResult | null;
  readonly stopped: boolean;
  readonly startedAt: string;
  /** The outgoing message this stream answers (null: a retry, or none). */
  readonly outgoingId: string | null;
  /** #4687: the latest stage the server reported, shown until answer text arrives. */
  readonly progress?: ProgressStage;
  /** #5504 Codex r2 F1: this send was asked under a component, so its answer waits for that
   *  send's own component frame and shows its label — never the header's. */
  readonly componentExpected?: boolean;
  readonly componentLabel?: string | null;
};

type RetainedExchange = Live & {
  readonly result: CompatibleStreamResult;
  readonly precedingAnswerIds: ReadonlySet<string>;
  readonly precedingRequestIds: ReadonlySet<string>;
  readonly replayedRequest: boolean;
  readonly attemptId: string | null;
};

function terminalRowsByRequest(turns: Detail["turns"]): Map<string, Detail["turns"][number]> {
  const rows = new Map<string, Detail["turns"][number]>();
  for (const row of turns) {
    if (row.clientRequestId && ["answered", "insufficient_evidence", "error"].includes(row.answerStatus)) {
      rows.set(row.clientRequestId, row);
    }
  }
  return rows;
}

function savedExchangeMatches(exchange: RetainedExchange, row: Detail["turns"][number] | undefined): boolean {
  if (!row) return false;
  // An exact replay can reclaim an error without changing the request ID.
  // A stale error must never replace a newer unconfirmed partial. Keep the
  // existing text comparison for an explicit Stop on servers without receipts.
  if (exchange.replayedRequest && !exchange.result.sawStatus && row.answerStatus === "error" &&
      (exchange.stopped || !row.evidence.some((entry) => "kind" in entry && entry.kind === "safety_stop"))) {
    if (!exchange.attemptId) return exchange.stopped && exchange.result.content === (row.answerText ?? "");
    return row.evidence.some((entry) => "kind" in entry && entry.kind === "stopped_attempt" &&
      entry.attemptId === exchange.attemptId);
  }
  return !exchange.result.sawStatus || exchange.result.status === row.answerStatus;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<{ status: number; data: T | null }> {
  const res = await fetch(`${API_BASE}${path}`, { cache: "no-store", headers: { accept: "application/json" }, signal });
  const data = res.ok ? ((await res.json()) as T) : null;
  return { status: res.status, data };
}

/** The address bar, read/written only in the browser (the page is a client
 *  component but is still prerendered). `replaceState` keeps one history entry
 *  per visit: the shell's own Back handling (`adapter.onBack`) is unchanged. */
function readSearch(): string {
  return typeof window === "undefined" ? "" : window.location.search;
}
function writeSearch(search: string): void {
  if (typeof window === "undefined") return;
  const next = `${window.location.pathname}${search}`;
  if (`${window.location.pathname}${window.location.search}` !== next) window.history.replaceState(window.history.state, "", next);
}

export function HubShellHost() {
  // One capture timestamp per mount (state, not a ref: it is read during render).
  const [capturedAt] = useState(() => new Date().toISOString());
  // Direct link `?workpacket=open`, read once on arrival: the URL is rewritten to the selected
  // notebook (writeSearch) before the Work Packet panel mounts, which would drop it.
  // Holds the linked notebook id, so only that notebook's packet opens.
  const [packetLink] = useState(() => (wantsPacketOpen(readSearch()) ? new URLSearchParams(readSearch()).get("notebook") : null));
  const [signedOut, setSignedOut] = useState(false);
  // #5089: bumped after a fix is saved, so the Saved fixes list re-reads without a reload.
  const [fixesSaved, setFixesSaved] = useState(0);
  const { data: authSession } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [notebooks, setNotebooks] = useState<HubNotebook[] | null>(null);
  // #4632: the New project setup sheet (replaces window.prompt).
  const [newProjectOpen, setNewProjectOpen] = useState(false);
  // #5302: per project, the still-reading files the technician approved at Create project.
  const [pendingApprovals, setPendingApprovals] = useState<Record<string, string[]>>({});
  const [notebookGate] = useState(() => latestRequestGate());
  const [selection, setSelection] = useState<HubSelection | null>(null);
  // Mirror for async callbacks that must know whether anything is open yet
  // without re-subscribing to the selection (the notebook list reloads after
  // every send).
  const selectionRef = useRef<HubSelection | null>(null);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const detailRef = useRef(detail);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  const [live, setLive] = useState<Live | null>(null);
  const [retainedByThread, setRetainedByThread] = useState<ReadonlyMap<string, readonly RetainedExchange[]>>(() => new Map());
  const retainedByThreadRef = useRef(retainedByThread);
  const persistedByRequest = useMemo(() => terminalRowsByRequest(detail?.turns ?? []), [detail]);
  const retainedExchanges = useMemo(
    () => retainedByThread.get(selection ? shellThreadId(selection) : HOME_THREAD)
      ?.filter((exchange) => !savedExchangeMatches(exchange, persistedByRequest.get(exchange.clientRequestId))),
    [persistedByRequest, retainedByThread, selection],
  );
  const confirmedExchange = retainedExchanges?.findLast((exchange) => exchange.result.sawStatus);
  const livePersisted = live ? persistedByRequest.get(live.clientRequestId) : undefined;
  const liveReplacesError = !!live && (live.result === null || live.stopped) && livePersisted?.answerStatus === "error";
  // #4454: the finished answer's follow-up suggestions, kept past the reload
  // that replaces the live turn (saved rows never carry them).
  const [settledFollowups, setSettledFollowups] = useState<(SettledFollowups & HubSelection & { clientRequestId: string }) | null>(null);
  // The technician's message from the moment Send is tapped (outgoing-turn.ts).
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [busy, setBusy] = useState(false);
  // The open project's detail could not be read after the retries below.
  const [detailUnavailable, setDetailUnavailable] = useState(false);
  const [waitingToSend, setWaitingToSend] = useState(false);
  // A composer submission held until this conversation's detail and component scope are read.
  const waitingSend = useRef<{
    selection: HubSelection;
    question: string;
    attachments: readonly Attachment[];
    scope: ReturnType<BenchScopes["get"]>;
    signal: AbortController;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null>(null);
  type WaitingSend = NonNullable<typeof waitingSend.current>;
  // #5746 (option A): the wait of a manual question the chat route refused. The question itself is
  // a saved question in the reducer (`manualRefused`) with its draft; this is only the wait that
  // follows the project's lookup and asks again once. One at a time, for the open conversation.
  type ManualHold = { readonly key: string; readonly threadId: string; readonly recoveryId: string; readonly stop: AbortController };
  const manualHoldRef = useRef<ManualHold | null>(null);
  const [manualHold, setManualHoldState] = useState<ManualHold | null>(null);
  const setManualHold = useCallback((hold: ManualHold | null) => {
    if (manualHoldRef.current && manualHoldRef.current !== hold) manualHoldRef.current.stop.abort();
    manualHoldRef.current = hold;
    setManualHoldState(hold);
  }, []);
  // #5746 r6 F7: a composer submission held before it went, then paused. Try again then belongs to
  // that draft, through the composer, not to an older failed request's retry.
  const [sendPaused, setSendPaused] = useState(false);
  // The panel's newest read, by conversation: names the targets when a refused question's target moved.
  const [benchView, setBenchView] = useState<{ key: string; state: BenchState | null } | null>(null);
  // Equipment navigator (MIRA_EQUIPMENT_NAV): the component it resolved, for that conversation's checklist to select.
  const [equipmentFocus, setEquipmentFocus] = useState<EquipmentFocus | null>(null);
  const [equipmentOffer, setEquipmentOffer] = useState<EquipmentOffer | null>(null);
  const [equipmentNotice, setEquipmentNotice] = useState<string | null>(null);
  const equipmentPickToken = useRef(0);
  // TASK-S3: the Living Work Sheet job open for ANY notebook (LivingSheet is
  // mounted per-notebook, but this state belongs to the host, not the panel,
  // so send() can read it without a prop round-trip). `livingSheetJobId`
  // rides the next chat turn only while `job.notebookId` matches the turn's
  // own notebook — switching notebooks never leaks a stale job id.
  const [livingSheetJob, setLivingSheetJob] = useState<{ notebookId: string; jobId: string } | null>(null);
  const [sheetReceipt, setSheetReceipt] = useState<NotebookSheetReceiptFrame | null>(null);
  // Bench components: what each conversation's header shows rides that conversation's
  // next chat turn (by conversation, so a late read from a conversation already left
  // can never become this one's scope — #5504 post-cap F10; a ref, so send() never
  // reads a stale render), the newest reply's Return / Switch / Stay / Confirm offers,
  // and a counter that re-reads the checklist after every turn.
  const benchScopesRef = useRef<BenchScopes>(new Map());
  const [componentFrame, setComponentFrame] = useState<{ key: string; frame: ComponentTurnFrame } | null>(null);
  const [benchRefresh, setBenchRefresh] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  // A rejected request can settle after a switch. Only the newest attempt
  // for its conversation may recover the original request.
  const sendAttempts = useRef(new Map<string, AbortController>());
  const explicitStops = useRef(new WeakSet<AbortController>());
  // The upload half of an attached send (#4019 round 2 F2): Stop and thread
  // changes abort it too, so a slow upload can never post afterwards.
  const uploadAbortRef = useRef<AbortController | null>(null);
  // Detail loads are independent of the chat stream: their own abort handle and
  // a latest-request gate so a slow, superseded GET can never overwrite the
  // detail of the selection that replaced it (Codex #3839 F3).
  const detailAbortRef = useRef<AbortController | null>(null);
  const [detailGate] = useState(() => latestRequestGate());
  const [detailLoads] = useState(() => createLatestLoadTracker());

  // The web adapter holds the picked bytes until onSend uploads them (#4019).
  const adapter = useMemo(() => createWebAdapter(browserAdapterDeps()), []);

  const [state, dispatch] = useReducer(hubHostReducer, undefined, initialHubShellState);
  // The reducer's copy for the manual wait, which reads it after an await (it stamps the draft revision).
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);
  const sendRecoveries = state.sendRecoveryByThread?.get(state.thread.id);
  const failedBody = sendRecoveries?.at(-1) ?? null;
  const attachmentDraftThreads = state.attachmentDraftThreads ?? NO_ATTACHMENT_DRAFTS;
  const onPendingAttachmentThreads = useCallback((threadIds: ReadonlySet<string>, editedThreadId?: string) => {
    dispatch({ type: "pending-attachments", threadIds, editedThreadId });
  }, []);
  /**
   * Tell the reducer WHICH thread is open, from event handlers (never effects).
   * The live turns are projected onto the state at render time via `hydrate`
   * (see `view`); that reducer case resets the draft whenever the thread id
   * differs from the one it holds, so the id must be kept in sync here or every
   * keystroke would be wiped by the next render.
   */
  const syncThread = useCallback((sel: HubSelection, how: "choose" | "land" = "choose") => {
    const at = new Date().toISOString();
    dispatch(how === "land" ? { type: "land-thread", selection: sel, at } : openThreadAction(sel, at));
  }, []);

  // --- data: notebooks (projects/threads), then the selected notebook's detail ---
  const loadNotebooks = useCallback(async () => {
    const token = notebookGate.begin();
    const { status, data } = await loadNotebookListWithRetry(
      () => getJson<{ notebooks: HubNotebook[] }>("/api/equipment-notebooks/"),
      { isCurrent: () => notebookGate.isCurrent(token) },
    );
    if (!notebookGate.isCurrent(token)) return;
    if (status === 401) { setSignedOut(true); return; }
    if (!data) return;
    setNotebooks(data.notebooks);
    dispatch({ type: "reconcile-notebook-list", notebooks: data.notebooks });
    // A deep link / reload names its conversation (#3922); otherwise HOME (L0).
    // Opening from the URL goes through the same two steps as a click: the
    // reducer is told the thread id FIRST (`syncThread`), or its hydrate case
    // would reset the draft on every render and the composer could not be
    // typed into (the e2e deep-link follow-up caught exactly that).
    if (!selectionRef.current) {
      const next = selectionFromSearch(readSearch(), data.notebooks) ?? landingSelection(data.notebooks);
      if (next) {
        // #4695: an automatic landing keeps what was typed while the list loaded.
        selectionRef.current = next;
        syncThread(next, "land");
        setSelection(next);
        // A link without a thread opened a freshly minted one (#4444); name it
        // in the URL so a reload returns to this chat, not another blank one.
        writeSearch(searchForSelection(next));
      }
    }
    return data.notebooks;
  }, [syncThread, notebookGate]);
  useEffect(() => () => notebookGate.invalidate(), [notebookGate]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load (codebase precedent: (hub)/equipment/[id]/page.tsx)
    void loadNotebooks();
  }, [loadNotebooks]);
  useEffect(() => {
    if (state.confirmedThreadTitles?.size) void loadNotebooks().catch(() => undefined);
  }, [loadNotebooks, state.confirmedThreadTitles]);

  // Codex r15–r16 F30: the ONE gate for starting manual-search following. Every
  // seed (hydration in loadDetail, confirm) goes through seedManualSearch, so
  // work that completes after unmount can never restart polling. The ref is
  // set true in effect SETUP (see the unmount effect below), so StrictMode's
  // dev-only cleanup/re-setup replay leaves it true (the round-7 F20 lesson).
  const [follow, setFollow] = useState<ManualSearchFollowState | null>(null);
  const manualSearchDriverRef = useRef<ManualSearchDriver | null>(null);
  const hostMountedRef = useRef(false);
  // #5750 r3 F11: for each status shown, the answer it belongs to
  // (`manualStatusKey` → origin). A status without one is not placed.
  const [statusOrigins, setStatusOrigins] = useState<ReadonlyMap<string, StatusOrigin | null>>(() => new Map());
  const recordStatusOrigin = useCallback((status: ManualSearchStatus, origin: StatusOrigin | null) => {
    if (hostMountedRef.current) setStatusOrigins((m) => new Map(m).set(manualStatusKey(status), origin));
  }, []);
  const seedManualSearch = useCallback((notebookId: string, status: ManualSearchStatus): void => {
    if (hostMountedRef.current) manualSearchDriverRef.current?.seed(notebookId, status);
  }, []);
  const loadDetail = useCallback((sel: HubSelection, fromPoll = false): Promise<boolean> => {
    const isActive = () => hostMountedRef.current && selectionRef.current === sel;
    if (!isActive()) return Promise.resolve(false);
    return detailLoads.start(async (follow) => {
      const token = detailGate.begin();
      detailAbortRef.current?.abort();
      const ctrl = new AbortController();
      detailAbortRef.current = ctrl;
      let res: { status: number; data: Detail | null };
      try {
        // Always names the thread (legacy included) — an omitted threadId returns EVERY thread's turns.
        res = await getJson<Detail>(`/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/${detailQueryFor(sel)}`, ctrl.signal);
      } catch (err) {
        // Superseded by a newer load: report THAT load's outcome, not this abort (#4219 Codex r3 F1).
        if (!isActive()) return false;
        if (isAbortError(err)) return follow();
        return false;
      }
      // Commit only if no newer load or selection change happened while this one was in flight.
      if (!isActive()) return false;
      if (!detailGate.isCurrent(token)) return follow();
      if (res.status === 401) { setSignedOut(true); return false; }
      if (!res.data) return false;
      const threadId = shellThreadId(sel);
      const savedByRequest = terminalRowsByRequest(res.data.turns);
      const requestIds = new Set(savedByRequest.keys());
      // Match the server's claim rule: a completed error can be replayed
      // with its original payload unless evidence records a safety stop.
      const replayableErrorIds = new Set<string>();
      for (const [requestId, row] of savedByRequest) {
        if (row.answerStatus === "error" && !row.evidence.some((entry) => "kind" in entry && entry.kind === "safety_stop")) {
          replayableErrorIds.add(requestId);
        }
      }
      const confirmedThreadTitle = res.data.notebook.id === sel.notebookId
        ? res.data.threads?.find((thread) => thread.notebookId === sel.notebookId && thread.id === sel.threadId)?.title.trim() ?? ""
        : undefined;
      const exchanges = retainedByThreadRef.current.get(threadId) ?? [];
      const remaining = exchanges.filter((exchange) => !savedExchangeMatches(exchange, savedByRequest.get(exchange.clientRequestId)));
      const confirmed = remaining.length !== exchanges.length;
      dispatch({ type: "reconcile-send", threadId, requestIds, replayableErrorIds, confirmedThreadTitle, confirmed });
      if (remaining.length !== exchanges.length) {
        const next = new Map(retainedByThreadRef.current);
        if (remaining.length) next.set(threadId, remaining);
        else next.delete(threadId);
        retainedByThreadRef.current = next;
        setRetainedByThread(next);
      }
      // Read straight after this await by the manual wait and the rebuilt resend.
      detailRef.current = res.data;
      const followed = sendWaitLookup(res.data);
      setDetail(res.data);
      setDetailUnavailable(false);
      if (res.data.manualSearch && res.data.manualSearchAnswer !== undefined) {
        recordStatusOrigin(res.data.manualSearch, res.data.manualSearchAnswer ? { turnId: res.data.manualSearchAnswer.turnId } : null);
      }
      // Codex #4195 round 2 F6: hydration follows a running search to completion —
      // seed the SAME driver a confirm uses, keyed on this notebook's status.
      if (!fromPoll && followed) seedManualSearch(sel.notebookId, followed);
      return true;
    });
  }, [detailGate, detailLoads, seedManualSearch, recordStatusOrigin]);
  useEffect(() => {
    if (!selection) return;
    // Opening a project retries a failed first read twice before it says so.
    const openProject = async () => {
      for (const delay of [0, 500, 1500]) {
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        if (selectionRef.current !== selection || !hostMountedRef.current) return;
        if (detailRef.current || await loadDetail(selection)) return;
      }
      if (selectionRef.current === selection && hostMountedRef.current && !detailRef.current) setDetailUnavailable(true);
    };
    void openProject();
  }, [selection, loadDetail]);
  useEffect(() => () => { detailGate.invalidate(); detailAbortRef.current?.abort(); }, [detailGate]);

  /** #5746: end a manual wait without asking again. Its saved question stays; the banner says why. */
  const pauseManualHold = useCallback((hold: ManualHold, message: string) => {
    if (manualHoldRef.current !== hold) return;
    setManualHold(null);
    const recovery = stateRef.current.sendRecoveryByThread?.get(hold.threadId)
      ?.find((item) => sendRecoveryId(item) === hold.recoveryId);
    if (recovery) dispatch({ type: "recover-send", threadId: hold.threadId, restoreDraft: false, recovery: { ...recovery, error: message } });
  }, [setManualHold]);

  /** Change what is open: abort any stream and any in-flight detail load, drop the previous notebook's data. */
  const select = useCallback((sel: HubSelection) => {
    // A composer send held for this conversation's detail ends here; the composer keeps its draft.
    const waiting = waitingSend.current;
    if (waiting && conversationKey(waiting.selection) !== conversationKey(sel)) waiting.signal.abort();
    // A refused manual question stays saved in its own conversation; its wait ends here.
    const hold = manualHoldRef.current;
    if (hold && hold.key !== conversationKey(sel)) pauseManualHold(hold, MANUAL_WAIT_LEFT);
    selectionRef.current = sel; // async list hydration must see this selection before React effects run
    abortRef.current?.abort();
    uploadAbortRef.current?.abort();
    detailGate.invalidate();
    detailAbortRef.current?.abort();
    detailRef.current = null;
    setDetail(null);
    setDetailUnavailable(false);
    setLive(null);
    setSendPaused(false);
    manualSearchDriverRef.current?.reset();
    setFollow(null);
    setStatusOrigins(new Map());
    syncThread(sel);
    setSelection(sel);
    writeSearch(searchForSelection(sel));
  }, [syncThread, detailGate, pauseManualHold]);

  // Codex #4195 round 2 (F4/F6/F8/F9): the Hub side of the ONE shared,
  // framework-free follower (`manual-search-follow.ts`, packages/factorylm-interaction).
  // `fetchStatus` reuses the SAME notebook-detail read `loadDetail` makes — never a second
  // endpoint — and applies the complete snapshot before handing its status to the poll timer.
  // The timer-scheduling behaviour is proven framework-free in `manual-search-driver.test.ts`.
  // Codex r14 F29 / r15–r16 F30: stop following when the host unmounts, and keep it stopped.
  useEffect(() => {
    const driver = createManualSearchDriver({
      fetchStatus: async (notebookId) => {
        const sel = selectionRef.current;
        if (!sel || sel.notebookId !== notebookId || !await loadDetail(sel, true)) return null;
        // #5746 r5 F6: the poll follows the lookup a refused manual question waits on, so a newer
        // lookup under a status withheld for a component answer gets its own budget (nothing more
        // is shown).
        return sel === selectionRef.current ? sendWaitLookup(detailRef.current) : null;
      },
      onStateChange: setFollow,
    });
    manualSearchDriverRef.current = driver;
    hostMountedRef.current = true;
    return () => {
      hostMountedRef.current = false;
      driver.reset();
      manualSearchDriverRef.current = null;
    };
  }, [loadDetail]);

  // --- derived shell inputs ---
  const projects = useMemo(() => {
    const localTitles = new Map(state.confirmedThreadTitles);
    const unsentThreads = new Set([
      ...attachmentDraftThreads,
      ...(state.sendRecoveryByThread?.keys() ?? []),
      ...(state.attachmentRecoveries?.keys() ?? []),
    ]);
    for (const [threadId, exchanges] of retainedByThread) {
      if (localTitles.has(threadId)) continue;
      if (exchanges.some((exchange) => exchange.result.sawStatus)) localTitles.set(threadId, "");
      // An explicit Stop may retire the draft before the notebook list sees
      // the reply. Keep the stopped conversation reachable in Projects.
      else if (!unsentThreads.has(threadId) && !state.draftsByThread?.has(threadId) &&
        exchanges.some((exchange) => exchange.stopped)) {
        localTitles.set(threadId, "Stopped conversation");
      }
    }
    return notebookProjects(notebooks ?? [], state.draftsByThread, unsentThreads, localTitles);
  }, [notebooks, state.draftsByThread, attachmentDraftThreads, state.sendRecoveryByThread, state.attachmentRecoveries, state.confirmedThreadTitles, retainedByThread]);
  const approvedManuals = useMemo(
    () => new Set(selection ? pendingApprovals[selection.notebookId] ?? [] : []),
    [selection, pendingApprovals],
  );
  const machines = useMemo(() => notebookMachines(notebooks ?? []), [notebooks]);
  const meta = useMemo(
    () => (detail && selection ? metaFor(detail.notebook, selection, null, capturedAt, detail.sources) : null),
    [detail, selection, capturedAt],
  );
  const docIds = useMemo(() => enabledDocIds(detail?.sources ?? []), [detail]);
  // Every answer numbers its citations from "[1]", so the index is keyed by the answer's request
  // (or, without one, its turn) and the citation (Codex #3839 F1); a live answer and its saved row
  // then name the same source.
  const citations = useMemo(() => {
    const index = new Map(citationIndex(detail?.turns ?? [], live?.result?.citations ?? live?.citations ?? [], live ? live.id + "-a" : null, live?.clientRequestId));
    for (const exchange of retainedExchanges ?? []) {
      for (const entry of citationIndex([], exchange.result?.citations ?? [], exchange.id + "-a", exchange.clientRequestId)) index.set(...entry);
    }
    return index;
  }, [detail, live, retainedExchanges]);

  // #5504 Codex r2: one send/change gate per conversation, shared with the component panel.
  // Keyed on the conversation (not a bare ref), so a gate never outlives a thread switch.
  const gateConversation = selection ? `${selection.notebookId}|${selection.threadId}` : null;
  const [, setBenchGateRevision] = useState(0);
  const benchGate = useMemo(() => {
    void gateConversation; // a new conversation gets a new gate
    return createBenchSendGate(() => setBenchGateRevision((revision) => revision + 1));
  }, [gateConversation]);

  // #5746: a refused manual question waiting for the manual blocks other resends: its wait asks once.
  const waitingForManual = manualHold !== null && manualHold.key === gateConversation;
  const recoveryBlocked = busy || waitingForManual ? "Wait for the current send to finish." : benchSendRefusal(benchGate);
  const reviewedBench = benchView?.key === gateConversation ? benchView?.state : undefined;

  // The shell passes the clicked assistant turn. A later retry can keep the
  // recovery ID but post a new wire ID after explicit target review.
  const inlineRecoveries = useMemo(() => {
    const byTurn = new Map<string, HubSendRecovery>();
    if (recoveryBlocked) return byTurn;
    const exchanges = [...(retainedExchanges ?? []), ...(live?.result ? [live] : [])];
    for (const exchange of exchanges) {
      const recovery = sendRecoveries?.find((item) => sendRecoveryId(item) === exchange.recoveryId &&
        item.body.clientRequestId === exchange.clientRequestId);
      if (recovery?.error && !recovery.unposted && retryTargetCheck(recovery.refusedScope, reviewedBench).kind === "retry") {
        byTurn.set(exchange.id + "-a", recovery);
      }
    }
    return byTurn;
  }, [live, recoveryBlocked, retainedExchanges, reviewedBench, sendRecoveries]);

  const exchangeTurns = useCallback((live: Live | null): InteractionTurn[] => {
    if (!live || !selection) return [];
    const { context } = live;
    const threadId = shellThreadId(selection);
    const q: InteractionTurn = {
      id: `${live.id}-q`, threadId, role: "user",
      parts: [{ type: "text", text: live.question }, ...(live.result?.visualEvidence ? [questionPhotoPart(live.result.visualEvidence)] : [])],
      lifecycle: "completed", context, createdAt: live.startedAt, updatedAt: live.startedAt,
    };
    const aId = `${live.id}-a`;
    let parts: InteractionPart[];
    let lifecycle: InteractionTurn["lifecycle"];
    if (live.result) {
      parts = partsFromStream(live.result, {
        stopped: live.stopped, turnId: aId, requestId: live.clientRequestId, notebookDocIds: meta?.notebookDocIds,
        componentLabel: live.componentLabel, confirmedIdentity: meta?.confirmedIdentity,
      });
      lifecycle = lifecycleFromStream(live.result, { stopped: live.stopped });
      if (!inlineRecoveries.has(aId)) {
        parts = parts.map((part) => part.type === "error" && part.error.retryable
          ? { ...part, error: { ...part.error, retryable: false } }
          : part);
      }
    } else {
      parts = livePartsWhileRunning(live.content, live.stopped ? undefined : live.progress, {
        expected: live.componentExpected === true,
        label: live.componentLabel ?? null,
      });
      lifecycle = live.stopped ? "stopped" : "running";
    }
    const a: InteractionTurn = {
      id: aId, threadId, role: "assistant", parts, lifecycle, context,
      createdAt: live.startedAt, updatedAt: new Date().toISOString(),
    };
    return [q, a];
  }, [inlineRecoveries, meta, selection]);
  const liveTurns = useMemo(() => {
    if (!live || (livePersisted && !liveReplacesError)) return [];
    return exchangeTurns(live);
  }, [exchangeTurns, live, livePersisted, liveReplacesError]);
  const visibleRetained = useMemo(
    () => retainedExchanges?.filter((exchange) => exchange.clientRequestId !== live?.clientRequestId) ?? [],
    [retainedExchanges, live?.clientRequestId],
  );

  // The project's lookup as this conversation may show it: the followed status when it is a newer
  // lookup than the read, never a status withheld for this thread, and "ready" only for a manual
  // the next send would actually carry.
  const manualStatus = detail?.manualSearch;
  const followIsNewer = Boolean(follow?.status.startedAt && manualStatus?.startedAt &&
    compareManualSearchGeneration(follow.status.startedAt, manualStatus.startedAt) > 0);
  const readyManualId = followIsNewer ? null : currentReadyManualId(manualStatus, detail?.sources ?? []);
  const visibleManualStatus = manualStatusForThread(
    followIsNewer || !manualStatus || (manualStatus.running && follow?.phase === "unresolved")
      ? (follow?.status.running || follow?.phase === "unresolved" ? follow.status : null)
      : manualStatus,
    detail?.manualSearchScope,
  );
  const displayedManualStatus = visibleManualStatus?.sourceState === "ready" && !readyManualId
    ? null
    : visibleManualStatus;
  // #5750 r3 F11: a live lookup belongs to the send that streamed it; on screen that answer is the
  // exchange's own turn until its saved row takes over.
  const displayedStatusOrigin = useMemo(() => {
    const origin = displayedManualStatus ? statusOrigins.get(manualStatusKey(displayedManualStatus)) : undefined;
    if (!origin || !("requestId" in origin)) return origin;
    const exchange = [...(live && !(livePersisted && !liveReplacesError) ? [live] : []), ...visibleRetained]
      .find((item) => item.clientRequestId === origin.requestId);
    // `withHostManualStatus` places a `turnId` origin on that id's answer (`<id>-a`).
    return exchange ? { turnId: exchange.id } : origin;
  }, [displayedManualStatus, statusOrigins, live, livePersisted, liveReplacesError, visibleRetained]);

  // Live data is a pure projection over the UI state: the reducer's `hydrate`
  // replaces thread/projects/machines/context and keeps drawer, draft, mode and
  // the open source. Applying it in render (not an effect) means no cascading
  // re-render and no moment where the shell shows stale turns.
  const view = useMemo<ShellState>(() => {
    if (!detail || !meta || !selection) {
      // HOME, or a thread whose detail is still loading: the outgoing message
      // still shows (a first send creates its project before anything else).
      const openId = selection ? shellThreadId(selection) : HOME_THREAD;
      const turns = withOutgoing(visibleRetained.flatMap(exchangeTurns), { turns: liveTurns, outgoingId: live?.outgoingId ?? null }, outgoing, openId, openId, state.activeContext);
      const thread = loadingThread(selection, turns);
      // The project's name heads the conversation while its detail is read.
      const project = notebooks?.find(notebook => notebook.id === selection?.notebookId);
      if (project) return shellReducer(state, { type: "hydrate", data: { thread: { ...thread, title: project.displayName }, projects, machines } });
      return notebooks ? shellReducer(state, { type: "hydrate", data: { thread, projects, machines } }) : state;
    }
    const base = fixtureFor(detail.notebook, selection, detail.turns, meta, projects, machines);
    // Overlay the current lookup on the last assistant turn without storing a
    // snapshot of progress. The live frame can seed this state before detail loads.
    let settled: SettledFollowups | null = null;
    if (settledFollowups && settledFollowups.notebookId === selection.notebookId && settledFollowups.threadId === selection.threadId) {
      const row = detail.turns.find((turn) => turn.clientRequestId === settledFollowups.clientRequestId);
      if (row) settled = { ...settledFollowups, answerId: answerTurnId(row.id) };
      else if (detail.turns.every((turn) => !("clientRequestId" in turn))) settled = settledFollowups;
    }
    // Use the history visible when each local question was asked. Browser
    // time cannot order these exchanges against the database clock.
    const retainedAfter = new Map<string | undefined, InteractionTurn[]>();
    const replacedRows = new Map<string, InteractionTurn[]>();
    if (liveReplacesError && livePersisted) replacedRows.set(livePersisted.id, []);
    for (const exchange of visibleRetained) {
      const saved = persistedByRequest.get(exchange.clientRequestId);
      const exchangePair = exchangeTurns(exchange);
      if (saved) {
        replacedRows.set(saved.id, exchangePair);
        continue;
      }
      const precedingRow = detail.turns.findLast((row) => exchange.precedingAnswerIds.has(answerTurnId(row.id)) ||
        (row.clientRequestId != null && exchange.precedingRequestIds.has(row.clientRequestId)));
      const anchor = precedingRow?.id;
      const turns = retainedAfter.get(anchor) ?? [];
      turns.push(...exchangePair);
      retainedAfter.set(anchor, turns);
    }
    const chronologicalTurns = visibleRetained.length || replacedRows.size ? [
      ...(retainedAfter.get(undefined) ?? []),
      ...detail.turns.flatMap((row, index) => [
        ...(replacedRows.get(row.id) ?? base.thread.turns.slice(index * 2, index * 2 + 2)),
        ...(retainedAfter.get(row.id) ?? []),
      ]),
    ] : base.thread.turns;
    const threadId = shellThreadId(selection);
    // A manual poll can deliver the saved turn before the stream finishes.
    // Once history owns this request, its outgoing placeholder is redundant.
    const pendingOutgoing = outgoing && live && outgoing.threadId === threadId && outgoing.id === live.outgoingId &&
      livePersisted && !liveReplacesError ? null : outgoing;
    // #5750 r2 F7: under the answer the status was checked against.
    const turns = withHostManualStatus(
      withSettledFollowups(
        withOutgoing(chronologicalTurns, { turns: liveTurns, outgoingId: live?.outgoingId ?? null, questionId: live ? `${live.id}-q` : undefined }, pendingOutgoing, threadId, threadId, contextFor(meta)),
        settled,
      ),
      displayedManualStatus,
      displayedStatusOrigin,
      detail.turns,
    );
    const thread = { ...base.thread, turns };
    return shellReducer(state, { type: "hydrate", data: { thread, projects, machines, activeContext: base.activeContext } });
  }, [state, detail, meta, selection, projects, machines, liveTurns, visibleRetained, exchangeTurns, live, livePersisted, liveReplacesError, persistedByRequest, notebooks, outgoing, settledFollowups, displayedManualStatus, displayedStatusOrigin]);

  // The outgoing message owns its photo previews until it is dropped; leaving
  // the hub releases whatever it still holds (Codex #4289 F2).
  const outgoingOwner = useMemo(() => createOutgoingOwner((id) => adapter.release?.(id), setOutgoing), [adapter]);
  useEffect(() => () => outgoingOwner.dispose(), [outgoingOwner]);
  const putOutgoing = outgoingOwner.put;
  /** The outgoing message is done: the server's row (or the restored draft) takes over. */
  const dropOutgoing = outgoingOwner.drop;

  // #5746 (option A): what a manual question the chat route refused does next (set below `send`).
  const onManualRefusalRef = useRef<(sel: HubSelection, threadId: string, recoveryId: string) => void>(() => {});

  // --- the send path: the canonical notebook-chat route, streamed ---
  // The ONE poster of the chat route in this shell. Every send asks the route to hold a question
  // that needs the project's manual while that manual can't be used (`x-mira-manual-wait: 1`),
  // except the three sends that keep main's path (`manualWait: false`: a send with attachments, a
  // home send, Send without the manual); a replay keeps its attempt's choice.
  const send = useCallback(async (
    body: ReturnType<typeof chatBodyFor> & { componentSelection?: ScopeField },
    question: string,
    sel: HubSelection | null = selection,
    retry?: HubSendRecovery,
    uploadTarget?: ScopeField,
    opts: SendOpts = {},
  ) => {
    if (!sel) return;
    // Never while a component change is saving (this send would carry the version the
    // header read before it), and never before this conversation's component selection
    // has been read (#5504 Codex r3 F6: it would go out as whole-machine). Checked before
    // anything else, so an answer already streaming is not aborted by a send that cannot
    // start. A project just made from home (`sel` is not this gate's conversation) has
    // no saved component and is not held.
    const forThisGate = gateConversation === `${sel.notebookId}|${sel.threadId}`;
    // #5504 post-cap F9/F10: every question carries its scope — the component, or the whole
    // machine — with the version read for THIS conversation; an unread one is refused.
    // #5746: a question the route refused for the manual comes back rebuilt by the caller
    // (`resendBodyFor`): its composition is that body, never the refused one, with a new wire id.
    const rebuilt = retry?.manualRefused !== undefined;
    const replayOriginal = retry && !retry.refusedScope && !retry.unposted && !rebuilt;
    const manualWait = sendsManualWait(retry, opts.manualWait);
    // A recovery of this attempt is replayed with the same choice.
    const waitField = manualWait ? {} : { manualWait: false as const };
    // Scope applies to the wire request. The composition retains general mode
    // and source choices so a later explicit retarget can rebuild the payload.
    const composition: HubSendRecovery["body"] = (rebuilt ? undefined : retry?.composition) ?? withLivingSheetRider(body, sel.notebookId, livingSheetJob);
    const prepared = prepareChatSend({
      gate: benchGate,
      forThisGate,
      sel,
      scopes: benchScopesRef.current,
      body: replayOriginal ? body : { ...composition, clientRequestId: body.clientRequestId },
    });
    const threadId = shellThreadId(sel);
    const recoveryId = retry ? sendRecoveryId(retry) : body.clientRequestId;
    const scopeMoved = uploadTarget && prepared.ok &&
      uploadTarget.componentId !== (prepared.body.componentSelection?.componentId ?? null);
    if (scopeMoved || !prepared.ok || !benchGate.tryBeginSend()) {
      if (forThisGate && !benchGate.known && !benchGate.changing) setBenchRefresh((n) => n + 1);
      dropOutgoing(outgoingOwner.current?.id ?? null);
      if (!retry) {
        dispatch({
          type: "recover-send", threadId, restoreDraft: true,
          recovery: {
            body: composition, composition, unposted: true, question, recoveryId, ...waitField,
            refusedScope: uploadTarget,
            error: scopeMoved ? "The question target changed before Send." : "The question is saved. Retry when the checklist is ready.",
          },
        });
      }
      return "deferred" as const;
    }
    // A send that starts retires a refused question's wait and a paused composer send's Try again.
    // The automatic resend and a tap on that question's own retry end its wait here; any other send
    // leaves it a saved question that says why it wasn't asked again. A refusal of this send makes
    // a new wait.
    const hold = manualHoldRef.current;
    if (hold && !(retry && sendRecoveryId(retry) === hold.recoveryId)) pauseManualHold(hold, MANUAL_WAIT_REPLACED);
    else setManualHold(null);
    setSendPaused(false);
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    sendAttempts.current.set(threadId, ctrl);
    const ownsAttempt = () => sendAttempts.current.get(threadId) === ctrl;
    const ownsVisibleSend = () => ownsAttempt() && selectionRef.current === sel && abortRef.current === ctrl;
    const id = "live-" + crypto.randomUUID();
    const outgoingId = outgoingOwner.current?.id ?? null;
    setSettledFollowups(null);
    // #4454: which answers were already there, so the kept follow-ups land on the one this send produces.
    const answeredBefore = (detailRef.current?.turns ?? []).map((row) => answerTurnId(row.id));
    dispatch({ type: "set-send-error", error: null });
    // An unclassified failure can be replayed only with the original request payload.
    const outBody = replayOriginal ? body : prepared.body;
    const earlierExchanges = retainedByThreadRef.current.get(threadId) ?? [];
    const prior = earlierExchanges.find((item) => item.clientRequestId === outBody.clientRequestId);
    const startedAt = prior?.startedAt ?? new Date().toISOString();
    const precedingAnswerIds = prior?.precedingAnswerIds ?? new Set(answeredBefore);
    const precedingRequestIds = prior?.precedingRequestIds ?? new Set(earlierExchanges.map((item) => item.clientRequestId));
    const originDetail = detailRef.current?.notebook.id === sel.notebookId ? detailRef.current : null;
    const context = originDetail
      ? contextFor(metaFor(originDetail.notebook, sel, null, startedAt, originDetail.sources))
      : { ...EMPTY_FIXTURE.activeContext, projectId: projectIdForNotebook(sel.notebookId), capturedAt: startedAt };
    const exchange = { id, clientRequestId: outBody.clientRequestId, recoveryId, question, context, startedAt, outgoingId };
    setLive({ ...exchange, content: "", citations: [], result: null, stopped: false });

    let componentLabel: string | null = null;
    let attemptId: string | null = null;
    let responseStarted = false;
    const retainExchange = (result: CompatibleStreamResult, stopped: boolean) => {
      const retained: RetainedExchange = {
        ...exchange, result, content: result.content, citations: result.citations, stopped, componentLabel,
        precedingAnswerIds, precedingRequestIds, replayedRequest: Boolean(replayOriginal), attemptId,
      };
      const current = retainedByThreadRef.current;
      const peers = current.get(threadId) ?? [];
      const updated = peers.some((item) => item.clientRequestId === retained.clientRequestId)
        ? peers.map((item) => item.clientRequestId === retained.clientRequestId ? retained : item)
        : [...peers, retained];
      const next = new Map(current).set(threadId, updated);
      retainedByThreadRef.current = next;
      setRetainedByThread(next);
    };
    const settleRetry = () => {
      if (!ownsAttempt() || !retry) return;
      dispatch({ type: "clear-recovery", threadId, recoveryId });
      if (retry.draftRevision !== undefined) {
        dispatch({ type: "sent-draft", threadId, question, revision: retry.draftRevision });
      }
    };
    const settleExplicitStop = (result: CompatibleStreamResult) => {
      // A posted conversation can be saved even if Stop precedes any answer
      // text. Keep it reachable while the notebook list catches up.
      if (ownsAttempt() && (responseStarted || result.content || result.safetyNotice)) retainExchange(result, true);
      settleRetry();
      if (ownsVisibleSend()) {
        setLive((cur) => (cur?.id === id ? { ...cur, content: result.content, result, stopped: true } : cur));
      } else {
        dropOutgoing(outgoingId);
      }
    };
    setBusy(true);
    // The route refused the scope (the selection moved): a retry is asked again under what the
    // header shows after the re-read, never replayed under the scope that was refused.
    let scopeRefused = false;
    let rejectionStatus: number | undefined;
    let rejectionCode = "";
    // Keep a named safety stop if the stream breaks before the safety frame (#5670).
    let stop: SafetyStopTracker | null = null;
    try {
      setComponentFrame(null);
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/chat/`, {
        // #4687: ask for stage progress; a server without MIRA_CHAT_PROGRESS ignores the header.
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-mira-progress": "1",
          ...(manualWait ? { "x-mira-manual-wait": "1" } : {}),
        },
        body: JSON.stringify(outBody), signal: ctrl.signal,
      });
      if (res.status === 401) { setSignedOut(true); return; }
      stop = trackSafetyStop(res.headers);
      attemptId = res.headers.get(NOTEBOOK_ATTEMPT_HEADER);
      if (res.ok && !res.body && stop.current()) throw stop.carry(new Error("no_stream"));
      if (!res.ok || !res.body) {
        if (!res.ok) rejectionStatus = res.status;
        // The route's own error codes, in plain language; never a bare status code.
        let code = "";
        try {
          code = String(((await res.json()) as { error?: unknown }).error ?? "");
        } catch (error) {
          if (ctrl.signal.aborted) throw error;
        }
        rejectionCode = code;
        scopeRefused = isScopeRefusalCode(code);
        throw new Error(errorMessageFor(code, res.status));
      }
      // Only tee while a sheet is open for this notebook — zero behavior
      // change (no tee, no extra branch) on every other turn. A stream can
      // be tee'd exactly once; call it once and keep both branches.
      responseStarted = true;
      let stream: ReadableStream<Uint8Array> = res.body;
      if ("livingSheetJobId" in outBody) {
        const [forChat, forReceipt] = stream.tee();
        stream = forChat;
        void parseSheetReceipts(forReceipt, (frame) => { if (ownsVisibleSend()) setSheetReceipt(frame); });
      }
      // Same rule for the component frame: tee only on a turn asked under a component.
      // The frame's label goes onto THIS send's live turn (keyed by its id), so a later
      // header change or another send cannot relabel it (#5504 Codex r2 F1).
      let componentRead: Promise<void> | null = null;
      if ("componentSelection" in outBody) {
        const [forChat, forComponent] = stream.tee();
        stream = forChat;
        const key = `${sel.notebookId}|${sel.threadId}`;
        if (expectsComponentFrame(outBody)) setLive((cur) => (cur && cur.id === id ? { ...cur, componentExpected: true } : cur));
        componentRead = parseComponentFrames(forComponent, (frame) => {
          componentLabel = frame.label;
          if (ownsVisibleSend()) setComponentFrame({ key, frame });
          setLive((cur) => (cur && cur.id === id ? { ...cur, componentLabel: frame.label } : cur));
        }).catch(() => undefined);
      }
      const reader = stop.watch(stream.getReader());
      const result = stop.settle(await readNotebookStream(reader, (content, cits) => {
        setLive((cur) => (cur && cur.id === id ? { ...cur, content, citations: cits } : cur));
      }, stop.current(), {
        onAttempt: (id) => { attemptId = id; },
        onProgress: (stage) => setLive((cur) => (cur && cur.id === id ? { ...cur, progress: stage } : cur)),
        onManualSearchStatus: (status) => {
          const active = selectionRef.current;
          if (!hostMountedRef.current || abortRef.current !== ctrl || ctrl.signal.aborted ||
            active?.notebookId !== sel.notebookId || active.threadId !== sel.threadId) return;
          // #5750 r3 F11: a live lookup belongs to the send that streamed it.
          recordStatusOrigin(status, { requestId: outBody.clientRequestId });
          manualSearchDriverRef.current?.observeLive(sel.notebookId, status);
        },
      }));
      // Both readers end with the stream; the finished answer carries its label.
      if (componentRead) await componentRead;
      const stopped = !result.sawStatus && ctrl.signal.aborted;
      const observed = stopped
        ? stoppedStreamResult({ partial: result.content, safetyNotice: result.safetyNotice })
        : result;
      if (stopped && explicitStops.current.has(ctrl)) {
        settleExplicitStop(observed);
        return;
      }
      if (ownsAttempt() && (observed.sawStatus || observed.content || observed.safetyNotice)) retainExchange(observed, stopped);
      if (!result.sawStatus) {
        if (ownsAttempt()) {
          dispatch({
            type: "recover-send", threadId, restoreDraft: true,
            recovery: {
              body: outBody, composition, question, recoveryId, draftRevision: retry?.draftRevision, ...waitField,
              error: "MIRA didn't confirm the send. Try again to check the original request.",
            },
          });
        }
        if (ownsVisibleSend()) void loadDetail(sel).catch(() => false);
      } else {
        settleRetry();
        setLive((cur) => (cur && cur.id === id ? null : cur));
        dropOutgoing(outgoingId);
        if (ownsVisibleSend()) {
          // A confirmed POST is settled. Refresh failure only affects hydration.
          await loadDetail(sel).catch(() => false);
          if (ownsVisibleSend()) {
            const finished = partsFromStream(result, { turnId: id + "-a" }).find((p) => p.type === "followups");
            setSettledFollowups(
              finished?.type === "followups"
                ? { notebookId: sel.notebookId, threadId: sel.threadId, question: body.message, suggestions: finished.suggestions, answeredBefore, clientRequestId: outBody.clientRequestId }
                : null,
            );
          }
        }
        if (ownsAttempt()) void loadNotebooks().catch(() => undefined);
      }
      setLive((cur) => (cur && cur.id === id ? null : cur));
      dropOutgoing(outgoingId);
    } catch (caught) {
      if (!ownsAttempt()) {
        dropOutgoing(outgoingId);
        return;
      }
      if (caught instanceof NotebookHttpError) {
        rejectionStatus = caught.status;
        rejectionCode = caught.code;
        scopeRefused = isScopeRefusalCode(caught.code);
      }
      // #5746: the route held a question that asks for the project's manual (either transport).
      // Nothing was answered or saved, so nothing from the stream is kept, and the refused body is
      // never sent again: the question is saved (its draft too, into an empty composer) and every
      // resend is rebuilt from the project as it is then.
      // The target the question was asked about: a refusal keeps it, so no resend moves it (r8 F14).
      const askedScope: ScopeField = outBody.componentSelection ?? {
        threadId: outBody.threadId, componentId: null, selectionVersion: null,
      };
      if (isManualWaitCode(rejectionCode)) {
        setLive((cur) => (cur && cur.id === id ? null : cur));
        dropOutgoing(outgoingId);
        const now = stateRef.current;
        const ownsComposer = now.thread.id === threadId && (retry?.draftRevision !== undefined
          ? retry.draftRevision === now.draftRevision
          : !now.draft && !now.attachmentDraftThreads?.has(threadId));
        const waits = ownsVisibleSend() && ownsComposer &&
          manualHoldAfterRefusal(rejectionCode, opts.automatic === true) === "waiting";
        dispatch({
          type: "recover-send", threadId, restoreDraft: true,
          recovery: {
            body: outBody, composition, question, recoveryId, manualRefused: rejectionCode, refusedScope: askedScope,
            error: waits ? null : errorMessageFor(rejectionCode, 409), draftRevision: retry?.draftRevision,
          },
        });
        if (waits) onManualRefusalRef.current(sel, threadId, recoveryId);
        return;
      }
      const refusedScope = scopeRefused ? askedScope : undefined;
      const interruption = rejectionStatus === undefined && stop ? stop.carry(caught) : caught;
      if (rejectionStatus !== 401 && explicitStops.current.has(ctrl)) {
        settleExplicitStop(stoppedStreamResult(interruption));
        return;
      }
      const retained = rejectionStatus === undefined ? retainedStreamInterruption(interruption) : null;
      if (retained && (retained.result.safetyNotice || retained.result.content)) {
        retainExchange(retained.result, retained.stopped);
      }
      if (!ownsVisibleSend()) {
        dropOutgoing(outgoingId);
        // The POST may already have reached the server. Preserve its request ID
        // and the submitted payload so replay can reconcile it in the origin.
        if (rejectionStatus === 401) return;
        dispatch({
          type: "recover-send", threadId, restoreDraft: true,
          recovery: {
            body: outBody, composition, question, recoveryId, ...(refusedScope ? { refusedScope } : {}), ...waitField,
            error: rejectionStatus === undefined ? sendFailureMessage(caught) : errorMessageFor(rejectionCode, rejectionStatus),
            draftRevision: retry?.draftRevision,
          },
        });
        return;
      }
      // #4687: a refusal delivered inside the progress stream is handled exactly
      // like the non-OK response above (signed out, or the route's own message).
      if (caught instanceof NotebookHttpError && caught.status === 401) { setSignedOut(true); return; }
      // The same refusal inside the progress stream re-scopes the retry too (#5504 F12, #5534).
      const err = caught instanceof NotebookHttpError ? new Error(errorMessageFor(caught.code, caught.status)) : caught;
      if (retained) {
        setLive((cur) =>
          cur && cur.id === id
            ? { ...cur, content: retained.result.content, stopped: retained.stopped, result: retained.result }
            : cur,
        );
        if (!retained.stopped) {
          const message = sendFailureMessage(err);
          dispatch({ type: "recover-send", threadId, recovery: { body: outBody, composition, question, recoveryId, error: message, draftRevision: retry?.draftRevision, ...waitField }, restoreDraft: false });
        }
        return;
      }
      const message = sendFailureMessage(err);
      setLive((cur) => (cur && cur.id === id ? null : cur));
      dropOutgoing(outgoingId);
      // A target refusal keeps the target it was asked about; the retry is held for review
      // until the panel has re-read what is selected now (the old read is stale).
      if (scopeRefused) setBenchView((cur) => (cur && cur.key === `${sel.notebookId}|${sel.threadId}` ? null : cur));
      dispatch({
        type: "recover-send", threadId, restoreDraft: true,
        recovery: { body: outBody, composition, question, recoveryId, ...(refusedScope ? { refusedScope } : {}), error: message, draftRevision: retry?.draftRevision, ...waitField },
      });
    } finally {
      if (sendAttempts.current.get(threadId) === ctrl) sendAttempts.current.delete(threadId);
      benchGate.endSend();
      if (abortRef.current === ctrl) { abortRef.current = null; setBusy(false); }
      // A turn can change the checklist (its tallies) or find the selection moved (409).
      setBenchRefresh((n) => n + 1);
    }
  }, [selection, loadDetail, loadNotebooks, dropOutgoing, outgoingOwner, livingSheetJob, benchGate, gateConversation, recordStatusOrigin, setManualHold, pauseManualHold]);

  /**
   * #5746: a refused question waits for the project's lookup to settle, then is asked once more.
   * Each read takes the project's detail again first, so that send goes with the project's sources
   * and history as they are then, never the refused body. It is sent with the reducer's own copy
   * of the saved question, and only while that question is still the composer's draft. Stop, a
   * conversation change, the bound, an edited draft or a send that can't start pause it instead:
   * the saved question and its draft stay, and the banner says why.
   */
  const waitThenAskAgain = useCallback(async (hold: ManualHold, sel: HubSelection) => {
    const current = () => manualHoldRef.current === hold && selectionRef.current === sel && hostMountedRef.current;
    const deadline = Date.now() + MANUAL_WAIT_BOUND_MS;
    // The work's value, or null once the hold ends or the bound passes: a read that never answers
    // cannot hold the question past the bound.
    const bounded = <T,>(work: Promise<T>) => new Promise<T | null>((resolve) => {
      const end = () => { clearTimeout(timer); resolve(null); };
      const timer = setTimeout(end, Math.max(0, deadline - Date.now()));
      hold.stop.signal.addEventListener("abort", end, { once: true });
      work.then((value) => {
        clearTimeout(timer);
        hold.stop.signal.removeEventListener("abort", end);
        resolve(value);
      }, end);
    });
    // The saved question as the reducer holds it now, or why the wait ends without a send.
    const stillHeld = () => {
      const held = heldManualRecovery(stateRef.current, hold.threadId, hold.recoveryId);
      if (held === "gone") setManualHold(null);
      else if (held === "not_owner") pauseManualHold(hold, MANUAL_DRAFT_CHANGED);
      return typeof held === "string" ? null : held;
    };
    for (let delay = 0; ; delay = Math.min(delay ? delay * 2 : 2_000, 10_000)) {
      if (delay) await bounded(new Promise<void>((resolve) => { setTimeout(resolve, delay); }));
      if (!current()) return;
      if (Date.now() >= deadline) { pauseManualHold(hold, MANUAL_STILL_PREPARING); return; }
      const read = await bounded(loadDetail(sel));
      if (!current() || !stillHeld()) return;
      if (read && !sendWaitLookup(detailRef.current, true)?.running) break;
      if (Date.now() >= deadline) { pauseManualHold(hold, MANUAL_STILL_PREPARING); return; }
    }
    const held = stillHeld();
    const now = detailRef.current;
    if (!held) return;
    const body = resendBodyFor(held, sel, now);
    if (!body) { pauseManualHold(hold, errorMessageFor(held.manualRefused ?? "manual_not_ready", 409)); return; }
    // Bound to the target it was asked about (r8 F14): a component picked during the wait means
    // nothing is posted, and the saved question goes through the target review instead.
    const outcome = await send(body, held.question, sel, held, held.refusedScope, { automatic: true });
    // A send that could not start leaves the question saved, and the banner says why.
    if (outcome === "deferred") pauseManualHold(hold, manualResendPause(held.refusedScope, benchScopesRef.current.get(hold.key)));
  }, [loadDetail, send, pauseManualHold, setManualHold]);

  const onManualRefusal = useCallback((sel: HubSelection, threadId: string, recoveryId: string) => {
    if (selectionRef.current !== sel) return;
    const hold: ManualHold = { key: conversationKey(sel), threadId, recoveryId, stop: new AbortController() };
    setManualHold(hold);
    void waitThenAskAgain(hold, sel);
  }, [setManualHold, waitThenAskAgain]);
  useEffect(() => { onManualRefusalRef.current = onManualRefusal; }, [onManualRefusal]);

  // Stable per conversation, so the panel's read does not re-run on every render.
  const benchNotebookId = selection?.notebookId ?? null;
  const benchThreadId = selection?.threadId ?? null;
  // Bound to the conversation it was rendered for: a panel left behind writes only its own entry.
  const onBenchState = useCallback((bench: BenchState | null) => {
    if (benchNotebookId && benchThreadId) {
      recordBenchScope(benchScopesRef.current, { notebookId: benchNotebookId, threadId: benchThreadId }, bench);
      setBenchView({ key: `${benchNotebookId}|${benchThreadId}`, state: bench });
    }
  }, [benchNotebookId, benchThreadId]);

  // Equipment navigator: where a press comes from, and the component it found.
  const benchKey = benchNotebookId && benchThreadId ? `${benchNotebookId}|${benchThreadId}` : null;
  const benchNow = benchView && benchView.key === benchKey ? benchView.state : null;
  // Moves on every conversation change, a return to the same one included (#5625 r2 F3). Derived
  // during render so the panel and this host always read the same value at a press.
  const [nav, setNav] = useState<{ key: string | null; generation: number }>({ key: benchKey, generation: 0 });
  if (nav.key !== benchKey) {
    setNav({ key: benchKey, generation: nav.generation + 1 });
    // Leaving the conversation before its checklist showed the component abandons the hand-off.
    if (equipmentFocus && `${equipmentFocus.notebookId}|${equipmentFocus.threadId}` !== benchKey) setEquipmentFocus(null);
    // An offer belongs to the conversation it was answered in.
    if (equipmentOffer) setEquipmentOffer(null);
  }
  const navGeneration = nav.key === benchKey ? nav.generation : nav.generation + 1;
  const equipmentOrigin = useMemo<PickOrigin>(
    () => ({ conversation: benchNotebookId && benchThreadId ? { notebookId: benchNotebookId, threadId: benchThreadId } : null, generation: navGeneration }),
    [benchNotebookId, benchThreadId, navGeneration],
  );
  const pickNow = useRef({ generation: navGeneration, answering: busy });
  useEffect(() => {
    pickNow.current = { generation: navGeneration, answering: busy };
  }, [navGeneration, busy]);
  const equipmentTarget: QuestionTarget | null = benchNotebookId
    ? { machineId: benchNotebookId, machineLabel: "", componentId: benchNow?.selection?.componentId ?? null, componentLabel: "", location: "" }
    : null;
  const onEquipmentPick = useCallback((target: QuestionTarget, pressedIn: PickOrigin) => {
    const route = pickRouteFor(target, pressedIn, { ...pickNow.current, selection: selectionRef.current }, ++equipmentPickToken.current);
    if (route.kind === "dropped") {
      setEquipmentNotice(route.reason === "conversation_changed"
        ? "You opened another chat before the equipment answered, so nothing was opened. Ask about it again from here."
        : "An answer was coming in, so the equipment wasn't opened. Ask about it again when the answer is done.");
      return;
    }
    setEquipmentNotice(null);
    setEquipmentOffer(route.kind === "offer" ? route.offer : null);
  }, []);
  // The technician's tap is the only thing that changes the screen outside the panel (#5625 r3 F12 / r4 F14).
  const onOpenOffer = useCallback((offer: EquipmentOffer) => {
    setEquipmentOffer(null);
    const opened = openOffer(offer, { generation: pickNow.current.generation, selection: selectionRef.current });
    if (!opened) return;
    if (opened.open) select(opened.open);
    setEquipmentFocus(opened.focus);
  }, [select]);
  const onDismissOffer = useCallback(() => setEquipmentOffer(null), []);
  // #5649: a component named by the repeated-serial warning opens through the same hand-off as a
  // Find equipment answer. The tap is the technician's, so it is routed and opened in one step.
  const onOpenEquipmentTarget = useCallback((target: QuestionTarget) => {
    const now = { ...pickNow.current, selection: selectionRef.current };
    const route = pickRouteFor(target, { conversation: now.selection, generation: now.generation }, now, ++equipmentPickToken.current);
    if (route.kind === "offer") onOpenOffer(route.offer);
  }, [onOpenOffer]);
  // The host owns a hand-off until the checklist reports how it ended (#5625 r1 F2): a checklist
  // remounted later never sees it again. Only the hand-off that ended is dropped, never a newer one.
  const onFocusDone = useCallback((token: number, outcome: { ok: true } | { ok: false; message: string }) => {
    setEquipmentFocus((f) => (f?.token === token ? null : f));
    if (!outcome.ok) setEquipmentNotice(outcome.message);
  }, []);

  // Tablet semantic-retry gap: a question refused because its target moved is never retried
  // onto the new target silently. Retry shows only when the target is unchanged.
  const retryCheck = failedBody ? retryTargetCheck(failedBody.refusedScope, reviewedBench) : null;
  const targetMessage = failedBody?.error && retryCheck?.kind === "review" ? targetReviewMessage(retryCheck.review) : null;
  const recoveryIsVisible = Boolean(failedBody?.error && !failedBody.bannerDismissed &&
    (view.sendError === failedBody.error || view.sendError === targetMessage));
  const reviewMessage = recoveryIsVisible ? targetMessage : null;
  const attachmentRecoveries = state.attachmentRecoveries?.get(state.thread.id);
  const attachmentDraftRecovery = state.draftRevision === undefined ? undefined
    : attachmentRecoveries?.find((recovery) => recovery.draftRevision === state.draftRevision);
  // A retry can reorder the saved questions without changing the composer's draft.
  const draftRecovery = sendRecoveries?.find((recovery) =>
    recoveryOwnsDraft(recovery, state.draftRevision, view.draft, attachmentDraftThreads.has(state.thread.id))) ?? null;
  const draftRetryCheck = draftRecovery ? retryTargetCheck(draftRecovery.refusedScope, reviewedBench) : null;
  const heldNote = draftRecovery
    ? heldEvidenceNote(draftRecovery, draftRetryCheck, true)
    : heldEvidenceNote(failedBody, retryCheck, false);
  const draftTargetMessage = draftRecovery && draftRetryCheck?.kind === "review" &&
    (draftRecovery !== failedBody || !reviewMessage) ? targetReviewMessage(draftRetryCheck.review) : null;
  useEffect(() => {
    if (reviewMessage) dispatch({ type: "set-send-error", error: reviewMessage });
  }, [reviewMessage]);

  /**
   * #4019 — attachments ride the turn they were attached to. Upload through the
   * existing doors (hub-attachments.ts), then ONE canonical send with the
   * re-read scope and/or the photo rider. A failed upload never lets the
   * question go out alone: the draft comes back with a plain-language error.
   * The bytes are released either way — the Composer already dropped the chip,
   * so keeping them would re-attach an invisible file to a later send (#3863).
   */
  const composeAndSend = useCallback(async (
    text: string,
    files: readonly HeldFile[],
    sel: HubSelection,
    nodeId: string,
    fallbackScope: readonly string[],
    history: ReturnType<typeof historyRows>,
    existing?: AbortController,
    recoveryId = crypto.randomUUID(),
  ) => {
    setBusy(true);
    dispatch({ type: "set-send-error", error: null });
    // A HOME send created its controller before the node read (round 3 F2);
    // reuse it so a Stop or navigation during that read already counts.
    const ctrl = existing ?? new AbortController();
    if (!existing) {
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = ctrl;
    }
    const threadId = shellThreadId(sel);
    const outgoingId = outgoingOwner.current?.id ?? null;
    const scope = benchScopesRef.current.get(sel.notebookId + "|" + sel.threadId);
    const uploadTarget: ScopeField = {
      threadId: sel.threadId === LEGACY_THREAD_ID ? null : sel.threadId,
      componentId: scope && scope !== "unavailable" ? scope.componentId : null,
      selectionVersion: scope && scope !== "unavailable" ? scope.selectionVersion : null,
    };
    sendAttempts.current.set(threadId, ctrl);
    let outcome: Awaited<ReturnType<typeof runAttachedSend>>;
    try {
      outcome = await runAttachedSend({
        signal: ctrl.signal,
        compose: () => composeHubSend(
          { text, files, notebookId: sel.notebookId, nodeId, threadId: sel.threadId === LEGACY_THREAD_ID ? null : sel.threadId, baseScope: fallbackScope },
          {
            fetch: (input, init) => fetch(input, { ...init, signal: ctrl.signal }),
            apiBase: API_BASE,
            newKey: () => crypto.randomUUID(),
            maxUploadMb: MAX_UPLOAD_MB,
          },
        ),
        send: async (composed) => {
          const rider = composed.visualEvidence ? { visualEvidence: composed.visualEvidence } : undefined;
          // The project's sources as they are when the question goes, plus what this upload added.
          const current = selectionRef.current === sel ? detailRef.current : null;
          const presentScope = current ? enabledDocIds(current.sources) : [...fallbackScope];
          const addedDuringUpload = (composed.scope ?? []).filter(id => !fallbackScope.includes(id));
          const scope = [...new Set([...presentScope, ...addedDuringUpload])];
          // #5746: a send with attachments keeps main's path; its files are already uploaded.
          return send(chatBodyFor(composed.question, scope, current ? historyRows(current.turns) : history, sel, rider),
            composed.question, sel, undefined, uploadTarget, { manualWait: false });
        },
      });
    } catch {
      outcome = { question: text, failure: "The attachment didn't upload — check the connection." };
    } finally {
      for (const f of files) adapter.forget(f.attachment.id);
      if (uploadAbortRef.current === ctrl) uploadAbortRef.current = null;
    }
    const ownsAttempt = sendAttempts.current.get(threadId) === ctrl;
    if (ownsAttempt) sendAttempts.current.delete(threadId);
    if (outcome === "sent" || outcome === "deferred") {
      dispatch({ type: "clear-attachment-recovery", threadId, recoveryId });
      if (outcome === "sent") return;
    }
    if (!uploadAbortRef.current && !abortRef.current) setBusy(false);
    dropOutgoing(outgoingId);
    if (outcome === "deferred" || !hostMountedRef.current) return;
    const notice = outcome === "cancelled"
      ? "The question was not sent. Attach the file again before sending."
      : outcome.reattach === false ? outcome.failure! : `${outcome.failure} Attach it again, then send.`;
    dispatch({
      type: "recover-attachment-draft", threadId, recoveryId,
      text: text || (outcome === "cancelled" ? "Review the attachment." : outcome.question),
      notice, restoreDraft: ownsAttempt,
      requiredAttachmentKinds: files.map(({ attachment }) => attachment.kind),
    });
  }, [adapter, send, dropOutgoing, outgoingOwner]);

  /** Create a project through the same contract as the legacy "New notebook" button. */
  const createNotebook = useCallback(async (body: { displayName: string; identitySourceType?: "user" }): Promise<string | null> => {
    const res = await fetch(`${API_BASE}/api/equipment-notebooks/`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.status === 401) { setSignedOut(true); return null; }
    if (!res.ok) throw new Error(errorMessageFor("", res.status));
    const created = (await res.json()) as { notebook?: HubNotebook };
    const notebook = created.notebook;
    if (!notebook?.id) throw new Error("The project was created but could not be opened. Refresh projects before trying again.");
    // POST already returned the authoritative notebook. Publish it immediately;
    // a slow or failed sidebar refresh must not hold selection or fail creation.
    notebookGate.invalidate();
    setNotebooks(current => [notebook, ...(current ?? []).filter(item => item.id !== notebook.id)]);
    void loadNotebooks().catch(error => console.warn("[hub-host] project list refresh failed", error));
    return notebook.id;
  }, [loadNotebooks, notebookGate]);

  /**
   * HOME send (L0): the question becomes a new thread in the preferred notebook
   * — created first when the workspace has none — and goes out on the canonical
   * route in general mode (no sources selected), so it persists, streams and
   * lands under Recent like every other conversation.
   */
  const sendFromHome = useCallback(async (plan: Exclude<ReturnType<typeof homeSendPlan>, { kind: "loading" }>, q: string, files: readonly HeldFile[] = []) => {
    let notebookId: string | null = plan.kind === "existing" ? plan.notebookId : null;
    if (plan.kind === "create") {
      setBusy(true);
      try { notebookId = await createNotebook(plan.body); }
      catch (err) { dropOutgoing(); dispatch({ type: "set-send-error", error: sendFailureMessage(err) }); dispatch({ type: "set-draft", draft: q }); return; }
      finally { setBusy(false); }
    }
    // No id means the create was refused (401 → signed-out screen) — hand the
    // technician their question back rather than dropping it.
    if (!notebookId) { dropOutgoing(); dispatch({ type: "set-draft", draft: q }); return; }
    const sel: HubSelection = { notebookId, threadId: newThreadId() };
    select(sel);
    // The message typed on HOME now belongs to the thread just created for it.
    const home = outgoingOwner.current;
    if (home && home.threadId === HOME_THREAD) putOutgoing({ ...home, threadId: shellThreadId(sel) });
    if (files.length === 0) {
      // #5746: a home send keeps main's general-mode contract (L0); it is never held.
      await send(chatBodyFor(q, [], [], sel), q, sel, undefined, undefined, { manualWait: false });
      return;
    }
    // Round 3 F2: own the operation from here, so Stop or opening another
    // thread during the node read cancels it before anything uploads.
    const ctrl = new AbortController();
    uploadAbortRef.current = ctrl;
    setBusy(true);
    // The upload door needs the notebook's own namespace node (every notebook
    // has one); a HOME send knows only the id, so read it first.
    const target = await resolveUploadNode(() =>
      getJson<Detail>(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/${detailQueryFor(sel)}`, ctrl.signal),
    );
    if (ctrl.signal.aborted) {
      for (const f of files) adapter.forget(f.attachment.id);
      if (uploadAbortRef.current === ctrl) uploadAbortRef.current = null;
      setBusy(false);
      dropOutgoing();
      return;
    }
    if (target.kind !== "ok") {
      if (uploadAbortRef.current === ctrl) uploadAbortRef.current = null;
      setBusy(false);
    }
    if (target.kind === "signed_out") { dropOutgoing(); setSignedOut(true); return; }
    if (target.kind === "failed") {
      // Codex #4024 F4: the Composer already cleared the draft — hand it back.
      for (const f of files) adapter.forget(f.attachment.id);
      dropOutgoing();
      dispatch({ type: "set-send-error", error: "Couldn't open the project to upload into. Attach the file again, then send." });
      dispatch({ type: "set-draft", draft: q });
      return;
    }
    await composeAndSend(q, files, sel, target.nodeId, [], [], ctrl);
  }, [adapter, createNotebook, select, send, composeAndSend, dropOutgoing, putOutgoing, outgoingOwner]);

  const onSend = useCallback((text: string, attachments: readonly Attachment[] = []) => {
    const q = text.trim();
    // #4019: pair each chip with the bytes the adapter held for it. Throws
    // (Composer keeps the draft AND the chips) on a missing file or a second
    // photo, before anything uploads (Codex #4024 F1/F3).
    const files = pairAttachments(attachments, (id) => adapter.heldFile(id));
    if ((!q && files.length === 0) || busy) return;
    // #5504 Codex r2/r3: the Composer keeps the draft and the attachments when this throws.
    // Before the checklist has been read, ask the panel to read it again, so a failed
    // first read does not leave the conversation unable to send.
    const benchRefused = selection ? benchSendRefusal(benchGate) : null;
    if (benchRefused) {
      if (!benchGate.known && !benchGate.changing) setBenchRefresh((n) => n + 1);
      throw new Error(benchRefused);
    }
    // Codex #3839 Spec P1: the Composer clears the draft after a hook that
    // RETURNS, so a send before the data loaded used to discard the
    // technician's question. Throwing is the Composer's documented contract
    // for "keep the draft, show this plain-language error". On HOME that is
    // the guard against creating a duplicate "General" before the list is
    // known (#3875 F2); inside a notebook, against sending before its detail.
    // Shown at once, before any upload, project creation or stream (outgoing-turn.ts).
    const beginOutgoing = (threadId: string) => putOutgoing(
      { id: `out-${Date.now()}`, threadId, question: q, attachments: files.map((f) => f.attachment), startedAt: new Date().toISOString() },
    );
    if (!selection) {
      const plan = homeSendPlan(notebooks);
      if (plan.kind === "loading") throw new Error(NO_PROJECT_ERROR);
      beginOutgoing(HOME_THREAD);
      void sendFromHome(plan, q, files);
      return;
    }
    if (!detail) throw new Error(NO_PROJECT_ERROR);
    if (attachmentDraftRecovery) {
      if (files.length === 0) throw new Error("Attach the file again before sending.");
      const missing = missingAttachmentKinds(attachmentDraftRecovery.requiredAttachmentKinds ?? [], attachments);
      if (missing.length) throw new Error(missing.includes("photo")
        ? "Attach the missing photo before sending."
        : "Attach the missing files before sending.");
    }
    // A deliberately reviewed target can reuse the held photo.
    const held = heldQuestionForSend(draftRecovery, draftRetryCheck, q, files.length);
    if (draftRecovery && recoveryOwnsDraft(draftRecovery, state.draftRevision, q, files.length > 0)) {
      if (draftRetryCheck?.kind === "loading") throw new Error("Wait for the question target to refresh.");
      if (held || draftRetryCheck?.kind === "retry") {
        // #5746: a question the route refused for the manual is asked with the project as it is now.
        const body = resendBodyFor(draftRecovery, selection, detail);
        if (body) void send(body, q, selection, draftRecovery);
        return;
      }
    }
    beginOutgoing(shellThreadId(selection));
    if (files.length > 0) {
      void composeAndSend(q, files, selection, detail.notebook.nodeId, docIds, historyRows(detail.turns),
        undefined, attachmentDraftRecovery?.id);
      return;
    }
    void send(chatBodyFor(q, docIds, historyRows(detail.turns), selection), q);
  }, [adapter, busy, selection, notebooks, detail, docIds, send, sendFromHome, composeAndSend, putOutgoing, benchGate, draftRecovery, draftRetryCheck, attachmentDraftRecovery, state.draftRevision]);

  // A send before this conversation's detail or component scope is read waits for them (15
  // seconds at most), so the question goes with the sources and scope the header shows. The
  // composer keeps the draft and attachments until the send starts. Whether a manual question
  // can be answered yet is the chat route's decision (#5746, option A), not this queue's.
  const onComposerSend = useCallback((question: string, attachments: readonly Attachment[]) => {
    if (!selection) return onSend(question, attachments);
    const scope = benchGate.known ? benchScopesRef.current.get(conversationKey(selection)) : undefined;
    const readingScope = !benchGate.known && !benchGate.changing && !benchGate.pending;
    if (detail && !readingScope) return onSend(question, attachments);
    return new Promise<void>((resolve, reject) => {
      const signal = new AbortController();
      const timer = setTimeout(() => signal.abort(), 15_000);
      const clear = () => {
        clearTimeout(timer);
        if (waitingSend.current?.signal !== signal) return;
        waitingSend.current = null;
        setWaitingToSend(false);
      };
      const fail = (error: Error) => { clear(); setSendPaused(true); reject(error); };
      signal.signal.addEventListener("abort", () => fail(new Error("Send paused. Your message and attachments are still here.")), { once: true });
      const waiting: WaitingSend = {
        selection, question, attachments, scope, signal,
        resolve: () => { clear(); resolve(); },
        reject: fail,
      };
      waitingSend.current = waiting;
      setWaitingToSend(true);
      if (readingScope) setBenchRefresh(count => count + 1);
      if (detailUnavailable) void loadDetail(selection);
    });
  }, [selection, detail, detailUnavailable, benchGate, onSend, loadDetail]);

  useEffect(() => {
    const waiting = waitingSend.current;
    if (!waiting) return;
    if (waiting.selection !== selection || selectionRef.current !== selection) {
      waiting.signal.abort();
      return;
    }
    if (busy) return;
    if (!benchGate.known) return;
    const scope = benchScopesRef.current.get(conversationKey(waiting.selection));
    if (waiting.scope && JSON.stringify(waiting.scope) !== JSON.stringify(scope)) {
      waiting.reject(new Error("The question target changed. Review it before sending your message."));
      return;
    }
    waiting.scope ??= scope;
    if (!detail) return;
    try {
      onSend(waiting.question, waiting.attachments);
      waiting.resolve();
    } catch (error) {
      waiting.reject(error instanceof Error ? error : new Error("Couldn't send the message."));
    }
  }, [waitingToSend, selection, detail, detailUnavailable, benchGate, benchView, busy, onSend]);

  useEffect(() => () => { waitingSend.current?.signal.abort(); manualHoldRef.current?.stop.abort(); }, []);

  // WP-1 guided dead end: sent in general mode with the session id; the route confirms it.
  const onGuidedDeadEnd = useCallback((question: string, sessionId: string) => {
    const q = question.trim();
    if (!q || busy || !selection || !detail) return;
    putOutgoing({ id: `out-${Date.now()}`, threadId: shellThreadId(selection), question: q, attachments: [], startedAt: new Date().toISOString() });
    void send(guidedDeadEndBody(q, sessionId, historyRows(detail.turns), selection), q);
  }, [busy, selection, detail, send, putOutgoing]);

  const onStop = useCallback(() => {
    waitingSend.current?.signal.abort();
    // Stop while a refused question waits for the manual pauses it; its draft and saved question stay.
    const hold = manualHoldRef.current;
    if (hold) pauseManualHold(hold, MANUAL_WAIT_STOPPED);
    const ctrl = abortRef.current;
    if (ctrl && !ctrl.signal.aborted) {
      explicitStops.current.add(ctrl);
      ctrl.abort();
    }
    uploadAbortRef.current?.abort();
  }, [pauseManualHold]);
  const retryRecovery = (recovery: HubSendRecovery, confirmTarget = false, opts: SendOpts = {}) => {
    if (!selection || selectionRef.current !== selection || uploadAbortRef.current || abortRef.current || benchSendRefusal(benchGate)) return;
    const check = retryTargetCheck(recovery.refusedScope, reviewedBench);
    if (check.kind === "loading" || (check.kind === "review" && !confirmTarget)) return;
    const current = benchScopesRef.current.get(gateConversation!);
    if (recovery.refusedScope && (!current || (current === "unavailable"
      ? reviewedBench !== null
      : current.componentId !== (reviewedBench?.selection?.componentId ?? null) ||
        current.selectionVersion !== (reviewedBench?.selectionVersion ?? null)))) return;
    // #5746: a question the route refused for the manual is asked with the project as it is now.
    const body = resendBodyFor(recovery, selection, detailRef.current);
    if (body) void send(body, recovery.question, selection, recovery, undefined, opts);
  };
  // #5746: one send of a paused manual question without the manual wait, while its saved question
  // is the banner and still the draft. It goes with the project's sources as they are now, and the
  // route answers it the way main does.
  const onSendWithoutManual = () => {
    if (failedBody?.manualRefused !== undefined && draftRecovery === failedBody) retryRecovery(failedBody, false, { manualWait: false });
  };
  const onRetry = (turnId: string) => {
    const recovery = inlineRecoveries.get(turnId);
    if (recovery) retryRecovery(recovery);
  };
  const onRetrySendError = () => { if (failedBody) retryRecovery(failedBody); };
  const discardRecovery = (recovery: HubSendRecovery) => {
    if (abortRef.current || uploadAbortRef.current) return;
    const threadId = state.thread.id;
    if (recovery.draftRevision !== undefined &&
        recoveryOwnsDraft(recovery, state.draftRevision, view.draft, attachmentDraftThreads.has(threadId))) {
      dispatch({ type: "sent-draft", threadId, question: recovery.question, revision: recovery.draftRevision });
    }
    dispatch({ type: "clear-recovery", threadId, recoveryId: sendRecoveryId(recovery) });
    if (recovery === failedBody && recoveryIsVisible) dispatch({ type: "set-send-error", error: null });
  };
  // #5746: a refused question waiting for the manual is not offered again while it waits.
  const extraRecoveries = sendRecoveries?.filter((recovery) =>
    !(waitingForManual && sendRecoveryId(recovery) === manualHold?.recoveryId) &&
    (recovery !== failedBody || recovery.unposted ||
    !recoveryIsVisible || (retryCheck?.kind === "review" && draftRecovery !== failedBody)));
  // #5746: the draft edited while its refused question waits ends the wait at once.
  useEffect(() => {
    const hold = manualHoldRef.current;
    if (hold && heldManualRecovery(state, hold.threadId, hold.recoveryId) === "not_owner") pauseManualHold(hold, MANUAL_DRAFT_CHANGED);
  }, [state, manualHold, pauseManualHold]);
  const refreshConfirmed = () => {
    if (selection) void loadDetail(selection).catch(() => false);
  };

  /** New chat: a fresh thread in the open notebook; from HOME, HOME is already the blank chat. */
  const onNewChat = useCallback(() => {
    if (selection) select({ notebookId: selection.notebookId, threadId: newThreadId() });
  }, [selection, select]);

  /** New project (#4632): opens the setup sheet. Nothing is written until the sheet's Create project. */
  const onCreateProject = useCallback(() => setNewProjectOpen(true), []);

  const onOpenItem = useCallback((item: ProjectItem) => {
    const ref = threadRefFromItem(item.id);
    if (ref) select(ref);
  }, [select]);
  const onSelectProject = useCallback((projectId: string) => {
    const notebookId = notebookIdFromProject(projectId);
    if (!notebookId) return;
    const nb = notebooks?.find((n) => n.id === notebookId);
    // Resume the project's newest saved conversation; a fresh chat only when it has none (#4681).
    if (!nb) return;
    const target = resumeProjectSelection(nb);
    // Already open: select() would abort a live stream and reset the loaded detail.
    const open = selectionRef.current;
    if (open && open.notebookId === target.notebookId && open.threadId === target.threadId) return;
    select(target);
  }, [notebooks, select]);

  /**
   * Open a source in the shell's viewer. The reducer's OWN thread is the empty
   * stub (`syncThread`); the real turns exist only in the render-time projection
   * `view`. `select-source` resolves the id against the reducer's thread, so a
   * bare dispatch was a silent no-op (found by the live click proof, 2026-09-18).
   * Hand the reducer the projected thread first — same thread id, so the draft
   * is untouched — then select. The next render's projection re-hydrates over a
   * thread that now contains the source, so the selection survives.
   */
  const openSource = useCallback((sourceId: string) => {
    dispatch({ type: "hydrate", data: { thread: view.thread, projects: view.projects, machines: view.machines, activeContext: view.activeContext } });
    dispatch({ type: "select-source", sourceId });
  }, [view]);

  // Answer text renders through the classic notebook's markdown + inline
  // citation marks, gated on the turn's own source parts.
  const renderText = useCallback((text: string, turn: InteractionTurn): ReactNode => {
    if (turn.role === "user") return <UserTurnText text={text} />;
    const own = new Map<string, { citation: EvidenceCitation; sourceId: string }>();
    for (const part of turn.parts) {
      if (part.type !== "source") continue;
      const citation = citations.get(part.source.id);
      if (citation) own.set(citation.citationId, { citation, sourceId: part.source.id });
    }
    // The marker the reader clicks is this turn's "[n]"; it opens the source part that carries it
    // (a source id names the answer's request, so a saved answer keeps its live id).
    const markdown = (content: string) => <AnswerMarkdown content={content} citations={[...own.values()].map(entry => entry.citation)} onCite={(citation) => {
      const entry = own.get(citation.citationId);
      if (entry) openSource(entry.sourceId);
    }} />;
    // #4690: the server's ⚠️ lines above the answer get their own warning block,
    // the shell's safety styling, instead of reading as the answer's first paragraph.
    return <AnswerWithSafety text={text} markdown={markdown} />;
  }, [citations, openSource]);

  const onCopy = useCallback((turnId: string) => {
    const turn = view.thread.turns.find((t) => t.id === turnId);
    if (!turn) return;
    const body = turn.parts.filter((p): p is Extract<InteractionPart, { type: "text" }> => p.type === "text").map((p) => p.text).join("\n\n").trim();
    const sources = turn.parts.filter((p): p is Extract<InteractionPart, { type: "source" }> => p.type === "source")
      .map((p) => `[${citations.get(p.source.id)?.citationId ?? p.source.id}] ${p.source.title}${p.source.locator ? ` ${p.source.locator}` : ""}`);
    const text = sources.length ? `${body}\n\nSources:\n${sources.join("\n")}` : body;
    if (text && typeof navigator !== "undefined" && navigator.clipboard) void navigator.clipboard.writeText(text);
  }, [view.thread.turns, citations]);

  // Read-aloud: created once; null where the browser has no Web Speech, in which
  // case the hook is omitted and the shell renders no button. Stopped on unmount.
  const readAloud = useMemo(() => createReadAloud(), []);
  const fixRequestIds = useMemo(() => createFixRequestIds(), []);
  useEffect(() => () => readAloud?.stop(), [readAloud]);
  // Switching notebook or thread stops an answer that is still being read.
  useEffect(() => {
    readAloud?.scope(`${selection?.notebookId ?? ""}:${selection?.threadId ?? ""}`);
  }, [readAloud, selection?.notebookId, selection?.threadId]);
  const onReadAloud = useCallback((turnId: string) => {
    const turn = view.thread.turns.find((t) => t.id === turnId);
    if (!turn) return;
    // The same citation ids renderText turns into chips: only those "[n]" are
    // citation marks; any other bracketed number is spoken.
    const ids = new Set<string>();
    for (const part of turn.parts) {
      const c = part.type === "source" ? citations.get(part.source.id) : undefined;
      if (c) ids.add(c.citationId);
    }
    readAloud?.toggle(turnId, spokenAnswerText(turn, ids));
  }, [readAloud, view.thread.turns, citations]);

  // T2 (#4175): confirm a machine MIRA proposed from free text (#4120).
  // Posts to the Hub's own confirm route (which reuses `updateNotebook` — not
  // a second identity-write path) and relays its outcome verbatim; the shell
  // renders the server's own `manualReady`/`message`, never a client guess.
  // Refresh afterward so a promoted candidate manual (migration 104) shows
  // up in Sources/the answer the next time the technician asks.
  const onConfirmIdentity = useCallback(async (proposal: IdentityProposal): Promise<ConfirmIdentityResult> => {
    const notebookId = selectionRef.current?.notebookId;
    if (!notebookId) throw new Error("no notebook selected");
    const body: Record<string, string> = { manufacturer: proposal.manufacturer, model: proposal.model };
    if (proposal.catalogNumber) body.catalogNumber = proposal.catalogNumber;
    const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/identity/confirm/`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as
      | { ok?: unknown; manualReady?: unknown; message?: unknown; searching?: unknown; startedAt?: unknown; error?: unknown; manufacturer?: unknown; model?: unknown }
      | null;
    // Light-review fix (PR #4195): a stale proposal card (or a race the
    // adapter's own `priorOutcome` missed) can still try to confirm an
    // identity the notebook has since moved past. The server's 409 names the
    // CURRENT confirmed machine; relay it as a typed, `instanceof`-checkable
    // error so the card renders a terminal refusal, never the generic
    // retryable "Could not confirm."
    if (res.status === 409 && data?.error === "identity_already_confirmed") {
      const mfr = typeof data.manufacturer === "string" && data.manufacturer ? data.manufacturer : null;
      const mdl = typeof data.model === "string" && data.model ? data.model : null;
      throw new IdentityAlreadyConfirmedError(mfr && mdl ? `This machine is already confirmed as ${mfr} ${mdl}.` : undefined);
    }
    if (!res.ok || !data || data.ok !== true) throw new Error("could not confirm identity");
    // Codex #4195 round 2 F4 + round 3 F4: a confirm that STARTED a search is
    // followed the same way hydration is (F6) — seed the SAME driver, no
    // second timer. `startedAt`, when the server sends it, is that search's
    // own generation — seeding with it (rather than an optimistic,
    // generation-less read) means the first poll never has to "adopt" it.
    const searching = data.searching === true;
    const startedAt = typeof data.startedAt === "string" && data.startedAt ? data.startedAt : undefined;
    // Codex round 5 F16 (#4195): bind completion to `notebookId` — the
    // notebook THIS confirm was for, captured BEFORE the await — never to
    // whatever `selectionRef.current` is NOW. A technician who navigated to
    // a different notebook while this POST was in flight must get neither a
    // `loadDetail` refresh nor a follower seed under A's identity; see
    // `applyConfirmIdentityResult`'s own header for the full race.
    const refresh = await applyConfirmIdentityResult(
      notebookId,
      proposal,
      { searching, ...(startedAt ? { startedAt } : {}) },
      {
        loadDetail,
        seedDriver: seedManualSearch,
        // Once unmounted there is no selection to refresh: the helper reports
        // "skipped" and never starts a detail GET for an abandoned host.
        currentSelection: () => (hostMountedRef.current ? selectionRef.current : null),
      },
    );
    // #4219 Codex r2 F1: "ready" only for a manual the next question would actually carry, read
    // from the refreshed detail; otherwise say so instead of claiming it.
    const confirmedDetail = refresh === "refreshed" && selectionRef.current?.notebookId === notebookId
      ? detailRef.current
      : null;
    const status = confirmedDetail?.manualSearch;
    const manualReady = currentReadyManualId(status, confirmedDetail?.sources ?? []) !== null;
    if (data.manualReady === true && !manualReady && !searching) {
      return {
        manualReady: false,
        searching: false,
        message: "Machine confirmed. I couldn't verify its manual in Sources.",
      };
    }
    return {
      manualReady,
      searching: !manualReady && (searching || status?.running === true),
      ...(startedAt ? { startedAt } : {}),
      ...(manualReady && status?.message ? { message: status.message }
        : !data.manualReady && typeof data.message === "string" && data.message ? { message: data.message } : {}),
    };
  }, [loadDetail, seedManualSearch]);

  // Plant memory (migration 095): record what fixed the machine, filed under
  // the question this answer replied to. The platform prompt/alert dialogs are
  // the capture UI (commodity-before-custom); the next answer on this notebook
  // is grounded on the record.
  const onRecordFix = useCallback(async (turnId: string) => {
    const notebookId = selectionRef.current?.notebookId;
    const symptom = fixSymptomFor(view.thread.turns, turnId);
    // The server files the fix under the machine THIS answer was served for
    // (Codex #4058 post-cap F1), so the answer's server turn id travels with it.
    const sourceTurnId = serverTurnIdFor(turnId);
    if (!notebookId || !symptom || !sourceTurnId || typeof window === "undefined") return;
    const fix = window.prompt(`What fixed it?\n\nProblem: ${symptom}`)?.trim();
    if (!fix) return;
    const clientRequestId = fixRequestIds.idFor(turnId, fix);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/fixes/`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ symptom, fix, clientRequestId, sourceTurnId }),
      });
      if (res.ok) {
        setFixesSaved((n) => n + 1);
        fixRequestIds.settle(turnId, fix);
        window.alert("Fix saved as a technician note. MIRA does not use it in its answers.");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      const refusal = fixRefusalMessage(body?.error);
      if (refusal) fixRequestIds.settle(turnId, fix);
      window.alert(refusal ?? "Could not save the fix. Try again.");
    } catch {
      window.alert("Could not save the fix. Check the connection and try again.");
    }
  }, [fixRequestIds, view.thread.turns]);

  // Keep a photo from this conversation as one of the machine's sources, then
  // reload the notebook so the next question's source scope includes it.
  const onKeepPhoto = useCallback(async (fileId: string, reviewed?: Parameters<NonNullable<HostHooks["onKeepPhoto"]>>[1]) => {
    const sel = selectionRef.current;
    if (!sel?.notebookId) throw new Error("no_notebook");
    const res = await fetch(
      `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/photos/${encodeURIComponent(fileId)}/source/`,
      {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        // The conversation whose reading the technician is looking at.
        body: JSON.stringify({ threadId: sel.threadId ?? "legacy", ...(reviewed ? { reviewed } : {}) }),
      },
    );
    if (!res.ok) throw new Error(`keep_photo_${res.status}`);
    try {
      if (!await loadDetail(sel)) return "refresh_pending" as const;
    } catch {
      return "refresh_pending" as const;
    }
  }, [loadDetail]);
  const onRefreshPhotoScope = useCallback(async () => {
    const sel = selectionRef.current;
    if (!sel?.notebookId) return false;
    return loadDetail(sel);
  }, [loadDetail]);
  const onReviewPhoto = useCallback(async (fileId: string) => {
    const sel = selectionRef.current;
    if (!sel?.notebookId) throw new Error("no_notebook");
    const query = sel.threadId ? `?threadId=${encodeURIComponent(sel.threadId)}` : "";
    const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/photos/${encodeURIComponent(fileId)}/source/${query}`);
    if (!res.ok) throw new Error(`photo_review_${res.status}`);
    return await res.json() as { observationId: string; text: string; reviewed: boolean };
  }, []);
  const keptPhotoIds = useMemo(
    () => new Set((detail?.sources ?? []).map((s) => s.originFileId).filter((id): id is string => !!id)),
    [detail],
  );

  // #5746: a refused question waiting for the manual reads as busy (Stop pauses it); a paused one
  // offers Send without the manual while its saved question is the banner and still the draft.
  const pausedForManual = failedBody?.manualRefused !== undefined && recoveryIsVisible && !waitingForManual &&
    draftRecovery === failedBody && retryCheck?.kind === "retry";
  const hooks: HostHooks = {
    onSend,
    onComposerSend,
    renderText,
    onCopy,
    ...(readAloud ? { onReadAloud } : {}),
    ...(selection?.notebookId
      ? { onRecordFix: (turnId: string) => void onRecordFix(turnId), canRecordFix: (turnId: string) => serverTurnIdFor(turnId) !== null }
      : {}),
    ...(selection?.notebookId ? { onConfirmIdentity: onConfirmIdentity } : {}),
    ...(selection?.notebookId ? { onKeepPhoto, onReviewPhoto, onRefreshPhotoScope, isPhotoKept: (fileId: string) => keptPhotoIds.has(fileId) } : {}),
    onSource: (source) => openSource(source.id),
    onNewChat,
    onCreateProject,
    ...(busy || waitingToSend || waitingForManual ? { onStop } : {}),
    // #5746 r6 F7: a composer send paused before it went retries through the composer (its draft).
    ...(inlineRecoveries.size && !sendPaused ? { onRetry } : {}),
    ...(!sendPaused && (failedBody || attachmentRecoveries?.length) ? { onRetrySendError: recoveryIsVisible && !failedBody?.unposted && retryCheck?.kind === "retry" ? onRetrySendError : null } : {}),
    ...(recoveryIsVisible && recoveryBlocked ? { retrySendErrorDisabledReason: recoveryBlocked } : {}),
    ...(failedBody && recoveryIsVisible ? { onDismissSendError: () => dispatch({
      type: "dismiss-recovery-error", threadId: state.thread.id, recoveryId: sendRecoveryId(failedBody),
    }) } : {}),
    onPendingAttachmentThreads,
    ...(reviewMessage ? { targetReview: reviewMessage } : {}),
    ...(pausedForManual && !busy ? { onSendWithoutManual } : {}),
    groundingLine: () => selection && !detail
      ? detailUnavailable ? "Couldn't load this project's details." : "Opening project…"
      : groundingLineFor(detail?.notebook ?? null, docIds.length),
    busy: busy || waitingToSend || waitingForManual,
  };

  const layers = useBackClosesLayers(view); // #5069: phone web Back closes the open layer first
  // #5546: the action column stays off (and out of the taps of) any layer that covers the page.
  const actionsCovered = actionsCoveredByLayer(layers.top, view.profile.kind === "mobile" || layers.narrow);

  if (signedOut) {
    return (
      <main style={{ padding: "var(--fl-space-8)", fontFamily: "var(--fl-font)" }}>
        <p>Sign in to ask MIRA.</p>
        <a href={`${API_BASE}/login`}><button type="button">Sign in</button></a>
      </main>
    );
  }

  return (
    <div className="hub-shell-host" data-testid="hub-shell" data-fl-surface="light">
      <FactoryLMShell
        state={view}
        dispatch={dispatch}
        adapter={adapter}
        hooks={hooks}
        conversationSurface="assistant"
        {...(heldNote || draftTargetMessage || attachmentRecoveries?.length || extraRecoveries?.length || confirmedExchange ? { composerAccessory: <>
          {confirmedExchange && <div className="fl-qtarget__browsing">
            <p role="status">{confirmedExchange.result.status === "error"
              ? "Refresh the conversation to load the saved turn."
              : "The answer is ready. Refresh the conversation to load the saved answer."}</p>
            <button type="button" onClick={refreshConfirmed}>Refresh conversation</button>
          </div>}
          {extraRecoveries?.map((recovery) => {
            const check = retryTargetCheck(recovery.refusedScope, reviewedBench);
            return <div className="fl-qtarget__browsing" key={sendRecoveryId(recovery)} role="group" aria-label="Saved question">
              <p>{recovery.question}</p>
              {recovery.body.visualEvidence && <p>Photo kept with this question.</p>}
              {check.kind === "review" && <p>Asked about {check.review.from}. Current target is {check.review.to}.</p>}
              {recoveryBlocked && <p>{recoveryBlocked}</p>}
              <button type="button" disabled={Boolean(recoveryBlocked) || check.kind === "loading"}
                onClick={() => retryRecovery(recovery, check.kind === "review")}>
                {check.kind === "review" ? "Send saved question to current target" : "Retry saved question"}
              </button>
              <button type="button" disabled={busy} onClick={() => discardRecovery(recovery)}>Discard saved question</button>
            </div>;
          })}
          {draftTargetMessage && <p className="fl-qtarget__browsing" role="status">{draftTargetMessage}</p>}
          {heldNote && <p className="fl-qtarget__browsing" role="status" aria-label="Kept with this question">{heldNote}</p>}
          {attachmentRecoveries?.map((recovery) => <div className="fl-qtarget__browsing" key={recovery.id}
            role="group" aria-label="Interrupted attachment">
            {!recovery.noticeDismissed && <p role="status">{recovery.notice}</p>}
            {attachmentDraftRecovery !== recovery && <p aria-label="Interrupted question">{recovery.question}</p>}
            {attachmentDraftRecovery !== recovery && <button type="button"
              disabled={busy || Boolean(view.draft) || attachmentDraftThreads.has(state.thread.id)}
              onClick={() => dispatch({ type: "restore-attachment-draft", threadId: state.thread.id, recoveryId: recovery.id })}>
              Restore question
            </button>}
            {!recovery.noticeDismissed && <button type="button" disabled={busy}
              onClick={() => dispatch({ type: "dismiss-attachment-notice", threadId: state.thread.id, recoveryId: recovery.id })}>
              Dismiss attachment notice
            </button>}
            {attachmentDraftRecovery === recovery && <button type="button" disabled={busy}
              onClick={() => dispatch({ type: "clear-attachment-recovery", threadId: state.thread.id, recoveryId: recovery.id })}>
              Continue without the missing files
            </button>}
            <button type="button" disabled={busy || (attachmentDraftRecovery === recovery && attachmentDraftThreads.has(state.thread.id))}
              onClick={() => dispatch({ type: "discard-attachment-question", threadId: state.thread.id, recoveryId: recovery.id })}>
              Discard interrupted question
            </button>
          </div>)}
        </> } : {})}
        onOpenItem={onOpenItem}
        onSelectProject={onSelectProject}
        navigationFooter={
          <HubAccountFooter
            email={authSession?.user?.email}
            signingOut={signingOut}
            onSignOut={() => {
              // TASK-S3: local-only Living Work Sheet queues must not outlive
              // the session that created them. R2-32: but they must not be
              // silently discarded either — ask first when anything is
              // unsynced; Cancel keeps them (no purge, no navigation). No
              // unsynced entries => no prompt, same as before. #5212: a purge
              // that left sheet text on the phone says so first.
              void (async () => {
                const proceed = await clearSheetDataForSignOut(localStorageStore, (m) => window.confirm(m), () => setSigningOut(true));
                if (!proceed) {
                  setSigningOut(false);
                  return;
                }
                signOutToLogin();
              })();
            }}
          />
        }
      />
      {/* The notebook's tools sit behind one More button (Mike, 2026-11-20); each still decides when it
          is available and owns what it opens. */}
      <NotebookActionsMenuProvider>
      {/* WP-1: shown only when the route is enabled and a manufacturer procedure applies. */}
      {selection && detail && (
        <GuidedProcedure
          // Re-mount (and re-read availability) when the machine's identity or its manuals change
          // in place — a confirm or an attach doesn't change the notebook id (Codex #4573 F4).
          key={[
            selection.notebookId,
            detail.notebook.identityStatus,
            detail.notebook.manufacturer ?? "",
            detail.notebook.model ?? "",
            detail.notebook.catalogNumber ?? "",
            detail.sources.map((s) => s.docId).join(","),
          ].join("|")}
          notebookId={selection.notebookId}
          onAskMira={onGuidedDeadEnd}
          chatBusy={busy}
        />
      )}
      {/* The notebook's action buttons share one column below the guided-procedure pill, each in its
          own row, so Machine state and Work Packet never cover each other (#5102). */}
      <div data-testid="notebook-actions" data-covered={actionsCovered ? "true" : undefined} aria-hidden={actionsCovered || undefined} style={notebookActionsStyle(actionsCovered)}>
      <style>{NOTEBOOK_ACTIONS_CSS}</style>
      <NotebookActionsMenu covered={actionsCovered} />
      {/* Equipment-first navigation (MIRA_EQUIPMENT_NAV): renders nothing while the flag is off. */}
      <EquipmentNav
        origin={equipmentOrigin}
        target={equipmentTarget}
        notice={equipmentNotice}
        offer={equipmentOffer && equipmentOffer.generation === navGeneration ? equipmentOffer : null}
        onPick={onEquipmentPick}
        onOpenOffer={onOpenOffer}
        onDismissOffer={onDismissOffer}
      />
      {/* Bench components: "Asking about …", the checklist and the reply's actions; nothing without migration 115. */}
      {selection && (
        <BenchComponents
          key={`bench|${selection.notebookId}|${selection.threadId}`}
          notebookId={selection.notebookId}
          threadId={selection.threadId}
          refresh={benchRefresh}
          busy={busy}
          frame={componentFrame?.key === `${selection.notebookId}|${selection.threadId}` ? componentFrame.frame : null}
          gate={benchGate}
          onState={onBenchState}
          focus={equipmentFocus && equipmentFocus.notebookId === selection.notebookId && equipmentFocus.threadId === selection.threadId ? equipmentFocus : null}
          onFocusDone={onFocusDone}
          onOpenEquipment={onOpenEquipmentTarget}
        />
      )}
      {/* Mission 001: report an observation and read back machine state; renders nothing while off. */}
      {selection && detail && (
        <MachineObservations
          key={`${selection.notebookId}|${detail.notebook.identityStatus}`}
          notebookId={selection.notebookId}
        />
      )}
      {/* #5089: the fixes saved on this project, read back after a reload; nothing while there are none. */}
      {selection && <SavedFixes key={`saved-fixes|${selection.notebookId}`} notebookId={selection.notebookId} refresh={fixesSaved} />}
      {/* #4982: shown only when NOTEBOOK_WORK_PACKET is on (the panel renders nothing on 404). */}
      {selection && (
        <WorkPacketPanel
          // Same remount rule as GuidedProcedure above: a notebook switch, an identity confirm or a
          // manual attach starts the panel fresh, so it never shows stale manuals or another
          // machine's packet (Codex #5062 F4/F5). `detail` may still be loading here.
          key={[
            selection.notebookId,
            detail?.notebook.identityStatus ?? "",
            detail?.notebook.manufacturer ?? "",
            detail?.notebook.model ?? "",
            detail?.notebook.catalogNumber ?? "",
            (detail?.sources ?? []).map((s) => s.docId).join(","),
          ].join("|")}
          notebookId={selection.notebookId}
          technicianName={authSession?.user?.email ?? null}
          openOnArrival={packetLink !== null && packetLink === selection.notebookId}
        />
      )}
      {/* TASK-S3: the phone Living Work Sheet; renders nothing on 404. Same
          remount rule as WorkPacketPanel above — a notebook switch starts it
          fresh, so it never shows another machine's job list or open job. */}
      {selection && (
        <LivingSheet
          key={selection.notebookId}
          notebookId={selection.notebookId}
          technicianName={authSession?.user?.email ?? null}
          onSheetOpenChange={setLivingSheetJob}
          receipt={sheetReceipt}
        />
      )}
      {/* #5302: manuals saved into this project that are not sources yet; renders nothing otherwise.
          Last row of the actions column, so it is on screen and never covers the buttons above. */}
      {selection && detail && detail.notebook.id === selection.notebookId && (
        <PendingManuals
          key={`pending-manuals|${selection.notebookId}`}
          notebookId={selection.notebookId}
          nodeId={detail.notebook.nodeId}
          sources={detail.sources}
          approved={approvedManuals}
          onAttached={(fileIds) => {
            const nb = selection.notebookId;
            setPendingApprovals((m) => ({ ...m, [nb]: (m[nb] ?? []).filter((id) => !fileIds.includes(id)) }));
            // Same late-completion race as the box below: never re-read a project that is no longer on screen.
            void reloadIfStillSelected(hostMountedRef.current ? selectionRef.current : null, selection, loadDetail);
          }}
        />
      )}
      {/* #5456: sources of this project that answers do not use (a manual saved switched off), each
          with its one next step; renders nothing when every source is in use. */}
      {selection && detail && detail.notebook.id === selection.notebookId && (
        <ParkedSources
          key={`parked-sources|${selection.notebookId}`}
          notebookId={selection.notebookId}
          sources={detail.sources}
          onChanged={() => reloadIfStillSelected(hostMountedRef.current ? selectionRef.current : null, selection, loadDetail)}
        />
      )}
      </div>
      </NotebookActionsMenuProvider>
      {/* #4632: New project setup; a sibling of the notebook actions, never inside them. */}
      <NewProjectSetup
        open={newProjectOpen}
        onClose={() => setNewProjectOpen(false)}
        notebooks={notebooks ?? []}
        createNotebook={createNotebook}
        onOpenProject={(notebookId) => {
          setNewProjectOpen(false);
          select({ notebookId, threadId: newThreadId() });
        }}
        onPendingManuals={(notebookId, fileIds) =>
          setPendingApprovals((m) => ({ ...m, [notebookId]: [...new Set([...(m[notebookId] ?? []), ...fileIds])] }))}
        onWritten={() => void loadNotebooks().catch((error) => console.warn("[hub-host] project list refresh failed", error))}
      />
    </div>
  );
}

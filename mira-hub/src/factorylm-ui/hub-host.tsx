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
  type ShellState,
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
import type { EvidenceCitation } from "@/lib/notebook-chat-types";
import {
  isAbortError,
  readNotebookStream,
  type PersistedTurn,
} from "@/components/equipment/notebook-chat-utils";
import { AnswerMarkdown } from "@/components/equipment/notebook-markdown";
import { browserAdapterDeps, createWebAdapter } from "./web-adapter";
import { HOME_THREAD, createOutgoingOwner, withOutgoing, type Outgoing } from "./outgoing-turn";
import { composeHubSend, pairAttachments, resolveUploadNode, runAttachedSend, type HeldFile } from "./hub-attachments";
import { createManualSearchDriver, type ManualSearchDriver } from "./manual-search-driver";
import { GuidedProcedure } from "./GuidedProcedure";
import { LEGACY_THREAD_ID, notebookMachines, notebookProjects, threadRefFromItem, notebookIdFromProject, type HubNotebook } from "./notebook-tree";
import { answerTurnId, citationIndex, contextFor, lifecycleFromStream, partsFromStream, sourceIdFor, threadFromPersisted, withManualSearchStatus, withSettledFollowups, type SettledFollowups } from "./to-interaction";
import {
  EMPTY_FIXTURE,
  NO_PROJECT_ERROR,
  applyConfirmIdentityResult,
  chatBodyFor,
  guidedDeadEndBody,
  createLatestLoadTracker,
  detailQueryFor,
  draftAfterSendSucceeded,
  enabledDocIds,
  errorMessageFor,
  fixtureFor,
  groundingLineFor,
  historyRows,
  homeSendPlan,
  initialHubShellState,
  landingSelection,
  latestRequestGate,
  metaFor,
  newThreadId,
  openNotebookSelection,
  retainedStreamInterruption,
  searchForSelection,
  selectionFromSearch,
  sendFailureMessage,
  shellThreadId,
  type CompatibleStreamResult,
  type HubSelection,
} from "./hub-host-logic";
import { keepPhotoWithReview } from "./keep-photo-review";

type Detail = {
  notebook: EquipmentNotebook;
  sources: NotebookSource[];
  turns: (PersistedTurn & { createdAt?: string })[];
  // T2 (#4189 F6): the notebook's CURRENT manual-search status, computed
  // fresh by the GET route on every read (`currentManualSearchStatus`) —
  // absent/null on a server that predates it, or when nothing is running.
  manualSearch?: ManualSearchStatus | null;
};

/** One in-flight or just-finished exchange the server has not yet returned as a row. */
type Live = {
  readonly id: string;
  readonly question: string;
  readonly content: string;
  readonly citations: EvidenceCitation[];
  readonly result: CompatibleStreamResult | null;
  readonly stopped: boolean;
  readonly startedAt: string;
  /** The outgoing message this stream answers (null: a retry, or none). */
  readonly outgoingId: string | null;
};

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
  const [signedOut, setSignedOut] = useState(false);
  const [notebooks, setNotebooks] = useState<HubNotebook[] | null>(null);
  const [selection, setSelection] = useState<HubSelection | null>(null);
  const selectionRef = useRef<HubSelection | null>(null);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const detailRef = useRef(detail);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  const [live, setLive] = useState<Live | null>(null);
  const [settledFollowups, setSettledFollowups] = useState<(SettledFollowups & HubSelection) | null>(null);
  const [outgoing, setOutgoing] = useState<Outgoing | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedBody, setFailedBody] = useState<{ body: ReturnType<typeof chatBodyFor>; question: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);
  const detailAbortRef = useRef<AbortController | null>(null);
  const [detailGate] = useState(() => latestRequestGate());
  const [detailLoads] = useState(() => createLatestLoadTracker());
  const adapter = useMemo(() => createWebAdapter(browserAdapterDeps()), []);
  const [state, dispatch] = useReducer(shellReducer, undefined, initialHubShellState);
  const draftRef = useRef(state.draft);
  useEffect(() => { draftRef.current = state.draft; }, [state.draft]);
  const syncThread = useCallback((sel: HubSelection) => {
    const at = new Date().toISOString();
    dispatch({
      type: "hydrate",
      data: {
        thread: { ...EMPTY_FIXTURE.thread, id: shellThreadId(sel), notebookId: sel.notebookId, createdAt: at, updatedAt: at },
      },
    });
  }, []);
  const loadNotebooks = useCallback(async () => {
    const { status, data } = await getJson<{ notebooks: HubNotebook[] }>("/api/equipment-notebooks/");
    if (status === 401) { setSignedOut(true); return; }
    if (!data) return;
    setNotebooks(data.notebooks);
    if (!selectionRef.current) {
      const next = selectionFromSearch(readSearch(), data.notebooks) ?? landingSelection(data.notebooks);
      if (next) {
        syncThread(next);
        setSelection(next);
        writeSearch(searchForSelection(next));
      }
    }
    return data.notebooks;
  }, [syncThread]);
  useEffect(() => {
    void loadNotebooks();
  }, [loadNotebooks]);
  const hostMountedRef = useRef(false);
  const seedManualSearch = (notebookId: string, status: ManualSearchStatus): void => {
    if (hostMountedRef.current) manualSearchDriverRef.current?.seed(notebookId, status);
  };
  const loadDetail = useCallback((sel: HubSelection): Promise<boolean> => detailLoads.start(async (follow) => {
    const token = detailGate.begin();
    detailAbortRef.current?.abort();
    const ctrl = new AbortController();
    detailAbortRef.current = ctrl;
    let res: { status: number; data: Detail | null };
    try {
      res = await getJson<Detail>(`/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/${detailQueryFor(sel)}`, ctrl.signal);
    } catch (err) {
      if (isAbortError(err)) return follow();
      throw err;
    }
    if (!detailGate.isCurrent(token)) return follow();
    if (res.status === 401) { setSignedOut(true); return false; }
    if (!res.data) return false;
    setDetail(res.data);
    if (res.data.manualSearch) seedManualSearch(sel.notebookId, res.data.manualSearch);
    return true;
  }), [detailGate, detailLoads]);
  useEffect(() => {
    if (selection) void loadDetail(selection);
  }, [selection, loadDetail]);
  useEffect(() => () => { detailGate.invalidate(); detailAbortRef.current?.abort(); }, [detailGate]);
  const select = useCallback((sel: HubSelection) => {
    abortRef.current?.abort();
    uploadAbortRef.current?.abort();
    detailGate.invalidate();
    detailAbortRef.current?.abort();
    setDetail(null);
    setLive(null);
    setFailedBody(null);
    manualSearchDriverRef.current?.reset();
    setFollow(null);
    syncThread(sel);
    setSelection(sel);
    writeSearch(searchForSelection(sel));
  }, [syncThread, detailGate]);
  const [follow, setFollow] = useState<ManualSearchFollowState | null>(null);
  const manualSearchDriverRef = useRef<ManualSearchDriver | null>(null);
  if (!manualSearchDriverRef.current) {
    manualSearchDriverRef.current = createManualSearchDriver({
      fetchStatus: async (notebookId) => {
        const sel = selectionRef.current;
        if (!sel || sel.notebookId !== notebookId) return null;
        const res = await getJson<Detail>(`/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/${detailQueryFor(sel)}`);
        return res.data?.manualSearch ?? null;
      },
      onStateChange: setFollow,
      onRefreshSources: () => {
        const sel = selectionRef.current;
        if (sel && hostMountedRef.current) void loadDetail(sel);
      },
    });
  }
  useEffect(() => {
    hostMountedRef.current = true;
    return () => {
      hostMountedRef.current = false;
      manualSearchDriverRef.current?.reset();
    };
  }, []);
  const projects = useMemo(() => notebookProjects(notebooks ?? []), [notebooks]);
  const machines = useMemo(() => notebookMachines(notebooks ?? []), [notebooks]);
  const meta = useMemo(
    () => (detail && selection ? metaFor(detail.notebook, selection, null, capturedAt, detail.sources) : null),
    [detail, selection, capturedAt],
  );
  const docIds = useMemo(() => enabledDocIds(detail?.sources ?? []), [detail]);
  const citations = useMemo(
    () => citationIndex(detail?.turns ?? [], live?.result?.citations ?? live?.citations ?? [], live ? `${live.id}-a` : null),
    [detail, live],
  );
  const liveTurns = useMemo<InteractionTurn[]>(() => {
    if (!live || !meta) return [];
    const context = contextFor(meta);
    const threadId = shellThreadId(selection!);
    const q: InteractionTurn = {
      id: `${live.id}-q`, threadId, role: "user", parts: [{ type: "text", text: live.question }],
      lifecycle: "completed", context, createdAt: live.startedAt, updatedAt: live.startedAt,
    };
    const aId = `${live.id}-a`;
    let parts: InteractionPart[];
    let lifecycle: InteractionTurn["lifecycle"];
    if (live.result) {
      parts = partsFromStream(live.result, { stopped: live.stopped, turnId: aId, notebookDocIds: meta.notebookDocIds });
      lifecycle = lifecycleFromStream(live.result, { stopped: live.stopped });
    } else {
      parts = live.content ? [{ type: "text", text: live.content }] : [];
      lifecycle = live.stopped ? "stopped" : "running";
    }
    const a: InteractionTurn = {
      id: aId, threadId, role: "assistant", parts, lifecycle, context,
      createdAt: live.startedAt, updatedAt: new Date().toISOString(),
    };
    return [q, a];
  }, [live, meta, selection]);
  const view = useMemo<ShellState>(() => {
    if (!detail || !meta || !selection) {
      const openId = selection ? shellThreadId(selection) : HOME_THREAD;
      const turns = withOutgoing([], { turns: [], outgoingId: null }, outgoing, openId, EMPTY_FIXTURE.thread.id, state.activeContext);
      const thread = turns.length ? { ...EMPTY_FIXTURE.thread, turns } : EMPTY_FIXTURE.thread;
      return notebooks ? shellReducer(state, { type: "hydrate", data: { thread, projects, machines } }) : state;
    }
    const base = fixtureFor(detail.notebook, selection, detail.turns, meta, projects, machines);
    const settled =
      settledFollowups && settledFollowups.notebookId === selection.notebookId && settledFollowups.threadId === selection.threadId
        ? settledFollowups
        : null;
    const turns = withManualSearchStatus(
      withSettledFollowups(
        withOutgoing(threadFromPersisted(detail.turns, meta).turns, { turns: liveTurns, outgoingId: live?.outgoingId ?? null }, outgoing, shellThreadId(selection), shellThreadId(selection), contextFor(meta)),
        settled,
      ),
      follow?.status ?? detail.manualSearch ?? null,
    );
    const thread = { ...base.thread, turns };
    return shellReducer(state, { type: "hydrate", data: { thread, projects, machines, activeContext: base.activeContext } });
  }, [state, detail, meta, selection, projects, machines, liveTurns, live, notebooks, follow, outgoing, settledFollowups]);
  const outgoingOwner = useMemo(() => createOutgoingOwner((id) => adapter.release?.(id), setOutgoing), [adapter]);
  useEffect(() => () => outgoingOwner.dispose(), [outgoingOwner]);
  const putOutgoing = outgoingOwner.put;
  const dropOutgoing = outgoingOwner.drop;
  const send = useCallback(async (body: ReturnType<typeof chatBodyFor>, question: string, sel: HubSelection | null = selection) => {
    if (!sel) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = `live-${Date.now()}`;
    const outgoingId = outgoingOwner.current?.id ?? null;
    setFailedBody(null);
    setSettledFollowups(null);
    const answeredBefore = (detailRef.current?.turns ?? []).map((row) => answerTurnId(row.id));
    dispatch({ type: "set-send-error", error: null });
    setLive({ id, question, content: "", citations: [], result: null, stopped: false, startedAt: new Date().toISOString(), outgoingId });
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/chat/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (res.status === 401) { setSignedOut(true); return; }
      if (!res.ok || !res.body) {
        let code = "";
        try { code = String(((await res.json()) as { error?: unknown }).error ?? ""); } catch { /* no JSON body */ }
        throw new Error(errorMessageFor(code, res.status));
      }
      const result = await readNotebookStream(res.body.getReader(), (content, cits) => {
        setLive((cur) => (cur && cur.id === id ? { ...cur, content, citations: cits } : cur));
      });
      setLive((cur) => (cur && cur.id === id ? { ...cur, result } : cur));
      await loadDetail(sel);
      await loadNotebooks();
      const finished = partsFromStream(result, { turnId: `${id}-a` }).find((p) => p.type === "followups");
      setSettledFollowups(
        finished?.type === "followups"
          ? { notebookId: sel.notebookId, threadId: sel.threadId, question: body.message, suggestions: finished.suggestions, answeredBefore }
          : null,
      );
      setLive((cur) => (cur && cur.id === id ? null : cur));
      dropOutgoing(outgoingId);
      const draft = draftAfterSendSucceeded(draftRef.current, question);
      if (draft !== null) dispatch({ type: "set-draft", draft });
    } catch (err) {
      const retained = retainedStreamInterruption(err);
      if (retained) {
        setLive((cur) =>
          cur && cur.id === id
            ? { ...cur, content: retained.result.content, stopped: retained.stopped, result: retained.result }
            : cur,
        );
        if (!retained.stopped) {
          const message = sendFailureMessage(err);
          setFailedBody({ body, question });
          dispatch({ type: "set-send-error", error: message });
        }
        return;
      }
      const message = sendFailureMessage(err);
      setLive((cur) => (cur && cur.id === id ? null : cur));
      dropOutgoing(outgoingId);
      setFailedBody({ body, question });
      dispatch({ type: "set-send-error", error: message });
      dispatch({ type: "set-draft", draft: question });
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setBusy(false); }
    }
  }, [selection, loadDetail, loadNotebooks, dropOutgoing, outgoingOwner]);
  const composeAndSend = useCallback(async (
    text: string,
    files: readonly HeldFile[],
    sel: HubSelection,
    nodeId: string,
    fallbackScope: readonly string[],
    history: ReturnType<typeof historyRows>,
    existing?: AbortController,
  ) => {
    setBusy(true);
    dispatch({ type: "set-send-error", error: null });
    const ctrl = existing ?? new AbortController();
    if (!existing) {
      uploadAbortRef.current?.abort();
      uploadAbortRef.current = ctrl;
    }
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
          await send(chatBodyFor(composed.question, composed.scope ?? fallbackScope, history, sel, rider), composed.question, sel);
        },
      });
    } catch {
      outcome = { question: text, failure: "The attachment didn't upload — check the connection." };
    } finally {
      for (const f of files) adapter.forget(f.attachment.id);
      if (uploadAbortRef.current === ctrl) uploadAbortRef.current = null;
    }
    if (outcome === "sent") return;
    setBusy(false);
    dropOutgoing();
    if (outcome === "cancelled") {
      if (selectionRef.current?.notebookId === sel.notebookId && selectionRef.current?.threadId === sel.threadId) {
        dispatch({ type: "set-draft", draft: text });
      }
      return;
    }
    dispatch({
      type: "set-send-error",
      error: outcome.reattach === false ? outcome.failure! : `${outcome.failure} Attach it again, then send.`,
    });
    dispatch({ type: "set-draft", draft: text });
  }, [adapter, send, dropOutgoing]);
  const createNotebook = useCallback(async (body: { displayName: string; identitySourceType?: "user" }): Promise<string | null> => {
    const res = await fetch(`${API_BASE}/api/equipment-notebooks/`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.status === 401) { setSignedOut(true); return null; }
    if (!res.ok) throw new Error(errorMessageFor("", res.status));
    const created = (await res.json()) as { notebook?: { id?: string } };
    const id = created.notebook?.id ?? null;
    await loadNotebooks();
    return id;
  }, [loadNotebooks]);
  const sendFromHome = useCallback(async (plan: Exclude<ReturnType<typeof homeSendPlan>, { kind: "loading" }>, q: string, files: readonly HeldFile[] = []) => {
    let notebookId: string | null = plan.kind === "existing" ? plan.notebookId : null;
    if (plan.kind === "create") {
      setBusy(true);
      try { notebookId = await createNotebook(plan.body); }
      catch (err) { dropOutgoing(); dispatch({ type: "set-send-error", error: sendFailureMessage(err) }); dispatch({ type: "set-draft", draft: q }); return; }
      finally { setBusy(false); }
    }
    if (!notebookId) { dropOutgoing(); dispatch({ type: "set-draft", draft: q }); return; }
    const sel: HubSelection = { notebookId, threadId: newThreadId() };
    select(sel);
    const home = outgoingOwner.current;
    if (home && home.threadId === HOME_THREAD) putOutgoing({ ...home, threadId: shellThreadId(sel) });
    if (files.length === 0) {
      await send(chatBodyFor(q, [], [], sel), q, sel);
      return;
    }
    const ctrl = new AbortController();
    uploadAbortRef.current = ctrl;
    setBusy(true);
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
    const files = pairAttachments(attachments, (id) => adapter.heldFile(id));
    if ((!q && files.length === 0) || busy) return;
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
    beginOutgoing(shellThreadId(selection));
    if (files.length > 0) {
      void composeAndSend(q, files, selection, detail.notebook.nodeId, docIds, historyRows(detail.turns));
      return;
    }
    void send(chatBodyFor(q, docIds, historyRows(detail.turns), selection), q);
  }, [adapter, busy, selection, notebooks, detail, docIds, send, sendFromHome, composeAndSend, putOutgoing]);
  const onGuidedDeadEnd = useCallback((question: string, sessionId: string) => {
    const q = question.trim();
    if (!q || busy || !selection || !detail) return;
    putOutgoing({ id: `out-${Date.now()}`, threadId: shellThreadId(selection), question: q, attachments: [], startedAt: new Date().toISOString() });
    void send(guidedDeadEndBody(q, sessionId, historyRows(detail.turns), selection), q);
  }, [busy, selection, detail, send, putOutgoing]);
  const onStop = useCallback(() => { abortRef.current?.abort(); uploadAbortRef.current?.abort(); }, []);
  const onRetry = useCallback(() => { if (failedBody) void send(failedBody.body, failedBody.question); }, [failedBody, send]);
  const onNewChat = useCallback(() => {
    if (selection) select({ notebookId: selection.notebookId, threadId: newThreadId() });
  }, [selection, select]);
  const onCreateProject = useCallback(() => {
    const name = window.prompt("Name this machine or project (e.g. Conveyor 4)")?.trim();
    if (!name) return;
    void (async () => {
      try {
        const id = await createNotebook({ displayName: name, identitySourceType: "user" });
        if (id) select({ notebookId: id, threadId: newThreadId() });
      } catch (err) {
        dispatch({ type: "set-send-error", error: err instanceof Error ? err.message : String(err) });
      }
    })();
  }, [createNotebook, select]);
  const onOpenItem = useCallback((item: ProjectItem) => {
    const ref = threadRefFromItem(item.id);
    if (ref) select(ref);
  }, [select]);
  const onSelectProject = useCallback((projectId: string) => {
    const notebookId = notebookIdFromProject(projectId);
    if (!notebookId) return;
    const nb = notebooks?.find((n) => n.id === notebookId);
    if (nb) select(openNotebookSelection(nb));
  }, [notebooks, select]);
  const openSource = useCallback((sourceId: string) => {
    dispatch({ type: "hydrate", data: { thread: view.thread, projects: view.projects, machines: view.machines, activeContext: view.activeContext } });
    dispatch({ type: "select-source", sourceId });
  }, [view]);
  const renderText = useCallback((text: string, turn: InteractionTurn): ReactNode => {
    if (turn.role === "user") return text;
    const own: EvidenceCitation[] = [];
    for (const part of turn.parts) {
      if (part.type !== "source") continue;
      const c = citations.get(part.source.id);
      if (c) own.push(c);
    }
    return <AnswerMarkdown content={text} citations={own} onCite={(c) => openSource(sourceIdFor(turn.id, c.citationId))} />;
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
  const readAloud = useMemo(() => createReadAloud(), []);
  const fixRequestIds = useMemo(() => createFixRequestIds(), []);
  useEffect(() => () => readAloud?.stop(), [readAloud]);
  useEffect(() => {
    readAloud?.scope(`${selection?.notebookId ?? ""}:${selection?.threadId ?? ""}`);
  }, [readAloud, selection?.notebookId, selection?.threadId]);
  const onReadAloud = useCallback((turnId: string) => {
    const turn = view.thread.turns.find((t) => t.id === turnId);
    if (!turn) return;
    const ids = new Set<string>();
    for (const part of turn.parts) {
      const c = part.type === "source" ? citations.get(part.source.id) : undefined;
      if (c) ids.add(c.citationId);
    }
    readAloud?.toggle(turnId, spokenAnswerText(turn, ids));
  }, [readAloud, view.thread.turns, citations]);
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
    if (res.status === 409 && data?.error === "identity_already_confirmed") {
      const mfr = typeof data.manufacturer === "string" && data.manufacturer ? data.manufacturer : null;
      const mdl = typeof data.model === "string" && data.model ? data.model : null;
      throw new IdentityAlreadyConfirmedError(mfr && mdl ? `This machine is already confirmed as ${mfr} ${mdl}.` : undefined);
    }
    if (!res.ok || !data || data.ok !== true) throw new Error("could not confirm identity");
    const searching = data.searching === true;
    const startedAt = typeof data.startedAt === "string" && data.startedAt ? data.startedAt : undefined;
    const refresh = await applyConfirmIdentityResult(
      notebookId,
      proposal,
      { searching, ...(startedAt ? { startedAt } : {}) },
      {
        loadDetail,
        seedDriver: seedManualSearch,
        currentSelection: () => (hostMountedRef.current ? selectionRef.current : null),
      },
    );
    if (refresh === "failed" && data.manualReady === true) {
      return {
        manualReady: false,
        searching: false,
        message: "Machine confirmed, but its manual couldn't be loaded. Reload this notebook before asking about it.",
      };
    }
    return {
      manualReady: data.manualReady === true,
      searching,
      ...(startedAt ? { startedAt } : {}),
      ...(typeof data.message === "string" && data.message ? { message: data.message } : {}),
    };
  }, [loadDetail]);
  const onRecordFix = useCallback(async (turnId: string) => {
    const notebookId = selectionRef.current?.notebookId;
    const symptom = fixSymptomFor(view.thread.turns, turnId);
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
        fixRequestIds.settle(turnId, fix);
        window.alert("Saved. MIRA will use this fix on this machine next time.");
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
  const onKeepPhoto = useCallback(async (fileId: string) => {
    const sel = selectionRef.current;
    if (!sel?.notebookId) throw new Error("no_notebook");
    const url = `${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/photos/${encodeURIComponent(fileId)}/source/`;
    await keepPhotoWithReview(sel.threadId === "legacy" ? "legacy" : sel.threadId, {
      post: async (body) => {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify(body),
        });
        const parsed = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        const data = parsed && typeof parsed === "object" ? parsed : {};
        return {
          ok: res.ok,
          status: res.status,
          body: {
            ...(typeof data.error === "string" ? { error: data.error } : {}),
            ...(typeof data.reading === "string" ? { reading: data.reading } : {}),
            ...(typeof data.observationId === "string" ? { observationId: data.observationId } : {}),
            ...(typeof data.docId === "string" ? { docId: data.docId } : {}),
          },
        };
      },
      refresh: async () => (await loadDetail(sel)) === true,
      review: async (proposed) =>
        window.prompt("Check this reading against the photo. Edit any wrong tags before keeping.", proposed.reading),
    });
  }, [loadDetail]);
  const keptPhotoIds = useMemo(
    () => new Set((detail?.sources ?? []).map((s) => s.originFileId).filter((id): id is string => !!id)),
    [detail],
  );
  const hooks: HostHooks = {
    onSend,
    renderText,
    onCopy,
    ...(readAloud ? { onReadAloud } : {}),
    ...(selection?.notebookId
      ? { onRecordFix: (turnId: string) => void onRecordFix(turnId), canRecordFix: (turnId: string) => serverTurnIdFor(turnId) !== null }
      : {}),
    ...(selection?.notebookId ? { onConfirmIdentity: onConfirmIdentity } : {}),
    ...(selection?.notebookId ? { onKeepPhoto, isPhotoKept: (fileId: string) => keptPhotoIds.has(fileId) } : {}),
    onSource: (source) => openSource(source.id),
    onNewChat,
    onCreateProject,
    ...(busy ? { onStop } : {}),
    ...(failedBody ? { onRetry } : {}),
    groundingLine: () => groundingLineFor(detail?.notebook ?? null, docIds.length),
    busy,
  };
  if (signedOut) {
    return (
      <main style={{ padding: "var(--fl-space-8)", fontFamily: "var(--fl-font)" }}>
        <p>Sign in to ask MIRA.</p>
        <a href={`${API_BASE}/login`}><button type="button">Sign in</button></a>
      </main>
    );
  }
  return (
    <div className="hub-shell-host" data-testid="hub-shell">
      <FactoryLMShell
        state={view}
        dispatch={dispatch}
        adapter={adapter}
        hooks={hooks}
        conversationSurface="assistant"
        onOpenItem={onOpenItem}
        onSelectProject={onSelectProject}
      />
      {selection && detail && (
        <GuidedProcedure
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
    </div>
  );
}

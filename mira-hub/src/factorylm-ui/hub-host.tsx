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
  PROFILES,
  createShellState,
  shellReducer,
  type Attachment,
  type InteractionPart,
  type InteractionTurn,
  type ProjectItem,
  type ShellState,
} from "@factorylm/interaction";
import { FactoryLMShell, type HostHooks } from "@factorylm/ui";
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
import { composeHubSend, pairAttachments, resolveUploadNode, runAttachedSend, type HeldFile } from "./hub-attachments";
import { LEGACY_THREAD_ID, notebookMachines, notebookProjects, threadRefFromItem, notebookIdFromProject, type HubNotebook } from "./notebook-tree";
import { citationIndex, contextFor, lifecycleFromStream, partsFromStream, sourceIdFor, threadFromPersisted } from "./to-interaction";
import {
  NO_PROJECT_ERROR,
  chatBodyFor,
  detailQueryFor,
  enabledDocIds,
  errorMessageFor,
  fixtureFor,
  groundingLineFor,
  historyRows,
  homeSendPlan,
  initialSelection,
  landingSelection,
  latestRequestGate,
  metaFor,
  newThreadId,
  retainedStreamInterruption,
  searchForSelection,
  selectionFromSearch,
  shellThreadId,
  type CompatibleStreamResult,
  type HubSelection,
} from "./hub-host-logic";

type Detail = { notebook: EquipmentNotebook; sources: NotebookSource[]; turns: (PersistedTurn & { createdAt?: string })[] };

/** One in-flight or just-finished exchange the server has not yet returned as a row. */
type Live = {
  readonly id: string;
  readonly question: string;
  readonly content: string;
  readonly citations: EvidenceCitation[];
  readonly result: CompatibleStreamResult | null;
  readonly stopped: boolean;
  readonly startedAt: string;
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

const EMPTY_FIXTURE = {
  id: "hub-empty",
  title: "FactoryLM",
  review: { themes: ["light", "dark"] as const, viewports: ["desktop"] as const, surfaces: ["hub"] as const },
  thread: {
    id: "hub-empty:thread", tenantId: "tenant", notebookId: "", title: "FactoryLM", mode: "ask" as const,
    visibility: "workspace" as const, turns: [], createdAt: "1970-01-01T00:00:00.000Z", updatedAt: "1970-01-01T00:00:00.000Z",
  },
  projects: [],
  machines: [],
  activeContext: { tenantId: "tenant", machineIdentity: "not_applicable" as const, evidenceAuthorization: "not_applicable" as const, capturedAt: "1970-01-01T00:00:00.000Z" },
  offline: { state: "online" as const, pendingChanges: 0 },
};

export function HubShellHost() {
  // One capture timestamp per mount (state, not a ref: it is read during render).
  const [capturedAt] = useState(() => new Date().toISOString());
  const [signedOut, setSignedOut] = useState(false);
  const [notebooks, setNotebooks] = useState<HubNotebook[] | null>(null);
  const [selection, setSelection] = useState<HubSelection | null>(null);
  // Mirror for async callbacks that must know whether anything is open yet
  // without re-subscribing to the selection (the notebook list reloads after
  // every send).
  const selectionRef = useRef<HubSelection | null>(null);
  useEffect(() => { selectionRef.current = selection; }, [selection]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [failedBody, setFailedBody] = useState<{ body: ReturnType<typeof chatBodyFor>; question: string } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The upload half of an attached send (#4019 round 2 F2): Stop and thread
  // changes abort it too, so a slow upload can never post afterwards.
  const uploadAbortRef = useRef<AbortController | null>(null);
  // Detail loads are independent of the chat stream: their own abort handle and
  // a latest-request gate so a slow, superseded GET can never overwrite the
  // detail of the selection that replaced it (Codex #3839 F3).
  const detailAbortRef = useRef<AbortController | null>(null);
  const [detailGate] = useState(() => latestRequestGate());

  // The web adapter holds the picked bytes until onSend uploads them (#4019).
  const adapter = useMemo(() => createWebAdapter(browserAdapterDeps()), []);

  const [state, dispatch] = useReducer(shellReducer, undefined, () =>
    shellReducer(createShellState(EMPTY_FIXTURE, PROFILES.hub), { type: "set-navigation-visible", visible: true }),
  );

  /**
   * Tell the reducer WHICH thread is open, from event handlers (never effects).
   * The live turns are projected onto the state at render time via `hydrate`
   * (see `view`); that reducer case resets the draft whenever the thread id
   * differs from the one it holds, so the id must be kept in sync here or every
   * keystroke would be wiped by the next render.
   */
  const syncThread = useCallback((sel: HubSelection) => {
    const at = new Date().toISOString();
    dispatch({
      type: "hydrate",
      data: {
        thread: { ...EMPTY_FIXTURE.thread, id: shellThreadId(sel), notebookId: sel.notebookId, createdAt: at, updatedAt: at },
      },
    });
  }, []);

  // --- data: notebooks (projects/threads), then the selected notebook's detail ---
  const loadNotebooks = useCallback(async () => {
    const { status, data } = await getJson<{ notebooks: HubNotebook[] }>("/api/equipment-notebooks/");
    if (status === 401) { setSignedOut(true); return; }
    if (!data) return;
    setNotebooks(data.notebooks);
    // A deep link / reload names its conversation (#3922); otherwise HOME (L0).
    // Opening from the URL goes through the same two steps as a click: the
    // reducer is told the thread id FIRST (`syncThread`), or its hydrate case
    // would reset the draft on every render and the composer could not be
    // typed into (the e2e deep-link follow-up caught exactly that).
    if (!selectionRef.current) {
      const next = selectionFromSearch(readSearch(), data.notebooks) ?? landingSelection(data.notebooks);
      if (next) {
        syncThread(next);
        setSelection(next);
      }
    }
    return data.notebooks;
  }, [syncThread]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load (codebase precedent: (hub)/equipment/[id]/page.tsx)
    void loadNotebooks();
  }, [loadNotebooks]);

  const loadDetail = useCallback(async (sel: HubSelection) => {
    const token = detailGate.begin();
    detailAbortRef.current?.abort();
    const ctrl = new AbortController();
    detailAbortRef.current = ctrl;
    let res: { status: number; data: Detail | null };
    try {
      // Always names the thread (legacy included) — an omitted threadId returns EVERY thread's turns.
      res = await getJson<Detail>(`/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/${detailQueryFor(sel)}`, ctrl.signal);
    } catch (err) {
      if (isAbortError(err)) return; // superseded by a newer selection
      throw err;
    }
    // Commit only if no newer load or selection change happened while this one was in flight.
    if (!detailGate.isCurrent(token)) return;
    if (res.status === 401) { setSignedOut(true); return; }
    if (!res.data) return;
    setDetail(res.data);
  }, [detailGate]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data load (codebase precedent: (hub)/equipment/[id]/page.tsx)
    if (selection) void loadDetail(selection);
  }, [selection, loadDetail]);
  useEffect(() => () => { detailGate.invalidate(); detailAbortRef.current?.abort(); }, [detailGate]);

  /** Change what is open: abort any stream and any in-flight detail load, drop the previous notebook's data. */
  const select = useCallback((sel: HubSelection) => {
    abortRef.current?.abort();
    uploadAbortRef.current?.abort();
    detailGate.invalidate();
    detailAbortRef.current?.abort();
    setDetail(null);
    setLive(null);
    setFailedBody(null);
    syncThread(sel);
    setSelection(sel);
    writeSearch(searchForSelection(sel));
  }, [syncThread, detailGate]);

  // --- derived shell inputs ---
  const projects = useMemo(() => notebookProjects(notebooks ?? []), [notebooks]);
  const machines = useMemo(() => notebookMachines(notebooks ?? []), [notebooks]);
  const meta = useMemo(
    () => (detail && selection ? metaFor(detail.notebook, selection, null, capturedAt) : null),
    [detail, selection, capturedAt],
  );
  const docIds = useMemo(() => enabledDocIds(detail?.sources ?? []), [detail]);
  // Turn-scoped keys (Codex #3839 F1): every answer numbers its citations from
  // "[1]", so the index is keyed by (assistant turn id, citation number).
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
      parts = partsFromStream(live.result, { stopped: live.stopped, turnId: aId });
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

  // Live data is a pure projection over the UI state: the reducer's `hydrate`
  // replaces thread/projects/machines/context and keeps drawer, draft, mode and
  // the open source. Applying it in render (not an effect) means no cascading
  // re-render and no moment where the shell shows stale turns.
  const view = useMemo<ShellState>(() => {
    if (!detail || !meta || !selection) {
      return notebooks ? shellReducer(state, { type: "hydrate", data: { thread: EMPTY_FIXTURE.thread, projects, machines } }) : state;
    }
    const base = fixtureFor(detail.notebook, selection, detail.turns, meta, projects, machines);
    const thread = { ...base.thread, turns: [...threadFromPersisted(detail.turns, meta).turns, ...liveTurns] };
    return shellReducer(state, { type: "hydrate", data: { thread, projects, machines, activeContext: base.activeContext } });
  }, [state, detail, meta, selection, projects, machines, liveTurns, notebooks]);

  // --- the send path: the canonical notebook-chat route, streamed ---
  const send = useCallback(async (body: ReturnType<typeof chatBodyFor>, question: string, sel: HubSelection | null = selection) => {
    if (!sel) return;
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const id = `live-${Date.now()}`;
    setFailedBody(null);
    dispatch({ type: "set-send-error", error: null });
    setLive({ id, question, content: "", citations: [], result: null, stopped: false, startedAt: new Date().toISOString() });
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/equipment-notebooks/${encodeURIComponent(sel.notebookId)}/chat/`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal,
      });
      if (res.status === 401) { setSignedOut(true); return; }
      if (!res.ok || !res.body) {
        // The route's own error codes, in plain language; never a bare status code.
        let code = "";
        try { code = String(((await res.json()) as { error?: unknown }).error ?? ""); } catch { /* no JSON body */ }
        throw new Error(errorMessageFor(code, res.status));
      }
      const result = await readNotebookStream(res.body.getReader(), (content, cits) => {
        setLive((cur) => (cur && cur.id === id ? { ...cur, content, citations: cits } : cur));
      });
      setLive((cur) => (cur && cur.id === id ? { ...cur, result } : cur));
      // The server row is the source of truth; refresh it (also picks up a
      // thread created by this first turn) and let the live turn go.
      await loadDetail(sel);
      await loadNotebooks();
      setLive((cur) => (cur && cur.id === id ? null : cur));
    } catch (err) {
      const retained = retainedStreamInterruption(err);
      if (retained) {
        setLive((cur) =>
          cur && cur.id === id
            ? { ...cur, content: retained.result.content, stopped: retained.stopped, result: retained.result }
            : cur,
        );
        if (!retained.stopped) {
          const message = err instanceof Error ? err.message : String(err);
          setFailedBody({ body, question });
          dispatch({ type: "set-send-error", error: message });
        }
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      setLive((cur) => (cur && cur.id === id ? null : cur));
      setFailedBody({ body, question });
      dispatch({ type: "set-send-error", error: message });
      dispatch({ type: "set-draft", draft: question });
    } finally {
      if (abortRef.current === ctrl) { abortRef.current = null; setBusy(false); }
    }
  }, [selection, loadDetail, loadNotebooks]);

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
  ) => {
    setBusy(true);
    dispatch({ type: "set-send-error", error: null });
    uploadAbortRef.current?.abort();
    const ctrl = new AbortController();
    uploadAbortRef.current = ctrl;
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
    // Stopped or navigated away: nothing was posted; the question goes back
    // only if the technician is still on the thread it was typed in.
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
  }, [adapter, send]);

  /** Create a project through the same contract as the legacy "New notebook" button. */
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
      catch (err) { dispatch({ type: "set-send-error", error: err instanceof Error ? err.message : String(err) }); dispatch({ type: "set-draft", draft: q }); return; }
      finally { setBusy(false); }
    }
    // No id means the create was refused (401 → signed-out screen) — hand the
    // technician their question back rather than dropping it.
    if (!notebookId) { dispatch({ type: "set-draft", draft: q }); return; }
    const sel: HubSelection = { notebookId, threadId: newThreadId() };
    select(sel);
    if (files.length === 0) {
      await send(chatBodyFor(q, [], [], sel), q, sel);
      return;
    }
    // The upload door needs the notebook's own namespace node (every notebook
    // has one); a HOME send knows only the id, so read it first.
    const target = await resolveUploadNode(() =>
      getJson<Detail>(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/${detailQueryFor(sel)}`),
    );
    if (target.kind === "signed_out") { setSignedOut(true); return; }
    if (target.kind === "failed") {
      // Codex #4024 F4: the Composer already cleared the draft — hand it back.
      for (const f of files) adapter.forget(f.attachment.id);
      dispatch({ type: "set-send-error", error: "Couldn't open the project to upload into. Attach the file again, then send." });
      dispatch({ type: "set-draft", draft: q });
      return;
    }
    await composeAndSend(q, files, sel, target.nodeId, [], []);
  }, [adapter, createNotebook, select, send, composeAndSend]);

  const onSend = useCallback((text: string, attachments: readonly Attachment[] = []) => {
    const q = text.trim();
    // #4019: pair each chip with the bytes the adapter held for it. Throws
    // (Composer keeps the draft AND the chips) on a missing file or a second
    // photo, before anything uploads (Codex #4024 F1/F3).
    const files = pairAttachments(attachments, (id) => adapter.heldFile(id));
    if ((!q && files.length === 0) || busy) return;
    // Codex #3839 Spec P1: the Composer clears the draft after a hook that
    // RETURNS, so a send before the data loaded used to discard the
    // technician's question. Throwing is the Composer's documented contract
    // for "keep the draft, show this plain-language error". On HOME that is
    // the guard against creating a duplicate "General" before the list is
    // known (#3875 F2); inside a notebook, against sending before its detail.
    if (!selection) {
      const plan = homeSendPlan(notebooks);
      if (plan.kind === "loading") throw new Error(NO_PROJECT_ERROR);
      void sendFromHome(plan, q, files);
      return;
    }
    if (!detail) throw new Error(NO_PROJECT_ERROR);
    if (files.length > 0) {
      void composeAndSend(q, files, selection, detail.notebook.nodeId, docIds, historyRows(detail.turns));
      return;
    }
    void send(chatBodyFor(q, docIds, historyRows(detail.turns), selection), q);
  }, [adapter, busy, selection, notebooks, detail, docIds, send, sendFromHome, composeAndSend]);

  const onStop = useCallback(() => { abortRef.current?.abort(); uploadAbortRef.current?.abort(); }, []);
  const onRetry = useCallback(() => { if (failedBody) void send(failedBody.body, failedBody.question); }, [failedBody, send]);

  /** New chat: a fresh thread in the open notebook; from HOME, HOME is already the blank chat. */
  const onNewChat = useCallback(() => {
    if (selection) select({ notebookId: selection.notebookId, threadId: newThreadId() });
  }, [selection, select]);

  /** New project: the legacy button's exact flow (prompt for a name, POST, open it). */
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
    const sel = nb ? initialSelection([nb]) : null;
    if (sel) select(sel);
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
    if (turn.role === "user") return text;
    const own: EvidenceCitation[] = [];
    for (const part of turn.parts) {
      if (part.type !== "source") continue;
      const c = citations.get(part.source.id);
      if (c) own.push(c);
    }
    // The marker the reader clicks is this turn's "[n]"; the shell source it opens is this turn's.
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

  const hooks: HostHooks = {
    onSend,
    renderText,
    onCopy,
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
    </div>
  );
}

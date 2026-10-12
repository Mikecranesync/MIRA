/**
 * Unified root (FLM-UI-4000 Phase 2, mobile): the shared FactoryLM shell owns
 * the whole app. Its drawer is the navigation (every notebook, every bound
 * machine), its header is the header, the conversation is the notebook's real
 * conversation, and the footer carries the host-owned controls (About &
 * updates, sign out). This is the only authenticated experience — there is no
 * classic switch. NotebookScreen keeps owning the send path, scope, riders,
 * uploads, and the citation viewer — it just renders chromeless.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ProjectItem } from "@factorylm/interaction";
import { createNotebook, listNotebooks, type Me, type Notebook } from "../api/resources";
import { homeSendPlan } from "../unified/home-send";
import { claimAttachments, clearAttachments, stashAttachments, type HeldAttachment } from "../unified/attachment-handoff";
import { defaultQuestionFor } from "../unified/attachments";
import { hasActiveApiMutations } from "../api/client";
import {
  hasActiveWorkOrderQueueProducers,
  pendingCount,
  preferencesStore,
  withSessionLocalProducer,
} from "../lib/offline-queue";
import { apiErrorCopy } from "../lib/api-error-copy";
import { getAssetByTag, openAssetNotebook } from "../api/resources";
import { resolveScan } from "../lib/scan-landing";
import {
  LEGACY_THREAD_ID,
  notebookIdFromProject,
  projectIdForNotebook,
  sourcesRefFromItem,
  notebookMachines,
  notebookProjects,
  threadItemId,
  threadRefFromItem,
} from "../unified/notebook-tree";
import { NotebookScreen } from "./NotebookScreen";
import type { UnifiedShellHost } from "./UnifiedChat";
import { UnifiedChat } from "./UnifiedChat";
import { UnifiedAboutUpdates } from "../unified/UnifiedAboutUpdates";
import { UnifiedCreateProject } from "../unified/UnifiedCreateProject";
import { UnifiedProjectRoot } from "../unified/UnifiedProjectRoot";

const LAST_NOTEBOOK_KEY = "flm.unified.notebook.v1";
const LAST_THREAD_KEY = (notebookId: string) => `flm.unified.thread.v1.${notebookId}`;

function createThreadId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `thrd_${raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 48)}`;
}

function latestThreadId(notebook: Notebook | undefined): string {
  return notebook?.threads?.[0]?.id ?? LEGACY_THREAD_ID;
}

/** A deep link as the native layer delivers it: the extracted asset tag (null
 * when the URL carried none) plus the raw URL for honest error copy. */
export interface UnifiedDeepLink {
  readonly tag: string | null;
  readonly raw: string;
}

export interface UnifiedRootProps {
  readonly me: Me;
  readonly backRef: MutableRefObject<(() => boolean) | null>;
  readonly onSignOut: () => Promise<void> | void;
  readonly deepLink?: UnifiedDeepLink | null;
  readonly onDeepLinkConsumed?: () => void;
}

export function UnifiedRoot({ me, backRef, onSignOut, deepLink, onDeepLinkConsumed }: UnifiedRootProps) {
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deepLinkNotice, setDeepLinkNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  // Every chat started this session, per notebook (newest first). The server
  // list is a boot-time snapshot, so these would otherwise vanish from the
  // drawer and the project root as soon as another thread is opened (#4188).
  const [localThreads, setLocalThreads] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [homeVisible, setHomeVisible] = useState(true);
  // #4188: where hardware BACK out of a notebook's chat thread lands — that
  // project's recent-threads list — rather than falling straight through to
  // `homeVisible`'s empty global composer. Mutually exclusive with
  // `homeVisible`; every funnel that opens a thread (`open`, `startNewThread`)
  // clears this the same way it already clears `homeVisible`.
  const [projectRootVisible, setProjectRootVisible] = useState(false);
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null);
  // A HOME send that could not create General is a failed SEND, not a dead
  // app (Codex #4350 F1): the composer stays, the banner says why, the
  // question comes back, and Try again re-attempts. Mirrors the Hub host's
  // recoverable shell send error.
  const [homeSendError, setHomeSendError] = useState<string | null>(null);
  const [homeFailedQuestion, setHomeFailedQuestion] = useState<string | null>(null);
  const homeFailedQuestionRef = useRef<string | null>(null);
  homeFailedQuestionRef.current = homeFailedQuestion;
  // What a failed HOME send had attached. Taken OUT of the handoff slot on
  // failure so no later thread can claim it unseen; it rides only a retry of
  // that same submission, and anything else discards it (Codex #4350 r2 F1).
  const failedHomeAttachments = useRef<readonly HeldAttachment[]>([]);
  const [queuedOpenAddSources, setQueuedOpenAddSources] = useState(false);
  const [queuedSensorStart, setQueuedSensorStart] = useState<"read-scan" | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [list, last] = await Promise.all([listNotebooks(), preferencesStore.get(LAST_NOTEBOOK_KEY)]);
        if (!live) return;
        setNotebooks(list);
        const preferred = last && list.some((nb) => nb.id === last) ? last : (list[0]?.id ?? null);
        setSelected(preferred);
        const notebook = list.find((nb) => nb.id === preferred);
        const lastThread = preferred ? await preferencesStore.get(LAST_THREAD_KEY(preferred)) : null;
        setSelectedThreadId(lastThread && notebook?.threads?.some((thread) => thread.id === lastThread) ? lastThread : latestThreadId(notebook));
        setHomeVisible(true);
      } catch (e) {
        if (live) setError(apiErrorCopy(e, "Could not load notebooks."));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const open = useCallback((id: string, threadId?: string | null) => {
    const notebook = notebooks?.find((nb) => nb.id === id);
    // #3851: opening the project the boot restore already pointed at must
    // resume the thread the technician was last reading, not the newest one —
    // and must not overwrite the persisted pointer with the newest id (that is
    // what made "resume on the wrong thread" permanent). An explicit threadId
    // (a thread row, a deep link) still wins; another project opens on its
    // latest thread as before.
    const restored =
      id === selected && selectedThreadId && notebook?.threads?.some((thread) => thread.id === selectedThreadId)
        ? selectedThreadId
        : null;
    const activeThread = threadId ?? restored ?? latestThreadId(notebook);
    setSelected(id);
    setSelectedThreadId(activeThread);
    setQueuedOpenAddSources(false);
    setHomeVisible(false);
    setProjectRootVisible(false);
    void withSessionLocalProducer(async () => {
      await preferencesStore.set(LAST_NOTEBOOK_KEY, id);
      await preferencesStore.set(LAST_THREAD_KEY(id), activeThread);
    });
  }, [notebooks, selected, selectedThreadId]);

  // A deep link resolves through the SAME decision the QR scanner uses
  // (resolveScan): tag → asset → that machine's notebook, opened in place.
  // Failures surface as a dismissible notice — never a dead screen, and never
  // a route into a retired surface.
  useEffect(() => {
    if (!deepLink || !notebooks) return;
    let live = true;
    void (async () => {
      try {
        if (!deepLink.tag) {
          if (live) setDeepLinkNotice(`Unrecognized link: ${deepLink.raw}`);
          return;
        }
        // Keep the notebook openAssetNotebook returns: it may be brand new and
        // absent from the list until the refresh below lands (or fails), and
        // without it there is no project to return to on BACK (#4188).
        const captured: { notebook: Notebook | null } = { notebook: null };
        const outcome = await resolveScan(
          deepLink.tag,
          {
            getAssetByTag,
            openAssetNotebook: async (...args: Parameters<typeof openAssetNotebook>) => {
              captured.notebook = await openAssetNotebook(...args);
              return captured.notebook;
            },
          },
          "qr",
        );
        if (!live) return;
        if (outcome.kind === "notebook") {
          setDeepLinkNotice(null);
          const opened = captured.notebook;
          const withOpened = (list: Notebook[]): Notebook[] =>
            opened && !list.some((nb) => nb.id === opened.id) ? [opened, ...list] : list;
          if (opened) setNotebooks((current) => withOpened(current ?? []));
          // open() reads the list from this render, which does not contain a
          // just-added notebook yet, so it would fall back to the legacy thread.
          // Name the opened notebook's latest thread explicitly in that case
          // only; a notebook already listed keeps open()'s own resume rules.
          const listedAlready = notebooks?.some((nb) => nb.id === outcome.notebookId) ?? false;
          open(outcome.notebookId, opened && !listedAlready ? latestThreadId(opened) : undefined);
          // The notebook may be new (openAssetNotebook can create it); refresh
          // the drawer so it lists what the technician is now inside. A refresh
          // that lags the create must not drop the notebook just opened.
          try {
            const list = await listNotebooks();
            if (live) setNotebooks(withOpened(list));
          } catch {
            // The conversation is already open; a stale drawer is tolerable.
          }
        } else if (outcome.kind === "notfound") {
          setDeepLinkNotice(`No machine found for tag ${deepLink.tag}.`);
        } else {
          setDeepLinkNotice(outcome.message);
        }
      } finally {
        if (live) onDeepLinkConsumed?.();
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLink, notebooks === null]);

  const preferredNotebookId = useCallback((): string | null => {
    if (!notebooks || notebooks.length === 0) return null;
    return selected && notebooks.some((nb) => nb.id === selected) ? selected : notebooks[0]?.id ?? null;
  }, [notebooks, selected]);

  const startNewThread = useCallback((notebookId?: string | null): string | null => {
    const id = notebookId ?? preferredNotebookId();
    if (!id) return null;
    const threadId = createThreadId();
    setSelected(id);
    setSelectedThreadId(threadId);
    setLocalThreads((current) => ({ ...current, [id]: [threadId, ...(current[id] ?? [])] }));
    setQueuedOpenAddSources(false);
    setHomeVisible(false);
    setProjectRootVisible(false);
    void withSessionLocalProducer(async () => {
      await preferencesStore.set(LAST_NOTEBOOK_KEY, id);
      await preferencesStore.set(LAST_THREAD_KEY(id), threadId);
    });
    return id;
  }, [preferredNotebookId]);

  // One HOME send at a time (Codex #4350 r3 F5). While General is being
  // created the shell's Send is disabled through `busy`, and a submit that
  // still slips through is dropped rather than starting a second create.
  const homeSendInFlight = useRef(false);
  const [homeSending, setHomeSending] = useState(false);
  // "Still on the home composer" for the fences below: HOME is also left by
  // opening the New-project form or About, which do not clear `homeVisible`
  // (Codex #4350 r7 F10).
  const onHomeRef = useRef(true);
  onHomeRef.current = homeVisible && !showCreateProject && !showAbout;

  /**
   * A HOME send (`text`, possibly empty for an attachment-only send) or New
   * chat (`null`) (#3877): it goes to an UNBOUND notebook — General first —
   * never the last-opened machine notebook, and creates General when there is
   * none, so a stranger with no project can still ask.
   *
   * The send's evidence is held HERE until the thread that claims it is the
   * very next thing to mount; it reaches the single handoff slot only at that
   * moment, so no other thread opened meanwhile can claim it. On a failed
   * create the error and the question land in one render, so the shell
   * restores the draft under its banner.
   */
  const sendFromHome = useCallback((text: string | null, opts: { readonly retry: boolean } = { retry: false }) => {
    // The shell stashed THIS send's attachments just before calling here.
    // Claim them before anything else: a send that slips past the disabled
    // button while a create is in flight is dropped WITH its bytes, so they
    // never sit in the slot for an unrelated thread to claim (r4 F5).
    const fresh = claimAttachments();
    if (homeSendInFlight.current) return;
    setHomeSendError(null);
    setHomeFailedQuestion(null);
    const kept = failedHomeAttachments.current;
    failedHomeAttachments.current = [];
    // Only a retry of the failed submission — the banner still showing, same
    // text, nothing attached anew — carries what it had; a replaced question,
    // a send after Dismiss, or New chat drops it (r8 F11).
    const retrying = opts.retry && fresh.length === 0 && text !== null && text === homeFailedQuestionRef.current;
    const carry = retrying ? kept : fresh;
    const handoff = (id: string) => {
      stashAttachments(carry);
      startNewThread(id);
      // An empty text is still a submission when evidence was attached: the
      // thread's composition path asks its default question (r2 F3).
      if (text !== null) setQueuedQuestion(text);
    };
    const plan = homeSendPlan(notebooks);
    if (plan.kind === "loading") return;
    if (plan.kind === "existing") {
      handoff(plan.notebookId);
      return;
    }
    homeSendInFlight.current = true;
    setHomeSending(true);
    void createNotebook(plan.body)
      .then(
        (created) => {
          setNotebooks((current) => (current?.some((nb) => nb.id === created.id) ? current : [created, ...(current ?? [])]));
          // The technician opened something else while this was in flight:
          // the send is abandoned, never a hijack of where they went.
          if (!onHomeRef.current) return;
          handoff(created.id);
        },
        (e: unknown) => {
          if (!onHomeRef.current) return;
          // Never the root's fatal error: that unmounts the composer with the
          // question in it and leaves nothing on screen that can recover.
          failedHomeAttachments.current = carry;
          // An attachment-only send has no text to put back; restore the
          // question the thread would have asked, so Try again can (r3 F4).
          const restored = text === "" && carry.length > 0 ? defaultQuestionFor(carry) : text;
          setHomeFailedQuestion(restored);
          setHomeSendError(
            apiErrorCopy(e, "Could not create a project for your question.") +
              (carry.length > 0 ? " Your attachment is kept for Try again; changing the question drops it." : ""),
          );
        },
      )
      .finally(() => {
        homeSendInFlight.current = false;
        setHomeSending(false);
      });
  }, [notebooks, startNewThread]);

  const openPreferredNotebook = useCallback((): string | null => {
    const id = preferredNotebookId();
    if (!id) return null;
    open(id);
    return id;
  }, [open, preferredNotebookId]);

  const onCreateProject = useCallback(() => {
    setShowCreateProject(true);
  }, []);

  const navigationNotebooks = useMemo<Notebook[]>(() => {
    if (!notebooks) return [];
    return notebooks.map((notebook) => {
      const missing = (localThreads[notebook.id] ?? []).filter(
        (threadId) => !notebook.threads?.some((thread) => thread.id === threadId),
      );
      if (missing.length === 0) return notebook;
      // threadRows() synthesizes the notebook's legacy conversation only while
      // its summaries are empty. Adding session chats would hide it, so keep it
      // explicitly; a blank title takes the notebook's label there (#4188 F4).
      const server: Notebook["threads"] =
        notebook.threads && notebook.threads.length > 0
          ? notebook.threads
          : [{
              id: LEGACY_THREAD_ID,
              notebookId: notebook.id,
              title: "",
              createdAt: notebook.createdAt ?? "",
              updatedAt: notebook.createdAt ?? "",
              turnCount: 0,
              sharedLegacy: true,
            }];
      return {
        ...notebook,
        threads: [
          ...missing.map((threadId) => ({
            id: threadId,
            notebookId: notebook.id,
            title: "New chat",
            createdAt: "",
            updatedAt: "",
            turnCount: 0,
            sharedLegacy: false,
          })),
          ...(server ?? []),
        ],
      };
    });
  }, [localThreads, notebooks]);

  const host = useMemo<UnifiedShellHost | null>(() => {
    if (!notebooks) return null;
    return {
      projects: notebookProjects(navigationNotebooks),
      machines: notebookMachines(navigationNotebooks),
      onOpenItem: (item: ProjectItem) => {
        // Sources is its own destination now, not a side effect of attaching.
        const sourcesFor = sourcesRefFromItem(item.id);
        if (sourcesFor) {
          open(sourcesFor);
          setQueuedOpenAddSources(true);
          return;
        }
        const ref = threadRefFromItem(item.id);
        if (ref) open(ref.notebookId, ref.threadId);
      },
      onSelectProject: (projectId: string) => {
        const id = notebookIdFromProject(projectId);
        if (id) open(id);
      },
      navigationFooter: (
        <>
          <p className="fl-card__meta">{me.email}</p>
          <button type="button" onClick={() => setShowAbout(true)}>About &amp; updates</button>
          <button
            type="button"
            disabled={signingOut}
            onClick={() => {
              setSigningOut(true);
              void Promise.resolve(onSignOut()).finally(() => setSigningOut(false));
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </>
      ),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigationNotebooks, notebooks, me.email, signingOut, open]);

  // #4188: the project root's title + recent-threads list — the SAME
  // `Project` the drawer's ProjectTree renders (`host.projects`), so the
  // title matches exactly (tag · name for a bound machine, display name
  // otherwise) and the thread rows are the SAME `ProjectItem`s `onOpenItem`
  // already knows how to open. `threadRows()` (inside `notebookProjects`)
  // orders by server `updated_at DESC`, so this is already most-recent-first;
  // the just-left thread is always present because every thread the project
  // has is listed, not just a recent subset.
  const currentProject = useMemo(
    () => host?.projects.find((project) => project.id === projectIdForNotebook(selected ?? "")) ?? null,
    [host, selected],
  );
  // The server order is a boot-time snapshot: chatting in an older thread does
  // not re-rank it. Float the thread just left to the top so it is always the
  // first row, whatever the stale order says (#4188 light review).
  const currentProjectThreads = useMemo<readonly ProjectItem[]>(() => {
    const threads = currentProject?.children.filter((node): node is ProjectItem => node.kind === "thread") ?? [];
    if (!selected || !selectedThreadId) return threads;
    const leftId = threadItemId(selected, selectedThreadId);
    const left = threads.find((item) => item.id === leftId);
    return left ? [left, ...threads.filter((item) => item !== left)] : threads;
  }, [currentProject, selected, selectedThreadId]);

  // NotebookScreen owns Android Back while a conversation is mounted. Every
  // root-owned state must replace that handler explicitly: otherwise the
  // unmounted notebook leaves its last callback behind and About can minimize
  // the app instead of returning to the conversation.
  const rootOwnsBack =
    homeVisible || projectRootVisible || showAbout || showCreateProject || Boolean(error) || !notebooks || !host || !selected;
  useEffect(() => {
    if (!rootOwnsBack) return;
    const previous = backRef.current;
    const handleBack = () => {
      if (showCreateProject) {
        setShowCreateProject(false);
        return true;
      }
      if (showAbout) {
        setShowAbout(false);
        return true;
      }
      // Project root → global home (the next rung of the BACK ladder below
      // NotebookScreen's own "thread → project root", #4188).
      if (projectRootVisible) {
        setProjectRootVisible(false);
        setHomeVisible(true);
        return true;
      }
      if (homeVisible) return true;
      return false;
    };
    backRef.current = handleBack;
    return () => {
      if (backRef.current === handleBack) backRef.current = previous;
    };
  }, [backRef, rootOwnsBack, homeVisible, projectRootVisible, showAbout, showCreateProject]);

  if (showCreateProject) {
    return (
      <UnifiedCreateProject
        onCancel={() => setShowCreateProject(false)}
        onCreated={(nb) => {
          setShowCreateProject(false);
          // A project made here starts clean: nothing a HOME send left behind
          // may ride into it (r7 F10).
          setQueuedQuestion(null);
          clearAttachments();
          // #3895: the list is fetched once at boot, so a project created here
          // has to be added to it or the drawer never shows it (no thread row,
          // no Sources to upload into) until the app is relaunched. Same idiom
          // as createGeneral above.
          setNotebooks((current) => (current?.some((existing) => existing.id === nb.id) ? current : [nb, ...(current ?? [])]));
          open(nb.id);
          setHomeVisible(false);
        }}
      />
    );
  }

  if (showAbout) {
    return (
      <UnifiedAboutUpdates
        pendingOfflineWork={async () =>
          hasActiveApiMutations() ||
          hasActiveWorkOrderQueueProducers() ||
          (await pendingCount(preferencesStore, me.tenantId)) > 0
        }
        onBack={() => setShowAbout(false)}
      />
    );
  }

  const notice = deepLinkNotice ? (
    <div className="unified-root__notice" role="alert">
      <span>{deepLinkNotice}</span>
      <button type="button" onClick={() => setDeepLinkNotice(null)}>
        Dismiss
      </button>
    </div>
  ) : null;

  if (error) return <div className="unified-root"><p className="unified-root__empty" role="alert">{error}</p></div>;
  if (!notebooks || !host) return <div className="unified-root"><p className="unified-root__empty">FactoryLM…</p></div>;

  // Row 8: an account with no projects gets the SAME home composer, not a
  // dead end — /v3 answers a brand-new account's general question, and so
  // does the phone. The send path below already creates General for it
  // (homeSendPlan on an empty list), so the only thing the old
  // "No projects yet" screen guarded was a composer that would have worked.
  // `!selected` implies zero notebooks (a non-empty list always selects).
  if (homeVisible || !selected) {
    return (
      <div className="unified-root" data-testid="unified-home">
        {notice}
        <UnifiedChat
          turns={[]}
          liveTurns={[]}
          pending={null}
          busy={homeSending}
          canStop={false}
          canRetry={false}
          chatError={homeSendError}
          // The shell puts this back in the composer under the banner, and its
          // Try again re-sends the draft through onSend (SendError.tsx): with
          // no failed turn on HOME there is no host retry to wire.
          failedQuestion={homeFailedQuestion}
          handlers={{
            // HOME has no notebook yet: the shell stashes whatever the composer
            // is holding and this send creates the thread that claims it.
            onSend: (text, _evidence, _scope, opts) => sendFromHome(text, opts),
            onStop: () => {},
            onCitation: () => {},
            onRetry: undefined,
            onNewChat: () => sendFromHome(null),
            onCreateProject: () => { onCreateProject(); },
            onScanMachine: async () => {
              const id = openPreferredNotebook();
              if (id) setQueuedSensorStart("read-scan");
              // No project yet, so no notebook can host the scanner; the
              // form that creates one is the honest next step, never a
              // silently dead button.
              else setShowCreateProject(true);
              return null;
            },
          }}
          host={host}
          // The exact line /v3 renders for "no project picked"
          // (mira-hub/src/factorylm-ui/hub-host-logic.ts groundingLineFor):
          // identical surfaces, identical words (row 8).
          groundingLine={() =>
            "General question — answered from general knowledge, nothing cited. Pick a project to ask about its manuals."}
          // No notebook exists yet, so nothing can upload here; the shell holds
          // the bytes and hands them to the thread this send creates.
          attachmentNotebookId={null}
          meta={{
            notebookId: "home",
            threadId: "home",
            projectId: selected ? `project-${selected}` : "project-home",
            title: "FactoryLM",
            asset: null,
            identityConfirmed: false,
          }}
        />
      </div>
    );
  }

  if (projectRootVisible) {
    return (
      <>
      {notice}
      <UnifiedProjectRoot
        title={currentProject?.name ?? "FactoryLM"}
        threads={currentProjectThreads}
        onOpenThread={(item) => host.onOpenItem(item)}
        onNewChat={() => startNewThread(selected)}
        onBack={() => {
          setProjectRootVisible(false);
          setHomeVisible(true);
        }}
      />
      </>
    );
  }

  return (
    <div className="unified-root" data-testid="unified-root" data-notebook-id={selected}>
      {notice}
      <NotebookScreen
        key={`${selected}:${selectedThreadId ?? LEGACY_THREAD_ID}`}
        id={selected}
        threadId={selectedThreadId ?? LEGACY_THREAD_ID}
        chromeless
        openAddSources={queuedOpenAddSources}
        unifiedShell={host}
        backRef={backRef}
        // A project root needs a project to show. A notebook the list does not
        // contain yet (a QR deep link can create one; its drawer refresh may
        // fail or lag) has none, so BACK goes to the global home instead of a
        // fabricated, empty "FactoryLM" project page (#4188 light review).
        onExit={() => (currentProject ? setProjectRootVisible(true) : setHomeVisible(true))}
        onOpenNotebook={open}
        initialQuestion={queuedQuestion}
        onInitialQuestionSent={() => setQueuedQuestion(null)}
        onInitialAddSourcesConsumed={() => setQueuedOpenAddSources(false)}
        initialSensorStart={queuedSensorStart}
        onInitialSensorStartConsumed={() => setQueuedSensorStart(null)}
        onNewThread={startNewThread}
        onCreateProject={onCreateProject}
      />
    </div>
  );
}

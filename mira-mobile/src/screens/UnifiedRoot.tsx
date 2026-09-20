/**
 * Unified root (FLM-UI-4000 Phase 2, mobile): the shared FactoryLM shell owns
 * the whole app. Its drawer is the navigation (every notebook, every bound
 * machine), its header is the header, the conversation is the notebook's real
 * conversation, and the footer carries the host-owned controls (About &
 * updates, sign out). This is the only authenticated experience — there is no
 * classic switch. NotebookScreen keeps owning the send path, scope, riders,
 * uploads, and the citation viewer — it just renders chromeless.
 */
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { ProjectItem } from "@factorylm/interaction";
import { createNotebook, listNotebooks, type Me, type Notebook } from "../api/resources";
import { homeSendPlan } from "../unified/home-send";
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
  sourcesRefFromItem,
  notebookMachines,
  notebookProjects,
  threadRefFromItem,
} from "../unified/notebook-tree";
import { NotebookScreen } from "./NotebookScreen";
import type { UnifiedShellHost } from "./UnifiedChat";
import { UnifiedChat } from "./UnifiedChat";
import { UnifiedAboutUpdates } from "../unified/UnifiedAboutUpdates";
import { UnifiedCreateProject } from "../unified/UnifiedCreateProject";

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
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const [homeVisible, setHomeVisible] = useState(true);
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null);
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
    setDraftThreadId(null);
    setQueuedOpenAddSources(false);
    setHomeVisible(false);
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
        const outcome = await resolveScan(deepLink.tag, { getAssetByTag, openAssetNotebook }, "qr");
        if (!live) return;
        if (outcome.kind === "notebook") {
          setDeepLinkNotice(null);
          open(outcome.notebookId);
          // The notebook may be new (openAssetNotebook can create it); refresh
          // the drawer so it lists what the technician is now inside.
          try {
            const list = await listNotebooks();
            if (live) setNotebooks(list);
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
    setDraftThreadId(threadId);
    setQueuedOpenAddSources(false);
    setHomeVisible(false);
    void withSessionLocalProducer(async () => {
      await preferencesStore.set(LAST_NOTEBOOK_KEY, id);
      await preferencesStore.set(LAST_THREAD_KEY(id), threadId);
    });
    return id;
  }, [preferredNotebookId]);

  /**
   * The thread a HOME question or a HOME "New chat" opens (#3877): an UNBOUND
   * notebook — General first — never `preferredNotebookId()`, which is the
   * last-opened notebook, i.e. the machine the technician was just at; its
   * identity would ride the turn as machine context. With no unbound notebook
   * it creates General so a stranger with no project can still ask. Async only
   * on that create path; the caller sequences the question after it.
   */
  const startHomeThread = useCallback(async (): Promise<string | null> => {
    const plan = homeSendPlan(notebooks);
    if (plan.kind === "loading") return null;
    if (plan.kind === "existing") return startNewThread(plan.notebookId);
    try {
      const created = await createNotebook(plan.body);
      setNotebooks((current) => (current?.some((nb) => nb.id === created.id) ? current : [created, ...(current ?? [])]));
      return startNewThread(created.id);
    } catch (e) {
      setError(apiErrorCopy(e, "Could not create a project for your question."));
      return null;
    }
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
      if (notebook.id !== selected || !draftThreadId) return notebook;
      if (notebook.threads?.some((thread) => thread.id === draftThreadId)) return notebook;
      return {
        ...notebook,
        threads: [
          {
            id: draftThreadId,
            notebookId: notebook.id,
            title: "New chat",
            createdAt: "",
            updatedAt: "",
            turnCount: 0,
            sharedLegacy: false,
          },
          ...(notebook.threads ?? []),
        ],
      };
    });
  }, [draftThreadId, notebooks, selected]);

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

  // NotebookScreen owns Android Back while a conversation is mounted. Every
  // root-owned state must replace that handler explicitly: otherwise the
  // unmounted notebook leaves its last callback behind and About can minimize
  // the app instead of returning to the conversation.
  const rootOwnsBack = homeVisible || showAbout || showCreateProject || Boolean(error) || !notebooks || !host || !selected;
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
      if (homeVisible) return true;
      return false;
    };
    backRef.current = handleBack;
    return () => {
      if (backRef.current === handleBack) backRef.current = previous;
    };
  }, [backRef, rootOwnsBack, homeVisible, showAbout, showCreateProject]);

  if (showCreateProject) {
    return (
      <UnifiedCreateProject
        onCancel={() => setShowCreateProject(false)}
        onCreated={(nb) => {
          setShowCreateProject(false);
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
  if (!selected) {
    return (
      <div className="unified-root">
        {notice}
        <p className="unified-root__empty">No projects yet. Create one to start a conversation.</p>
        <button
          type="button"
          className="unified-root__create"
          onClick={() => setShowCreateProject(true)}
        >
          New project
        </button>
        <div className="fl-shell__nav-footer">{host.navigationFooter}</div>
      </div>
    );
  }

  if (homeVisible) {
    return (
      <div className="unified-root" data-testid="unified-home">
        {notice}
        <UnifiedChat
          turns={[]}
          liveTurns={[]}
          pending={null}
          busy={false}
          canStop={false}
          canRetry={false}
          chatError={null}
          handlers={{
            // HOME has no notebook yet: the shell stashes whatever the composer
            // is holding and this send creates the thread that claims it.
            onSend: (text) => {
              void startHomeThread().then((id) => { if (id) setQueuedQuestion(text); });
            },
            onStop: () => {},
            onCitation: () => {},
            onRetry: undefined,
            onNewChat: () => { void startHomeThread(); },
            onCreateProject: () => { onCreateProject(); },
            onScanMachine: async () => {
              const id = openPreferredNotebook();
              if (id) setQueuedSensorStart("read-scan");
              return null;
            },
          }}
          host={host}
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
        onExit={() => setHomeVisible(true)}
        onOpenNotebook={open}
        initialQuestion={queuedQuestion}
        onInitialQuestionSent={() => setQueuedQuestion(null)}
        onInitialAddSourcesConsumed={() => setQueuedOpenAddSources(false)}
        initialSensorStart={queuedSensorStart}
        onInitialSensorStartConsumed={() => setQueuedSensorStart(null)}
        onNewThread={startNewThread}
      />
    </div>
  );
}

/**
 * Unified root (FLM-UI-4000 Phase 2, mobile): the shared FactoryLM shell owns
 * the whole app. Its drawer is the navigation (every notebook, every bound
 * machine), its header is the header, the conversation is the notebook's real
 * conversation, and the footer carries the host-owned controls (About &
 * updates, classic app, sign out). NotebookScreen keeps owning the send path,
 * scope, riders, uploads, and the citation viewer — it just renders chromeless.
 */
import { useCallback, useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { ProjectItem } from "@factorylm/interaction";
import { listNotebooks, type Me, type Notebook } from "../api/resources";
import { hasActiveApiMutations } from "../api/client";
import {
  hasActiveWorkOrderQueueProducers,
  pendingCount,
  preferencesStore,
  withSessionLocalProducer,
} from "../lib/offline-queue";
import { apiErrorCopy } from "../lib/api-error-copy";
import {
  LEGACY_THREAD_ID,
  notebookIdFromProject,
  notebookMachines,
  notebookProjects,
  threadRefFromItem,
} from "../unified/notebook-tree";
import { NotebookScreen } from "./NotebookScreen";
import type { UnifiedShellHost } from "./UnifiedChat";
import { UnifiedChat } from "./UnifiedChat";
import { UnifiedAboutUpdates } from "../unified/UnifiedAboutUpdates";

const LAST_NOTEBOOK_KEY = "flm.unified.notebook.v1";
const LAST_THREAD_KEY = (notebookId: string) => `flm.unified.thread.v1.${notebookId}`;

function createThreadId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `thrd_${raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 48)}`;
}

function latestThreadId(notebook: Notebook | undefined): string {
  return notebook?.threads?.[0]?.id ?? LEGACY_THREAD_ID;
}

export interface UnifiedRootProps {
  readonly me: Me;
  readonly backRef: MutableRefObject<(() => boolean) | null>;
  readonly onSignOut: () => Promise<void> | void;
  readonly onSwitchClassic: () => void;
}

export function UnifiedRoot({ me, backRef, onSignOut, onSwitchClassic }: UnifiedRootProps) {
  const [notebooks, setNotebooks] = useState<Notebook[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [draftThreadId, setDraftThreadId] = useState<string | null>(null);
  const [homeVisible, setHomeVisible] = useState(true);
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null);
  const [queuedOpenAddSources, setQueuedOpenAddSources] = useState(false);
  const [queuedSensorStart, setQueuedSensorStart] = useState<"read-scan" | null>(null);
  const [showAbout, setShowAbout] = useState(false);
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
    setSelected(id);
    setSelectedThreadId(threadId ?? latestThreadId(notebooks?.find((nb) => nb.id === id)));
    setDraftThreadId(null);
    setQueuedOpenAddSources(false);
    setHomeVisible(false);
    void withSessionLocalProducer(async () => {
      await preferencesStore.set(LAST_NOTEBOOK_KEY, id);
      const activeThread = threadId ?? latestThreadId(notebooks?.find((nb) => nb.id === id));
      await preferencesStore.set(LAST_THREAD_KEY(id), activeThread);
    });
  }, [notebooks]);

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

  const openPreferredNotebook = useCallback((): string | null => {
    const id = preferredNotebookId();
    if (!id) return null;
    open(id);
    return id;
  }, [open, preferredNotebookId]);

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
          <button type="button" onClick={onSwitchClassic}>Use classic app</button>
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
  const rootOwnsBack = homeVisible || showAbout || Boolean(error) || !notebooks || !host || !selected;
  useEffect(() => {
    if (!rootOwnsBack) return;
    const previous = backRef.current;
    const handleBack = () => {
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
  }, [backRef, rootOwnsBack, homeVisible, showAbout]);

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

  if (error) return <div className="unified-root"><p className="unified-root__empty" role="alert">{error}</p></div>;
  if (!notebooks || !host) return <div className="unified-root"><p className="unified-root__empty">FactoryLM…</p></div>;
  if (!selected) {
    return (
      <div className="unified-root">
        <p className="unified-root__empty">
          No notebooks yet. Use the classic app to create one, then come back.
        </p>
        <div className="fl-shell__nav-footer">{host.navigationFooter}</div>
      </div>
    );
  }

  if (homeVisible) {
    const suggestions = notebooks.slice(0, 3).map((notebook) => ({
      id: `notebook-${notebook.id}`,
      text: notebook.manufacturer || notebook.model
        ? `Ask about ${[notebook.manufacturer, notebook.model].filter(Boolean).join(" ")}`
        : `Ask about ${notebook.displayName}`,
    }));
    return (
      <div className="unified-root" data-testid="unified-home">
        <UnifiedChat
          turns={[]}
          liveTurns={[]}
          pending={null}
          busy={false}
          canStop={false}
          canRetry={false}
          chatError={null}
          handlers={{
            onSend: (text) => {
              const id = startNewThread();
              if (id) setQueuedQuestion(text);
            },
            onStop: () => {},
            onCitation: () => {},
            onAttachPhoto: () => { if (startNewThread()) setQueuedOpenAddSources(true); },
            onAttachFile: () => { if (startNewThread()) setQueuedOpenAddSources(true); },
            onRetry: undefined,
            onNewChat: () => { startNewThread(); },
            onScanMachine: async () => {
              const id = openPreferredNotebook();
              if (id) setQueuedSensorStart("read-scan");
              return null;
            },
          }}
          host={host}
          groundingLine={() => "Ask from your notebooks, or scan a machine to start with the equipment in front of you."}
          suggestChips={() => suggestions}
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

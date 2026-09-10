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
import { notebookIdFromItem, notebookMachines, notebookProjects } from "../unified/notebook-tree";
import { NotebookScreen } from "./NotebookScreen";
import type { UnifiedShellHost } from "./UnifiedChat";
import { UnifiedChat } from "./UnifiedChat";
import { UnifiedAboutUpdates } from "../unified/UnifiedAboutUpdates";

const LAST_NOTEBOOK_KEY = "flm.unified.notebook.v1";

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
  const [homeVisible, setHomeVisible] = useState(true);
  const [queuedQuestion, setQueuedQuestion] = useState<string | null>(null);
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
        setHomeVisible(true);
      } catch (e) {
        if (live) setError(apiErrorCopy(e, "Could not load notebooks."));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const open = useCallback((id: string) => {
    setSelected(id);
    setHomeVisible(false);
    void withSessionLocalProducer(() => preferencesStore.set(LAST_NOTEBOOK_KEY, id));
  }, []);

  const preferredNotebookId = useCallback((): string | null => {
    if (!notebooks || notebooks.length === 0) return null;
    return selected && notebooks.some((nb) => nb.id === selected) ? selected : notebooks[0]?.id ?? null;
  }, [notebooks, selected]);

  const openPreferredNotebook = useCallback((): string | null => {
    const id = preferredNotebookId();
    if (!id) return null;
    open(id);
    return id;
  }, [open, preferredNotebookId]);

  const host = useMemo<UnifiedShellHost | null>(() => {
    if (!notebooks) return null;
    return {
      projects: notebookProjects(notebooks),
      machines: notebookMachines(notebooks),
      onOpenItem: (item: ProjectItem) => {
        const id = notebookIdFromItem(item.id);
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
  }, [notebooks, me.email, signingOut]);

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
              const id = openPreferredNotebook();
              if (id) setQueuedQuestion(text);
            },
            onStop: () => {},
            onCitation: () => {},
            onAttachPhoto: () => { openPreferredNotebook(); },
            onAttachFile: () => { openPreferredNotebook(); },
            onRetry: undefined,
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
        key={selected}
        id={selected}
        chromeless
        unifiedShell={host}
        backRef={backRef}
        onExit={() => setHomeVisible(true)}
        onOpenNotebook={open}
        initialQuestion={queuedQuestion}
        onInitialQuestionSent={() => setQueuedQuestion(null)}
        initialSensorStart={queuedSensorStart}
        onInitialSensorStartConsumed={() => setQueuedSensorStart(null)}
      />
    </div>
  );
}

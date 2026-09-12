/**
 * Unified root (FLM-UI-4000 Phase 2, mobile): the shared FactoryLM shell owns
 * the whole app. Its drawer is the navigation (every notebook, every bound
 * machine), its header is the header, the conversation is the notebook's real
 * conversation, and the footer carries the host-owned controls (About &
 * updates, classic app, sign out). NotebookScreen keeps owning the send path,
 * scope, riders, uploads, and the citation viewer — it just renders chromeless.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import type { ProjectItem } from "@factorylm/interaction";
import { createNotebook, listNotebooks, type Me, type Notebook } from "../api/resources";
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
  const [createError, setCreateError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const creatingRef = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [list, last] = await Promise.all([listNotebooks(), preferencesStore.get(LAST_NOTEBOOK_KEY)]);
        if (!live) return;
        setNotebooks(list);
        const preferred = last && list.some((nb) => nb.id === last) ? last : (list[0]?.id ?? null);
        setSelected(preferred);
      } catch (e) {
        if (live) setError(apiErrorCopy(e, "Could not load projects."));
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const open = (id: string) => {
    setSelected(id);
    void withSessionLocalProducer(() => preferencesStore.set(LAST_NOTEBOOK_KEY, id));
  };

  const startNewChat = async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreateError(null);
    try {
      const created = await createNotebook({
        displayName: "New chat",
        identityStatus: "candidate",
        identitySourceType: "user",
      });
      setNotebooks((current) => {
        const list = current ?? [];
        return [created, ...list.filter((row) => row.id !== created.id)];
      });
      open(created.id);
    } catch (e) {
      setCreateError(apiErrorCopy(e, "Could not start a new chat."));
    } finally {
      creatingRef.current = false;
    }
  };

  const host = useMemo<UnifiedShellHost | null>(() => {
    if (!notebooks) return null;
    return {
      projects: notebookProjects(notebooks),
      machines: notebookMachines(notebooks),
      onOpenItem: (item: ProjectItem) => {
        const id = notebookIdFromItem(item.id);
        if (id) open(id);
      },
      onNewChat: () => {
        void startNewChat();
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
  const rootOwnsBack = showAbout || Boolean(error) || !notebooks || !host || !selected;
  useEffect(() => {
    if (!rootOwnsBack) return;
    const previous = backRef.current;
    const handleBack = () => {
      if (showAbout) {
        setShowAbout(false);
        return true;
      }
      return false;
    };
    backRef.current = handleBack;
    return () => {
      if (backRef.current === handleBack) backRef.current = previous;
    };
  }, [backRef, rootOwnsBack, showAbout]);

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
        {createError ? <p className="unified-root__empty" role="alert">{createError}</p> : null}
        <p className="unified-root__empty">No projects yet.</p>
        <button type="button" onClick={() => void startNewChat()}>New chat</button>
        <div className="fl-shell__nav-footer">{host.navigationFooter}</div>
      </div>
    );
  }

  return (
    <div className="unified-root" data-testid="unified-root" data-notebook-id={selected}>
      {createError ? <p className="unified-root__empty" role="alert">{createError}</p> : null}
      <NotebookScreen
        key={selected}
        id={selected}
        chromeless
        unifiedShell={host}
        backRef={backRef}
        onExit={() => { /* the shell's drawer is the way between notebooks */ }}
        onOpenNotebook={open}
      />
    </div>
  );
}

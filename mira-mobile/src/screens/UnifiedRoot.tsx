/**
 * Unified root (FLM-UI-4000 Phase 2, mobile): the shared FactoryLM shell owns
 * the whole app. Its drawer is the navigation (every notebook, every bound
 * machine), its header is the header, the conversation is the notebook's real
 * conversation, and the footer carries the host-owned controls (About &
 * updates, classic app, sign out). NotebookScreen keeps owning the send path,
 * scope, riders, uploads, and the citation viewer — it just renders chromeless.
 */
import { useEffect, useMemo, useState, type MutableRefObject } from "react";
import type { ProjectItem } from "@factorylm/interaction";
import { listNotebooks, type Me, type Notebook } from "../api/resources";
import { pendingCount, preferencesStore } from "../lib/offline-queue";
import { notebookIdFromItem, notebookMachines, notebookProjects } from "../unified/notebook-tree";
import { AboutUpdates } from "./AboutUpdates";
import { NotebookScreen } from "./NotebookScreen";
import type { UnifiedShellHost } from "./UnifiedChat";

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
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Could not load notebooks.");
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const open = (id: string) => {
    setSelected(id);
    void preferencesStore.set(LAST_NOTEBOOK_KEY, id);
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

  // A pushed screen must own hardware Back. Opening About unmounts NotebookScreen,
  // which is the only component that assigns backRef.current — leaving App.tsx's
  // listener with an unconsumed press, which it answers with minimizeApp(). A
  // non-root screen backgrounding the app is the defect (CANARY-OTA-NAV-AUDIT).
  useEffect(() => {
    if (!showAbout) return;
    const previous = backRef.current;
    backRef.current = () => {
      setShowAbout(false);
      return true;
    };
    return () => {
      backRef.current = previous;
    };
  }, [showAbout, backRef]);

  if (showAbout) {
    return (
      <AboutUpdates
        pendingOfflineWork={async () => (await pendingCount(preferencesStore, me.tenantId)) > 0}
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

  return (
    <div className="unified-root" data-testid="unified-root" data-notebook-id={selected}>
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

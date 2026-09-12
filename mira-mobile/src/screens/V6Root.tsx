/**
 * V6 Root — ChatGPT-like industrial technician shell.
 *
 * North star: FactoryLM should feel as simple and coherent as ChatGPT, but
 * optimized for an industrial technician. This implementation reuses the
 * canonical shared shell from packages/factorylm-ui and wires mobile-specific
 * behaviors.
 *
 * Key improvements over legacy:
 * - Projects (not Notebooks) as the user mental model
 * - Chat-first home — open to clean Ask/conversation
 * - No-machine mode — ask general questions before selecting a machine
 * - Persistent conversations that survive reload/restart
 * - Normal navigation with visible back affordances
 */
import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import "../unified/unified.css";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, type MutableRefObject } from "react";
import {
  PROFILES,
  createShellState,
  shellReducer,
  type Machine,
  type Project,
  type ProjectItem,
  type ShellState,
} from "@factorylm/interaction";
import { FactoryLMShell, closeLayerAction, topLayer, type HostHooks } from "@factorylm/ui";
import { Preferences } from "@capacitor/preferences";
import { createWorkOrder, getMe, signOut, type Me } from "../api/resources";
import { registerTransientLayer } from "../lib/transient-layer";
import { createV6Adapter, type V6AdapterHandlers } from "../v6/adapter";
import { v6Projects, v6Machines, type V6Thread } from "../v6/data";
import {
  beginSessionLocalPurge,
  drainQueueForSessionPurge,
  pendingCount,
  preferencesStore,
  purgeAllQueues,
  resumeSessionLocalWrites,
  waitForSessionLocalProducers,
  waitForWorkOrderQueueProducers,
} from "../lib/offline-queue";
import { hasActiveApiMutations } from "../api/client";
import { signOutSyncInProgressCopy, signOutWarningCopy } from "../lib/sign-out-copy";

const LAST_THREAD_KEY = "flm.v6.thread.v1";
const SECURE_CLEANUP_KEY = "flm.session.cleanup-required.v1";

export interface V6RootProps {
  readonly me: Me;
  readonly backRef: MutableRefObject<(() => boolean) | null>;
  readonly onSignOut: () => Promise<void> | void;
  readonly onSwitchLegacy: () => void;
}

function initialState(projects: readonly Project[], machines: readonly Machine[]): ShellState {
  const fixture = {
    projects,
    machines,
    thread: {
      id: "new-chat",
      label: "New chat",
      messages: [],
      assistantStatus: "idle" as const,
      canRetry: false,
      canStop: false,
    },
    mode: "ask" as const,
    theme: "light" as const,
    draft: "",
  };
  return createShellState(fixture, PROFILES.mobile);
}

export function V6Root({ me, backRef, onSignOut, onSwitchLegacy }: V6RootProps) {
  const [projects, setProjects] = useState<readonly Project[]>([]);
  const [machines, setMachines] = useState<readonly Machine[]>([]);
  const [threads, setThreads] = useState<readonly V6Thread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [state, dispatch] = useReducer(shellReducer, undefined, () => initialState([], []));

  // Load data on mount
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [projectsData, machinesData, lastThread] = await Promise.all([
          v6Projects(),
          v6Machines(),
          Preferences.get({ key: LAST_THREAD_KEY }),
        ]);
        if (!live) return;
        setProjects(projectsData);
        setMachines(machinesData);
        // TODO: Load threads from backend
        setThreads([]);
        
        // Hydrate shell state with loaded data
        dispatch({
          type: "hydrate",
          data: {
            projects: projectsData,
            machines: machinesData,
            thread: state.thread,
            activeContext: { machineId: undefined },
          },
        });

        const preferred = lastThread.value || null;
        setSelectedThreadId(preferred);
      } catch (error) {
        console.error("[V6] failed to load data", error);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const onNewChat = useCallback(() => {
    const newThreadId = `thread-${Date.now()}`;
    setSelectedThreadId(newThreadId);
    void Preferences.set({ key: LAST_THREAD_KEY, value: newThreadId });
    
    // Reset to empty conversation
    dispatch({
      type: "hydrate",
      data: {
        thread: {
          id: newThreadId,
          label: "New chat",
          messages: [],
          assistantStatus: "idle",
          canRetry: false,
          canStop: false,
        },
        projects: state.projects,
        machines: state.machines,
        activeContext: { machineId: undefined },
      },
    });
  }, [state.projects, state.machines]);

  const onOpenItem = useCallback((item: ProjectItem) => {
    if (item.kind === "thread") {
      setSelectedThreadId(item.id);
      void Preferences.set({ key: LAST_THREAD_KEY, value: item.id });
      // TODO: Load thread messages from backend
    }
  }, []);

  const onSend = useCallback((text: string) => {
    // TODO: Implement send logic that supports no-machine mode
    console.log("[V6] sending:", text, "machine:", state.activeContext.machineId || "none");
    
    // Mock response for now
    dispatch({
      type: "mock-send",
    });
  }, [state.activeContext.machineId]);

  const handlers = useMemo<V6AdapterHandlers>(() => ({
    onAttachPhoto: () => {
      console.log("[V6] attach photo");
    },
    onAttachFile: () => {
      console.log("[V6] attach file");
    },
    onScanMachine: async () => {
      console.log("[V6] scan machine");
      return null;
    },
  }), []);

  const adapter = useMemo(() => createV6Adapter(handlers), [handlers]);

  const hooks = useMemo<HostHooks>(() => ({
    onSend,
    onStop: () => {
      console.log("[V6] stop");
    },
    onRetry: () => {
      console.log("[V6] retry");
    },
    onNewChat,
    viewCitation: (sourceId) => {
      console.log("[V6] view citation:", sourceId);
    },
  }), [onSend, onNewChat]);

  const navigationFooter = useMemo(() => (
    <>
      <p className="fl-card__meta">{me.email}</p>
      <button type="button" onClick={onSwitchLegacy}>Use legacy app</button>
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
  ), [me.email, onSwitchLegacy, onSignOut, signingOut]);

  // Register open shell layers for hardware back
  const layer = topLayer(state);
  const layerRef = useRef(layer);
  layerRef.current = layer;

  useEffect(() => {
    if (!layer) return;
    return registerTransientLayer(() => {
      const current = layerRef.current;
      if (current) {
        dispatch(closeLayerAction(current));
        return true;
      }
      return false;
    });
  }, [layer]);

  // V6 root owns Android Back when no layers are open
  useEffect(() => {
    if (layer) return;
    const previous = backRef.current;
    const handleBack = () => {
      // No internal navigation stack yet - just return false to minimize
      return false;
    };
    backRef.current = handleBack;
    return () => {
      if (backRef.current === handleBack) backRef.current = previous;
    };
  }, [backRef, layer]);

  return (
    <div className="v6-root" data-testid="v6-root">
      <FactoryLMShell
        state={state}
        dispatch={dispatch}
        adapter={adapter}
        hooks={hooks}
        onOpenItem={onOpenItem}
        navigationFooter={navigationFooter}
      />
    </div>
  );
}

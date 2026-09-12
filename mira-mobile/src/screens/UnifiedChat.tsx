/**
 * Unified conversation surface (FLM-UI-4000 Phase 2, mobile lane): the shared
 * FactoryLM shell rendering THIS notebook's real turns through the mobile
 * chat-adapter vocabulary. The screen keeps owning the send path, scope,
 * riders, Retry body, uploads and the citation viewer — exactly as ChatV2 does
 * — so switching surfaces changes the shell, never the semantics.
 *
 * Shared code stays host-agnostic: the packages are reached through Vite
 * aliases (no package.json change, so the OTA guard's native-path check stays
 * green) and receive live data through the reducer's `hydrate` action.
 */
import "@factorylm/theme/workspace.css";
import "@factorylm/ui/shell.css";
import "@factorylm/ui/conversation.css";
import "../unified/unified.css";
import { useEffect, useMemo, useReducer, useRef } from "react";
import {
  PROFILES,
  createShellState,
  shellReducer,
  type Machine,
  type Project,
  type ProjectItem,
  type ShellState,
} from "@factorylm/interaction";
import type { ReactNode } from "react";
import { FactoryLMShell, closeLayerAction, topLayer, type HostHooks } from "@factorylm/ui";
import type { NotebookServerTurn } from "../api/resources";
import { threadMessages } from "../chat-adapter/turns-to-parts";
import type { ChatCitation, ChatTurn } from "../lib/sse";
import { registerTransientLayer } from "../lib/transient-layer";
import { createCapacitorAdapter } from "../unified/capacitor-adapter";
import {
  citationIndex,
  contextFor,
  liveFixture,
  machinesFor,
  projectsFor,
  toThread,
  type UnifiedNotebookMeta,
} from "../unified/to-interaction";
import type { ChatV2Handlers } from "./ChatV2";

/** What the unified ROOT supplies when the shell owns the whole app: the
 *  notebook/machine tree, item opening, and host-owned navigation controls. */
export interface UnifiedShellHost {
  readonly projects: readonly Project[];
  readonly machines: readonly Machine[];
  readonly onOpenItem: (item: ProjectItem) => void;
  readonly onNewChat?: () => void;
  readonly navigationFooter?: ReactNode;
}

export interface UnifiedChatProps {
  readonly turns: NotebookServerTurn[];
  readonly liveTurns: { q: string; a: ChatTurn }[];
  readonly pending: { q: string; a: ChatTurn } | null;
  readonly busy: boolean;
  readonly canStop: boolean;
  readonly canRetry: boolean;
  readonly chatError: string | null;
  readonly handlers: ChatV2Handlers;
  readonly meta: Omit<UnifiedNotebookMeta, "capturedAt">;
  readonly host?: UnifiedShellHost;
}

function initialState(messages: ReturnType<typeof threadMessages>, meta: UnifiedNotebookMeta, host?: UnifiedShellHost): ShellState {
  const fixture = liveFixture(messages, meta);
  const created = createShellState(
    host ? { ...fixture, projects: host.projects, machines: host.machines } : fixture,
    PROFILES.mobile,
  );
  // The fixture contract opens the drawer at mount for review; a live screen
  // starts on the conversation.
  return shellReducer(created, { type: "set-navigation-visible", visible: false });
}

export function UnifiedChat({ turns, liveTurns, pending, busy, canStop, canRetry, chatError, handlers, meta, host }: UnifiedChatProps) {
  const capturedAt = useRef(new Date().toISOString());
  const fullMeta = useMemo<UnifiedNotebookMeta>(() => ({ ...meta, capturedAt: capturedAt.current }), [meta]);
  const messages = useMemo(() => threadMessages(turns, liveTurns, pending), [turns, liveTurns, pending]);
  const citations = useMemo(() => citationIndex(messages), [messages]);
  const [state, dispatch] = useReducer(shellReducer, undefined, () => initialState(messages, fullMeta, host));

  useEffect(() => {
    dispatch({
      type: "hydrate",
      data: {
        thread: toThread(messages, fullMeta),
        projects: host ? host.projects : projectsFor(fullMeta),
        machines: host ? host.machines : machinesFor(fullMeta),
        activeContext: contextFor(fullMeta, messages.some((m) => m.parts.some((p) => p.type === "identity_dispute"))),
      },
    });
  }, [messages, fullMeta, host]);

  // Open shell layers join the app's one BACK stack (lib/transient-layer.ts):
  // hardware BACK closes the top layer before any tab navigation happens.
  const layer = topLayer(state);
  const layerRef = useRef(layer);
  layerRef.current = layer;
  useEffect(() => {
    if (!layer) return;
    return registerTransientLayer(() => {
      const current = layerRef.current;
      if (current) dispatch(closeLayerAction(current));
    });
  }, [layer]);

  const adapter = useMemo(() => createCapacitorAdapter({
    onAttachPhoto: handlers.onAttachPhoto,
    onAttachFile: handlers.onAttachFile,
  }), [handlers.onAttachPhoto, handlers.onAttachFile]);

  const hooks: HostHooks = {
    onSend: handlers.onSend,
    ...(canStop ? { onStop: handlers.onStop } : {}),
    ...(canRetry && handlers.onRetry ? { onRetry: () => handlers.onRetry?.() } : {}),
    onSource: (source) => {
      const citation: ChatCitation | undefined = citations.get(source.id);
      if (citation) handlers.onCitation(citation);
    },
    ...(host?.onNewChat ? { onNewChat: host.onNewChat } : {}),
    busy,
  };

  return <div className="unified-host" data-testid="unified-chat">
    {chatError != null && (
      <div className="fl-error" role="alert">
        <p>{chatError}</p>
        {canRetry && handlers.onRetry ? (
          <button type="button" onClick={() => handlers.onRetry?.()}>Retry</button>
        ) : null}
      </div>
    )}
    <FactoryLMShell
      state={state}
      dispatch={dispatch}
      adapter={adapter}
      hooks={hooks}
      onOpenItem={host?.onOpenItem}
      navigationFooter={host?.navigationFooter}
    />
  </div>;
}

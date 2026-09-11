import type { PlatformAdapter, ProjectItem, ShellAction, ShellState } from "@factorylm/interaction";
import { useEffect, useRef, type Dispatch, type ReactNode } from "react";
import { AssistantThread } from "./assistant/AssistantThread";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { Inspector } from "./Inspector";
import { Overlay, type LayerName } from "./Overlay";
import type { HostHooks } from "./parts";
import { SendError } from "./SendError";
import { Sidebar } from "./Sidebar";
import { SourceViewer } from "./SourceViewer";
import { ThreadHeader } from "./ThreadHeader";

export interface FactoryLMShellProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
  /** Optional live-host hooks (real send/stop/retry/citation viewer). Absent = fixture-only shell. */
  readonly hooks?: HostHooks;
  /** Host hook: open a project item (thread/run/file/finding) from the tree. */
  readonly onOpenItem?: (item: ProjectItem) => void;
  /** Host hook: a project row was selected from the tree. */
  readonly onSelectProject?: (projectId: string) => void;
  /** Host-owned controls rendered at the bottom of navigation. */
  readonly navigationFooter?: ReactNode;
  /**
   * Which conversation surface renders the turns. `classic` (default) is the
   * package's own list; `assistant` is the same bar, run card and parts on
   * assistant-ui primitives (viewport, autoscroll, jump-to-latest, run state).
   * The composer, header, navigation and layers are identical for both.
   */
  readonly conversationSurface?: ConversationSurface;
}

export type ConversationSurface = "classic" | "assistant";

/** Custom DOM event a host dispatches on `document` for a hardware Back press. */
export const BACK_EVENT = "factorylm:back";

function inspectorOpen(state: ShellState): boolean {
  return state.profile.enterpriseInspector && state.inspectorVisible && state.inspector !== undefined;
}

/** The navigation drawer is a closable layer only where it overlays the page. */
function navigationIsLayer(state: ShellState): boolean {
  return state.profile.kind === "mobile";
}

/**
 * Deterministic closing precedence: source viewer, attachment menu, inspector
 * sheet, navigation drawer. `null` means nothing is open and Back belongs to
 * the host.
 */
export function topLayer(state: ShellState): LayerName | null {
  if (state.selectedSource) return "source";
  if (state.attachmentMenuVisible) return "attachment-menu";
  if (inspectorOpen(state)) return "inspector";
  if (navigationIsLayer(state) && state.navigationVisible) return "navigation";
  return null;
}

export function closeLayerAction(layer: LayerName): ShellAction {
  switch (layer) {
    case "source": return { type: "select-source", sourceId: null };
    case "attachment-menu": return { type: "set-attachment-menu-visible", visible: false };
    case "inspector": return { type: "set-inspector-visible", visible: false };
    case "navigation": return { type: "set-navigation-visible", visible: false };
  }
}

export function FactoryLMShell({ state, dispatch, adapter, hooks, onOpenItem, onSelectProject, navigationFooter, conversationSurface = "classic" }: FactoryLMShellProps) {
  const mobile = navigationIsLayer(state);
  const sourceOpen = state.selectedSource !== null;
  // One scrim, for the top-most page-covering layer, in closing-precedence order.
  const scrimLayer: LayerName | null = sourceOpen
    ? "source"
    : state.attachmentMenuVisible
      ? "attachment-menu"
      : mobile && inspectorOpen(state)
        ? "inspector"
        : mobile && state.navigationVisible
          ? "navigation"
          : null;

  const top = topLayer(state);
  const closeTop = () => {
    const layer = top;
    if (layer) dispatch(closeLayerAction(layer));
    else adapter.onBack();
  };
  // The listeners subscribe once; they read the latest closeTop through a ref
  // so re-renders never re-subscribe two document listeners.
  const closeTopRef = useRef(closeTop);
  closeTopRef.current = closeTop;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      closeTopRef.current();
    };
    const onBack = (event: Event) => {
      event.preventDefault();
      closeTopRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener(BACK_EVENT, onBack);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener(BACK_EVENT, onBack);
    };
  }, []);

  return <div
    className="fl-shell"
    data-surface={state.profile.kind}
    data-theme={state.theme}
    data-mode={state.mode}
    data-navigation-visible={state.navigationVisible}
    data-top-layer={topLayer(state) ?? ""}
    data-conversation-surface={conversationSurface}
  >
    {scrimLayer ? <div className="fl-scrim" data-layer={scrimLayer} aria-hidden="true" onClick={closeTop} /> : null}
    <Overlay layer="navigation" active={state.navigationVisible} modal={mobile} trapsTab={top === "navigation"}>
      <Sidebar state={state} dispatch={dispatch} onOpenItem={onOpenItem} onSelectProject={onSelectProject} footer={navigationFooter} inert={mobile && !state.navigationVisible} hooks={hooks} />
    </Overlay>
    <main className="fl-shell__main">
      <ThreadHeader state={state} dispatch={dispatch} />
      {conversationSurface === "assistant"
        ? <AssistantThread state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} />
        : <Conversation state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} />}
      {state.sendError ? <SendError error={state.sendError} dispatch={dispatch} draft={state.draft} turnId={state.thread.turns.at(-1)?.id} hooks={hooks} /> : null}
      <Composer state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} attachmentTrapsTab={top === "attachment-menu"} />
    </main>
    <Overlay layer="inspector" active={inspectorOpen(state)} modal={mobile} trapsTab={top === "inspector"}>
      <Inspector state={state} />
    </Overlay>
    <Overlay layer="source" active={sourceOpen} modal>
      <SourceViewer state={state} dispatch={dispatch} />
    </Overlay>
  </div>;
}

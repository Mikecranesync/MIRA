import type { PlatformAdapter, ProjectItem, ShellAction, ShellState } from "@factorylm/interaction";
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { AssistantThread } from "./assistant/AssistantThread";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { DemoNotice } from "./DemoNotice";
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
   * Host-owned panel rendered between the demo notice and the conversation —
   * the public demo's machine view. A slot rather than a shell feature: the
   * shell should not know what a live machine looks like, and the component
   * that does (`MachineView`) enforces its own public-only rule.
   */
  readonly machinePanel?: ReactNode;
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

/**
 * The viewport at which `shell.css` turns the sidebar into a fixed overlay.
 *
 * Duplicated in two languages, which is the defect class this constant exists
 * to close: the stylesheet made the sidebar an overlay below 48rem for EVERY
 * surface, while the TypeScript asked `profile.kind === "mobile"`. A narrow
 * `public`/`web`/`hub` window therefore got a drawer covering the page with no
 * scrim, no tap-outside-to-close and no Escape - open by default, with only the
 * in-drawer close button to escape it.
 *
 * `navigation-drawer.test.tsx` asserts the stylesheet still contains exactly
 * this query, so the two cannot drift apart again in silence.
 */
export const NAVIGATION_LAYER_QUERY = "(max-width: 48rem)";

/**
 * The navigation drawer is a closable layer wherever it overlays the page.
 *
 * `narrowViewport` is what the stylesheet actually keys on. The phone profile
 * stays a layer unconditionally: that is existing shipped behaviour (the phone
 * host drives hardware Back through `topLayer`), and narrowing it here would be
 * a behaviour change smuggled into a bug fix. So this is a superset of the CSS
 * condition - a phone profile on a wide screen keeps its scrim-and-Escape
 * semantics for a sidebar the stylesheet renders statically. Pre-existing,
 * unchanged, and noted rather than quietly altered.
 *
 * The parameter defaults to `false` so `topLayer(state)` keeps its meaning for
 * existing callers (`mira-mobile/src/screens/UnifiedChat.tsx`), which pass a
 * phone profile and are unaffected either way.
 */
function navigationIsLayer(state: ShellState, narrowViewport = false): boolean {
  return state.profile.kind === "mobile" || narrowViewport;
}

/**
 * Deterministic closing precedence: source viewer, attachment menu, inspector
 * sheet, navigation drawer. `null` means nothing is open and Back belongs to
 * the host.
 */
export function topLayer(state: ShellState, narrowViewport = false): LayerName | null {
  if (state.selectedSource) return "source";
  if (state.attachmentMenuVisible) return "attachment-menu";
  if (inspectorOpen(state)) return "inspector";
  if (navigationIsLayer(state, narrowViewport) && state.navigationVisible) return "navigation";
  return null;
}

/**
 * Track the same media query the stylesheet uses, live.
 *
 * Subscribes rather than sampling once: a desktop window dragged narrow must
 * gain the scrim and Escape, and dragged wide must lose them, without a reload.
 * Returns `false` where there is no `matchMedia` (SSR, a stripped test DOM), so
 * the shell degrades to exactly its previous behaviour rather than throwing.
 */
function useNarrowViewport(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(NAVIGATION_LAYER_QUERY);
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    // `addListener` is the deprecated form, and the only one on Safari < 14 -
    // the phone host runs a WebView old enough for that to matter.
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    query.addListener(onChange);
    return () => query.removeListener(onChange);
  }, []);
  return narrow;
}

export function closeLayerAction(layer: LayerName): ShellAction {
  switch (layer) {
    case "source": return { type: "select-source", sourceId: null };
    case "attachment-menu": return { type: "set-attachment-menu-visible", visible: false };
    case "inspector": return { type: "set-inspector-visible", visible: false };
    case "navigation": return { type: "set-navigation-visible", visible: false };
  }
}

export function FactoryLMShell({ state, dispatch, adapter, hooks, onOpenItem, onSelectProject, navigationFooter, machinePanel, conversationSurface = "classic" }: FactoryLMShellProps) {
  const narrowViewport = useNarrowViewport();
  // `layered` rather than the old `mobile`: the drawer overlays the page on any
  // narrow viewport, which is what the stylesheet has always done.
  const layered = navigationIsLayer(state, narrowViewport);
  const sourceOpen = state.selectedSource !== null;
  // One scrim, for the top-most page-covering layer, in closing-precedence order.
  const scrimLayer: LayerName | null = sourceOpen
    ? "source"
    : state.attachmentMenuVisible
      ? "attachment-menu"
      : layered && inspectorOpen(state)
        ? "inspector"
        : layered && state.navigationVisible
          ? "navigation"
          : null;

  const top = topLayer(state, narrowViewport);
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
    data-top-layer={top ?? ""}
    data-conversation-surface={conversationSurface}
    /* Lets the stylesheet move the flexible grid row onto the conversation
       when a host inserts a machine panel above it — see shell.css. */
    data-machine-panel={machinePanel ? "true" : undefined}
  >
    {scrimLayer ? <div className="fl-scrim" data-layer={scrimLayer} aria-hidden="true" onClick={closeTop} /> : null}
    <Overlay layer="navigation" active={state.navigationVisible} modal={layered} trapsTab={top === "navigation"}>
      <Sidebar state={state} dispatch={dispatch} onOpenItem={onOpenItem} onSelectProject={onSelectProject} footer={navigationFooter} inert={layered && !state.navigationVisible} hooks={hooks} />
    </Overlay>
    <main className="fl-shell__main">
      <ThreadHeader state={state} dispatch={dispatch} />
      {/* Public surface only; a no-op elsewhere. Inside <main>, above the
          conversation, so it is read before any answer it qualifies. */}
      <DemoNotice state={state} hooks={hooks} />
      {/* The machine the conversation is about, above the conversation and
          smaller than it. */}
      {machinePanel}
      {conversationSurface === "assistant"
        ? <AssistantThread state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} />
        : <Conversation state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} />}
      {state.sendError ? <SendError error={state.sendError} dispatch={dispatch} draft={state.draft} turnId={state.thread.turns.at(-1)?.id} hooks={hooks} /> : null}
      <Composer state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} attachmentTrapsTab={top === "attachment-menu"} />
    </main>
    <Overlay layer="inspector" active={inspectorOpen(state)} modal={layered} trapsTab={top === "inspector"}>
      <Inspector state={state} />
    </Overlay>
    <Overlay layer="source" active={sourceOpen} modal>
      <SourceViewer state={state} dispatch={dispatch} />
    </Overlay>
  </div>;
}

import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { ComposeIcon, HamburgerIcon, InspectorIcon } from "./icons";
import type { HostHooks } from "./parts";

interface ThreadHeaderProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly hooks?: HostHooks;
}

/** The product mark shown above the thread title on phones. */
const BRAND = "FactoryLM";

export function ThreadHeader({ state, dispatch, hooks }: ThreadHeaderProps) {
  const canInspect = state.profile.enterpriseInspector && state.inspector !== undefined;
  // Both HOME hosts title the composer-home thread with the product name. The
  // mark is the product and the heading is the thread; when they are the same
  // word the phone header read "FactoryLM / FactoryLM", so the mark yields to
  // the heading and the name appears once.
  const showBrandMark = state.thread.title.trim() !== BRAND;
  // Same label as the drawer control (Sidebar): the public demo keeps no
  // history, so the action is "Start over", not "New chat".
  const newThreadLabel = state.profile.publicDemo ? "Start over" : "New chat";
  const onNewChat = hooks?.onNewChat;
  const newChatReason = state.profile.publicDemo
    ? "Start a fresh demo conversation once a host is connected."
    : "Not available in this workspace yet.";

  return <header className="fl-shell__header">
    <button
      className="fl-shell__navigation-toggle"
      type="button"
      aria-label="Open navigation"
      onClick={() => dispatch({ type: "set-navigation-visible", visible: true })}
    >
      <HamburgerIcon />
    </button>
    <div className="fl-shell__header-title">
      {/* The product mark, not the surface profile: `profile.kind` is lab metadata and
          never belongs in the technician's viewport. */}
      {showBrandMark ? <p className="fl-shell__brand-mark">{BRAND}</p> : null}
      <h1>{state.thread.title}</h1>
    </div>
    <div className="fl-shell__header-actions">
      {typeof onNewChat === "function"
        ? <button
          className="fl-shell__header-new-chat"
          type="button"
          aria-label={newThreadLabel}
          onClick={() => {
            onNewChat();
            dispatch({ type: "set-navigation-visible", visible: false });
          }}
        >
          <ComposeIcon />
        </button>
        : <>
          {/* `title` alone is mouse-only; the reason is also linked for screen
              readers (aria-describedby resolves a `hidden` node). Separate id from
              the drawer's reason, which is inert while the drawer is closed. */}
          <button
            className="fl-shell__header-new-chat"
            type="button"
            disabled
            aria-label={newThreadLabel}
            aria-describedby="fl-header-new-chat-reason"
            title={newChatReason}
          >
            <ComposeIcon />
          </button>
          <span id="fl-header-new-chat-reason" hidden>{newChatReason}</span>
        </>}
      {canInspect ? <button
        className="fl-shell__inspector-toggle"
        type="button"
        aria-pressed={state.inspectorVisible}
        onClick={() => dispatch({ type: "set-inspector-visible", visible: !state.inspectorVisible })}
      ><InspectorIcon />Inspector</button> : null}
    </div>
  </header>;
}

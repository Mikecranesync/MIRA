import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { HamburgerIcon, InspectorIcon } from "./icons";

interface ThreadHeaderProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
}

/** The product mark shown above the thread title on phones. */
const BRAND = "FactoryLM";

export function ThreadHeader({ state, dispatch }: ThreadHeaderProps) {
  const canInspect = state.profile.enterpriseInspector && state.inspector !== undefined;
  // Both HOME hosts title the composer-home thread with the product name. The
  // mark is the product and the heading is the thread; when they are the same
  // word the phone header read "FactoryLM / FactoryLM", so the mark yields to
  // the heading and the name appears once.
  const showBrandMark = state.thread.title.trim() !== BRAND;

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
    {canInspect ? <button
      className="fl-shell__inspector-toggle"
      type="button"
      aria-pressed={state.inspectorVisible}
      onClick={() => dispatch({ type: "set-inspector-visible", visible: !state.inspectorVisible })}
    ><InspectorIcon />Inspector</button> : null}
  </header>;
}

import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { HamburgerIcon, InspectorIcon } from "./icons";

interface ThreadHeaderProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
}

export function ThreadHeader({ state, dispatch }: ThreadHeaderProps) {
  const canInspect = state.profile.enterpriseInspector && state.inspector !== undefined;

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
      <p className="fl-shell__brand-mark">FactoryLM</p>
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

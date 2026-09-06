import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { InspectorIcon } from "./icons";

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
      onClick={() => dispatch({ type: "set-navigation-visible", visible: true })}
    >
      Open navigation
    </button>
    <div>
      <p className="fl-shell__eyebrow">{state.profile.kind}</p>
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

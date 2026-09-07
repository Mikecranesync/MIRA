import type { ProjectItem, ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch, ReactNode } from "react";
import { CloseIcon } from "./icons";
import { ProjectTree } from "./ProjectTree";

interface SidebarProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly onOpenItem?: (item: ProjectItem) => void;
  /** Host-owned controls at the bottom of navigation (account, updates, sign out). */
  readonly footer?: ReactNode;
}

export function Sidebar({ state, dispatch, onOpenItem, footer }: SidebarProps) {
  return <aside className="fl-shell__sidebar" aria-label="FactoryLM navigation">
    <div className="fl-shell__brand">FactoryLM</div>
    <button
      className="fl-shell__drawer-close"
      type="button"
      aria-label="Close navigation"
      onClick={() => dispatch({ type: "set-navigation-visible", visible: false })}
    >
      <CloseIcon />
    </button>
    <button className="fl-shell__new-chat" type="button" disabled title="New threads are not available yet">
      New chat
    </button>
    <ProjectTree projects={state.projects} state={state} dispatch={dispatch} onOpenItem={onOpenItem} />
    {footer ? <div className="fl-shell__nav-footer">{footer}</div> : null}
  </aside>;
}

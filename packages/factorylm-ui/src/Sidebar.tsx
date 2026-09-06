import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { ProjectTree } from "./ProjectTree";

interface SidebarProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
}

export function Sidebar({ state, dispatch }: SidebarProps) {
  return <aside className="fl-shell__sidebar" aria-label="FactoryLM navigation">
    <div className="fl-shell__brand">FactoryLM</div>
    <button className="fl-shell__new-chat" type="button" disabled title="New threads are not available yet">
      New chat
    </button>
    <ProjectTree projects={state.projects} state={state} dispatch={dispatch} />
  </aside>;
}

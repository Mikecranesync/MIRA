import type { PlatformAdapter, ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { Composer } from "./Composer";
import { Conversation } from "./Conversation";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { SourceViewer } from "./SourceViewer";
import { ThreadHeader } from "./ThreadHeader";

export interface FactoryLMShellProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
}

export function FactoryLMShell({ state, dispatch, adapter }: FactoryLMShellProps) {
  return <div
    className="fl-shell"
    data-surface={state.profile.kind}
    data-theme={state.theme}
    data-mode={state.mode}
    data-navigation-visible={state.navigationVisible}
  >
    <Sidebar state={state} dispatch={dispatch} />
    <main className="fl-shell__main">
      <ThreadHeader state={state} dispatch={dispatch} />
      <Conversation state={state} dispatch={dispatch} adapter={adapter} />
      <Composer state={state} dispatch={dispatch} adapter={adapter} />
    </main>
    <Inspector state={state} />
    <SourceViewer state={state} dispatch={dispatch} />
  </div>;
}

import type { PlatformAdapter, ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { Inspector } from "./Inspector";
import { Sidebar } from "./Sidebar";
import { ThreadHeader } from "./ThreadHeader";

export interface FactoryLMShellProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
}

export function FactoryLMShell({ state, dispatch, adapter }: FactoryLMShellProps) {
  void adapter;
  return <div
    className="fl-shell"
    data-surface={state.profile.kind}
    data-theme={state.theme}
    data-navigation-visible={state.navigationVisible}
  >
    <Sidebar state={state} dispatch={dispatch} />
    <main className="fl-shell__main">
      <ThreadHeader state={state} dispatch={dispatch} />
      <section className="fl-shell__placeholder" aria-label="Conversation placeholder">
        <p>Conversation is not available in this shell preview.</p>
      </section>
    </main>
    <Inspector state={state} />
  </div>;
}

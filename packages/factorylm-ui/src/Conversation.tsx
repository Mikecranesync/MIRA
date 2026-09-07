import type {
  ContextSnapshot,
  InteractionRun,
  InteractionTurn,
  PlatformAdapter,
  ProjectNode,
  ShellAction,
  ShellState,
} from "@factorylm/interaction";
import type { Dispatch } from "react";
import { PartRenderer, describeContext, lifecycleLabel, machineName, type HostHooks } from "./parts";

export interface ConversationProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly adapter: PlatformAdapter;
  readonly hooks?: HostHooks;
}

const ROLE_LABEL = { user: "You", assistant: "MIRA", system: "System" } as const;

function findFolderLabel(nodes: readonly ProjectNode[], folderId: string): string | undefined {
  for (const node of nodes) {
    if (node.kind !== "folder") continue;
    if (node.id === folderId) return node.label;
    const nested = findFolderLabel(node.children, folderId);
    if (nested) return nested;
  }
  return undefined;
}

export function breadcrumb(state: ShellState): readonly string[] {
  const crumbs: string[] = [];
  const project = state.projects.find((candidate) => candidate.id === state.activeContext.projectId);
  if (project) {
    crumbs.push(project.name);
    if (state.activeContext.folderId) {
      const folder = findFolderLabel(project.children, state.activeContext.folderId);
      if (folder) crumbs.push(folder);
    }
  }
  return crumbs;
}

/** A turn or run carries its own context line only when it differs from the current context
 *  (machine, identity, project or folder) — the chip at the top already says where we are. */
export function contextDiffers(state: ShellState, snapshot: ContextSnapshot): boolean {
  const now = state.activeContext;
  return snapshot.machineId !== now.machineId
    || snapshot.machineIdentity !== now.machineIdentity
    || (snapshot.projectId ?? undefined) !== (now.projectId ?? undefined)
    || (snapshot.folderId ?? undefined) !== (now.folderId ?? undefined);
}

function RunCard({ run, state }: { readonly run: InteractionRun; readonly state: ShellState }) {
  const completed = run.plan.filter((step) => step.status === "completed").length;
  return <section className="fl-run" aria-label="Diagnostic Run" data-run-status={run.status}>
    <div className="fl-run__head">
      <p className="fl-card__label">Diagnostic Run · {run.kind}</p>
      <p className="fl-card__meta">{lifecycleLabel(run.status)} · {completed}/{run.plan.length} steps</p>
    </div>
    <p className="fl-run__goal">{run.goal}</p>
    {contextDiffers(state, run.contextSnapshot)
      ? <p className="fl-card__meta" data-context-line="run">Context: {describeContext(state, run.contextSnapshot)}</p>
      : null}
    <ol className="fl-run__steps" aria-label="Plan steps">
      {run.plan.map((step) => <li key={step.id} className="fl-step" data-step-status={step.status}>
        <span className="fl-step__check" aria-hidden="true">{step.status === "completed" ? "✓" : ""}</span>
        <span><b>{step.title}</b> <span className="fl-card__meta">{step.status.replace("_", " ")}</span></span>
      </li>)}
    </ol>
    <p className="fl-card__label">Completion criteria</p>
    <ul className="fl-run__criteria">
      {run.completionCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
    </ul>
  </section>;
}

function Turn({ turn, state, dispatch, adapter, hooks }: ConversationProps & { readonly turn: InteractionTurn }) {
  const machine = machineName(state, turn.context.machineId);
  return <li
    className="fl-turn"
    data-turn-id={turn.id}
    data-role={turn.role}
    data-lifecycle={turn.lifecycle}
    data-context-machine-id={turn.context.machineId ?? ""}
  >
    <div className="fl-turn__head">
      <span className="fl-turn__role">{ROLE_LABEL[turn.role]}</span>
      {contextDiffers(state, turn.context)
        ? <span className="fl-card__meta" data-context-line="turn">{machine ? `${machine} · ${turn.context.machineIdentity.replace("_", " ")}` : "No machine context"}</span>
        : null}
    </div>
    <div className="fl-turn__parts">
      {turn.parts.map((part, index) => <PartRenderer
        key={`${turn.id}-${index}`}
        part={part}
        turn={turn}
        state={state}
        dispatch={dispatch}
        adapter={adapter}
        hooks={hooks}
      />)}
    </div>
  </li>;
}

export function Conversation({ state, dispatch, adapter, hooks }: ConversationProps) {
  const crumbs = breadcrumb(state);
  const machine = machineName(state, state.activeContext.machineId);

  return <section className="fl-conversation" aria-label="Conversation" data-mode={state.mode}>
    <div className="fl-conversation__bar">
      <nav className="fl-conversation__crumbs" aria-label="Breadcrumb">
        {crumbs.length > 0
          ? crumbs.map((crumb, index) => <span key={`${index}-${crumb}`}>{index > 0 ? " / " : ""}{crumb}</span>)
          : <span>Workspace</span>}
      </nav>
      <div className="fl-conversation__modes" role="group" aria-label="Mode">
        <button type="button" aria-pressed={state.mode === "ask"} onClick={() => dispatch({ type: "set-mode", mode: "ask" })}>Ask</button>
        <button type="button" aria-pressed={state.mode === "work"} onClick={() => dispatch({ type: "set-mode", mode: "work" })}>Work</button>
      </div>
      <span className="fl-chip" data-identity={state.activeContext.machineIdentity}>
        ● {machine ? `${machine} · ${state.activeContext.machineIdentity.replace("_", " ")}` : "No machine"}
      </span>
    </div>

    {state.mode === "work"
      ? (state.run
        ? <RunCard run={state.run} state={state} />
        : <p className="fl-conversation__notice" role="status">No diagnostic run exists for this thread in the lab.</p>)
      : null}

    {state.thread.turns.length === 0
      ? <p className="fl-conversation__empty">No turns yet.</p>
      : <ol className="fl-conversation__log" aria-label="Turns">
        {state.thread.turns.map((turn) => <Turn key={turn.id} turn={turn} state={state} dispatch={dispatch} adapter={adapter} hooks={hooks} />)}
      </ol>}
  </section>;
}

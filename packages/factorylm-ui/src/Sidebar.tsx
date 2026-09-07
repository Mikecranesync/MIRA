import type { ProjectItem, ProjectNode, ShellAction, ShellState } from "@factorylm/interaction";
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { ChatIcon, CloseIcon, ClockIcon, ComposeIcon, MachineIcon, RunIcon, SearchIcon } from "./icons";
import { ProjectTree } from "./ProjectTree";

interface SidebarProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly onOpenItem?: (item: ProjectItem) => void;
  /** Host-owned controls at the bottom of navigation (account, updates, sign out). */
  readonly footer?: ReactNode;
  /** The drawer is closed on a layered (mobile) profile: out of the tab order immediately. */
  readonly inert?: boolean;
}

/** Threads and runs anywhere in the workspace, in workspace order (the fixture/host order is the recency order). */
function recentItems(state: ShellState, limit = 5): ProjectItem[] {
  const out: ProjectItem[] = [];
  const walk = (nodes: readonly ProjectNode[]) => {
    for (const node of nodes) {
      if (node.kind === "folder") walk(node.children);
      else if (node.kind === "thread" || node.kind === "run") out.push(node);
    }
  };
  for (const project of state.projects) walk(project.children);
  return out.slice(0, limit);
}

/**
 * Exactly ONE row in the whole navigation is aria-current — the tree row
 * `currentTreeRowId` picks. Recent and Machines are references to objects
 * the tree already shows; when they point at the current object they carry
 * `data-active` (a quiet weight), never a second selection.
 *
 * Left navigation, in the order the plan fixes for every surface
 * (part-2 §6.1): identity → New chat → Search → Recent → Projects →
 * pinned machines → host footer (settings / user menu). On mobile the same
 * markup is the drawer; nothing is reordered or renamed per surface.
 */
export function Sidebar({ state, dispatch, onOpenItem, footer, inert }: SidebarProps) {
  const [query, setQuery] = useState("");
  const filter = query.trim() || undefined;
  const recent = recentItems(state).filter((item) => !filter || item.label.toLowerCase().includes(filter.toLowerCase()));
  const machines = state.machines.filter((machine) => !filter || machine.name.toLowerCase().includes(filter.toLowerCase()));

  // `inert` removes the closed drawer from focus and the accessibility tree at once;
  // the stylesheet's visibility flip is the belt for the slide animation. Toggled on
  // the node, not as a JSX prop: the package promises React >=18 <20, React 18's types
  // don't know `inert`, and React 19 treats an empty-string value as false.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.toggleAttribute("inert", Boolean(inert));
  }, [inert]);
  return <aside ref={root} className="fl-shell__sidebar" aria-label="FactoryLM navigation">
    <div className="fl-shell__nav-head">
      <div className="fl-shell__brand">FactoryLM</div>
      <button
        className="fl-shell__drawer-close"
        type="button"
        aria-label="Close navigation"
        onClick={() => dispatch({ type: "set-navigation-visible", visible: false })}
      >
        <CloseIcon />
      </button>
    </div>

    {/* Honestly unavailable: the interaction contract has no new-thread action yet, so the
        control says why instead of looking like a dim input. */}
    <button className="fl-shell__new-chat" type="button" disabled aria-describedby="fl-new-chat-reason">
      <ComposeIcon className="fl-shell__nav-icon" />New chat
    </button>
    <p id="fl-new-chat-reason" className="fl-shell__hint">Not available in this workspace yet.</p>

    <label className="fl-shell__search">
      <SearchIcon className="fl-shell__nav-icon" />
      <input
        type="search"
        aria-label="Search navigation"
        placeholder="Search"
        value={query}
        onChange={(event) => setQuery(event.currentTarget.value)}
      />
    </label>

    <div className="fl-shell__nav-scroll">
      <section className="fl-shell__nav-section" aria-labelledby="fl-nav-recent">
        <h2 id="fl-nav-recent" className="fl-shell__section-title"><ClockIcon className="fl-shell__nav-icon" />Recent</h2>
        {recent.length === 0
          ? <p className="fl-shell__empty">{filter ? "No matches." : "No conversations yet."}</p>
          : <ul className="fl-tree fl-tree--flat" aria-label="Recent conversations">
            {recent.map((item) => onOpenItem
              ? <li key={item.id}>
                <button
                  type="button"
                  className="fl-tree__row fl-tree__item-button"
                  data-kind={item.kind}
                  data-recent-id={item.id}
                  data-active={state.thread.id === item.id ? "true" : undefined}
                  onClick={() => { onOpenItem(item); dispatch({ type: "set-navigation-visible", visible: false }); }}
                >
                  <span className="fl-tree__icon" aria-hidden="true">{item.kind === "run" ? <RunIcon /> : <ChatIcon />}</span>
                  <span className="fl-tree__label">{item.label}</span>
                </button>
              </li>
              : <li key={item.id} className="fl-tree__item fl-tree__row" data-kind={item.kind} data-recent-id={item.id} data-active={state.thread.id === item.id ? "true" : undefined}>
                <span className="fl-tree__icon" aria-hidden="true">{item.kind === "run" ? <RunIcon /> : <ChatIcon />}</span>
                <span className="fl-tree__label">{item.label}</span>
              </li>)}
          </ul>}
      </section>

      <section className="fl-shell__nav-section" aria-labelledby="fl-nav-projects">
        <h2 id="fl-nav-projects" className="fl-shell__section-title">Projects</h2>
        <ProjectTree projects={state.projects} state={state} dispatch={dispatch} onOpenItem={onOpenItem} filter={filter} />
      </section>

      <section className="fl-shell__nav-section" aria-labelledby="fl-nav-machines">
        <h2 id="fl-nav-machines" className="fl-shell__section-title">Machines</h2>
        {machines.length === 0
          ? <p className="fl-shell__empty">{filter ? "No matches." : "No machines in this workspace."}</p>
          : <ul className="fl-tree fl-tree--flat" aria-label="Machines">
            {machines.map((machine) => <li key={machine.id}>
              <button
                type="button"
                className="fl-tree__row fl-tree__machine"
                data-kind="machine"
                data-pinned-machine-id={machine.id}
                data-machine-status={machine.status}
                data-active={state.activeContext.machineId === machine.id ? "true" : undefined}
                onClick={() => { dispatch({ type: "select-machine", machineId: machine.id }); dispatch({ type: "set-navigation-visible", visible: false }); }}
              >
                <span className="fl-tree__icon" aria-hidden="true"><MachineIcon /></span>
                <span className="fl-tree__label">{machine.name}</span>
                <span className="fl-tree__status" data-status={machine.status} aria-label={machine.status} />
              </button>
            </li>)}
          </ul>}
      </section>
    </div>

    {footer ? <div className="fl-shell__nav-footer">{footer}</div> : null}
  </aside>;
}

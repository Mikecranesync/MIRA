import type { ProjectItem, ProjectNode, ShellAction, ShellState } from "@factorylm/interaction";
import { useEffect, useRef, useState, type Dispatch, type ReactNode } from "react";
import { ChatIcon, CloseIcon, ClockIcon, ComposeIcon, FolderIcon, RunIcon, SearchIcon } from "./icons";
import { ProjectTree, openObjectId } from "./ProjectTree";
import type { HostHooks } from "./parts";

interface SidebarProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  readonly onOpenItem?: (item: ProjectItem) => void;
  readonly onSelectProject?: (projectId: string) => void;
  /** Host-owned controls at the bottom of navigation (account, updates, sign out). */
  readonly footer?: ReactNode;
  /** The drawer is closed on a layered (mobile) profile: out of the tab order immediately. */
  readonly inert?: boolean;
  readonly hooks?: HostHooks;
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
 * `currentTreeRowId` picks. Recent rows are references to that same object:
 * the one pointing at the open object carries `data-active` (a quiet weight),
 * never a second selection.
 *
 * The pinned machine carries `data-context`, NOT `data-active`. Machine context
 * and open-object selection are different facts — a run is open AND it is being
 * run on a machine, both at once — and overloading one attribute for both meant
 * Work+run marked two objects active at the same time (Codex P1 on #3651, second
 * pass). `data-active` now means exactly one thing: "this reference points at the
 * open object", so a whole-navigation assertion can hold it to exactly one.
 *
 * Left navigation, ChatGPT hierarchy (UI-replacement brief §6):
 * identity → New chat → Search → Projects (threads nested) → Recent →
 * host footer (settings / user menu). Machines are reached through their
 * Project, not a competing top-level section. On mobile the same
 * markup is the drawer; nothing is reordered or renamed per surface.
 */
/**
 * The ONE open object for reference lists — the same object the tree marks current
 * (`openObjectId`). Work with a run selects the run exclusively (its owning thread is
 * not active); Work without a run and Ask select the thread. Codex P1 on #3651: the
 * previous version let every non-run row fall through to the thread, so run and
 * thread were both active at once.
 */
function isOpenItem(state: ShellState, itemId: string): boolean {
  return openObjectId(state) === itemId;
}

export function Sidebar({ state, dispatch, onOpenItem, onSelectProject, footer, inert, hooks }: SidebarProps) {
  const onNewChat = hooks?.onNewChat;
  const onCreateProject = hooks?.onCreateProject;
  const [query, setQuery] = useState("");
  const filter = query.trim() || undefined;
  const recent = recentItems(state).filter((item) => !filter || item.label.toLowerCase().includes(filter.toLowerCase()));

  // `inert` removes the closed drawer from focus and the accessibility tree at once;
  // the stylesheet's visibility flip is the belt for the slide animation. Toggled on
  // the node, not as a JSX prop: the package promises React >=18 <20, React 18's types
  // don't know `inert`, and React 19 treats an empty-string value as false.
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    root.current?.toggleAttribute("inert", Boolean(inert));
  }, [inert]);
  // "New chat" implies a list to add to. The public demo keeps no history, so the
  // control is named for what it actually does there. Declared once: labelling
  // only the enabled branch would leave the disabled state still saying
  // "New chat" on the same surface.
  const newThreadLabel = state.profile.publicDemo ? "Start over" : "New chat";

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

    {typeof onNewChat === "function"
      ? <button
        className="fl-shell__new-chat"
        type="button"
        onClick={() => { onNewChat(); dispatch({ type: "set-navigation-visible", visible: false }); }}
      >
        {/* "New chat" implies a list to add to. The public demo keeps no
            history, so the same control is labelled for what it actually does
            there: discard this demo conversation and begin again. */}
        <ComposeIcon className="fl-shell__nav-icon" />{newThreadLabel}
      </button>
      : <>
        {/* No host to create a thread (the disconnected lab): honestly disabled, with the reason
            linked, instead of a dim input or a button that does nothing. */}
        <button className="fl-shell__new-chat" type="button" disabled aria-describedby="fl-new-chat-reason">
          <ComposeIcon className="fl-shell__nav-icon" />{newThreadLabel}
        </button>
        <p id="fl-new-chat-reason" className="fl-shell__hint">{state.profile.publicDemo
          ? "Start a fresh demo conversation once a host is connected."
          : "Not available in this workspace yet."}</p>
      </>}

    {state.profile.publicDemo
      // Projects persist; the public demo does not. Convert instead of showing a
      // disabled control -- "not available" reads as a missing feature, when the
      // truth is it needs a workspace of your own.
      ? (typeof hooks?.onConvert === "function"
        ? <button
          className="fl-shell__new-project"
          type="button"
          data-intent="create-workspace"
          onClick={() => { hooks.onConvert?.("create-workspace"); dispatch({ type: "set-navigation-visible", visible: false }); }}
        >
          <FolderIcon className="fl-shell__nav-icon" />Create workspace to save Projects
        </button>
        : <>
          <button className="fl-shell__new-project" type="button" disabled aria-describedby="fl-demo-project-reason">
            <FolderIcon className="fl-shell__nav-icon" />New project
          </button>
          <p id="fl-demo-project-reason" className="fl-shell__hint">Projects are saved to a workspace of your own.</p>
        </>)
      : typeof onCreateProject === "function"
      ? <button
        className="fl-shell__new-project"
        type="button"
        onClick={() => { onCreateProject(); dispatch({ type: "set-navigation-visible", visible: false }); }}
      >
        <FolderIcon className="fl-shell__nav-icon" />New project
      </button>
      : <>
        {/* No host to create a project (the disconnected lab): honestly disabled, with the reason
            linked, instead of a dim input or a button that does nothing. */}
        <button className="fl-shell__new-project" type="button" disabled aria-describedby="fl-new-project-reason">
          <FolderIcon className="fl-shell__nav-icon" />New project
        </button>
        <p id="fl-new-project-reason" className="fl-shell__hint">Not available in this workspace yet.</p>
      </>}

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
      <section className="fl-shell__nav-section" aria-labelledby="fl-nav-projects">
        <h2 id="fl-nav-projects" className="fl-shell__section-title">Projects</h2>
        <ProjectTree projects={state.projects} state={state} dispatch={dispatch} onOpenItem={onOpenItem} onSelectProject={onSelectProject} filter={filter} />
      </section>

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
                  data-active={isOpenItem(state, item.id) ? "true" : undefined}
                  onClick={() => { onOpenItem(item); dispatch({ type: "set-navigation-visible", visible: false }); }}
                >
                  <span className="fl-tree__icon" aria-hidden="true">{item.kind === "run" ? <RunIcon /> : <ChatIcon />}</span>
                  <span className="fl-tree__label">{item.label}</span>
                </button>
              </li>
              : <li key={item.id} className="fl-tree__item fl-tree__row" data-kind={item.kind} data-recent-id={item.id} data-active={isOpenItem(state, item.id) ? "true" : undefined}>
                <span className="fl-tree__icon" aria-hidden="true">{item.kind === "run" ? <RunIcon /> : <ChatIcon />}</span>
                <span className="fl-tree__label">{item.label}</span>
              </li>)}
          </ul>}
      </section>

    </div>

    {footer ? <div className="fl-shell__nav-footer">{footer}</div> : null}
  </aside>;
}

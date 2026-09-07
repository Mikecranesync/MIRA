import type { Project, ProjectItem, ProjectNode, ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch, ReactNode } from "react";
import { ChatIcon, ChevronIcon, DocumentIcon, FindingIcon, FolderIcon, MachineIcon, RunIcon } from "./icons";

interface ProjectTreeProps {
  readonly projects: readonly Project[];
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
  /** Host hook: open a thread/run/file/finding item. Absent = items are inert labels. */
  readonly onOpenItem?: (item: ProjectItem) => void;
  /** Case-insensitive label filter (the navigation Search box); ancestors of a match stay visible. */
  readonly filter?: string;
}

/**
 * The single "current" row. Exactly one row carries aria-current="page":
 * in Work mode the open run, else the open thread (Ask mode ignores a retained run), if it is in the tree, else the active machine's link
 * (the one under the selected folder when the machine appears twice), else
 * the selected folder, else the selected project. Ancestors of the current
 * row get data-path="true" — a quiet "you are inside this" treatment, not a
 * second selection.
 */
export function currentTreeRowId(state: ShellState, projects: readonly Project[]): string | undefined {
  const items = flatten(projects);
  // In Work mode the open run is what the user is inside, so it outranks the thread; in Ask
  // mode a retained run is background and the open thread (or machine) is current.
  const openIds = (state.mode === "work" ? [state.run?.id, state.thread.id] : [state.thread.id]).filter((id): id is string => Boolean(id));
  for (const id of openIds) {
    const open = items.find((entry) => entry.node.kind !== "folder" && entry.node.kind !== "machine-link" && entry.node.id === id);
    if (open) return open.node.id;
  }
  const machineId = state.activeContext.machineId;
  if (machineId) {
    const links = items.filter((entry) => entry.node.kind === "machine-link" && entry.node.machineId === machineId);
    const inFolder = links.find((entry) => state.selectedFolderId !== undefined && entry.ancestors.includes(state.selectedFolderId));
    const pick = inFolder ?? links[0];
    if (pick) return pick.node.id;
  }
  if (state.selectedFolderId) return state.selectedFolderId;
  return state.selectedProjectId;
}

interface FlatEntry {
  readonly node: ProjectNode;
  readonly projectId: string;
  readonly ancestors: readonly string[];
}

function flatten(projects: readonly Project[]): FlatEntry[] {
  const out: FlatEntry[] = [];
  const walk = (nodes: readonly ProjectNode[], projectId: string, ancestors: readonly string[]) => {
    for (const node of nodes) {
      out.push({ node, projectId, ancestors });
      if (node.kind === "folder") walk(node.children, projectId, [...ancestors, node.id]);
    }
  };
  for (const project of projects) walk(project.children, project.id, [project.id]);
  return out;
}

function ancestorsOf(current: string | undefined, projects: readonly Project[]): ReadonlySet<string> {
  if (!current) return new Set();
  const entry = flatten(projects).find((candidate) => candidate.node.id === current);
  return new Set(entry ? entry.ancestors : []);
}

function matches(label: string, filter: string | undefined): boolean {
  return !filter || label.toLowerCase().includes(filter.toLowerCase());
}

/**
 * A node renders under a filter when its label matches, when a descendant matches, or when it
 * IS the current row / an ancestor of it — the selection never disappears from the tree, so the
 * whole navigation keeps exactly one aria-current row while results exist (Codex P2, #3651).
 */
function subtreeMatches(node: ProjectNode, filter: string | undefined, keep: ReadonlySet<string>): boolean {
  if (keep.has(node.id) || matches(node.label, filter)) return true;
  return node.kind === "folder" && node.children.some((child) => subtreeMatches(child, filter, keep));
}

const ITEM_ICON = { thread: ChatIcon, run: RunIcon, file: DocumentIcon, finding: FindingIcon } as const;
const ITEM_KIND_LABEL = { thread: "Chat", run: "Run", file: "File", finding: "Finding" } as const;

/** One row pattern for every object type: disclosure column, type icon, label, optional muted metadata. */
function Row({ kind, current, onPath, disclosure, icon, label, meta, ...rest }: {
  readonly kind: string;
  readonly current: boolean;
  readonly onPath: boolean;
  readonly disclosure: boolean;
  readonly icon: ReactNode;
  readonly label: string;
  readonly meta?: string;
  readonly className: string;
  readonly onClick?: () => void;
  readonly [data: `data-${string}`]: string | undefined;
}) {
  return <button
    type="button"
    aria-current={current ? "page" : undefined}
    data-kind={kind}
    data-path={onPath ? "true" : undefined}
    {...rest}
  >
    <span className="fl-tree__disclosure" aria-hidden="true">{disclosure ? <ChevronIcon className="fl-tree__chevron" /> : null}</span>
    <span className="fl-tree__icon" aria-hidden="true">{icon}</span>
    <span className="fl-tree__label">{label}</span>
    {meta ? <span className="fl-tree__meta">{meta}</span> : null}
  </button>;
}

export function ProjectTree({ projects, state, dispatch, onOpenItem, filter }: ProjectTreeProps) {
  if (projects.length === 0) return <p className="fl-shell__empty">No projects in this workspace.</p>;
  const current = currentTreeRowId(state, projects);
  const path = ancestorsOf(current, projects);
  const keep = new Set<string>([...path, ...(current ? [current] : [])]);
  const visible = projects.filter((project) => keep.has(project.id) || matches(project.name, filter) || project.children.some((child) => subtreeMatches(child, filter, keep)));
  if (visible.length === 0) return <p className="fl-shell__empty" role="status">No matches.</p>;

  return <ul className="fl-tree" aria-label="Projects">
    {visible.map((project) => (
      <li key={project.id}>
        <Row
          kind="project"
          className="fl-tree__row fl-tree__project"
          data-project-id={project.id}
          current={current === project.id}
          onPath={path.has(project.id)}
          disclosure
          icon={<FolderIcon />}
          label={project.name}
          onClick={() => selectAndCloseNavigation(dispatch, { type: "select-project", projectId: project.id })}
        />
        <Nodes nodes={project.children} state={state} dispatch={dispatch} onOpenItem={onOpenItem} filter={filter} current={current} path={path} keep={keep} />
      </li>
    ))}
  </ul>;
}

function Nodes({ nodes, state, dispatch, onOpenItem, filter, current, path, keep }: Omit<ProjectTreeProps, "projects"> & {
  readonly nodes: readonly ProjectNode[];
  readonly current: string | undefined;
  readonly path: ReadonlySet<string>;
  readonly keep: ReadonlySet<string>;
}) {
  const shown = nodes.filter((node) => subtreeMatches(node, filter, keep));
  if (shown.length === 0) return null;
  return <ul className="fl-tree__children">
    {shown.map((node) => {
      if (node.kind === "folder") {
        return <li key={node.id}>
          <Row
            kind="folder"
            className="fl-tree__row fl-tree__folder"
            data-folder-id={node.id}
            current={current === node.id}
            onPath={path.has(node.id)}
            disclosure
            icon={<FolderIcon />}
            label={node.label}
            onClick={() => selectAndCloseNavigation(dispatch, { type: "select-folder", folderId: node.id })}
          />
          <Nodes nodes={node.children} state={state} dispatch={dispatch} onOpenItem={onOpenItem} filter={filter} current={current} path={path} keep={keep} />
        </li>;
      }
      if (node.kind === "machine-link") {
        const machine = state.machines.find((candidate) => candidate.id === node.machineId);
        return <li key={node.id}>
          <Row
            kind="machine"
            className="fl-tree__row fl-tree__machine"
            data-machine-id={node.machineId}
            data-machine-status={machine?.status}
            current={current === node.id}
            onPath={false}
            disclosure={false}
            icon={<MachineIcon />}
            label={node.label}
            meta="Machine"
            onClick={() => selectAndCloseNavigation(dispatch, { type: "select-machine", machineId: node.machineId })}
          />
        </li>;
      }
      const Icon = ITEM_ICON[node.kind];
      if (!onOpenItem) {
        // No host to open it: a label in the same row pattern, never a dead button.
        return <li key={node.id} className="fl-tree__item fl-tree__row" data-kind={node.kind} data-item-kind={node.kind} aria-current={current === node.id ? "page" : undefined}>
          <span className="fl-tree__disclosure" aria-hidden="true" />
          <span className="fl-tree__icon" aria-hidden="true"><Icon /></span>
          <span className="fl-tree__label">{node.label}</span>
          <span className="fl-tree__meta">{ITEM_KIND_LABEL[node.kind]}</span>
        </li>;
      }
      return <li key={node.id}>
        <Row
          kind={node.kind}
          className="fl-tree__row fl-tree__item-button"
          data-item-id={node.id}
          data-item-kind={node.kind}
          current={current === node.id}
          onPath={false}
          disclosure={false}
          icon={<Icon />}
          label={node.label}
          meta={ITEM_KIND_LABEL[node.kind]}
          onClick={() => { onOpenItem(node); dispatch({ type: "set-navigation-visible", visible: false }); }}
        />
      </li>;
    })}
  </ul>;
}

function selectAndCloseNavigation(dispatch: Dispatch<ShellAction>, action: ShellAction) {
  dispatch(action);
  dispatch({ type: "set-navigation-visible", visible: false });
}

import type { Project, ProjectNode, ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { ChevronIcon } from "./icons";

interface ProjectTreeProps {
  readonly projects: readonly Project[];
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
}

export function ProjectTree({ projects, state, dispatch }: ProjectTreeProps) {
  if (projects.length === 0) return <p className="fl-shell__empty">No projects in this workspace.</p>;

  return <ul className="fl-tree" aria-label="Projects">
    {projects.map((project) => (
      <li key={project.id}>
        <button
          type="button"
          className="fl-tree__project"
          data-project-id={project.id}
          aria-current={state.selectedProjectId === project.id ? "page" : undefined}
          onClick={() => selectAndCloseNavigation(dispatch, { type: "select-project", projectId: project.id })}
        >
          {project.name}
        </button>
        <Nodes nodes={project.children} state={state} dispatch={dispatch} />
      </li>
    ))}
  </ul>;
}

function Nodes({ nodes, state, dispatch }: Omit<ProjectTreeProps, "projects"> & { readonly nodes: readonly ProjectNode[] }) {
  return <ul className="fl-tree__children">
    {nodes.map((node) => {
      if (node.kind === "folder") {
        return <li key={node.id}>
          <button
            type="button"
            className="fl-tree__folder"
            data-folder-id={node.id}
            aria-current={state.selectedFolderId === node.id ? "page" : undefined}
            onClick={() => selectAndCloseNavigation(dispatch, { type: "select-folder", folderId: node.id })}
          >
            <ChevronIcon className="fl-tree__chevron" />{node.label}
          </button>
          <Nodes nodes={node.children} state={state} dispatch={dispatch} />
        </li>;
      }
      if (node.kind === "machine-link") {
        return <li key={node.id}>
          <button
            type="button"
            className="fl-tree__machine"
            data-machine-id={node.machineId}
            aria-current={state.activeContext.machineId === node.machineId ? "page" : undefined}
            onClick={() => selectAndCloseNavigation(dispatch, { type: "select-machine", machineId: node.machineId })}
          >
            {node.label}
          </button>
        </li>;
      }
      return <li className="fl-tree__item" key={node.id}>{node.label}</li>;
    })}
  </ul>;
}

function selectAndCloseNavigation(dispatch: Dispatch<ShellAction>, action: ShellAction) {
  dispatch(action);
  dispatch({ type: "set-navigation-visible", visible: false });
}

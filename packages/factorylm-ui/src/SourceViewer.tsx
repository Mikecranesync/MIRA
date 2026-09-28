import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";

export interface SourceViewerProps {
  readonly state: ShellState;
  readonly dispatch: Dispatch<ShellAction>;
}

const KIND_LABEL = {
  oem_documentation: "OEM documentation",
  workspace_file: "Workspace file",
  machine_history: "Machine history",
} as const;

export function SourceViewer({ state, dispatch }: SourceViewerProps) {
  const source = state.selectedSource;
  if (!source) return null;

  return <aside className="fl-source-viewer" role="dialog" aria-modal="true" aria-label="Source viewer" data-source-id={source.id}>
    <div className="fl-source-viewer__head">
      <p className="fl-card__label">{KIND_LABEL[source.kind]}</p>
      <button type="button" aria-label="Close source viewer" onClick={() => dispatch({ type: "select-source", sourceId: null })}>Close</button>
    </div>
    <h2>{source.title}</h2>
    <p className="fl-source-viewer__locator">{source.locator}</p>
    <p className="fl-card__meta">Document content is not connected in this disconnected lab; the citation locator above is the authoritative reference.</p>
  </aside>;
}

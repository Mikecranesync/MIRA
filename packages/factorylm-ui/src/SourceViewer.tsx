import type { ShellAction, ShellState } from "@factorylm/interaction";
import type { Dispatch } from "react";
import { isSameSite, openableUrl } from "./links";

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

  // Open the document the way any site does: a same-site original (a parked
  // PDF at its cited page, or the photograph a doc was read from) is shown
  // right here; an off-site manual opens in a new tab, since other sites
  // refuse to be framed. Without an address the locator is the reference.
  const href = openableUrl(source.href);
  const inline = href !== null && isSameSite(href);
  return <aside className={`fl-source-viewer${inline ? " fl-source-viewer--document" : ""}`} role="dialog" aria-modal="true" aria-label="Source viewer" data-source-id={source.id}>
    <div className="fl-source-viewer__head">
      <p className="fl-card__label">{KIND_LABEL[source.kind]}</p>
      <button type="button" aria-label="Close source viewer" onClick={() => dispatch({ type: "select-source", sourceId: null })}>Close</button>
    </div>
    <h2>{source.title}</h2>
    <p className="fl-source-viewer__locator">{source.locator}</p>
    {href ? <a className="fl-source-viewer__open" href={href} target="_blank" rel="noopener noreferrer">Open document in a new tab</a> : null}
    {inline ? <iframe className="fl-source-viewer__frame" title={source.title} src={href} /> : null}
    {href ? null : <p className="fl-card__meta">The original document isn&apos;t available to open here; the citation locator above is the reference.</p>}
  </aside>;
}

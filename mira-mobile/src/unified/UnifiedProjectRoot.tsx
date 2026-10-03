import type { ProjectItem } from "@factorylm/interaction";
import "@factorylm/ui/shell.css";
import "./unified-project-root.css";

/**
 * #4188: where hardware BACK from a notebook's chat thread lands, instead of
 * the empty global-home composer. Shows the project's real title (the same
 * `Project.name` the drawer's ProjectTree already renders — tag · name for a
 * bound machine, display name otherwise) and its recent threads, most recent
 * first, so the thread just left is one tap away — not buried behind
 * hamburger → project → "… Chat".
 *
 * Deliberately NOT `ProjectTree`: that component needs a live `ShellState` +
 * `dispatch` (the reducer UnifiedChat owns) to resolve its machine-link rows
 * and "current" highlighting — wiring a parallel reducer here just to list
 * one project's threads would be new interaction code for no behavior gain
 * (.claude/rules/commodity-before-custom.md). This reuses the SAME row
 * pattern (`fl-tree` classes from `@factorylm/ui/shell.css`) and the exact
 * same open path the drawer uses (`onOpenThread` is `host.onOpenItem`).
 */
export interface UnifiedProjectRootProps {
  readonly title: string;
  /** Most-recent-first; `UnifiedRoot` derives this from `Project.children`. */
  readonly threads: readonly ProjectItem[];
  readonly onOpenThread: (item: ProjectItem) => void;
  readonly onNewChat: () => void;
  readonly onBack: () => void;
}

export function UnifiedProjectRoot({ title, threads, onOpenThread, onNewChat, onBack }: UnifiedProjectRootProps) {
  return (
    <div className="unified-root unified-project-root" data-testid="unified-project-root">
      <header className="unified-project-root__header">
        <button type="button" className="unified-project-root__back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div>
          <p className="fl-card__label">FactoryLM</p>
          <h1>{title}</h1>
        </div>
      </header>
      <main className="unified-project-root__content">
        {/* "+ New chat", not "New chat": a draft thread's own row title is
            literally "New chat" (NotebookScreen/UnifiedRoot's `draftThreadId`
            injection), so a bare "New chat" label here would collide with
            that row's accessible name whenever a draft is present. */}
        <button type="button" className="unified-project-root__new-chat" onClick={onNewChat}>
          + New chat
        </button>
        {threads.length === 0 ? (
          <p className="unified-project-root__empty">No conversations yet.</p>
        ) : (
          <ul className="unified-project-root__threads fl-tree" aria-label="Recent chats">
            {threads.map((thread) => (
              <li key={thread.id}>
                <button
                  type="button"
                  className="fl-tree__row fl-tree__item-button unified-project-root__thread"
                  data-item-id={thread.id}
                  onClick={() => onOpenThread(thread)}
                >
                  <span className="fl-tree__label">{thread.label}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

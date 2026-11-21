/**
 * Reopening a project from the sidebar (#4681).
 *
 * A sidebar project click used to mint a blank thread every time, so a technician
 * who left a project and came back found their conversation gone from view. A
 * click on a project now resumes that project's newest saved conversation and
 * mints a fresh chat only when the project has none.
 *
 * This is deliberately separate from `openNotebookSelection`, which keeps its
 * #4444 meaning (an explicit fresh link / equipment offer starts a new chat).
 * New chat, HOME and a link naming a thread are untouched.
 *
 * Input is the notebook's thread summaries as the list route already returns
 * them (the server caps that list); it is read as-is, in any order, and never
 * trusted: a summary for another notebook or with a malformed id is ignored.
 */
import { LEGACY_THREAD_ID, type HubNotebook, type HubThreadSummary } from "./notebook-tree";
import { newThreadId, type HubSelection } from "./hub-host-logic";

/** The server's thread-id grammar (same as `selectionFromSearch`'s) plus the legacy marker. */
const THREAD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function stamp(iso: unknown): number {
  const ms = typeof iso === "string" ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

/** A real saved conversation of THIS notebook: a well-formed id and at least one turn. */
function isResumable(t: HubThreadSummary, notebookId: string): boolean {
  if (!t || t.notebookId !== notebookId || typeof t.id !== "string") return false;
  if (t.id !== LEGACY_THREAD_ID && !THREAD_ID_RE.test(t.id)) return false;
  return Number.isFinite(t.turnCount) && t.turnCount > 0;
}

/** Newest first: updatedAt, then createdAt, then id (so equal timestamps never depend on input order). */
function newestFirst(a: HubThreadSummary, b: HubThreadSummary): number {
  return (
    stamp(b.updatedAt) - stamp(a.updatedAt) ||
    stamp(b.createdAt) - stamp(a.createdAt) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/** The thread a project click opens: the newest saved conversation, else a freshly minted one. */
export function resumeProjectSelection(
  nb: Pick<HubNotebook, "id"> & { threads?: readonly HubThreadSummary[] },
  mint: () => string = newThreadId,
): HubSelection {
  const saved = (nb.threads ?? []).filter((t) => isResumable(t, nb.id));
  if (saved.length === 0) return { notebookId: nb.id, threadId: mint() };
  const newest = saved.reduce((best, t) => (newestFirst(t, best) < 0 ? t : best));
  return { notebookId: nb.id, threadId: newest.id };
}

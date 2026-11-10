/**
 * #5089: the fixes a technician saved on a project ("Record what fixed it"), read back from
 * GET /api/equipment-notebooks/[id]/fixes/ so they are visible after a reload.
 *
 * Read-only and deterministic: no model call, no write, and nothing here feeds MIRA's answers.
 * The server already scopes the list to the machine the project is bound to now.
 */

/** What the list shows for one saved fix. */
export interface SavedFix {
  id: string;
  symptom: string;
  faultCode: string | null;
  fix: string;
  createdAt: string;
}

export interface SavedFixesPage {
  fixes: SavedFix[];
  /** Id to ask the next page with, or null when everything is shown. */
  nextCursor: string | null;
  /** true: bound to a confirmed machine. null: no machine picked. false: picked, not confirmed. */
  assetConfirmed: boolean | null;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function parseFix(raw: unknown): SavedFix | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = text(r.id);
  const symptom = text(r.symptom);
  const fix = text(r.fix);
  if (!id || !symptom || !fix) return null;
  return { id, symptom, faultCode: text(r.faultCode), fix, createdAt: text(r.createdAt) ?? "" };
}

/** A fixes page from the route's JSON, or null when the body is not one. */
export function parseFixesPage(body: unknown): SavedFixesPage | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.fixes)) return null;
  const fixes = b.fixes.map(parseFix).filter((f): f is SavedFix => f !== null);
  const assetConfirmed = b.assetConfirmed === true ? true : b.assetConfirmed === false ? false : null;
  return { fixes, nextCursor: text(b.nextCursor), assetConfirmed };
}

/** One page of the project's saved fixes, or null when the read is refused or fails. */
export async function loadSavedFixes(
  fetchImpl: typeof fetch,
  apiBase: string,
  notebookId: string,
  before?: string,
): Promise<SavedFixesPage | null> {
  const url = `${apiBase}/api/equipment-notebooks/${encodeURIComponent(notebookId)}/fixes/`;
  try {
    const res = await fetchImpl(before ? `${url}?before=${encodeURIComponent(before)}` : url, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    return parseFixesPage(await res.json());
  } catch {
    return null;
  }
}

/**
 * The page to draw, or null for "draw nothing": the read failed, or a machine is picked but not
 * yet confirmed (the server lists no fix for an unconfirmed machine, and neither does the screen).
 */
export function pageToShow(page: SavedFixesPage | null): SavedFixesPage | null {
  return page && page.assetConfirmed !== false ? page : null;
}

/** The next page after what is shown; a record already shown is not added again. */
export function mergeFixPages(shown: SavedFix[], next: SavedFix[]): SavedFix[] {
  const seen = new Set(shown.map((f) => f.id));
  return [...shown, ...next.filter((f) => !seen.has(f.id))];
}

/** What the list holds: the fixes shown, where the next page starts, and the Show more state. */
export type FixesState = {
  fixes: SavedFix[];
  cursor: string | null;
  assetConfirmed: boolean | null;
  loadingMore: boolean;
  moreError: string | null;
} | null;

export type FixesEvent =
  /** The list was read from the top (first load, after a save). `null` = the read failed. */
  | { type: "first-page"; page: SavedFixesPage | null }
  | { type: "more-started" }
  /** The page after `before` came back. `null` = the read failed. */
  | { type: "more-loaded"; before: string; page: SavedFixesPage | null };

export function fixesReducer(state: FixesState, event: FixesEvent): FixesState {
  switch (event.type) {
    case "first-page": {
      // A failed re-read keeps what is already shown; it does not blank a list the technician is reading.
      if (event.page === null) return state;
      const page = pageToShow(event.page);
      if (!page) return null;
      // A re-read replaces the list, so a Show more that was in flight is over: never left on "Loading".
      return { fixes: page.fixes, cursor: page.nextCursor, assetConfirmed: page.assetConfirmed, loadingMore: false, moreError: null };
    }
    case "more-started":
      return state && state.cursor && !state.loadingMore ? { ...state, loadingMore: true, moreError: null } : state;
    case "more-loaded": {
      // Only the page that continues THIS list: an answer that starts after another list's last
      // record is dropped. One that starts after this list's last record is the right next page
      // whoever asked for it.
      if (!state || state.cursor !== event.before) return state;
      if (!event.page) return { ...state, loadingMore: false, moreError: "More saved fixes could not be loaded." };
      return { ...state, fixes: mergeFixPages(state.fixes, event.page.fixes), cursor: event.page.nextCursor, loadingMore: false };
    }
  }
}

export function savedFixesPillLabel(shown: number, hasMore: boolean): string {
  return `Saved fixes (${shown}${hasMore ? "+" : ""})`;
}

export function savedFixesHeading(assetConfirmed: boolean | null): string {
  return assetConfirmed === true ? "Saved fixes for this machine" : "Saved fixes in this project";
}

/** When the fix was saved, in the reader's locale and zone; blank when the time cannot be read. */
export function fixWhenLabel(iso: string, locale?: string, timeZone?: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone });
}

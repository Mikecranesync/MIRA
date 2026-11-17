/**
 * Paged equipment navigation: the same browse-vs-target split as
 * `equipment-nav.ts`, over a source that serves one page at a time.
 *
 * The item and page shapes mirror the Hub equipment-browser contract
 * (`mira-hub/src/capabilities/equipment-browser/README.md`, PR #5602): explicit
 * kind + UUID, direct-child counts, signed cursors, retired components and
 * installed instances that are explicitly `unmapped/no_link`.
 *
 * Rules kept here, not in a host:
 * - Rows are keyed by kind + id, never by label, so two "VFD1"s stay two rows.
 * - Only an explicit, successful `resolve` produces a question target.
 * - A refused resolve (409 stale revision / changed selection, retired,
 *   unlinked, not found) is reported, never retried, and leaves the target alone.
 */

import type { QuestionTarget } from "./equipment-nav";

export type BrowserItemKind = "namespace" | "asset" | "notebook" | "notebook_component" | "installed_instance";

export interface BrowserRef {
  readonly kind: BrowserItemKind;
  readonly id: string;
}

export interface BrowserItem extends BrowserRef {
  readonly label: string;
  /** Model or short description, shown muted after the label. */
  readonly detail?: string;
  /** Plant tag (e.g. "VFD1"). Tags repeat; never an identity. */
  readonly tag?: string;
  /** null = placed at the root (including unplaced records). */
  readonly parent: BrowserRef | null;
  /** Human path of the parent, e.g. "Garage › Bench line › GS10 bench". Display only. */
  readonly place?: string;
  /** Authorized direct children. */
  readonly childCount: number;
  /** Notebook components only: set when the component is retired. */
  readonly retiredAt?: string | null;
  /** Installed instances: always explicit about the missing notebook link. */
  readonly resolution?: { readonly status: "unmapped"; readonly reason: "no_link" };
}

export interface BrowserPage {
  readonly items: readonly BrowserItem[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
}

export type ResolveFailureReason =
  | "stale_revision"
  | "selection_changed"
  | "retired"
  | "no_link"
  | "not_found"
  | "error";

export type ResolveResult =
  | { readonly ok: true; readonly target: QuestionTarget }
  | { readonly ok: false; readonly reason: ResolveFailureReason };

export interface EquipmentSourceOptions {
  readonly cursor?: string | null;
  readonly signal?: AbortSignal;
}

/** What a host provides. The Hub backs it with `/api/equipment-browser/*`; the lab with a fixture. */
export interface EquipmentSource {
  /** Direct children of `parent` (null = root). */
  children(parent: BrowserRef | null, options?: EquipmentSourceOptions): Promise<BrowserPage>;
  /** Server-side search under `scope` (null = the authorized inventory). */
  search(query: string, scope: BrowserRef | null, options?: EquipmentSourceOptions): Promise<BrowserPage>;
  /** Exact resolution of one row to a question target. Never selects or confirms anything. */
  resolve(item: BrowserRef, options?: { readonly signal?: AbortSignal }): Promise<ResolveResult>;
}

export const ROOT_KEY = "root";

export function itemKey(ref: BrowserRef): string {
  return `${ref.kind}:${ref.id}`;
}

export function parentKey(ref: BrowserRef | null): string {
  return ref ? itemKey(ref) : ROOT_KEY;
}

export type Askability = "askable" | "retired" | "no_link" | "browse_only";

/**
 * Whether "Ask about" is offered on a row. A notebook is a whole machine; an
 * active notebook component is a component. Installed instances without a
 * notebook link, retired components, namespaces and plain assets are browse-only.
 */
export function askabilityOf(item: BrowserItem): Askability {
  if (item.kind === "installed_instance") return "no_link";
  if (item.kind === "notebook_component") return item.retiredAt ? "retired" : "askable";
  if (item.kind === "notebook") return "askable";
  return "browse_only";
}

/** Plain words for a refused resolve. None of them suggest pressing again to "fix" it. */
export function resolveFailureText(reason: ResolveFailureReason, label: string): string {
  switch (reason) {
    case "stale_revision":
      return `${label} was corrected since this list loaded. The question target did not change. Reopen ${label} to see the current record.`;
    case "selection_changed":
      return `The selection for this conversation changed somewhere else. The question target did not change. Check the target before asking.`;
    case "retired":
      return `${label} is retired. The question target did not change.`;
    case "no_link":
      return `${label} is not linked to an equipment notebook yet, so questions cannot go to it. The question target did not change.`;
    case "not_found":
      return `${label} is no longer available. The question target did not change.`;
    case "error":
      return `Could not check ${label}. The question target did not change.`;
  }
}

export type BranchStatus = "idle" | "loading" | "ready" | "error";

export interface Branch {
  readonly status: BranchStatus;
  readonly items: readonly BrowserItem[];
  readonly total: number;
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  /** Bumped on every request so a late response to an older request is dropped. */
  readonly request: number;
}

export const EMPTY_BRANCH: Branch = { status: "idle", items: [], total: 0, hasMore: false, nextCursor: null, request: 0 };

export type BranchAction =
  | { readonly type: "start"; readonly key: string; readonly request: number; readonly append: boolean }
  | { readonly type: "page"; readonly key: string; readonly request: number; readonly page: BrowserPage; readonly append: boolean }
  | { readonly type: "fail"; readonly key: string; readonly request: number }
  | { readonly type: "reset"; readonly key: string };

export type Branches = ReadonlyMap<string, Branch>;

/**
 * Loaded pages per parent (or per search). Appending a page drops rows already
 * shown (same kind + id), so a row that moved between pages is never doubled.
 */
export function branchesReducer(state: Branches, action: BranchAction): Branches {
  const current = state.get(action.key) ?? EMPTY_BRANCH;
  const next = new Map(state);
  switch (action.type) {
    case "reset":
      next.delete(action.key);
      return next;
    case "start":
      next.set(action.key, {
        ...(action.append ? current : EMPTY_BRANCH),
        status: "loading",
        request: action.request,
      });
      return next;
    case "page": {
      if (current.request !== action.request) return state;
      const base = action.append ? current.items : [];
      const seen = new Set(base.map(itemKey));
      const added = action.page.items.filter((item) => !seen.has(itemKey(item)));
      next.set(action.key, {
        status: "ready",
        items: [...base, ...added],
        total: action.page.total,
        hasMore: action.page.hasMore && action.page.nextCursor !== null,
        nextCursor: action.page.hasMore ? action.page.nextCursor : null,
        request: action.request,
      });
      return next;
    }
    case "fail":
      if (current.request !== action.request) return state;
      next.set(action.key, { ...current, status: "error" });
      return next;
  }
}

/**
 * Keys of loaded rows whose tag (or label) also appears on another loaded row.
 * Those rows show where they are. Paged loading cannot see unloaded rows, so
 * search results always show their place regardless.
 */
export function repeatedLabelKeys(items: readonly BrowserItem[]): ReadonlySet<string> {
  const name = (item: BrowserItem) => (item.tag ?? item.label).trim().toLowerCase();
  const counts = new Map<string, number>();
  for (const item of items) counts.set(name(item), (counts.get(name(item)) ?? 0) + 1);
  return new Set(items.filter((item) => (counts.get(name(item)) ?? 0) > 1).map(itemKey));
}

/** The row key that is the current question target (component, else the machine notebook). */
export function targetKeyOf(target: QuestionTarget | null): string | null {
  if (!target) return null;
  return target.componentId ? itemKey({ kind: "notebook_component", id: target.componentId }) : itemKey({ kind: "notebook", id: target.machineId });
}

/**
 * Equipment notebooks → the shared shell's project tree (Hub host side).
 *
 * The notebook is the shell's Project; its THRD-0 thread summaries are the
 * conversation rows beneath it; its confirmed asset binding is the machine link.
 * This is the Hub counterpart of the mobile lane's `src/unified/notebook-tree.ts`
 * — the same item-id grammar (`project-<nb>`, `notebook-<nb>:thread-<t>`) so a
 * thread opened on the phone and on the Hub resolve to the same ids. Hub cannot
 * import the mobile file (mobile-local per the cutover registry), so the small
 * amount of logic is repeated here on purpose; promoting it into
 * `packages/factorylm-interaction` is a separate shared-core claim.
 *
 * Type-only dependency on the shared package (erased at compile time), exactly
 * like `web-adapter.ts`: the runtime alias/bundling for `packages/` is owned by
 * the mount step, not by this module.
 */
import type { Machine, Project, ProjectNode } from "../../../packages/factorylm-interaction/src";
import type { EquipmentNotebook } from "@/lib/equipment-notebooks";

/** One thread row as `GET /api/equipment-notebooks` returns it (listThreads). */
export type HubThreadSummary = {
  id: string;
  notebookId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  sharedLegacy: boolean;
};

/** One notebook as the list route returns it: the row plus its threads. */
export type HubNotebook = EquipmentNotebook & { threads?: HubThreadSummary[] };

export const LEGACY_THREAD_ID = "legacy";

export function notebookLabel(nb: Pick<EquipmentNotebook, "displayName">): string {
  return nb.displayName.trim() || "Untitled notebook";
}

export function machineNameFor(nb: Pick<EquipmentNotebook, "displayName" | "manufacturer" | "model">): string {
  return [nb.manufacturer, nb.model].filter(Boolean).join(" ") || notebookLabel(nb);
}

export function projectIdForNotebook(notebookId: string): string {
  return `project-${notebookId}`;
}

export function notebookIdFromProject(projectId: string): string | null {
  return projectId.startsWith("project-") ? projectId.slice("project-".length) : null;
}

export function threadItemId(notebookId: string, threadId = LEGACY_THREAD_ID): string {
  return `notebook-${notebookId}:thread-${threadId}`;
}

export function threadRefFromItem(itemId: string): { notebookId: string; threadId: string } | null {
  if (!itemId.startsWith("notebook-")) return null;
  const rest = itemId.slice("notebook-".length);
  const marker = ":thread-";
  const at = rest.indexOf(marker);
  if (at === -1) return rest ? { notebookId: rest, threadId: LEGACY_THREAD_ID } : null;
  const notebookId = rest.slice(0, at);
  const threadId = rest.slice(at + marker.length);
  return notebookId && threadId ? { notebookId, threadId } : null;
}

function threadRows(nb: HubNotebook): ProjectNode[] {
  const summaries = nb.threads ?? [];
  const threads: readonly HubThreadSummary[] = summaries.length > 0
    ? summaries
    : [{
        id: LEGACY_THREAD_ID,
        notebookId: nb.id,
        title: notebookLabel(nb),
        createdAt: nb.createdAt,
        updatedAt: nb.createdAt,
        turnCount: 0,
        sharedLegacy: true,
      }];
  return threads.map((t) => ({
    kind: "thread" as const,
    id: threadItemId(nb.id, t.id),
    label: t.title.trim() || notebookLabel(nb),
  }));
}

/** Distinct bound machines across the notebooks. The binding's `entityId` is the
 *  canonical asset key (never a display label); an unbound notebook adds none. */
export function notebookMachines(notebooks: readonly HubNotebook[]): readonly Machine[] {
  const seen = new Map<string, Machine>();
  for (const nb of notebooks) {
    if (!nb.asset || seen.has(nb.asset.entityId)) continue;
    seen.set(nb.asset.entityId, {
      id: nb.asset.entityId,
      canonicalAssetId: nb.asset.entityId,
      name: machineNameFor(nb),
      unsPath: "",
      status: "unknown",
    });
  }
  return Array.from(seen.values());
}

export function notebookProjects(notebooks: readonly HubNotebook[]): readonly Project[] {
  return notebooks.map((nb) => ({
    id: projectIdForNotebook(nb.id),
    name: notebookLabel(nb),
    children: [
      ...(nb.asset
        ? [{ kind: "machine-link" as const, id: `link-${nb.id}`, label: machineNameFor(nb), machineId: nb.asset.entityId }]
        : []),
      ...threadRows(nb),
    ],
  }));
}

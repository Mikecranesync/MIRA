/**
 * Notebooks → the shell's project tree. A notebook is the Project/context
 * container; its server THRD-0 summaries are the conversation rows beneath it.
 * Legacy item ids still parse so pre-3740 tests/hosts keep opening notebooks.
 */
import type { Machine, Project, ProjectNode } from "@factorylm/interaction";
import type { Notebook, NotebookThreadSummary } from "../api/resources";

export const LEGACY_THREAD_ID = "legacy";

function canonicalNotebookLabel(nb: Pick<Notebook, "displayName">): string {
  return nb.displayName.trim() || "Untitled notebook";
}

export function machineNameFor(nb: Notebook): string {
  return [nb.manufacturer, nb.model].filter(Boolean).join(" ") || canonicalNotebookLabel(nb);
}

export function projectIdForNotebook(notebookId: string): string {
  return `project-${notebookId}`;
}

export function threadItemId(notebookId: string, threadId = LEGACY_THREAD_ID): string {
  return `notebook-${notebookId}:thread-${threadId}`;
}

export function notebookIdFromItem(itemId: string): string | null {
  return threadRefFromItem(itemId)?.notebookId ?? null;
}

export function notebookIdFromProject(projectId: string): string | null {
  return projectId.startsWith("project-") ? projectId.slice("project-".length) : null;
}

export function threadRefFromItem(itemId: string): { notebookId: string; threadId: string } | null {
  if (!itemId.startsWith("notebook-")) return null;
  const rest = itemId.slice("notebook-".length);
  const marker = ":thread-";
  const markerAt = rest.indexOf(marker);
  if (markerAt === -1) return { notebookId: rest, threadId: LEGACY_THREAD_ID };
  const notebookId = rest.slice(0, markerAt);
  const threadId = rest.slice(markerAt + marker.length);
  return notebookId && threadId ? { notebookId, threadId } : null;
}

function threadRows(nb: Notebook): ProjectNode[] {
  const summaries = nb.threads ?? [];
  const threads: readonly NotebookThreadSummary[] = summaries.length > 0
    ? summaries
    : [{ id: LEGACY_THREAD_ID, notebookId: nb.id, title: canonicalNotebookLabel(nb), createdAt: nb.createdAt ?? "", updatedAt: nb.createdAt ?? "", turnCount: 0, sharedLegacy: true }];
  return threads.map((thread) => ({
    kind: "thread" as const,
    id: threadItemId(nb.id, thread.id),
    label: thread.title.trim() || canonicalNotebookLabel(nb),
  }));
}

export function notebookMachines(notebooks: readonly Notebook[]): readonly Machine[] {
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

export function notebookProjects(notebooks: readonly Notebook[]): readonly Project[] {
  return notebooks.map((nb) => ({
    id: projectIdForNotebook(nb.id),
    name: canonicalNotebookLabel(nb),
    children: [
      ...(nb.asset ? [{ kind: "machine-link" as const, id: `link-${nb.id}`, label: machineNameFor(nb), machineId: nb.asset.entityId }] : []),
      ...threadRows(nb),
    ],
  }));
}

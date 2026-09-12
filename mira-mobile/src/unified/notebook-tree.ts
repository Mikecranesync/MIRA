/**
 * Notebooks → the shell's project tree (V6 chat-first IA).
 *
 * Persistence remains Equipment Notebooks. The technician-facing tree is
 * **one Project per notebook** (a machine / job / general chat), each
 * containing its thread. The old single "Notebooks" bucket is gone.
 */
import type { Machine, Project, ProjectNode } from "@factorylm/interaction";
import type { Notebook } from "../api/resources";

export function projectIdForNotebook(notebookId: string): string {
  return `project-${notebookId}`;
}

function canonicalChatLabel(nb: Pick<Notebook, "displayName">): string {
  return nb.displayName.trim() || "Untitled chat";
}

export function machineNameFor(nb: Notebook): string {
  return [nb.manufacturer, nb.model].filter(Boolean).join(" ") || canonicalChatLabel(nb);
}

export function projectNameFor(nb: Notebook): string {
  return nb.asset ? machineNameFor(nb) : canonicalChatLabel(nb);
}

export function threadItemId(notebookId: string): string {
  return `notebook-${notebookId}`;
}

export function notebookIdFromItem(itemId: string): string | null {
  return itemId.startsWith("notebook-") ? itemId.slice("notebook-".length) : null;
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
  return notebooks.map((nb) => {
    const children: ProjectNode[] = [];
    if (nb.asset) {
      children.push({
        kind: "machine-link",
        id: `link-${nb.id}`,
        label: machineNameFor(nb),
        machineId: nb.asset.entityId,
      });
    }
    children.push({ kind: "thread", id: threadItemId(nb.id), label: canonicalChatLabel(nb) });
    return { id: projectIdForNotebook(nb.id), name: projectNameFor(nb), children };
  });
}

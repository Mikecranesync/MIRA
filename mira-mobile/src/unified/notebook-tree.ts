/**
 * Notebooks → the shell's project tree. One project ("Notebooks"); a notebook
 * bound to a machine contributes a machine link and its thread; an unbound
 * notebook contributes just its thread. Ids are the notebook ids so opening an
 * item maps straight back to a notebook.
 */
import type { Machine, Project, ProjectNode } from "@factorylm/interaction";
import type { Notebook } from "../api/resources";

export function machineNameFor(nb: Notebook): string {
  return [nb.manufacturer, nb.model].filter(Boolean).join(" ") || nb.displayName;
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
  const children: ProjectNode[] = [];
  for (const nb of notebooks) {
    if (nb.asset) {
      children.push({ kind: "machine-link", id: `link-${nb.id}`, label: machineNameFor(nb), machineId: nb.asset.entityId });
    }
    children.push({ kind: "thread", id: threadItemId(nb.id), label: nb.displayName });
  }
  return [{ id: "project-notebooks", name: "Notebooks", children }];
}

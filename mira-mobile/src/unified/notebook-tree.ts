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

/**
 * The technician-facing identity of a BOUND machine, resolved from the current
 * asset — never the notebook's frozen `displayName` (Slice 0). Rendered as
 * "CV-101 · Discharge Conveyor" (tag · name) so the drawer's substring search
 * (ProjectTree `matches()` is a plain `label.includes(query)`, with no separate
 * searchable field) finds the machine by the tag the technician reads off the
 * sticker OR by its human name. This is why a stale `displayName`
 * ("Sensor v0 overnight 2026-08-28") can no longer mask the bound asset.
 * Returns null for an unbound notebook, so callers keep their prior fallback.
 */
function boundAssetLabel(nb: Notebook): string | null {
  const asset = nb.asset;
  if (!asset) return null;
  const tag = asset.assetTag?.trim();
  const name = asset.name?.trim();
  if (tag && name) return `${tag} · ${name}`;
  return tag || name || null;
}

export function machineNameFor(nb: Notebook): string {
  return (
    boundAssetLabel(nb) ??
    ([nb.manufacturer, nb.model].filter(Boolean).join(" ") || canonicalNotebookLabel(nb))
  );
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

const SOURCES_PREFIX = "sources-";

/** The drawer id for a notebook's Sources panel. */
export function sourcesItemId(notebookId: string): string {
  return SOURCES_PREFIX + notebookId;
}

/**
 * Source management needs its OWN front door.
 *
 * In the unified shell the notebook appbar (and its overflow, which is where
 * "Sources" lives) is gated behind `!chromeless`, so the Sources panel was only
 * ever reachable through the composer's Photo/File/Camera handlers setting
 * `openAddSources`. That is precisely the conflation this change removes: the
 * composer attaches to a MESSAGE, while Sources manages what a machine is
 * GROUNDED in. Fixing the composer without giving Sources a door of its own
 * would have deleted the only route to it.
 */
export function sourcesRefFromItem(itemId: string): string | null {
  return itemId.startsWith(SOURCES_PREFIX) ? itemId.slice(SOURCES_PREFIX.length) || null : null;
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
    // A bound machine's Project name is its current asset identity (tag · name),
    // so a stale display_name can't mask CV-101 in the drawer (Slice 0). Unbound
    // notebooks keep their display_name.
    name: boundAssetLabel(nb) ?? canonicalNotebookLabel(nb),
    children: [
      ...(nb.asset ? [{ kind: "machine-link" as const, id: `link-${nb.id}`, label: machineNameFor(nb), machineId: nb.asset.entityId }] : []),
      ...threadRows(nb),
      { kind: "file" as const, id: sourcesItemId(nb.id), label: `Sources (${nb.sourceCount})` },
    ],
  }));
}

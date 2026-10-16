/**
 * A notebook's sources, read for the unified shell's reloaded basis chip
 * (parity row 2: it may say "this notebook's sources" only when every
 * citation is one of them, as /v3's does since #4301).
 *
 * A thin reader over the SAME notebook-detail GET route `getNotebookDetail`
 * calls, like `manual-search-status.ts`: the classic host already holds these
 * sources, but it is guarded legacy presentation under the Unified UI Cutover
 * and cannot pass them down. Rows decode through the existing
 * `toNotebookSource`, so there is no second decoder.
 *
 * Uses the shared data-layer transport (`client.ts request()`).
 */
import { request } from "./client";
import { toNotebookSource, type NotebookSource } from "./resources";

export async function fetchNotebookSources(notebookId: string): Promise<NotebookSource[] | null> {
  const res = await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/`);
  if (res.status !== 200 || typeof res.data !== "object" || res.data === null) return null;
  const sources = (res.data as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) return null;
  return sources
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null)
    .map(toNotebookSource);
}

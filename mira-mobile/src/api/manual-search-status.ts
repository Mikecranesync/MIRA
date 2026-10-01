/**
 * The notebook's CURRENT manual-search status (Codex F4, #4189). A thin,
 * pure transport wrapper — like `identity-confirm.ts` — over the SAME
 * notebook-detail GET route `api/resources.ts`'s `getNotebookDetail` already
 * calls, reading only the NEW `manualSearch` field that route now returns
 * (`currentManualSearchStatus`, computed fresh server-side on every read —
 * see its own header). This is NOT a second endpoint or a second decoder for
 * the fields `getNotebookDetail` already owns (notebook/sources/turns/etc);
 * it exists only because `api/resources.ts`'s decoder is guarded legacy
 * presentation under the Unified UI Cutover and must not be edited.
 *
 * Uses the shared data-layer transport (`client.ts request()`) — no bespoke
 * fetch/auth/retry logic (five-tabs rule, see client.ts header).
 */
import type { ManualSearchStatus } from "@factorylm/interaction";
import { request } from "./client";

export async function fetchManualSearchStatus(
  notebookId: string,
  opts: { threadId?: string | null } = {},
): Promise<ManualSearchStatus | null> {
  const query = opts.threadId ? `?threadId=${encodeURIComponent(opts.threadId)}` : "";
  const res = await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/${query}`);
  if (res.status !== 200 || typeof res.data !== "object" || res.data === null) return null;
  const m = (res.data as { manualSearch?: unknown }).manualSearch;
  if (typeof m !== "object" || m === null) return null;
  const r = m as Record<string, unknown>;
  if (typeof r.manufacturer !== "string" || typeof r.model !== "string" || typeof r.running !== "boolean") return null;
  return {
    manufacturer: r.manufacturer,
    model: r.model,
    running: r.running,
    ...(typeof r.message === "string" && r.message ? { message: r.message } : {}),
  };
}

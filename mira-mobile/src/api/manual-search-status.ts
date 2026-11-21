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

/**
 * One status read: the status, `"hidden"` when the server withheld the
 * project status because this thread is about a different model (#5750 —
 * the route reports a `manualSearchScope`), or `null` when the
 * read failed or carried nothing. Only `"hidden"` clears a status the chat
 * already shows; `null` never does.
 */
export type ManualSearchRead = ManualSearchReadStatus | "hidden" | null;

/** A status read, plus (#5750 r3 F10/F12) the saved answer the server checked
 *  it against: that answer's key (its `clientRequestId`, else `row:<turn id>`,
 *  the key the chat gives each answer), `null` when the thread had no answer
 *  yet, absent when the server named none. The chat shows the status under
 *  that answer only. */
export type ManualSearchReadStatus = ManualSearchStatus & { readonly answer?: string | null };

function answerKeyOf(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (typeof raw !== "object" || raw === undefined) return undefined;
  const r = raw as { turnId?: unknown; clientRequestId?: unknown };
  if (typeof r.clientRequestId === "string" && r.clientRequestId) return r.clientRequestId;
  if (typeof r.turnId === "string" && r.turnId) return `row:${r.turnId}`;
  return undefined;
}

export async function fetchManualSearchStatus(
  notebookId: string,
  opts: { threadId?: string | null } = {},
): Promise<ManualSearchRead> {
  const query = opts.threadId ? `?threadId=${encodeURIComponent(opts.threadId)}` : "";
  const res = await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/${query}`);
  if (res.status !== 200 || typeof res.data !== "object" || res.data === null) return null;
  // The route withheld the project status for this thread: it is about
  // another model ("other_model"), or its subject is too far back to read
  // ("out_of_reach"). Either way the status must not be shown here.
  const scope = (res.data as { manualSearchScope?: unknown }).manualSearchScope;
  if (opts.threadId && (scope === "other_model" || scope === "out_of_reach")) return "hidden";
  const m = (res.data as { manualSearch?: unknown }).manualSearch;
  if (typeof m !== "object" || m === null) return null;
  const r = m as Record<string, unknown>;
  const answer = answerKeyOf((res.data as { manualSearchAnswer?: unknown }).manualSearchAnswer);
  if (typeof r.manufacturer !== "string" || typeof r.model !== "string" || typeof r.running !== "boolean") return null;
  return {
    manufacturer: r.manufacturer,
    model: r.model,
    running: r.running,
    ...(typeof r.manualUrl === "string" && r.manualUrl ? { manualUrl: r.manualUrl } : {}),
    ...(typeof r.message === "string" && r.message ? { message: r.message } : {}),
    // Codex round 3 F12: `startedAt` is the search's own GENERATION — the
    // shared follower keys its retry budget on it (via `reseedManualSearchFollow`
    // / `advanceManualSearchFollow`) so a later, different search never
    // inherits an already-spent budget. Dropping it here silently broke that
    // keying on mobile.
    ...(typeof r.startedAt === "string" && r.startedAt ? { startedAt: r.startedAt } : {}),
    ...(answer !== undefined ? { answer } : {}),
  };
}

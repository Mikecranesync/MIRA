/**
 * Confirm (or report the result of confirming) a machine identity MIRA
 * proposed from free text (#4120/#4175). Reuses the shared data-layer
 * transport (`client.ts request()`) — no bespoke fetch/auth/retry logic
 * (five-tabs rule, see client.ts header).
 *
 * This is a thin, pure transport wrapper. The server (mira-hub
 * `/api/equipment-notebooks/[id]/identity/confirm/`) owns the actual write:
 * setting the notebook's manufacturer/model/identity_status='user_confirmed'
 * via the existing `updateNotebook` seam, which fires migration 104's
 * promotion trigger. This file never guesses `manualReady` — it is the
 * server's own answer, relayed verbatim.
 */
import type { ConfirmIdentityResult, IdentityProposal } from "@factorylm/interaction";
import { request } from "./client";

export async function confirmIdentityProposal(
  notebookId: string,
  proposal: IdentityProposal,
): Promise<ConfirmIdentityResult> {
  const body: Record<string, string> = { manufacturer: proposal.manufacturer, model: proposal.model };
  if (proposal.catalogNumber) body.catalogNumber = proposal.catalogNumber;
  const res = await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/identity/confirm/`, {
    method: "POST",
    json: body,
  });
  const data = res.status === 200 && typeof res.data === "object" && res.data !== null
    ? (res.data as { ok?: unknown; manualReady?: unknown; message?: unknown; searching?: unknown; startedAt?: unknown })
    : null;
  if (!data || data.ok !== true) {
    throw new Error(`confirm identity failed (status ${res.status})`);
  }
  return {
    manualReady: data.manualReady === true,
    ...(typeof data.message === "string" && data.message ? { message: data.message } : {}),
    // Codex round 2 F4 + round 3 F4: `searching` is the structured signal
    // telling the host whether to start following progress; `startedAt` (when
    // the server sends it) is that search's own generation. Both decoded
    // here, verbatim — this wrapper never guesses either.
    ...(data.searching === true ? { searching: true } : {}),
    ...(typeof data.startedAt === "string" && data.startedAt ? { startedAt: data.startedAt } : {}),
  };
}

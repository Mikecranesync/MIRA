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
import { IdentityAlreadyConfirmedError, type ConfirmIdentityResult, type IdentityProposal } from "@factorylm/interaction";
import { request } from "./client";

export async function confirmIdentityProposal(
  notebookId: string,
  proposal: IdentityProposal,
): Promise<ConfirmIdentityResult> {
  const body: Record<string, string> = { manufacturer: proposal.manufacturer, model: proposal.model };
  if (proposal.catalogNumber) body.catalogNumber = proposal.catalogNumber;
  // Light-review fix (PR #4195): `request()` throws on any non-2xx by
  // default (`errorFromStatus`, which keeps only the `error` string, not the
  // manufacturer/model this 409's BODY also carries) — `acceptStatuses`
  // returns it instead, same contract `uploadMultipartRequest` already uses
  // for "a non-2xx whose body is the answer".
  const res = await request(`/api/equipment-notebooks/${encodeURIComponent(notebookId)}/identity/confirm/`, {
    method: "POST",
    json: body,
    acceptStatuses: [409],
  });
  // A stale proposal card (or a race the adapter's own `priorOutcome`
  // missed) can still try to confirm an identity the notebook has since
  // moved past. The server's 409 names the CURRENT confirmed machine; relay
  // it as a typed, `instanceof`-checkable error so the card renders a
  // terminal refusal, never the generic retryable failure below.
  if (res.status === 409 && typeof res.data === "object" && res.data !== null) {
    const refusal = res.data as { error?: unknown; manufacturer?: unknown; model?: unknown };
    if (refusal.error === "identity_already_confirmed") {
      const mfr = typeof refusal.manufacturer === "string" && refusal.manufacturer ? refusal.manufacturer : null;
      const mdl = typeof refusal.model === "string" && refusal.model ? refusal.model : null;
      throw new IdentityAlreadyConfirmedError(mfr && mdl ? `This machine is already confirmed as ${mfr} ${mdl}.` : undefined);
    }
  }
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

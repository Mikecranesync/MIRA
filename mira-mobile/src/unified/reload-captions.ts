/**
 * A reloaded answer's basis chip names the notebook only when that is
 * provable, as /v3's does since #4301 (parity row 2, Pixel acceptance
 * 2026-10-07).
 *
 * The persisted row carries the basis value but not the server's label, so
 * `to-interaction.ts` gives a documentation basis the neutral caption ("the
 * cited documentation"): the route sends `oem_documentation` for a
 * shared-library answer too. Once the host knows the notebook's own source
 * docIds, an answer whose every citation is one of them says "this
 * notebook's sources" — the /v3 rule (`citesOnlyNotebookSources`, Codex #4301
 * F1). A label the server sent live is never replaced.
 *
 * A pass over the mapped thread, like `withManualSearchOverrides`, so the
 * one per-part mapping in `to-interaction.ts` stays as it is.
 */
import type { InteractionThread, InteractionTurn } from "@factorylm/interaction";
import type { AdapterMessage } from "../chat-adapter/contract";

const NOTEBOOK_SOURCES_CAPTION = "Grounded in this notebook's sources.";

/** The notebook's own sources, enabled or not — what the chip may call "this
 *  notebook's sources". A rejected match was never one. Same rule as /v3's
 *  `notebookSourceDocIds` (mira-hub/src/factorylm-ui/hub-host-logic.ts). */
export function notebookSourceDocIds(sources: readonly { readonly docId: string; readonly matchState: string }[]): string[] {
  return sources.filter((s) => s.docId !== "" && s.matchState !== "rejected").map((s) => s.docId);
}

/** True only when the answer cites, and every citation is one of the
 *  notebook's own sources. Library chunks carry no docId, so they never match. */
function citesOnlyNotebookSources(msg: AdapterMessage, notebookDocIds: readonly string[]): boolean {
  const cited = msg.parts.flatMap((part) => (part.type === "source" ? [part.citation.docId ?? ""] : []));
  return cited.length > 0 && cited.every((docId) => docId !== "" && notebookDocIds.includes(docId));
}

function needsNotebookCaption(msg: AdapterMessage | undefined, notebookDocIds: readonly string[]): boolean {
  if (!msg) return false;
  const basis = msg.parts.find((part) => part.type === "basis");
  if (basis?.type !== "basis" || basis.label?.trim()) return false;
  return citesOnlyNotebookSources(msg, notebookDocIds);
}

export function withNotebookCaptions(
  thread: InteractionThread,
  messages: readonly AdapterMessage[],
  notebookDocIds: readonly string[] | undefined,
): InteractionThread {
  if (!notebookDocIds) return thread;
  const byId = new Map(messages.map((msg) => [msg.id, msg]));
  let changed = false;
  const turns = thread.turns.map((turn): InteractionTurn => {
    if (!needsNotebookCaption(byId.get(turn.id), notebookDocIds)) return turn;
    changed = true;
    return {
      ...turn,
      parts: turn.parts.map((part) =>
        part.type === "evidence_basis" && part.basis.kind === "oem_documentation"
          ? { ...part, basis: { ...part.basis, label: NOTEBOOK_SOURCES_CAPTION } }
          : part,
      ),
    };
  });
  return changed ? { ...thread, turns } : thread;
}

import type { Notebook } from "../api/resources";

/** A notebook with no machine behind it: no canonical binding and no
 *  manufacturer/model identity. Only such a notebook may host a HOME question,
 *  because the canonical chat route appends the notebook's machine context
 *  (equipment identity, asset path, loaded documents) even in general mode. */
export function isUnboundNotebook(nb: Pick<Notebook, "asset" | "manufacturer" | "model">): boolean {
  return !nb.asset && !(nb.manufacturer ?? "").trim() && !(nb.model ?? "").trim();
}

export type HomeSendPlan =
  | { kind: "loading" }
  | { kind: "existing"; notebookId: string }
  | { kind: "create"; body: { displayName: string; identitySourceType: "user" } };

/**
 * Where a HOME question goes (#3877, mirrors the Hub host's `homeSendPlan`):
 * an UNBOUND notebook — the one literally named General first, because a
 * notebook's name is machine context too — never the last-opened machine
 * notebook (`listNotebooks` orders by last opened, so `notebooks[0]` was the
 * drive the technician was just standing at). With no unbound notebook it
 * creates General through the same body the create-project form posts, so a
 * stranger with no project can still ask. Before the list is known: nothing.
 */
export function homeSendPlan(notebooks: readonly Notebook[] | null): HomeSendPlan {
  if (!notebooks) return { kind: "loading" };
  const unbound = notebooks.filter(isUnboundNotebook);
  const general = unbound.find((nb) => nb.displayName.trim().toLowerCase() === "general") ?? unbound[0];
  if (general) return { kind: "existing", notebookId: general.id };
  return { kind: "create", body: { displayName: "General", identitySourceType: "user" } };
}

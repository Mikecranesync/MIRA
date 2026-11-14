/**
 * One chat turn asked under a selected bench component (chat/route.ts).
 *
 * The client sends which component its "Asking about …" header showed and the
 * selection version it read. The server never trusts that: it reads the stored
 * selection and the component, and the turn proceeds only when they agree.
 * Then exactly one of:
 *
 *  - conflict: the stored selection is not what the client showed (another tap,
 *    another device, a correction) — 409, nothing answered, nothing written;
 *  - hold (blocked): the component is not confirmed, or has no model number —
 *    a fixed reply asks for the confirmation; no manual is read;
 *  - hold (clarify): the question names another component of this bench by its
 *    exact catalog number — a fixed reply offers to switch; the selection does
 *    NOT change on its own (Mike 2026-11-14 rule 6);
 *  - scoped: the component's confirmed identity is the record for every manual
 *    read of the turn, and only questions asked under this selection carry.
 *
 * Similarity never establishes identity here: only an exact catalog-number
 * match names another component.
 */
import { modelNumbersIn, unlistedModelNumbers } from "@/capabilities/manual-applicability";
import { modelIdentitiesInText } from "@/capabilities/model-token";
import type { ManualIdentity } from "@/capabilities/notebook-manual-identity";
import { componentManualIdentity, componentManualsBlocked, type ComponentRevision } from "./selection";
import { componentLabel } from "./view";
import { advanceSelectionRevision, getSelection, listComponents, type ComponentRecord, type ThreadSelection } from "./store";
import { isUuid } from "./validate";

export type RequestedComponent = { componentId: string; selectionVersion: number };

/** The chat body's `componentSelection`, or null when absent. */
export function readComponentSelection(value: unknown): RequestedComponent | null | { error: string } {
  if (value == null) return null;
  if (typeof value !== "object") return { error: "invalid_component_selection" };
  const v = value as { componentId?: unknown; selectionVersion?: unknown };
  if (!isUuid(v.componentId)) return { error: "invalid_component_selection" };
  if (!Number.isInteger(v.selectionVersion) || (v.selectionVersion as number) < 1) return { error: "invalid_component_selection" };
  return { componentId: v.componentId, selectionVersion: v.selectionVersion as number };
}

export type ComponentAction =
  | { action: "confirm"; componentId: string; label: string }
  | { action: "switch"; componentId: string; label: string }
  | { action: "stay"; componentId: string; label: string }
  | { action: "return"; componentId: string; label: string };

/** SSE frame: which component this turn was asked under, and the actions a reply offers. */
export type ComponentTurnFrame = {
  kind: "component";
  componentId: string;
  revision: number;
  /** The selection version after this turn: a correction made on another screen
   *  advances it here, and the next question must send this one. */
  selectionVersion: number;
  label: string;
  actions: ComponentAction[];
};

export type ComponentTurn =
  | { kind: "conflict"; selection: ThreadSelection | null }
  | { kind: "hold"; reason: "not_confirmed" | "no_model" | "other_component"; component: ComponentRecord; revision: number; selection: ThreadSelection; text: string; actions: ComponentAction[] }
  | { kind: "scoped"; component: ComponentRecord; revision: ComponentRevision; selection: ThreadSelection; identity: ManualIdentity; label: string };

/** The model numbers a catalog number is written as ("6ES7 212-1BE40-0XB0" is two runs). */
const catalogKeys = (catalog: string | null | undefined): string[] => (catalog ? modelNumbersIn(catalog).map((n) => n.key) : []);

/** Exact catalog-number keys a question names. */
function namedKeys(question: string): Set<string> {
  const keys = new Set<string>();
  for (const id of modelIdentitiesInText(question)) for (const n of modelNumbersIn(id)) keys.add(n.key);
  for (const n of unlistedModelNumbers(question)) keys.add(n.key);
  for (const n of modelNumbersIn(question)) keys.add(n.key);
  return keys;
}

const sameKeys = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * Another component of this bench the question names by its exact catalog number
 * (every run of it), or null. A number the selected component shares (a second
 * unit of the same model) is the selected one's, never "another".
 */
export function otherComponentNamed(question: string, selected: ComponentRecord, components: readonly ComponentRecord[]): ComponentRecord | null {
  const keys = namedKeys(question);
  if (keys.size === 0) return null;
  const own = catalogKeys(selected.current?.catalogNumber);
  for (const c of components) {
    if (c.id === selected.id || c.retiredAt) continue;
    const theirs = catalogKeys(c.current?.catalogNumber);
    if (theirs.length > 0 && !sameKeys(theirs, own) && theirs.every((k) => keys.has(k))) return c;
  }
  return null;
}

export const notConfirmedText = (label: string) =>
  `${label} isn't confirmed yet, so I won't answer from the manuals for it. Check what its label says and tap Confirm, then ask again.`;
export const noModelText = (label: string) =>
  `${label} is confirmed without a model or catalog number, so I can't tell which manual is for it. Add the number from its label, then ask again.`;
/** The project has no searchable place for its documents (no namespace node), so nothing can be checked for the component. */
export const noDocumentsForComponentText = (label: string) =>
  `This project's documents can't be searched yet, so I won't answer about ${label} from them. Attach its manual to the project, then ask again.`;
export const otherComponentText = (selectedLabel: string, namedLabel: string, named: string) =>
  `This chat is asking about ${selectedLabel}. Your question names ${named}, which is ${namedLabel} on this bench. Switch to ${namedLabel} to ask about it, or stay on ${selectedLabel}.`;

export async function resolveComponentTurn(
  tenantId: string,
  notebookId: string,
  userId: string,
  threadKey: string,
  requested: RequestedComponent,
  question: string,
): Promise<ComponentTurn> {
  const [stored, components] = await Promise.all([
    getSelection(tenantId, notebookId, userId, threadKey),
    listComponents(tenantId, notebookId),
  ]);
  if (!stored || stored.componentId !== requested.componentId || stored.version !== requested.selectionVersion) {
    return { kind: "conflict", selection: stored };
  }
  const component = components.find((c) => c.id === stored.componentId);
  if (!component || component.retiredAt || !component.current) return { kind: "conflict", selection: stored };
  let selection = stored;
  if (stored.revision !== component.current.revision) {
    // The identity was corrected after this chat picked the component: re-check the turn
    // against the new identity, and nothing asked under the old one carries.
    const moved = await advanceSelectionRevision(tenantId, notebookId, userId, threadKey, stored.version, component.current.revision);
    if (!moved) return { kind: "conflict", selection: await getSelection(tenantId, notebookId, userId, threadKey) };
    selection = moved;
  }
  const label = componentLabel(component, component.current);
  const blocked = componentManualsBlocked(component.current);
  if (blocked) {
    return {
      kind: "hold",
      reason: blocked,
      component,
      revision: component.current.revision,
      selection,
      text: blocked === "not_confirmed" ? notConfirmedText(label) : noModelText(label),
      actions: [{ action: "confirm", componentId: component.id, label }],
    };
  }
  const other = otherComponentNamed(question, component, components);
  if (other) {
    const otherLabel = componentLabel(other, other.current);
    return {
      kind: "hold",
      reason: "other_component",
      component,
      revision: component.current.revision,
      selection,
      text: otherComponentText(label, otherLabel, other.current?.catalogNumber ?? otherLabel),
      actions: [
        { action: "switch", componentId: other.id, label: otherLabel },
        { action: "stay", componentId: component.id, label },
      ],
    };
  }
  return { kind: "scoped", component, revision: component.current, selection, identity: componentManualIdentity(component.current), label };
}

/** The frame a component turn streams. A refusal under a scoped component offers "Return to …". */
export function componentTurnFrame(turn: Exclude<ComponentTurn, { kind: "conflict" }>, refused: boolean): ComponentTurnFrame {
  if (turn.kind === "hold") {
    return {
      kind: "component",
      componentId: turn.component.id,
      revision: turn.revision,
      selectionVersion: turn.selection.version,
      label: componentLabel(turn.component, turn.component.current),
      actions: turn.actions,
    };
  }
  return {
    kind: "component",
    componentId: turn.component.id,
    revision: turn.revision.revision,
    selectionVersion: turn.selection.version,
    label: turn.label,
    actions: refused ? [{ action: "return", componentId: turn.component.id, label: turn.label }] : [],
  };
}

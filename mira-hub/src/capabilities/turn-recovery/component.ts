/** Recovery reads an already-accepted selection. Unlike a new question it must
 * never advance the selection to a corrected identity or restamp its history. */
import { getSelection, listComponents } from "@/capabilities/bench-components/store";
import { componentManualIdentity, componentManualsBlocked } from "@/capabilities/bench-components/selection";
import { componentLabel } from "@/capabilities/bench-components/view";
import { notConfirmedText, noModelText, otherComponentNamed, otherComponentText, type ComponentTurn } from "@/capabilities/bench-components/chat-turn";
import type { AcceptedTurnContext } from "./accepted-context";

export async function resolveRecoveredComponent(
  tenantId: string, notebookId: string, userId: string, threadKey: string,
  original: NonNullable<AcceptedTurnContext["component"]>, question: string,
): Promise<ComponentTurn | { kind: "revision_changed" }> {
  const [selection, components] = await Promise.all([
    getSelection(tenantId, notebookId, userId, threadKey), listComponents(tenantId, notebookId),
  ]);
  const component = components.find(c => c.id === original.componentId);
  if (!component || component.retiredAt || !component.current || component.current.revision !== original.revision
      || !selection || selection.componentId !== original.componentId || selection.revision !== original.revision) return { kind: "revision_changed" };
  if (selection.version !== original.selection.version || selection.selectedAt !== original.selection.selectedAt) return { kind: "conflict", selection };
  const revision = component.current, label = componentLabel(component, revision);
  const blocked = componentManualsBlocked(revision);
  if (blocked) return { kind: "hold", reason: blocked, component, revision: revision.revision, selection,
    text: blocked === "not_confirmed" ? notConfirmedText(label) : noModelText(label),
    actions: [{ action: "confirm", componentId: component.id, label }] };
  const other = otherComponentNamed(question, component, components);
  if (other) {
    const otherLabel = componentLabel(other, other.current);
    return { kind: "hold", reason: "other_component", component, revision: revision.revision, selection,
      text: otherComponentText(label, otherLabel, other.current?.catalogNumber ?? otherLabel),
      actions: [{ action: "switch", componentId: other.id, label: otherLabel }, { action: "stay", componentId: component.id, label }] };
  }
  return { kind: "scoped", component, revision, selection, identity: componentManualIdentity(revision), label };
}

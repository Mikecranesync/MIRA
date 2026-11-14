/**
 * Request reading shared by the bench-component routes. Thin: every decision
 * about what a request may do lives in validate.ts and store.ts.
 */
import { NextResponse } from "next/server";
import { LEGACY_THREAD_ID, normalizeNotebookThreadId, type NotebookSource } from "@/lib/equipment-notebooks";
import { isUuid } from "./validate";
import { componentView, type ComponentView } from "./view";
import { getSelection, listComponents, listSelectionTurns, readDocumentHeadings, type ThreadSelection } from "./store";

/** The selection row's key for a conversation: its thread id, or "legacy" for the default one. */
export function threadKeyOf(value: unknown): string | null {
  if (value == null || value === LEGACY_THREAD_ID) return LEGACY_THREAD_ID;
  return normalizeNotebookThreadId(value);
}

/** listTurns' thread argument for the same conversation. */
export const storedThread = (key: string): string | null => (key === LEGACY_THREAD_ID ? null : key);

export const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

export function requestIdOf(body: Record<string, unknown>): string | null {
  return isUuid(body.clientRequestId) ? body.clientRequestId : null;
}

export type BenchState = {
  components: ComponentView[];
  selection: (ThreadSelection & { current: boolean }) | null;
  /** turn id → the component and identity revision it was asked under. */
  turnComponents: Record<string, { componentId: string; revision: number }>;
};

/**
 * Everything one conversation's component header, picker and history labels need.
 * `selection.current` is false when the component's identity was corrected after
 * it was picked (the next question re-checks it).
 */
export async function benchState(
  tenantId: string,
  notebookId: string,
  userId: string,
  threadKey: string,
  sources: readonly NotebookSource[],
): Promise<BenchState> {
  const [components, selection, turns, headings] = await Promise.all([
    listComponents(tenantId, notebookId),
    getSelection(tenantId, notebookId, userId, threadKey),
    listSelectionTurns(tenantId, notebookId, userId, storedThread(threadKey), 300),
    readDocumentHeadings(tenantId, sources.map((s) => s.docId)),
  ]);
  const views = components.map((c) => componentView(c, sources, headings));
  const selected = selection ? components.find((c) => c.id === selection.componentId) : undefined;
  const turnComponents: BenchState["turnComponents"] = {};
  for (const t of turns) {
    if (t.componentId && t.componentRevision != null) turnComponents[t.id] = { componentId: t.componentId, revision: t.componentRevision };
  }
  return {
    components: views,
    selection: selection && selected ? { ...selection, current: selected.current?.revision === selection.revision } : null,
    turnComponents,
  };
}

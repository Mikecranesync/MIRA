/**
 * Request reading shared by the bench-component routes. Thin: every decision
 * about what a request may do lives in validate.ts and store.ts.
 */
import { NextResponse } from "next/server";
import { DOCUMENT_BASES } from "@/capabilities/conversation-subject";
import { modelNumbersIn } from "@/capabilities/manual-applicability";
import { LEGACY_THREAD_ID, normalizeNotebookThreadId, type NotebookSource } from "@/lib/equipment-notebooks";
import { isUuid } from "./validate";
import { componentView, type ComponentView } from "./view";
import { getSelection, getSelectionVersion, listComponents, listSelectionTurns, readDocumentHeadings, type ThreadSelection } from "./store";

/** The selection row's key for a conversation: its thread id, or "legacy" for the default one. */
export function threadKeyOf(value: unknown): string | null {
  if (value == null || value === LEGACY_THREAD_ID) return LEGACY_THREAD_ID;
  return normalizeNotebookThreadId(value);
}

/** listTurns' thread argument for the same conversation. */
export const storedThread = (key: string): string | null => (key === LEGACY_THREAD_ID ? null : key);

export const bad = (error: string, status = 400, extra: Record<string, unknown> = {}) => NextResponse.json({ error, ...extra }, { status });

/**
 * The component tables (proposed migration 115) are not in this database yet:
 * Postgres undefined_table / undefined_column. The checklist answers 503 so the
 * tablet hides it, instead of an error on every project. Any other failure is
 * not masked.
 */
export function componentTablesMissing(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "42703";
}

export function requestIdOf(body: Record<string, unknown>): string | null {
  return isUuid(body.clientRequestId) ? body.clientRequestId : null;
}

export type BenchState = {
  components: ComponentView[];
  selection: (ThreadSelection & { current: boolean }) | null;
  /** The version the next pick must send: the stored one even after a clear, null if
   *  this conversation never had a selection. */
  selectionVersion: number | null;
  /** turn id → the component and identity revision it was asked under. */
  turnComponents: Record<string, { componentId: string; revision: number }>;
  /** Per component, in this conversation: questions answered from a document, and
   *  questions refused. Two separate counts — a refusal is never coverage. */
  tallies: Record<string, { answered: number; refused: number }>;
  /** The model and catalog numbers written in each attached document's opening
   *  text — the only numbers the confirmation card proposes as look-alikes
   *  (lookalike.ts). A proposal, never an identity: the technician confirms. */
  documentNumbers: { label: string; from: string }[];
};

/** A turn answered from a document — the same rule that closes a carried subject
 *  (conversation-subject.ts): a safety stop or general reasoning is not one. */
const answeredFromSource = (t: { answerStatus?: string | null; basis?: string | null }) =>
  t.answerStatus === "answered" && DOCUMENT_BASES.has(t.basis ?? "");

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
  const [components, selection, selectionVersion, turns, headings] = await Promise.all([
    listComponents(tenantId, notebookId),
    getSelection(tenantId, notebookId, userId, threadKey),
    getSelectionVersion(tenantId, notebookId, userId, threadKey),
    listSelectionTurns(tenantId, notebookId, userId, storedThread(threadKey), 300),
    readDocumentHeadings(tenantId, sources.map((s) => s.docId)),
  ]);
  const views = components.map((c) => componentView(c, sources, headings));
  const selected = selection ? components.find((c) => c.id === selection.componentId) : undefined;
  const turnComponents: BenchState["turnComponents"] = {};
  const tallies: BenchState["tallies"] = {};
  for (const t of turns) {
    if (!t.componentId || t.componentRevision == null) continue;
    turnComponents[t.id] = { componentId: t.componentId, revision: t.componentRevision };
    const tally = (tallies[t.componentId] ??= { answered: 0, refused: 0 });
    if (answeredFromSource(t)) tally.answered++;
    else if (t.answerStatus === "insufficient_evidence") tally.refused++;
  }
  const documentNumbers = sources.flatMap((s) => {
    const seen = new Set<string>();
    return modelNumbersIn(headings.get(s.docId) ?? "").flatMap((n) =>
      seen.has(n.key) ? [] : (seen.add(n.key), [{ label: n.label, from: s.filename ?? "an attached document" }]),
    );
  });
  return {
    components: views,
    selection: selection && selected ? { ...selection, current: selected.current?.revision === selection.revision } : null,
    selectionVersion,
    turnComponents,
    tallies,
    documentNumbers,
  };
}

/**
 * The manual status a notebook conversation reads, and the subject rule that decides where it
 * belongs. Shared by the notebook detail read (`GET /api/equipment-notebooks/[id]`) and the chat
 * route's manual wait (`POST /api/equipment-notebooks/[id]/chat`), so both answer from one rule.
 *
 * #5750: the status names the project's machine; a thread that asked about another exact model
 * must not show it. #5746: a question about the whole machine still waits for the project's
 * lookup when the status is withheld only for answers about a selected component. A question
 * that names the project's own model waits too, whatever the thread asked before. Round 8
 * (option A): the chat route decides, from the question it is about to answer, read as the
 * newest whole-machine question. Server only: the model matcher reads the reviewed manual library.
 */
import { getNotebook, listSources, listTurns, type EquipmentNotebook, type NotebookSource } from "@/lib/equipment-notebooks";
import { detectEnergizedElectricalHazardIntent, isEnergizedWorkAsk, notebookSafetyTrigger } from "@/lib/safety-classifier";
import {
  currentManualSearchStatus,
  threadStatusScope,
  type ManualSearchStatus,
} from "@/capabilities/notebook-manual-acquisition";
import { confirmedCatalogNumber } from "@/capabilities/notebook-manual-identity";
import { DOCUMENT_BASES, SUBJECT_READ_STEPS } from "@/capabilities/conversation-subject";
import { isComponentAttributionEntry } from "@/capabilities/bench-components/attribution";
import { turnsAskedUnderComponent } from "@/capabilities/bench-components/store";

/** The conversation history the detail read returns, and the first window the subject reads. */
export const TURN_WINDOW = 50;
/** How far back the subject is read when the window settles nothing. */
const WIDEST_SUBJECT_READ = SUBJECT_READ_STEPS[SUBJECT_READ_STEPS.length - 1];

type Turn = Awaited<ReturnType<typeof listTurns>>[number];
type Machine = Parameters<typeof threadStatusScope>[1];
export type SubjectScope = ReturnType<typeof threadStatusScope> | "out_of_reach";

/** What the Hub's send wait reads of a lookup: never a message or link, so it is never shown. */
export function sendWaitStatus(status: ManualSearchStatus): ManualSearchStatus {
  return {
    manufacturer: status.manufacturer,
    model: status.model,
    running: status.running,
    ...(status.sourceState ? { sourceState: status.sourceState } : {}),
    ...(status.readySourceDocId ? { readySourceDocId: status.readySourceDocId } : {}),
    ...(status.startedAt ? { startedAt: status.startedAt } : {}),
  };
}

/** A send may wait on the project's lookup unless the subject is another model or out of reach. */
export function sendWaitAllows(scope: SubjectScope): boolean {
  return scope !== "other" && scope !== "out_of_reach";
}

/**
 * #5746 r5 F1: the questions that decide, for the send wait, whether the thread moved to another
 * model. One asked under a selected bench component is about that component (#5750 r3 F13), even
 * when it names the component's own model, so it never decides that. The saved attribution entry
 * marks only the paths that stream a component frame; a safety stop or an off-topic reply carries
 * the turn's component stamp alone (`stamped`).
 */
function wholeMachineQuestions(
  rows: readonly { id: string; question: string; evidence?: readonly unknown[] | null }[],
  stamped: ReadonlySet<string>,
): string[] {
  return rows.filter((t) => !stamped.has(t.id) && !(t.evidence ?? []).some(isComponentAttributionEntry)).map((t) => t.question);
}

/**
 * The most recently PROPOSED (not yet confirmed) identity on this notebook's
 * turns, read straight off the raw `evidence[]` the same way
 * `mira-hub/src/factorylm-ui/to-interaction.ts`'s `identityProposalOf` does
 * (duplicated here, not imported: that file is a client component and this
 * is server-only). `turns` is chronological, so the LAST match wins.
 */
function latestIdentityProposal(
  turns: readonly { evidence: unknown[] }[],
): { manufacturer: string; model: string } | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    for (const e of turns[i]!.evidence) {
      if (typeof e !== "object" || e === null) continue;
      const r = e as Record<string, unknown>;
      if (r.kind !== "identity_proposal") continue;
      if (typeof r.manufacturer === "string" && typeof r.model === "string") {
        return { manufacturer: r.manufacturer, model: r.model };
      }
    }
  }
  return null;
}

/** True when the newest turn is an answer that came from a document. */
function latestTurnIsGrounded(
  turns: readonly { answerStatus?: string | null; basis?: string | null }[],
): boolean {
  const last = turns[turns.length - 1];
  return !!last && last.answerStatus === "answered" && !!last.basis && DOCUMENT_BASES.has(last.basis);
}

/**
 * The notebook's CURRENT manual-search status, computed fresh (T2 #4189 F4/F6): a persisted
 * snapshot would read as permanently stale once the search finishes.
 */
export function notebookManualStatus(
  tenantId: string,
  notebookId: string,
  notebook: EquipmentNotebook,
  sources: NotebookSource[],
  turns: Turn[],
): Promise<ManualSearchStatus | null> {
  return currentManualSearchStatus(
    tenantId,
    notebookId,
    {
      identityStatus: notebook.identityStatus,
      manufacturer: notebook.manufacturer,
      model: notebook.model,
      catalogNumber: notebook.catalogNumber,
    },
    latestIdentityProposal(turns),
    sources,
    ...(latestTurnIsGrounded(turns) ? [{ groundedTurn: true }] : []),
  );
}

/** The machine the status names, or null when neither a model nor a catalog number is known. */
export function subjectMachine(status: ManualSearchStatus | null, notebook: EquipmentNotebook): Machine | null {
  const model = status?.model ?? notebook.model;
  if (!model && !notebook.catalogNumber) return null;
  return {
    manufacturer: status?.manufacturer ?? notebook.manufacturer,
    model,
    catalogNumber: model === notebook.model ? notebook.catalogNumber : null,
    recordCatalog: confirmedCatalogNumber(notebook),
  };
}

/**
 * The subject of one conversation, from its newest `turns` (the first window). When the window
 * settles nothing and older turns exist, it reads further back once (the same widest step the
 * chat path's subject read uses); still nothing past that bound, the subject is out of reach.
 */
export function subjectReader(input: {
  tenantId: string;
  notebookId: string;
  viewerUserId: string;
  threadId: string;
  turns: Turn[];
  machine: Machine;
}) {
  const { tenantId, notebookId, viewerUserId, threadId, turns, machine } = input;
  let wider: Promise<Turn[]> | undefined;
  const scopeOf = async (questionsOf: (rows: Turn[]) => string[] | Promise<string[]>): Promise<SubjectScope> => {
    const scope = threadStatusScope(await questionsOf(turns), machine);
    if (scope !== "undecided" || turns.length < TURN_WINDOW) return scope;
    const rows = await (wider ??= listTurns(tenantId, notebookId, WIDEST_SUBJECT_READ, { viewerUserId, threadId }));
    const widest = threadStatusScope(await questionsOf(rows), machine);
    return widest === "undecided" && rows.length >= WIDEST_SUBJECT_READ ? "out_of_reach" : widest;
  };
  return {
    /** Every saved question: what the shown status follows. */
    shown: () => scopeOf((rows) => rows.map((t) => t.question)),
    /** The saved questions about the whole machine, then `pending` as the newest. */
    wholeMachine: (pending?: string) => scopeOf(async (rows) => [
      ...wholeMachineQuestions(rows, await turnsAskedUnderComponent(tenantId, notebookId, rows.map((t) => t.id))),
      ...(pending ? [pending] : []),
    ]),
  };
}

/**
 * Words that make "manual" an adjective for a machine part or mode (a manual reset, the manual
 * valve), not the document. A missed manual ask answers without the manual, so this lists what
 * "manual" describes rather than what a manual ask may say next.
 */
const MANUAL_ADJECTIVE = String.raw`(?:mode|modes|override|overrides|reset|resets|control|controls|operation|operations|switch|switches|start|stop|setting|settings|position|valve|valves|lever|crank|jog|feed|run|lubrication|backup|entry|process|handle|brake|release|button|buttons|input|inputs|adjustment|transfer|trip|test|cycle|pump|drain|lock|labou?r|winch|hoist|gate|door|damper|tensioner|clamp|wheel|handwheel|selector|station|pendant|speed|bypass|shutoff|shut-off|disconnect|load|loading|clutch)`;
/**
 * The manual as a document: "the manual", "the GS10 manual", "its manual", "a manual", unless
 * the next word makes it a part or mode. "The manual reset" and "run it in manual" are not.
 */
const MANUAL_DOCUMENT = new RegExp(
  String.raw`\b(?:the|this|that|its|their|your|my|our|a|an|any)\s+(?:[\w./-]+\s+){0,3}?manuals?\b(?!\s+${MANUAL_ADJECTIVE}\b)`,
  "i",
);
/** "manual page 12", "manual section 4": a part of the manual named without an article. */
const MANUAL_PART = /\bmanual\s+(?:page|pages|section|chapter|table|figure|fig\.?|pg\.?|p\.)\s*\d/i;
const SAFETY_LANGUAGE = /\b(?:energized|energised|live|arc flash|shock|sparks?|fire|smoke|emergency|unsafe|injur(?:y|ed)|hazard|lockout|tagout|interlock|bypass|guard)\b/i;

/**
 * #5746 r7 F11: a question that explicitly asks for the manual waits for it. That is the manual
 * itself ("what does the manual say", "according to the official manual") or a page, section,
 * chapter, table or figure of it ("what page of the manual shows the acceleration settings").
 * "Figure out" or a bare "table" are not manual asks, and an ordinary question does not wait.
 * Safety, hazard and energized-work language never waits: those questions keep their own path.
 */
export function waitsForManual(question: string): boolean {
  return (MANUAL_DOCUMENT.test(question) || MANUAL_PART.test(question)) &&
    !SAFETY_LANGUAGE.test(question) &&
    !notebookSafetyTrigger(question) &&
    !isEnergizedWorkAsk(question) &&
    !detectEnergizedElectricalHazardIntent(question);
}

/** What the manual wait read: the project's status and the outgoing question's subject. */
export type ManualWaitRead = { status: ManualSearchStatus | null; scope: SubjectScope | null };

/** The chat route's refusal of a manual question it cannot answer yet. */
export type ManualWaitRefusal = {
  /** `manual_not_ready`: the Hub waits for the lookup, then asks again. `manual_unavailable`: it pauses. */
  error: "manual_not_ready" | "manual_unavailable";
  reason: "running" | "ready_not_sent" | "off" | "removed" | "unavailable" | "unknown";
  /** The lookup's gate fields, never its message or link. */
  lookup: ManualSearchStatus | null;
};

/**
 * #5746 (option A): whether the chat route may answer a manual question now. `docIds` is the
 * validated set the request carries. Null means answer. A read that failed is not a missing
 * manual: it pauses, so the question is never answered without a manual that may be there.
 */
export function manualWaitDecision(read: ManualWaitRead | "read_failed", docIds: readonly string[]): ManualWaitRefusal | null {
  if (read === "read_failed") return { error: "manual_unavailable", reason: "unknown", lookup: null };
  const { status, scope } = read;
  if (!status || !scope || !sendWaitAllows(scope)) return null;
  const lookup = sendWaitStatus(status);
  if (status.running) return { error: "manual_not_ready", reason: "running", lookup };
  switch (status.sourceState) {
    case "ready":
      return status.readySourceDocId && docIds.includes(status.readySourceDocId)
        ? null
        : { error: "manual_not_ready", reason: "ready_not_sent", lookup };
    case "disabled":
      return { error: "manual_unavailable", reason: "off", lookup };
    case "removed":
      return { error: "manual_unavailable", reason: "removed", lookup };
    case "unavailable":
      return { error: "manual_unavailable", reason: "unavailable", lookup };
    default:
      // Settled with no state: the newest answer was already grounded in a document (#5958).
      return null;
  }
}

/**
 * Reads what the manual wait decides from: the project's current status, from this viewer's
 * history of this thread, and the subject with the outgoing question as the newest whole-machine
 * question. Throws on a failed read; the route treats that as `read_failed`.
 */
export async function readManualWait(input: {
  tenantId: string;
  notebookId: string;
  viewerUserId: string;
  threadId: string;
  question: string;
}): Promise<ManualWaitRead> {
  const { tenantId, notebookId, viewerUserId, threadId, question } = input;
  const notebook = await getNotebook(tenantId, notebookId);
  if (!notebook) return { status: null, scope: null };
  const [sources, turns] = await Promise.all([
    listSources(tenantId, notebookId),
    listTurns(tenantId, notebookId, TURN_WINDOW, { viewerUserId, threadId }),
  ]);
  const status = await notebookManualStatus(tenantId, notebookId, notebook, sources, turns);
  const machine = status ? subjectMachine(status, notebook) : null;
  if (!status || !machine) return { status, scope: null };
  const scope = await subjectReader({ tenantId, notebookId, viewerUserId, threadId, turns, machine }).wholeMachine(question);
  return { status, scope };
}

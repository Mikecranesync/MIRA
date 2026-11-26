/**
 * The manual status a notebook conversation reads, and the subject rule that decides where it
 * belongs. Shared by the notebook detail read (`GET /api/equipment-notebooks/[id]`) and the
 * pre-send check (`POST /api/equipment-notebooks/[id]/send-wait`), so both answer from one rule.
 *
 * #5750: the status names the project's machine; a thread that asked about another exact model
 * must not show it. #5746: a question about the whole machine still waits for the project's
 * lookup when the status is withheld only for answers about a selected component. Round 6 F1: a
 * question that names the project's own model waits too, whatever the thread asked before. That
 * question has not been saved yet, so only the pre-send check can read it, as the newest
 * whole-machine question. Server only: the model matcher reads the reviewed manual library.
 */
import { listTurns, type EquipmentNotebook, type NotebookSource } from "@/lib/equipment-notebooks";
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

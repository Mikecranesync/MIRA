/**
 * The manual status a notebook conversation reads, and the subject rule that decides where it
 * belongs (`GET /api/equipment-notebooks/[id]`).
 *
 * #5750: the status names the project's machine; a thread that asked about another exact model
 * must not show it. Server only: the model matcher reads the reviewed manual library.
 */
import { listTurns, type EquipmentNotebook, type NotebookSource } from "@/lib/equipment-notebooks";
import {
  currentManualSearchStatus,
  threadStatusScope,
  type ManualSearchStatus,
} from "@/capabilities/notebook-manual-acquisition";
import { confirmedCatalogNumber } from "@/capabilities/notebook-manual-identity";
import { DOCUMENT_BASES, SUBJECT_READ_STEPS } from "@/capabilities/conversation-subject";
import { numbersForIdentity, type ConfirmedNumberEntry } from "@/capabilities/confirmed-numbers";

/** The conversation history the detail read returns, and the first window the subject reads. */
export const TURN_WINDOW = 50;
/** How far back the subject is read when the window settles nothing. */
const WIDEST_SUBJECT_READ = SUBJECT_READ_STEPS[SUBJECT_READ_STEPS.length - 1];

type Turn = Awaited<ReturnType<typeof listTurns>>[number];
type Machine = Parameters<typeof threadStatusScope>[1];
type SubjectScope = ReturnType<typeof threadStatusScope> | "out_of_reach";

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
 * #6085: whether confirmed numbers can count at all: an identity a technician settled on the
 * identity card (the only writer of source `user`; a nameplate photo settles without the card, so
 * it never brings a number back), and a status that names the notebook's own model (the rule
 * `catalogNumber` follows above). When false, the detail read never reads them.
 */
export function numbersApply(status: ManualSearchStatus | null, notebook: EquipmentNotebook): boolean {
  if (notebook.identityStatus !== "user_confirmed" && notebook.identityStatus !== "verified") return false;
  if (notebook.identitySourceType !== "user") return false;
  const model = status?.model ?? notebook.model;
  return Boolean(model) && model === notebook.model;
}

/** #6085: the confirmed numbers that count for the machine the status names: only entries
 *  saved for the notebook's current maker and model, and only when `numbersApply` holds. */
export function numbersForMachine(
  entries: readonly ConfirmedNumberEntry[],
  status: ManualSearchStatus | null,
  notebook: EquipmentNotebook,
): string[] {
  if (!numbersApply(status, notebook)) return [];
  return numbersForIdentity(entries, { manufacturer: notebook.manufacturer, model: notebook.model });
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
  /** #6085: numbers the technician confirmed; read only when the scope without them is "other". */
  confirmedNumbers?: () => Promise<readonly string[]>;
}) {
  const { tenantId, notebookId, viewerUserId, threadId, turns, machine, confirmedNumbers } = input;
  let numbers: Promise<readonly string[]> | null = null;
  const scopeOf = async (questions: string[]): Promise<ReturnType<typeof threadStatusScope>> => {
    const scope = threadStatusScope(questions, machine);
    if (scope !== "other" || !confirmedNumbers) return scope;
    numbers ??= confirmedNumbers().catch((err: unknown) => {
      console.warn(`[manual-status-subject] confirmed numbers unavailable notebook=${notebookId}: ${(err as Error).message}`);
      return [];
    });
    const confirmed = await numbers;
    return confirmed.length ? threadStatusScope(questions, { ...machine, confirmedNumbers: confirmed }) : scope;
  };
  return {
    /** Every saved question: what the shown status follows. */
    shown: async (): Promise<SubjectScope> => {
      const scope = await scopeOf(turns.map((t) => t.question));
      if (scope !== "undecided" || turns.length < TURN_WINDOW) return scope;
      const rows = await listTurns(tenantId, notebookId, WIDEST_SUBJECT_READ, { viewerUserId, threadId });
      const widest = await scopeOf(rows.map((t) => t.question));
      return widest === "undecided" && rows.length >= WIDEST_SUBJECT_READ ? "out_of_reach" : widest;
    },
  };
}

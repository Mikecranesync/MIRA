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
import {
  currentManualSearchStatus,
  manualWaitSourceStatus,
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
 *
 * `forManualWait` (the chat route's manual wait, #5746 r8 F12/F13): every read is strict, so a
 * failed read throws instead of reading as "no lookup", and a failed lookup is never settled
 * quietly under an earlier answer from a document. That settling (#5958) is for what the page
 * shows; it says nothing about whether the manual can be used now.
 */
export function notebookManualStatus(
  tenantId: string,
  notebookId: string,
  notebook: EquipmentNotebook,
  sources: NotebookSource[],
  turns: Turn[],
  opts: { forManualWait?: boolean } = {},
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
    ...(opts.forManualWait ? [{ strict: true }] : latestTurnIsGrounded(turns) ? [{ groundedTurn: true }] : []),
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
 * #5746 r8 F11: the words that make "manual" the machine's part or mode ("a manual reset", "the
 * manual valve"), not the document. A missed manual ask answers without the manual, while a
 * question held by mistake costs one pause with "Send without the manual", so this list names only
 * the machine's own parts and modes. Words that also read as part of a manual ("entry",
 * "setting", "process", "test") are left out: "the manual entry for P09.03" waits.
 */
export const MANUAL_MACHINE_WORDS: readonly string[] = [
  "mode", "modes", "override", "overrides", "reset", "resets", "control", "controls", "operation",
  "operations", "switch", "switches", "start", "stop", "position", "valve", "valves", "lever",
  "crank", "jog", "feed", "run", "lubrication", "backup", "handle", "brake", "release", "button",
  "buttons", "input", "inputs", "adjustment", "transfer", "trip", "cycle", "pump", "drain", "lock",
  "labor", "labour", "winch", "hoist", "gate", "door", "damper", "tensioner", "clamp", "wheel",
  "handwheel", "selector", "station", "pendant", "speed", "bypass", "shutoff", "shut-off",
  "disconnect", "load", "loading", "clutch",
];
const MANUAL_WORD = /\bmanuals?\b/gi;
/** "manual" followed by one of the machine's parts or modes. */
const MACHINE_PART_AFTER = new RegExp(String.raw`^\s+(?:${MANUAL_MACHINE_WORDS.map((w) => w.replace(/-/g, "\\-")).join("|")})\b`, "i");
/** The other side of a mode selector: "auto", "automatic", "hand", "off", "local", "remote". */
const MODE_SIDE = String.raw`(?:auto|automatic|hand|off|on|local|remote)`;
/** "manual/auto", "manual-off", "manual or automatic": one side of a mode selector. */
const SELECTOR_AFTER = new RegExp(String.raw`^(?:\s*\/\s*${MODE_SIDE}\b|-${MODE_SIDE}\b|\s+(?:or|and|vs\.?|versus|to)\s+auto(?:matic)?\b)`, "i");
/** "hand/manual", "auto-manual", "auto or manual", "from auto to manual". */
const SELECTOR_BEFORE = new RegExp(String.raw`(?:\b${MODE_SIDE}\s*\/\s*|\b${MODE_SIDE}-|\bauto(?:matic)?\s+(?:or|and|vs\.?|versus|to)\s+)$`, "i");
/**
 * Words before "manual" that make it the document: "according to manual", "refer back to
 * manual", "based on manual", "look in manual", "check manual", "covered in manual".
 */
const DOCUMENT_BEFORE = /\b(?:according\s+to|refer\w*(?:\s+back)?\s+to|go\s+(?:back\s+)?to|as\s+per|per|based\s+on|see|check|consult|read|look(?:ed|ing|s)?\s+(?:in|into|at|through)|search(?:ed|ing)?(?:\s+(?:in|through))?|(?:covered|listed|shown|written|found|mentioned|described|documented|explained|printed|given|stated)\s+(?:in|on)|(?:page|section|chapter|table|figure)\s+(?:\d+\s+)?(?:in|of|on))\s+$/i;
/** A verb that changes a mode, then "to manual" or "into manual": "switch the conveyor to manual". */
const MODE_VERB_BEFORE = /\b(?:switch\w*|set|sets|setting|put|puts|putting|change\w*|go|goes|going|went|turn\w*|flip\w*|move\w*|revert\w*|return\w*|toggle\w*|select\w*|run|runs|running|ran|operate\w*|jog\w*|leave|left|keep|kept)\b(?:\s+[\w'-]+){0,3}?\s+(?:back\s+)?(?:to|into|in)\s+$/i;
/** "in manual", "on manual", "from manual": a mode only with a selector named in the question. */
const PREPOSITION_BEFORE = /\b(?:in|into|on|from)\s+$/i;
const SELECTOR_CUE = /\b(?:auto|automatic|hand|hoa|h-o-a|selector|mode)\b/i;
/** A mode ends its clause: "…to manual.", "…on manual?", "…to manual before you jog it". */
const MODE_ENDS = /^\s*(?:$|[?.!;:)]|,?\s*(?:but|and|or|not|instead|yet|still|then|before|after|when|while|until|so|because|if|on\s+the\s+(?:hmi|panel|screen|selector|switch|pendant))\b)/i;
/** "manual page 12", "manual section 4": a part of the manual named without an article. */
const MANUAL_PART = /\bmanual\s+(?:page|pages|section|chapter|table|figure|fig\.?|pg\.?|p\.)\s*\d/i;

/**
 * #5746 r7 F11, r8 F11: a question that mentions the manual waits for it. Each mention is read on
 * its own, and any one that is the document makes the question wait: "which manual covers…", "do
 * you have manuals for…", "according to manual", "what page of the manual…", "manual page 4",
 * "the manual's wiring table". A mention is not the document only when it is the machine's part or
 * mode, and that needs a positive cue: a machine word after it (MANUAL_MACHINE_WORDS), a selector
 * ("manual/auto", "auto or manual"), a verb that changes a mode ("switch the conveyor to manual"),
 * or "in/on/from manual" in a question that names the selector or a mode. "Manually", "figure out"
 * and a bare "table" are not the manual, and an ordinary question does not wait. Only the word
 * "manual" counts: "user guide", "handbook" or "documentation" do not.
 *
 * This reads the question's words only, with no list of safety words of its own: the chat route's
 * safety, energized-work and bypass stops decide which questions keep their own path.
 */
export function waitsForManual(question: string): boolean {
  if (MANUAL_PART.test(question)) return true;
  for (const mention of question.matchAll(MANUAL_WORD)) {
    if (mention[0].length > "manual".length) return true; // "manuals" is always the document
    const at = mention.index ?? 0;
    const before = question.slice(0, at);
    const after = question.slice(at + mention[0].length);
    if (DOCUMENT_BEFORE.test(before)) return true;
    if (MACHINE_PART_AFTER.test(after) || SELECTOR_AFTER.test(after) || SELECTOR_BEFORE.test(before)) continue;
    if (MODE_ENDS.test(after) && (MODE_VERB_BEFORE.test(before) ||
      (PREPOSITION_BEFORE.test(before) && SELECTOR_CUE.test(question)))) continue;
    return true;
  }
  return false;
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
  // Only a question about another exact model is answered without the project's manual. A subject
  // out of reach is not shown to be another model, so it waits like an undecided one (r8). (The
  // detail read's `sendWaitAllows` is unchanged.)
  if (!status || !scope || scope === "other") return null;
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
      // r8 F13: a settled status with no state says nothing about the manual. The wait's read
      // never settles a failed lookup under an earlier grounded answer, so this is a state the
      // decision does not know: it pauses rather than answer without a manual that may be there.
      return { error: "manual_unavailable", reason: "unknown", lookup };
  }
}

/**
 * Reads what the manual wait decides from: the project's current status, from this viewer's
 * history of this thread, and the subject with the outgoing question as the newest whole-machine
 * question. Throws on a failed read (every status read is strict, r8 F12); the route treats that
 * as `read_failed`. Where the lookup
 * status is null, the project's own Sources decide (`manualWaitSourceStatus`): a linked manual
 * that is turned off, still being prepared or unreadable is not answered without.
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
  const status = (await notebookManualStatus(tenantId, notebookId, notebook, sources, turns, { forManualWait: true })) ??
    manualWaitSourceStatus(sources, {
      identityStatus: notebook.identityStatus,
      manufacturer: notebook.manufacturer,
      model: notebook.model,
      catalogNumber: notebook.catalogNumber,
    });
  if (!status) return { status, scope: null };
  // A status whose machine can't be named can't be shown to be about another model: it is the
  // project's machine, so the question waits (r8).
  const machine = subjectMachine(status, notebook);
  if (!machine) return { status, scope: "undecided" };
  const scope = await subjectReader({ tenantId, notebookId, viewerUserId, threadId, turns, machine }).wholeMachine(question);
  return { status, scope };
}

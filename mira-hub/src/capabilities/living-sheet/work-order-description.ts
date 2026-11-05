/**
 * Builds the Atlas work-order DESCRIPTION for a technician-confirmed
 * "create work order" request from a Living Work Sheet (TASK-OUTBOX-CREATE-WO).
 *
 * Why the description, not an attachment: at the deployed Atlas digest, file
 * attachments are license-gated (`FileController`: "You need a license to
 * add a file" — same constraint `contracts/cmms-write-contract.v1.json`
 * already documents for `attach_evidence`). So the created order's
 * DESCRIPTION is the only place the job's content can land where Atlas
 * read-back can see it. This function renders the whole thing: the marker
 * (so read-back is a substring match, same discipline as
 * `write-contract.ts::renderWorkLogText`), title + asset, every step's
 * done/not-done state with who/when, every reading's current value with who
 * (a superseded value is explicitly labelled, never shown as current), the
 * open-items summary, and photo/source references as display strings only
 * (Hub `fileId`s — never a URL, never a secret).
 *
 * WORDING RULE (same as `finish-outbox.ts`): never say "fixed", "safe",
 * "repaired", or "resolved" about the ASSET. Technician-typed text (job
 * title, step text, note text) is quoted verbatim, never rewritten.
 *
 * Pure, no I/O — reuses the exact phrasing `living-sheet-print.ts` already
 * established (`NO_SOURCE_TEXT`) rather than inventing new copy.
 */
import type { SheetReadingView, SheetStepView, SheetView } from "./reduce";

/** Same string `living-sheet-print.ts` uses for a torque with no source —
 *  reused here for a reading recorded with no `ref`. */
const NO_SOURCE_TEXT = "no source — unverified";

/** Same disclaimer `living-sheet-print.ts::FOOTER_DISCLAIMER` already prints
 *  on every job sheet — reused verbatim rather than inventing new copy, and
 *  it already satisfies the WORDING RULE without using "safe"/"repaired". */
const FOOTER_DISCLAIMER = "This sheet records what was reported. It does not authorize return to service.";

/** Hard cap on the rendered description. Atlas stores it as TEXT, but a
 *  sane bound keeps the comment readable and keeps this provider's write
 *  payload small regardless of how large a job sheet grows. */
export const WORK_ORDER_DESCRIPTION_MAX_CHARS = 4000;
const TRUNCATION_LINE = "(truncated — full sheet in FactoryLM)";

function sourceText(source: { kind: "tech" | "manual"; ref: string | null } | null): string {
  if (!source) return NO_SOURCE_TEXT;
  if (source.kind === "manual") return source.ref ? `manual: ${source.ref}` : NO_SOURCE_TEXT;
  return "technician-reported";
}

function stepLine(step: SheetStepView, position: number): string {
  const who = step.doneBy ? ` by ${step.doneBy}` : "";
  const when = step.doneAt ? ` at ${step.doneAt}` : "";
  const note = step.note ? ` — note: "${step.note}"` : "";
  return step.done
    ? `  ${position}. [done${who}${when}] "${step.text}"${note}`
    : `  ${position}. [not done] "${step.text}"`;
}

/** Current value only — a superseded value is labelled "Replaced — not
 *  used", never rendered as if it were the current reading. */
function readingLines(reading: SheetReadingView): string[] {
  const who = reading.current.by ? ` — ${reading.current.by}` : "";
  const src = sourceText(reading.source);
  const lines = [`  ${reading.what}: ${reading.current.value} ${reading.current.unit}${who} (${src})`];
  const supersededCount = reading.history.filter((h) => h.superseded).length;
  if (supersededCount > 0) {
    lines.push(`    Replaced — not used (${supersededCount} prior value${supersededCount === 1 ? "" : "s"})`);
  }
  return lines;
}

function openItemsLines(view: SheetView): string[] {
  const openSteps = view.steps.filter((s) => !s.done);
  const openQuestions = view.questions.filter((q) => !q.resolved);
  if (openSteps.length === 0 && openQuestions.length === 0) return ["  None."];
  const lines: string[] = [];
  if (openSteps.length > 0) {
    lines.push(`  Unfinished steps (${openSteps.length}):`);
    for (const s of openSteps.slice(0, 10)) lines.push(`    - "${s.text}"`);
    if (openSteps.length > 10) lines.push(`    (+${openSteps.length - 10} more)`);
  }
  if (openQuestions.length > 0) {
    lines.push(`  Unanswered questions (${openQuestions.length}):`);
    for (const q of openQuestions.slice(0, 10)) lines.push(`    - "${q.text}"`);
    if (openQuestions.length > 10) lines.push(`    (+${openQuestions.length - 10} more)`);
  }
  return lines;
}

/** Photo references as Hub photo ids only — never a URL, never a secret.
 *  NOTE: `SheetPhotoView` carries no content hash today
 *  (`PhotoAttachedPayload` has `photoId`/`fileId`/`caption` only), so this
 *  cites the Hub `fileId` alone. A sha256 reference would need a schema
 *  change this task does not make — flagged, not invented. */
function photoLines(view: SheetView): string[] {
  if (view.photos.length === 0) return [];
  const lines = [`Photos (${view.photos.length}, Hub file id — see FactoryLM for the image):`];
  for (const p of view.photos.slice(0, 10)) {
    const caption = p.caption ? ` — "${p.caption}"` : "";
    lines.push(`  - file ${p.fileId}${caption}`);
  }
  if (view.photos.length > 10) lines.push(`  (+${view.photos.length - 10} more)`);
  return lines;
}

/** Pure: same (view, marker) in, same description string out. Never says
 *  the asset is repaired, safe, or resolved. */
export function buildWorkOrderDescription(view: SheetView, marker: string): string {
  const assetName = view.machine.name ?? "unlinked asset";
  const lines: string[] = [];

  lines.push(marker);
  lines.push(`Work order requested from job sheet "${view.title}" — asset: ${assetName}.`);
  lines.push("");

  lines.push(`Steps (${view.steps.length}):`);
  view.steps.forEach((s, i) => lines.push(stepLine(s, i + 1)));
  lines.push("");

  if (view.readings.length > 0) {
    lines.push("Readings:");
    for (const r of view.readings) lines.push(...readingLines(r));
    lines.push("");
  }

  lines.push("Open items:");
  lines.push(...openItemsLines(view));
  lines.push("");

  const photos = photoLines(view);
  if (photos.length > 0) {
    lines.push(...photos);
    lines.push("");
  }

  lines.push(FOOTER_DISCLAIMER);

  const full = lines.join("\n").trimEnd();
  if (full.length <= WORK_ORDER_DESCRIPTION_MAX_CHARS) return full;
  const cut = full.slice(0, WORK_ORDER_DESCRIPTION_MAX_CHARS - TRUNCATION_LINE.length - 1);
  return `${cut}\n${TRUNCATION_LINE}`;
}

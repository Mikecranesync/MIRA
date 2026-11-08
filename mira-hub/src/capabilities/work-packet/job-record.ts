/**
 * Work Packet job record — pure (no I/O).
 *
 * What the technician actually did on the job: which draft steps they performed, the values they
 * measured, findings and unresolved issues, and job photos. Kept apart from the packet's review
 * edits (`edits.ts`): confirming a manual line means "I checked this line", never "I did this work".
 *
 * Nothing here is ever inferred. A step is performed only when the technician records it, and the
 * summary never states that equipment is safe, repaired or returned to service — that is a
 * qualified person's decision on site, outside this record.
 */
import type { WorkPacket } from "./types";

export interface StepRecord {
  performed: true;
  by: string;
  at: string;
  /** The step's text when it was ticked. If the step is edited later the tick no longer counts
   *  (Codex EGM F35). Records saved before this field existed have none and keep their tick. */
  text?: string | null;
}

export interface MeasurementRecord {
  /** As measured, in the technician's own words — not checked against the manual value. */
  value: string;
  by: string;
  at: string;
}

export interface JobNote {
  id: string;
  kind: "finding" | "issue";
  text: string;
  /** The draft step the note is about, or null for the job as a whole. */
  stepIndex: number | null;
  by: string;
  at: string;
  resolved?: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
}

export interface JobPhoto {
  id: string;
  /** A downscaled inline JPEG (data: URL) — kept on this device with the record. */
  image: string;
  caption: string;
  stepIndex: number | null;
  by: string;
  at: string;
}

export interface JobRecord {
  version: 1;
  packetId: string;
  steps: Record<number, StepRecord>;
  measurements: Record<number, MeasurementRecord>;
  notes: JobNote[];
  photos: JobPhoto[];
}

export const MAX_JOB_PHOTOS = 8;

export function emptyRecord(packetId: string): JobRecord {
  return { version: 1, packetId, steps: {}, measurements: {}, notes: [], photos: [] };
}

function clone(r: JobRecord): JobRecord {
  return JSON.parse(JSON.stringify(r)) as JobRecord;
}

function checkIndex(i: number): void {
  if (!Number.isInteger(i) || i < 0) throw new Error(`Invalid index: ${i}`);
}

export function setStepPerformed(r: JobRecord, index: number, performed: boolean, by: string, at: string, text?: string | null): JobRecord {
  checkIndex(index);
  const next = clone(r);
  if (performed) next.steps[index] = text === undefined ? { performed: true, by, at } : { performed: true, by, at, text };
  else delete next.steps[index];
  return next;
}

/** True when step `index` is recorded as performed for the instruction as it reads now. */
export function stepPerformedHolds(r: JobRecord, packet: Pick<WorkPacket, "steps">, index: number): boolean {
  const rec = r.steps[index];
  if (!rec?.performed) return false;
  if (rec.text === undefined) return true;
  return rec.text === (packet.steps[index]?.text.value ?? null);
}

export function recordMeasurement(r: JobRecord, index: number, value: string, by: string, at: string): JobRecord {
  checkIndex(index);
  const next = clone(r);
  const v = value.trim();
  if (v) next.measurements[index] = { value: v, by, at };
  else delete next.measurements[index];
  return next;
}

export function addNote(r: JobRecord, note: JobNote): JobRecord {
  if (!note.text.trim()) throw new Error("A note needs text.");
  const next = clone(r);
  next.notes.push({ ...note, text: note.text.trim() });
  return next;
}

export function setNoteResolved(r: JobRecord, id: string, resolved: boolean, by: string, at: string): JobRecord {
  const next = clone(r);
  const n = next.notes.find((x) => x.id === id);
  if (!n) throw new Error(`Unknown note: ${id}`);
  if (resolved) Object.assign(n, { resolved: true, resolvedBy: by, resolvedAt: at });
  else { delete n.resolved; delete n.resolvedBy; delete n.resolvedAt; }
  return next;
}

export function addPhoto(r: JobRecord, photo: JobPhoto): JobRecord {
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo.image)) throw new Error("A job photo must be an inline image.");
  if (r.photos.length >= MAX_JOB_PHOTOS) throw new Error(`A record holds at most ${MAX_JOB_PHOTOS} photos.`);
  const next = clone(r);
  next.photos.push(photo);
  return next;
}

export function removePhoto(r: JobRecord, id: string): JobRecord {
  const next = clone(r);
  next.photos = next.photos.filter((p) => p.id !== id);
  return next;
}

/** A saved record, or null when it is unreadable or belongs to another packet. */
export function parseRecord(raw: string | null, packetId: string): JobRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as JobRecord;
    const ok = r && r.version === 1 && r.packetId === packetId && typeof r.steps === "object" && typeof r.measurements === "object" &&
      Array.isArray(r.notes) && Array.isArray(r.photos);
    return ok ? r : null;
  } catch {
    return null;
  }
}

export type CompletionStatus = "not_started" | "in_progress" | "open_issues" | "all_steps_recorded";

export interface CompletionSummary {
  status: CompletionStatus;
  total: number;
  struck: number;
  performed: number;
  remaining: number;
  measured: number;
  measurementsTotal: number;
  findings: number;
  openIssues: number;
  photos: number;
  text: string;
}

const REVIEW_LINE = "This is a draft work record, not a return to service. A qualified person must review it and decide what happens next.";

export function completionSummary(packet: Pick<WorkPacket, "steps" | "measurements">, r: JobRecord): CompletionSummary {
  const live = packet.steps.map((s, i) => ({ i, struck: !!s.text.struck })).filter((s) => !s.struck);
  const performed = live.filter((s) => stepPerformedHolds(r, packet, s.i)).length;
  const struck = packet.steps.length - live.length;
  const remaining = live.length - performed;
  const measured = packet.measurements.filter((_, i) => r.measurements[i]).length;
  const findings = r.notes.filter((n) => n.kind === "finding").length;
  const openIssues = r.notes.filter((n) => n.kind === "issue" && !n.resolved).length;
  const touched = performed > 0 || measured > 0 || r.notes.length > 0 || r.photos.length > 0;

  let status: CompletionStatus;
  if (!touched) status = "not_started";
  else if (openIssues > 0) status = "open_issues";
  else if (live.length > 0 && remaining === 0) status = "all_steps_recorded";
  else status = "in_progress";

  const head: Record<CompletionStatus, string> = {
    not_started: "Not started — no work recorded yet.",
    in_progress: "In progress — work is partly recorded.",
    open_issues: `Open issues — ${openIssues} unresolved issue${openIssues === 1 ? "" : "s"} recorded.`,
    all_steps_recorded: "Every remaining draft step is recorded as performed by the technician.",
  };
  const counts =
    `${performed} of ${live.length} steps recorded as performed` +
    (struck ? ` (${struck} struck as not applicable)` : "") +
    `; ${measured} of ${packet.measurements.length} measurements recorded; ${findings} finding${findings === 1 ? "" : "s"}; ` +
    `${r.photos.length} photo${r.photos.length === 1 ? "" : "s"}.`;
  return {
    status, total: packet.steps.length, struck, performed, remaining, measured, measurementsTotal: packet.measurements.length,
    findings, openIssues, photos: r.photos.length, text: `${head[status]} ${counts} ${REVIEW_LINE}`,
  };
}

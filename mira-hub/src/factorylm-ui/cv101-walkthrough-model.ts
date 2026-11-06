/** Tutorial-local fixtures and adapters. No I/O or server imports. Never admitted as asset evidence. */
import { emptyRecord, parseRecord, type JobRecord } from "@/capabilities/work-packet/job-record";
import type { Field, WorkPacket } from "@/capabilities/work-packet/types";
import { reduceSheet, type StoredEvent } from "@/capabilities/living-sheet/reduce";
import type { JobSheetBody, SheetEvent } from "@/capabilities/living-sheet/types";

export type WalkthroughStatus = "PASS" | "FAIL" | "BLOCKED";
const PIN = "211e5c78ecdc6cf538e7509206a3397167f74d5e";
const ROOT = `https://github.com/Mikecranesync/MIRA/blob/${PIN}`;
export const CV101_EVIDENCE = {
  revision: PIN,
  asOf: "2026-11-06T10:32:00.318324Z",
  inventory: `${ROOT}/docs/proofs/cv101-asset-memory-acceptance/inventory.md`,
  receipt: `${ROOT}/docs/proofs/cv101-asset-memory-acceptance/db-inspect-cv101.txt`,
  acceptance: `${ROOT}/docs/proofs/cv101-asset-memory-acceptance/README.md`,
  procedure: `${ROOT}/docs/proofs/cv101-asset-memory-acceptance/procedure.md`,
  software: `${ROOT}/docs/proofs/asset-memory-5241-continuation/verification.md`,
  plcPhoto: `${ROOT}/plc/conv_simple_electrical/review/photos/panel_full.jpg`,
  manual: "https://literature.rockwellautomation.com/idc/groups/literature/documents/in/2080-in009_-en-p.pdf#page=6",
} as const;

export const CV101_COMPONENTS = [
  { id: "plc", name: "Micro820 PLC", model: "2080-LC20-20QBB", state: "Historical photograph", detail: "The July 11 photograph supports the model. MAC/serial records conflict; current unit and firmware are unverified.", source: CV101_EVIDENCE.plcPhoto },
  { id: "drive", name: "DURApulse drive", model: "GS10 family", state: "Historical photograph / transcription", detail: "Exact GS11N-20P2 is a July 2 transcription. Serial settings differ across program revisions; no current readback.", source: CV101_EVIDENCE.inventory },
  { id: "motor", name: "Conveyor gearmotor", model: "Model 108074 transcription", state: "Historical technician record", detail: "Manufacturer and gearbox identity are unresolved. The recorded 1 HP motor versus ¼ HP drive rating discrepancy is unresolved suitability evidence.", source: CV101_EVIDENCE.inventory },
  { id: "photoeye", name: "PE-101 photoeye", model: "Physical model unknown", state: "Program function / proposed physical identity", detail: "DI05 is the program function. Sensor make, wiring and blocked/clear polarity have not been confirmed.", source: CV101_EVIDENCE.inventory },
] as const;

type Workflow = { title: string; instructions: readonly string[]; expected: string; evidence: string; live: { status: WalkthroughStatus; actual: string } };
export const CV101_WORKFLOWS: readonly Workflow[] = [
  { title: "Sign in and discover CV-101", instructions: ["In the real product, sign in with your existing account; open navigation → Projects → the owner-confirmed CV-101 project and its machine link. If that association is unknown, stop rather than create or rebind an asset.", "For practice, select the local CV-101 example below. This does not sign in or select a real tenant's asset."], expected: "Identify one asset without joining machines by display name.", evidence: CV101_EVIDENCE.acceptance, live: { status: "BLOCKED", actual: "The garage cloud asset/KG bridge was confirmed. Owner sign-in and exact notebook association were not established; another tenant also has a CV-101." } },
  { title: "Inspect components and manuals", instructions: ["Open each component card and read its source and unknowns.", "Follow the PLC OEM reference and compare the documented topology with the relationship diagram. Dashed links are historical or unverified current relationships."], expected: "Understand PLC, drive, motor and photoeye relationships, applicable references and unresolved identity.", evidence: CV101_EVIDENCE.inventory, live: { status: "BLOCKED", actual: "Historical photographs, transcriptions and code exist. Current physical relationships, exact unit identities and original manual attachments were not verified." } },
  { title: "Read telemetry with its source and time", instructions: ["Read the dated production receipt before viewing any example values.", "Replay the synthetic DI05 samples. Compare source observation, acquisition and receipt time; never infer present motion or photoeye polarity."], expected: "Distinguish historical cloud history, synthetic samples and an actual fresh equipment reading.", evidence: CV101_EVIDENCE.receipt, live: { status: "FAIL", actual: "Fresh-baseline check failed: newest bridge observation was over 12 hours old at inspection. Reader identity/access, per-tag quality and current readings remain unestablished." } },
  { title: "Ask a question and open its citation", instructions: ["Play the prepared technical question; this is a teaching example, not a generated MIRA answer.", "Open its citation in the existing source viewer, then follow the original OEM document. For a real answer, use the confirmed project's composer only after owner/source checks pass."], expected: "A claim has an identifiable manual reference and the original source is reachable.", evidence: CV101_EVIDENCE.inventory, live: { status: "BLOCKED", actual: "No authenticated CV-101 question/served answer or asset-attached original manual citation was proven. A reference link is not a retrieval or ingestion receipt." } },
  { title: "Document an inspection", instructions: ["Create the synthetic documentation-review packet. These steps are UI practice, not physical inspection instructions.", "Use the existing Work Packet checkoffs and notes, then finish the practice record. Read the same event-derived Living Sheet preview; unknowns stay unresolved."], expected: "Explicit reports, actor/time and completion remain distinguishable from a procedure draft or safety approval.", evidence: CV101_EVIDENCE.software, live: { status: "BLOCKED", actual: "No real CV-101 maintenance observation, completed Living Sheet/Work Packet or technician closeout was recorded. No Atlas writes are authorized." } },
  { title: "Open a new practice session and recall", instructions: ["After finishing, reopen the walkthrough or reload this tab and retrieve the saved practice job.", "Read its same event sequence, notes and unresolved items. This tests same-browser practice storage, not another technician account or server persistence."], expected: "Retrieve the same recorded practice history without inventing a live machine state or approval.", evidence: CV101_EVIDENCE.acceptance, live: { status: "BLOCKED", actual: "A real owner-authenticated, cross-session CV-101 recall/tenant-isolation journey remains unproven. Existing synthetic QA evidence is separate." } },
];

export type LessonProgress = { discovered: boolean; components: string[]; manual: boolean; telemetry: boolean; question: boolean; citation: boolean; recalled: boolean };
export const emptyLesson = (): LessonProgress => ({ discovered: false, components: [], manual: false, telemetry: false, question: false, citation: false, recalled: false });
export const DEMO_PACKET_ID = "cv101-practice-packet-v1";
const DEMO_ACTOR = "Demo technician";
const FINISH = "Synthetic documentation review completed in this browser. Physical machine state, current connections and reusable acceptance remain unknown.";
const field = (value: string | null): Field => ({ value, label: value === null ? "unknown" : "proposed", source: null, basis: "Synthetic walkthrough fixture; not an OEM instruction or physical observation" });
export function practicePacket(): WorkPacket {
  return {
    version: 2, packetId: DEMO_PACKET_ID, notebookId: "cv101-practice-notebook-v1", generatedAt: "2026-11-06T12:00:00.000Z",
    disclaimer: "SYNTHETIC PRACTICE ONLY — no physical work, equipment commands or return to service.",
    equipment: { manufacturer: field(null), model: field("CV-101 learning model"), serial: field(null), identityStatus: "unconfirmed" },
    identitySnapshot: { manufacturer: null, model: "CV-101 learning model", catalogNumber: null },
    workOrder: { id: "demo-only-no-atlas-order", title: "Synthetic CV-101 documentation review", description: "Practice recording a documentation review. No physical operation.", assetTag: "DEMO-CV101", site: null, synthetic: true },
    documents: [], scope: [field("Practice documentation review only")], safety: { cautions: [field("Do not operate or alter equipment for this walkthrough.")], siteIsolation: field(null), hazardFlags: [] },
    parts: [], tools: [], measurements: [],
    steps: ["Read the historical identity/source cards in this walkthrough.", "Record that current telemetry and physical condition remain unverified."].map((text, i) => ({ section: "Documentation review — synthetic", topic: "other", phase: "service", n: i + 1, text: field(text), notes: [] })),
    unknowns: [field("Current physical state, exact installed unit identities, fresh telemetry and manual attachments are unverified.")],
    approval: { technicianReview: { state: "draft", entries: [] }, supervisor: { state: "pending", by: null, at: null } },
  };
}
function template(): JobSheetBody {
  const p = practicePacket();
  return { title: p.workOrder.title, machineLabel: "DEMO-CV101 (synthetic)", component: "Documentation review only", jobType: "inspection", estHours: null, crewSize: null, isolationPoints: "No physical work is authorized by this practice record.", cautions: p.disclaimer, returnToService: [], items: [], torques: [], author: DEMO_ACTOR, notes: "Synthetic practice, not a server-backed job or technician closeout QC. Original sources remain in the walkthrough evidence links.", steps: p.steps.map((s, i) => ({ id: `demo-step-${i}`, text: s.text.value!, checkoff: "none", torqueRef: null, source: CV101_EVIDENCE.inventory })) };
}
export type Practice = { kind: "cv101_practice"; version: 1; viewerScope: string; jobId: string; record: JobRecord; events: StoredEvent[]; lesson: LessonProgress };
export function newPractice(viewerScope: string, at: string, jobId: string): Practice {
  const t = template();
  return { kind: "cv101_practice", version: 1, viewerScope, jobId, record: emptyRecord(DEMO_PACKET_ID), lesson: emptyLesson(), events: [{ id: `${jobId}-1`, seq: 1, actorLabel: DEMO_ACTOR, actorUserId: null, occurredAt: at, recordedAt: at, workOrderId: null, kind: "job_started", payload: { title: t.title, machine: { entityId: "DEMO-CV101", name: "Synthetic CV-101 learning model" }, templateRevisionId: null, template: t } }] };
}
export const practiceView = (p: Practice) => reduceSheet(p.events, p.jobId);
function append(p: Practice, event: SheetEvent, at: string): Practice {
  if (p.events.length >= 80) throw new Error("Practice history is full. Start a fresh practice record.");
  const seq = p.events.length + 1;
  return { ...p, events: [...p.events, { id: `${p.jobId}-${seq}`, seq, actorLabel: DEMO_ACTOR, actorUserId: null, occurredAt: at, recordedAt: at, workOrderId: null, ...event }] };
}
export function updatePracticeRecord(p: Practice, record: JobRecord, at: string): Practice {
  if (practiceView(p).finished) throw new Error("This practice record is finished; its history is retained.");
  let next = p;
  for (let i = 0; i < practicePacket().steps.length; i++) {
    if (Boolean(p.record.steps[i]) !== Boolean(record.steps[i])) next = append(next, { kind: "step_marked", payload: { stepId: `demo-step-${i}`, done: Boolean(record.steps[i]), note: null } }, at);
  }
  if (record.notes.length > 12 || record.notes.some(n => n.text.length > 2000)) throw new Error("Practice notes are limited to 12 entries of 2,000 characters.");
  for (const note of record.notes) {
    const old = p.record.notes.find(n => n.id === note.id);
    if (!old) next = append(next, { kind: "note_added", payload: { noteId: note.id, text: note.text, noteKind: note.kind === "issue" ? "question" : "note" } }, note.at);
    else if (!old.resolved && note.resolved) next = append(next, { kind: "question_resolved", payload: { noteId: note.id, resolution: "Marked resolved in synthetic practice only; no physical condition was verified." } }, note.resolvedAt ?? at);
    else if (old.resolved && !note.resolved) throw new Error("To retain chronology, add a new unresolved practice note instead of reopening an old one.");
  }
  return { ...next, record: structuredClone(record) };
}
export function finishPractice(p: Practice, at: string): Practice {
  const v = practiceView(p);
  if (v.finished) return p;
  if (v.openSteps || !p.record.notes.length) throw new Error("Record both steps and at least one note before finishing practice.");
  return append(p, { kind: "job_finished", payload: { summary: FINISH, openItemsAcknowledged: true } }, at);
}
export function practiceStatus(index: number, p: Practice | null, lesson: LessonProgress = p?.lesson ?? emptyLesson()): WalkthroughStatus {
  const checks = [lesson.discovered, lesson.components.length === CV101_COMPONENTS.length && lesson.manual, lesson.telemetry, lesson.question && lesson.citation, !!p && !!practiceView(p).finished, !!p && !!practiceView(p).finished && lesson.recalled];
  return checks[index] ? "PASS" : "BLOCKED";
}
/** Viewer scope is an isolation key, not an authentication or tenant-authorization claim. */
export const storageKey = (viewer: string) => `factorylm:cv101-practice:v1:${encodeURIComponent(viewer)}`;
const plain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max = 2000): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
const time = (v: unknown): v is string => text(v, 40) && Number.isFinite(Date.parse(v));
/** Only the tutorial's own narrow event subset is admitted; never a general job importer. */
export function parsePractice(raw: string | null, viewerScope: string): Practice | null {
  if (!raw || raw.length > 120000) return null;
  try {
    const p = JSON.parse(raw) as Practice;
    if (!plain(p) || p.kind !== "cv101_practice" || p.version !== 1 || p.viewerScope !== viewerScope || !text(p.jobId, 100) || !p.jobId.startsWith("demo-cv101-") || !Array.isArray(p.events) || !p.events.length || p.events.length > 80) return null;
    const r = parseRecord(JSON.stringify(p.record), DEMO_PACKET_ID);
    if (!r || !plain(r.steps) || !plain(r.measurements) || Object.keys(r.measurements).length || r.photos.length || r.notes.length > 12) return null;
    if (Object.entries(r.steps).some(([i, s]) => !["0", "1"].includes(i) || !plain(s) || s.performed !== true || s.by !== DEMO_ACTOR || !time(s.at) || s.text !== practicePacket().steps[Number(i)].text.value)) return null;
    if (r.notes.some(n => !plain(n) || !text(n.id, 100) || !["finding", "issue"].includes(n.kind) || !text(n.text) || n.by !== DEMO_ACTOR || !time(n.at) || ![null, 0, 1].includes(n.stepIndex))) return null;
    if (new Set(r.notes.map(n => n.id)).size !== r.notes.length || r.notes.some(n =>
      (n.resolved !== undefined && typeof n.resolved !== "boolean") ||
      (n.resolved ? n.kind !== "issue" || n.resolvedBy !== DEMO_ACTOR || !time(n.resolvedAt)
        : n.resolvedBy !== undefined || n.resolvedAt !== undefined))) return null;
    const l = p.lesson;
    if (!plain(l) || [l.discovered, l.manual, l.telemetry, l.question, l.citation, l.recalled].some(v => typeof v !== "boolean") || !Array.isArray(l.components) || l.components.length > 4 || new Set(l.components).size !== l.components.length || l.components.some(id => !CV101_COMPONENTS.some(c => c.id === id))) return null;
    for (const [i, e] of p.events.entries()) {
      if (!plain(e) || e.seq !== i + 1 || e.id !== `${p.jobId}-${i + 1}` || e.actorLabel !== DEMO_ACTOR || e.actorUserId !== null || e.workOrderId !== null || !time(e.occurredAt) || e.recordedAt !== e.occurredAt || !plain(e.payload)) return null;
      if (i === 0) {
        if (e.kind !== "job_started" || JSON.stringify(e.payload) !== JSON.stringify(newPractice(viewerScope, e.occurredAt, p.jobId).events[0].payload)) return null;
      } else if (e.kind === "step_marked") {
        if (!["demo-step-0", "demo-step-1"].includes(e.payload.stepId) || typeof e.payload.done !== "boolean" || e.payload.note !== null) return null;
      } else if (e.kind === "note_added") {
        if (!text(e.payload.noteId, 100) || !text(e.payload.text) || !["note", "question"].includes(e.payload.noteKind)) return null;
      } else if (e.kind === "question_resolved") {
        if (!text(e.payload.noteId, 100) || !text(e.payload.resolution)) return null;
      } else if (e.kind === "job_finished") {
        if (i !== p.events.length - 1 || e.payload.summary !== FINISH || e.payload.openItemsAcknowledged !== true) return null;
      } else return null;
    }
    const v = practiceView(p);
    if (v.warnings.length || v.steps.some((s, i) => s.done !== Boolean(r.steps[i])) || v.notes.length + v.questions.length !== r.notes.length) return null;
    if (r.notes.some(n => {
      const q = v.questions.find(s => s.id === n.id);
      const s = n.kind === "issue" ? q : v.notes.find(s => s.id === n.id);
      if (!s || s.text !== n.text || s.by !== n.by || s.at !== n.at) return true;
      return n.kind === "issue" && (!q || q.resolved !== Boolean(n.resolved) ||
        q.resolvedBy !== (n.resolvedBy ?? null) || q.resolvedAt !== (n.resolvedAt ?? null));
    })) return null;
    if (v.finished && (v.openSteps || !r.notes.length)) return null;
    return p;
  } catch { return null; }
}

export type PracticeStorage = Pick<Storage, "getItem" | "setItem">;
export type PracticeStorageProvider = () => PracticeStorage;
export function persistPractice(storage: PracticeStorageProvider, p: Practice): { status: "saved" | "invalid" | "unavailable" } {
  try {
    const raw = JSON.stringify(p);
    if (!parsePractice(raw, p.viewerScope)) return { status: "invalid" };
    storage().setItem(storageKey(p.viewerScope), raw);
    return { status: "saved" };
  } catch { return { status: "unavailable" }; }
}
export function readPractice(storage: PracticeStorageProvider, viewer: string): { status: "ready"; practice: Practice } | { status: "missing" | "invalid" | "unavailable" } {
  try {
    const raw = storage().getItem(storageKey(viewer));
    if (raw === null) return { status: "missing" };
    const p = parsePractice(raw, viewer);
    return p ? { status: "ready", practice: p } : { status: "invalid" };
  } catch { return { status: "unavailable" }; }
}

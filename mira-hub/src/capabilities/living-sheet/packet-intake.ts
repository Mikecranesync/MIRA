/** Pure, bounded adapter. Unknown JSON properties are retained as opaque imported
 * evidence. Only the supported shape below is interpreted or rendered. */
import { isUuid } from "@/capabilities/fix-records";
import type { WorkPacket, PacketEdit } from "@/capabilities/work-packet/types";
import type { JobRecord } from "@/capabilities/work-packet/job-record";
import { collectFields } from "@/capabilities/work-packet/verify";
import { applyEdit } from "@/capabilities/work-packet/edits";
import type { JobSheetBody } from "./types";
import type { ValidationResult } from "./validate";
import { qcTargets } from "./instruction-fields";
export { qcTargets } from "./instruction-fields";

export const INTAKE_BYTES_MAX = 8 * 1024 * 1024;
export type PacketIntakeInput = { clientRequestId: string; packet: WorkPacket; record: JobRecord | null };
export type CloseoutInput = { clientRequestId: string; seq: number; snapshotId: string; decisions: PacketEdit[] };
type Check = (v: unknown) => boolean;
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text: Check = v => typeof v === "string" && v.length <= 16000;
const nullable = (check: Check): Check => v => v === null || check(v);
const num: Check = v => typeof v === "number" && Number.isFinite(v);
const integer: Check = v => num(v) && Number.isInteger(v) && Number(v) >= 0;
const bool: Check = v => typeof v === "boolean";
const one = (...values: unknown[]): Check => v => values.includes(v);
const arr = (check: Check): Check => v => Array.isArray(v) && v.length <= 500 && v.every(check);
const shape = (required: Record<string, Check>, optional: Record<string, Check> = {}): Check => v =>
  obj(v) && Object.entries(required).every(([key, check]) => check(v[key])) &&
  Object.entries(optional).every(([key, check]) => v[key] === undefined || check(v[key]));
const source = shape({ docId: text, fileId: nullable(text), filename: nullable(text), page: integer, line: text });
const review = shape({ path: text, action: one("set", "confirm", "strike", "mark_unknown", "settle"), by: text, at: text,
  previous: () => true, next: () => true }, { source: text });
const field = shape({ value: nullable(text), label: one("verified", "proposed", "unknown"), source: nullable(source), basis: text },
  { struck: bool, review, copyOf: text });
const index = (length: number): Check => v => integer(v) && Number(v) < length;
const image: Check = v => {
  if (typeof v !== "string" || v.length > 1400000) return false;
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(v);
  if (!match || match[2].length % 4 !== 0) return false;
  try {
    const bytes = atob(match[2].slice(0, 32));
    return match[1] === "png" ? bytes.startsWith("\x89PNG\r\n\x1a\n") :
      match[1] === "jpeg" ? bytes.startsWith("\xff\xd8\xff") : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
  } catch { return false; }
};

/** Bound depth, node count and bytes before walking any optional opaque content. */
export function boundedJson(raw: unknown): boolean {
  let nodes = 0;
  function visit(v: unknown, depth: number): boolean {
    if (++nodes > 50000 || depth > 24) return false;
    if (v === null || typeof v === "boolean" || typeof v === "string") return true;
    if (typeof v === "number") return Number.isFinite(v);
    if (Array.isArray(v)) return v.length <= 1000 && v.every(x => visit(x, depth + 1));
    return obj(v) && Object.entries(v).every(([key, value]) =>
      !["__proto__", "prototype", "constructor"].includes(key) && visit(value, depth + 1));
  }
  try { return visit(raw, 0) && new TextEncoder().encode(JSON.stringify(raw)).length <= INTAKE_BYTES_MAX; }
  catch { return false; }
}

export function validatePacketIntake(raw: unknown, notebookId: string): ValidationResult<PacketIntakeInput> {
  const fail = (error: string): ValidationResult<PacketIntakeInput> => ({ ok: false, error });
  if (!boundedJson(raw)) return fail("intake_payload_too_large_or_invalid");
  if (!obj(raw) || Object.keys(raw).some(k => !["clientRequestId", "packet", "record"].includes(k)) ||
    typeof raw.clientRequestId !== "string" || !isUuid(raw.clientRequestId)) return fail("invalid_intake_request");
  const p = raw.packet;
  if (!obj(p) || ![1, 2].includes(Number(p.version))) return fail("unsupported_packet_version");
  if (p.notebookId !== notebookId) return fail("packet_notebook_mismatch");
  const packetShape = shape({
    version: one(1, 2), packetId: text, notebookId: text, generatedAt: text, disclaimer: text,
    equipment: shape({ manufacturer: field, model: field, serial: field, identityStatus: text }),
    identitySnapshot: shape({ manufacturer: nullable(text), model: nullable(text), catalogNumber: nullable(text) }),
    workOrder: shape({ id: text, title: v => typeof v === "string" && v.length > 0 && v.length <= 200,
      description: text, assetTag: nullable(text), site: nullable(text), synthetic: bool }),
    documents: arr(shape({ docId: text, fileId: nullable(text), filename: nullable(text), role: one("datasheet", "service_manual", "other"), modelFoundOn: arr(integer), via: one("file", "chunks"), revision: field })),
    scope: arr(field), safety: shape({ cautions: arr(field), siteIsolation: field, hazardFlags: arr(text) }),
    parts: arr(shape({ kit: one("seal", "valve", null), item: nullable(num), partNumber: field, description: field, qty: field })),
    tools: arr(field), unknowns: arr(field),
    steps: arr(shape({ section: text, topic: one("valves", "seals", "plungers", "crankcase", "lubrication", "other"), text: field },
      { phase: one("removal", "service", "reinstall"), n: nullable(num), subheading: nullable(text), applicability: field, inclusion: field,
        notes: arr(shape({ kind: one("CAUTION", "WARNING", "NOTE", "IMPORTANT"), text: field }, { applicability: field, placement: one("before", "after") })) })),
    measurements: arr(shape({ name: field, value: field, tool: field }, { steps: arr(index(Array.isArray(p.steps) ? p.steps.length : 0)), link: field, measured: field })),
    approval: shape({ technicianReview: shape({ state: one("draft", "reviewed"), entries: arr(review) }), supervisor: shape({ state: one("pending", "approved"), by: nullable(text), at: nullable(text) }) }),
  }, {
    figures: arr(shape({ section: text, docId: text, filename: nullable(text), page: integer, image: nullable(image), caption: arr(text) },
      { step: nullable(index(Array.isArray(p.steps) ? p.steps.length : 0)), placement: field })),
    jha: arr(shape({ task: field, hazard: field, controls: field })), qualifications: arr(field), restoration: arr(field), blockers: arr(field), leftOut: arr(field),
    coverage: shape({ complete: bool, stepsRead: integer, stepsTotal: integer, stepsMayApply: integer, totalIsLowerBound: bool, summary: text,
      sections: arr(shape({ heading: text, status: one("read", "partly", "not_read"), stepsRead: integer, stepsNotRead: integer, stepsMayApply: integer, reasons: arr(text), source: nullable(source) })) }),
  });
  if (!packetShape(p)) return fail("invalid_packet_shape_or_image");
  const packet = p as unknown as WorkPacket;
  const fields = [...collectFields(packet), ...packet.documents.map((d, i) => ({ path: `documents[${i}].revision`, field: d.revision }))];
  const byPath = new Map(fields.map(f => [f.path, f.field]));
  if (fields.length > 500 || packet.steps.some(s => (s.text.value?.length ?? 0) > 2000)) return fail("packet_content_limit");
  // applyEdit follows copyOf. Permit only supported copies to canonical fields,
  // never arbitrary object paths or chains supplied by an imported document.
  if (fields.some(({ path, field: f }) => f.copyOf && (!/^(?:jha\[\d+\]\.hazard|restoration\[\d+\])$/.test(path) || !byPath.has(f.copyOf) || byPath.get(f.copyOf)!.copyOf))) return fail("invalid_field_copy");
  const record = raw.record ?? null;
  if (record !== null) {
    const keyed = (check: Check, length: number): Check => v => obj(v) && Object.entries(v).every(([k, x]) => /^(0|[1-9]\d*)$/.test(k) && Number(k) < length && check(x));
    const author = { by: text, at: text };
    const recordShape = shape({ version: one(1), packetId: one(packet.packetId),
      steps: keyed(shape({ performed: one(true), ...author }, { text: nullable(text) }), packet.steps.length),
      measurements: keyed(shape({ value: text, ...author }), packet.measurements.length),
      notes: arr(shape({ id: text, kind: one("finding", "issue"), text, stepIndex: nullable(index(packet.steps.length)), ...author }, { resolved: bool, resolvedBy: text, resolvedAt: text })),
      photos: v => Array.isArray(v) && v.length <= 8 && v.every(shape({ id: text, image, caption: text, stepIndex: nullable(index(packet.steps.length)), ...author })),
    });
    if (!recordShape(record)) return fail("invalid_job_record");
  }
  return { ok: true, value: structuredClone({ clientRequestId: raw.clientRequestId, packet, record: record as JobRecord | null }) };
}

/** Conservative execution projection; full structured content remains in instruction.
 * No numeric spec parsing, imported approval or local performed marks is inferred. */
export function packetBody(packet: WorkPacket): JobSheetBody {
  return { title: packet.workOrder.title, machineLabel: null, component: null, jobType: "repair", estHours: null, crewSize: null,
    isolationPoints: null, cautions: null, returnToService: [], items: [], torques: [], author: null,
    notes: "Imported draft. Read the saved guide, sources, unknowns and imported work evidence before using these steps.",
    steps: packet.steps.flatMap((s, i) => s.text.struck ? [] : [{ id: `packet-step-${i}`, text: s.text.value || "Unknown instruction — read the saved guide.", checkoff: "photo" as const, torqueRef: null, source: null }]),
  };
}

export function validateCloseout(raw: unknown): ValidationResult<CloseoutInput> {
  if (!boundedJson(raw) || !obj(raw) || Object.keys(raw).some(k => !["clientRequestId", "seq", "snapshotId", "decisions"].includes(k)) ||
    typeof raw.clientRequestId !== "string" || !isUuid(raw.clientRequestId) || !integer(raw.seq) || Number(raw.seq) < 1 ||
    typeof raw.snapshotId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.snapshotId) || !Array.isArray(raw.decisions) || raw.decisions.length > 500) return { ok: false, error: "invalid_closeout" };
  for (const d of raw.decisions) {
    if (!obj(d) || Object.keys(d).some(k => !["path", "action", "value", "source"].includes(k)) || typeof d.path !== "string" ||
      !["confirm", "settle", "mark_unknown", "strike"].includes(String(d.action)) ||
      (d.action === "settle" && (typeof d.value !== "string" || !d.value.trim() || d.value.length > 2000 || typeof d.source !== "string" || !d.source.trim() || d.source.length > 2000)) ||
      (d.action !== "settle" && (d.value !== undefined || d.source !== undefined))) return { ok: false, error: "invalid_closeout_decision" };
  }
  return { ok: true, value: structuredClone(raw) as CloseoutInput };
}

export function applyCloseoutDecisions(packet: WorkPacket, decisions: PacketEdit[], userId: string, at: string): WorkPacket {
  const required = new Set(qcTargets(packet).map(f => f.path));
  if (decisions.length !== required.size || decisions.some(d => !required.delete(d.path))) throw new Error("incomplete_or_duplicate_decisions");
  let next = structuredClone(packet);
  // Imported names/times remain only in originalPacket. These edits are server QC,
  // with no supervisor approval and no implication that work was performed.
  next.approval = { technicianReview: { state: "draft", entries: [] }, supervisor: { state: "pending", by: null, at: null } };
  for (const decision of decisions) next = applyEdit(next, decision, userId, at);
  return next;
}

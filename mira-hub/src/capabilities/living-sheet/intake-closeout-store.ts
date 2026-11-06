/** All writes reuse migration 114's append-only JSONB stores and tenant transaction. */
import { createHash, randomUUID } from "node:crypto";
import { withTenantContext } from "@/lib/tenant-context";
import { jobEventsInTransaction, type Actor } from "./store";
import { reduceSheet, type SheetView } from "./reduce";
import { instructionRecord } from "./instruction-record";
import { applyCloseoutDecisions, boundedJson, packetBody, validatePacketIntake, validateCloseout, type PacketIntakeInput, type CloseoutInput } from "./packet-intake";
import type { ConfirmedAsset } from "@/capabilities/observations/gate";
import type { JobSheetBody } from "./types";

export function contentHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v)).digest("hex");
}
type Failure = { status: "invalid_input" | "unauthenticated" | "request_id_conflict" | "identity_mismatch" | "asset_changed" | "job_not_found" | "job_not_finished" | "wrong_technician" | "snapshot_conflict" | "candidate_conflict" | "candidate_content_limit" | "not_packet_job" | "invalid_decisions" };
export type IntakeResult = Failure | { status: "created" | "existing"; jobId: string; view: SheetView };
export type CloseoutCandidate = { id: string; jobSheetId: string; revision: number; status: "draft"; body: JobSheetBody };
export type CloseoutResult = Failure | { status: "created" | "existing"; candidate: CloseoutCandidate };
type CandidateRow = { id: string; job_sheet_id: string; revision: number; body: JobSheetBody };
const candidate = (r: CandidateRow): CloseoutCandidate => ({ id: r.id, jobSheetId: r.job_sheet_id, revision: Number(r.revision), status: "draft", body: r.body });

export async function intakePacket(tenantId: string, notebookId: string, asset: ConfirmedAsset, input: PacketIntakeInput, actor: Actor): Promise<IntakeResult> {
  if (!actor.userId) return { status: "unauthenticated" };
  const checked = validatePacketIntake(input, notebookId);
  if (!checked.ok) return { status: "invalid_input" };
  input = checked.value;
  const fingerprint = contentHash([notebookId, actor.userId, checked.value]);
  return withTenantContext(tenantId, async c => {
    // Event keys are scoped to this notebook, independently of template keys.
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:intake:${input.clientRequestId}`]);
    const prior = await c.query<{ job_id: string; request_fingerprint: string }>(
      `SELECT job_id::text, request_fingerprint FROM work_sheet_events WHERE tenant_id=$1::uuid AND notebook_id=$2::uuid AND client_event_id=$3::uuid`,
      [tenantId, notebookId, input.clientRequestId]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_fingerprint !== fingerprint) return { status: "request_id_conflict" };
      const jobId = prior.rows[0].job_id;
      return { status: "existing", jobId, view: reduceSheet(await jobEventsInTransaction(c, tenantId, notebookId, jobId), jobId) };
    }
    const notebook = await c.query<{ manufacturer: string | null; model: string | null; catalog_number: string | null; serial_number: string | null; identity_status: string; equipment_entity_id: string | null; asset_confirmed_at: string | null }>(
      `SELECT manufacturer,model,catalog_number,serial_number,identity_status,equipment_entity_id,asset_confirmed_at FROM equipment_notebooks WHERE tenant_id=$1::uuid AND id=$2::uuid FOR SHARE`, [tenantId, notebookId]);
    const n = notebook.rows[0];
    if (!n) return { status: "job_not_found" };
    if (!n.asset_confirmed_at || n.equipment_entity_id !== asset.entityId) return { status: "asset_changed" };
    const norm = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
    const snap = input.packet.identitySnapshot!;
    if (!["user_confirmed", "verified"].includes(n.identity_status) ||
      norm(snap.manufacturer) !== norm(n.manufacturer) || norm(snap.model) !== norm(n.model) || norm(snap.catalogNumber) !== norm(n.catalog_number) ||
      norm(input.packet.equipment.manufacturer.value) !== norm(n.manufacturer) || norm(input.packet.equipment.model.value) !== norm(n.model) ||
      (input.packet.equipment.serial.value !== null && norm(input.packet.equipment.serial.value) !== norm(n.serial_number))) return { status: "identity_mismatch" };
    const at = new Date().toISOString();
    const body = packetBody(input.packet);
    body.instruction = { schemaVersion: 1, kind: "packet_intake", imported: { userId: actor.userId!, at, notebookId, asset,
      identity: { manufacturer: n.manufacturer, model: n.model, catalogNumber: n.catalog_number, serialNumber: n.serial_number, status: n.identity_status } },
      originalPacket: input.packet, originalRecord: input.record, packet: input.packet,
      stepMap: input.packet.steps.map((_, i) => ({ stepId: `packet-step-${i}`, packetIndex: i })) };
    const jobId = randomUUID();
    await c.query(`INSERT INTO work_sheet_events (tenant_id,notebook_id,job_id,seq,kind,payload,client_event_id,request_fingerprint,actor_user_id,actor_label,occurred_at)
      VALUES ($1::uuid,$2::uuid,$3::uuid,1,'job_started',$4::jsonb,$5::uuid,$6,$7,$8,$9::timestamptz)
      ON CONFLICT (tenant_id,notebook_id,client_event_id) DO NOTHING`,
      [tenantId, notebookId, jobId, JSON.stringify({ title: body.title, machine: { entityId: asset.entityId, name: asset.name }, templateRevisionId: null, template: body }), input.clientRequestId, fingerprint, actor.userId, actor.label, at]);
    // A generic start may contend for the same notebook event key without our lock.
    const saved = await c.query<{ job_id: string; request_fingerprint: string }>(`SELECT job_id::text,request_fingerprint FROM work_sheet_events WHERE tenant_id=$1::uuid AND notebook_id=$2::uuid AND client_event_id=$3::uuid`, [tenantId, notebookId, input.clientRequestId]);
    if (saved.rows[0]?.request_fingerprint !== fingerprint) return { status: "request_id_conflict" };
    const savedJob = saved.rows[0].job_id;
    return { status: savedJob === jobId ? "created" : "existing", jobId: savedJob, view: reduceSheet(await jobEventsInTransaction(c, tenantId, notebookId, savedJob), savedJob) };
  });
}

export async function recordCloseout(tenantId: string, notebookId: string, jobId: string, input: CloseoutInput, actor: Actor): Promise<CloseoutResult> {
  if (!actor.userId) return { status: "unauthenticated" };
  const checked = validateCloseout(input);
  if (!checked.ok) return { status: "invalid_input" };
  input = checked.value;
  const fingerprint = contentHash([notebookId, jobId, actor.userId, input]);
  return withTenantContext(tenantId, async c => {
    // Request lock also serializes collisions with generic create/revise/review.
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:request:${input.clientRequestId}`]);
    await c.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${tenantId}:${jobId}`]);
    const events = await jobEventsInTransaction(c, tenantId, notebookId, jobId);
    if (!events.length) return { status: "job_not_found" };
    const view = reduceSheet(events, jobId);
    const finish = events.find(e => e.kind === "job_finished");
    if (!finish) return { status: "job_not_finished" };
    if (finish.actorUserId !== actor.userId) return { status: "wrong_technician" };
    const prior = await c.query<CandidateRow>(`SELECT id::text,job_sheet_id::text,revision,body FROM job_sheet_revisions WHERE tenant_id=$1::uuid AND client_request_id=$2::uuid`, [tenantId, input.clientRequestId]);
    if (prior.rows[0]) return prior.rows[0].body.instruction?.closeout?.requestFingerprint === fingerprint
      ? { status: "existing", candidate: candidate(prior.rows[0]) } : { status: "request_id_conflict" };
    if (view.seq !== input.seq || instructionRecord(notebookId, view).snapshotId !== input.snapshotId) return { status: "snapshot_conflict" };
    const latest = await latestCloseoutInTransaction(c, tenantId, notebookId, jobId, view.seq);
    // Immutable job sequence/hash and append-only guide revision are separate
    // scopes. A concurrent QC cannot silently review or revert another guide.
    if (input.baseCandidateId !== (latest?.id ?? null)) return { status: "candidate_conflict" };
    const metadata = latest?.body.instruction ?? view.template.instruction;
    if (!metadata) return { status: "not_packet_job" };
    const at = new Date().toISOString();
    let packet;
    try { packet = applyCloseoutDecisions(metadata.packet, input.decisions, actor.userId!, at); }
    catch { return { status: "invalid_decisions" }; }
    // Never satisfy a size limit by erasing prior provenance. Existing revisions
    // remain readable if accumulated history exceeds the bounded guide budget.
    if (!boundedJson(packet)) return { status: "candidate_content_limit" };
    const body = packetBody(packet);
    // The immutable source job is addressable by notebook/job/seq/hash. Embedding
    // its full view here would recursively copy earlier candidates on reuse.
    body.instruction = { ...metadata, packet, closeout: { userId: actor.userId!, at, notebookId, jobId, seq: view.seq, snapshotId: input.snapshotId,
      baseCandidateId: input.baseCandidateId, historyStart: metadata.packet.approval.technicianReview.entries.length, decisions: input.decisions, requestFingerprint: fingerprint } };
    // One append-only candidate series for this source job. The shared job lock
    // serializes different QC requests, generic revisions and finish appends.
    await c.query(`INSERT INTO job_sheets (id,tenant_id,created_by) VALUES ($1::uuid,$2::uuid,$3) ON CONFLICT (id) DO NOTHING`, [jobId, tenantId, actor.userId]);
    const next = await c.query<{ n: number }>(`SELECT coalesce(max(revision),0)+1 AS n FROM job_sheet_revisions WHERE tenant_id=$1::uuid AND job_sheet_id=$2::uuid`, [tenantId, jobId]);
    const saved = await c.query<CandidateRow>(`INSERT INTO job_sheet_revisions (tenant_id,job_sheet_id,revision,status,body,created_by,client_request_id)
      VALUES ($1::uuid,$2::uuid,$3,'draft',$4::jsonb,$5,$6::uuid) RETURNING id::text,job_sheet_id::text,revision,body`,
      [tenantId, jobId, next.rows[0].n, JSON.stringify(body), actor.userId, input.clientRequestId]);
    return { status: "created", candidate: candidate(saved.rows[0]) };
  });
}

export async function latestCloseout(tenantId: string, notebookId: string, jobId: string, atSeq: number): Promise<CloseoutCandidate | null> {
  return withTenantContext(tenantId, c => latestCloseoutInTransaction(c, tenantId, notebookId, jobId, atSeq));
}

async function latestCloseoutInTransaction(c: import("pg").PoolClient, tenantId: string, notebookId: string, jobId: string, atSeq: number): Promise<CloseoutCandidate | null> {
  const result = await c.query<CandidateRow>(`SELECT id::text,job_sheet_id::text,revision,body FROM job_sheet_revisions WHERE tenant_id=$1::uuid AND job_sheet_id=$2::uuid
      AND body->'instruction'->'closeout'->>'notebookId'=$3 AND (body->'instruction'->'closeout'->>'seq')::int <= $4 ORDER BY revision DESC LIMIT 1`, [tenantId, jobId, notebookId, atSeq]);
  return result.rows[0] ? candidate(result.rows[0]) : null;
}

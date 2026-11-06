/** Server-only read adapter. Browser consumers import TYPES only. Existing v2
 * remains complete; this additional manifest is bounded, dated evidence data. */
import { createHash } from "node:crypto";
import { getNotebook, resolveBoundAsset, validateChatSources, type ResolvedAsset } from "@/lib/equipment-notebooks";
import { maintenanceContext } from "@/lib/knowledge-graph/traversal";
import { observationStateEnabled } from "@/capabilities/observations/flag";
import { listProjectionRows } from "@/capabilities/observations/store";
import { deriveObservedState, summaryOf, type ObservationRow } from "@/capabilities/observations/project";
import { deliveryStatusForWorkOrderRequest } from "@/capabilities/cmms-dispatch/status";
import { loadJob } from "./store";
import { latestCloseout, type CloseoutCandidate } from "./intake-closeout-store";
import { getJobSheetRevision } from "./job-sheet-store";
import { instructionRecord } from "./instruction-record";
import { instructionRecordV2, type InstructionRecordV2 } from "./instruction-record-v2";
import { qcTargets, fieldGuideHistory, fieldValueChanges, correctionOrigin } from "./instruction-fields";
import type { SheetView } from "./reduce";

export const ASSET_MEMORY_MAX_BYTES = 24 * 1024;
const ADAPTER = "asset-memory-1" as const;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^sha256:[a-f0-9]{64}$/;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
export type AssetMemorySelector = { seq: number; snapshotId: string; candidate: null | { id: string; revision: number; hash: string } };
export type AssetMemorySelection = { notebookId: string; jobId: string; selector: AssetMemorySelector };
export type AssetMemoryFact = { id: string; period: "historical" | "current"; category: string; data: Record<string, unknown> };
export type OverlayStatus = "ready" | "empty" | "disabled" | "unavailable" | "limited";
export type AssetMemoryProjection = {
  kind: "asset_memory"; adapterVersion: typeof ADAPTER; selector: AssetMemorySelector; contentHash: string;
  capture: { startedAt: string; finishedAt: string };
  source: { label: string; href: string };
  historical: { notebookId: string; jobId: string; asset: { entityId: string; name: string | null; capturedUnsPath: string | null }; finished: boolean };
  current: { binding: "same_confirmed_asset" | "same_unconfirmed_asset" | "different_asset" | "unbound" | "unavailable";
    graph: OverlayStatus; observations: OverlayStatus; documents: OverlayStatus; workOrder: OverlayStatus };
  facts: AssetMemoryFact[];
  coverage: { available: number; included: number; omitted: number; stringsClipped: number; detailsOmitted: number; categories: Record<string, { available: number; included: number }> };
  limits: { utf8Bytes: number; stringCharacters: number; perCategory: number };
  gaps: string[]; safety: "not_established"; reusableAcceptance: "not_recorded";
};
export type AssetMemoryRecord = InstructionRecordV2 & { assetMemory: AssetMemoryProjection };
export type AssetMemoryFailure = "invalid_selector" | "notebook_not_found" | "job_not_found" | "snapshot_conflict" | "candidate_conflict" | "asset_mismatch";
export type AssetMemoryResult = { status: "ok"; record: AssetMemoryRecord } | { status: AssetMemoryFailure };

export function candidateBodyHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value, (_k, v) => object(v)
    ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : v)).digest("hex")}`;
}
export function validateAssetMemorySelector(raw: unknown): { ok: true; value: AssetMemorySelector } | { ok: false } {
  if (!object(raw) || !keys(raw, ["seq", "snapshotId", "candidate"]) || !Number.isSafeInteger(raw.seq) || Number(raw.seq) < 1 || typeof raw.snapshotId !== "string" || !HASH.test(raw.snapshotId)) return { ok: false };
  const c = raw.candidate;
  if (c !== null && (!object(c) || !keys(c, ["id", "revision", "hash"]) || typeof c.id !== "string" || !UUID.test(c.id) || !Number.isSafeInteger(c.revision) || Number(c.revision) < 1 || typeof c.hash !== "string" || !HASH.test(c.hash))) return { ok: false };
  return { ok: true, value: structuredClone(raw) as AssetMemorySelector };
}
export function legacySheetAssetMatches(view: SheetView, bound: ResolvedAsset): boolean {
  return bound.state === "unbound" || bound.state === "resolved" && bound.entityId === view.machine.entityId;
}
function candidateMatches(c: CloseoutCandidate, view: SheetView, notebookId: string, snapshotId: string): boolean {
  const m = c.body.instruction, q = m?.closeout;
  return view.finished !== null && c.status === "draft" && c.jobSheetId === view.jobId && !!m && !!q &&
    m.imported.notebookId === notebookId && m.imported.asset.entityId === view.machine.entityId &&
    q.notebookId === notebookId && q.jobId === view.jobId && q.seq === view.seq && q.snapshotId === snapshotId;
}
const iso = (v: unknown): string | null => v instanceof Date && Number.isFinite(v.getTime()) ? v.toISOString() : typeof v === "string" ? v : null;
const scalar = (v: unknown) => v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : null;

/** Pure projection of whitelisted producer values. Coverage includes all count
 * and string omissions; the complete record is never changed to fit the budget. */
export function projectAssetMemory(record: InstructionRecordV2, selector: AssetMemorySelector, overlay: {
  binding: AssetMemoryProjection["current"]["binding"]; statuses: Omit<AssetMemoryProjection["current"], "binding">;
  facts: AssetMemoryFact[]; gaps: string[]; startedAt: string; finishedAt: string;
}): AssetMemoryProjection {
  const view = record.snapshot, metadata = record.closeout?.body.instruction ?? record.sourceEvidence;
  const facts: AssetMemoryFact[] = []; let clipped = 0; let detailsOmitted = 0;
  const compact = (v: unknown, depth = 0): unknown => {
    if (typeof v === "string") { const chars = Array.from(v); if (chars.length > 240) clipped++; return chars.slice(0, 240).join(""); }
    if (v === null || typeof v === "boolean" || typeof v === "number") return v;
    if (depth > 6) { detailsOmitted++; return "details omitted"; }
    if (Array.isArray(v)) { detailsOmitted += Math.max(0, v.length - 8); return v.slice(0, 8).map(x => compact(x, depth + 1)); }
    if (object(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, compact(x, depth + 1)]));
    return null;
  };
  const add = (id: string, category: string, data: Record<string, unknown>) => facts.push({ id, period: "historical", category, data });
  add("job", "job", { title: view.title, seq: view.seq, finished: view.finished, openSteps: view.openSteps, openQuestions: view.openQuestions, templateRevisionId: view.templateRevisionId, actorUserId: null, actorIdentityGap: "reduced labels are not user IDs" });
  if (metadata?.closeout) add("qc", "qc", { scope: record.closeout ? "selected current-job candidate" : "imported source-job lineage", userId: metadata.closeout.userId, at: metadata.closeout.at, jobId: metadata.closeout.jobId, seq: metadata.closeout.seq, sourceSnapshotId: metadata.closeout.snapshotId, candidate: selector.candidate });
  for (const s of view.steps) add(`execution:${s.id}`, "execution", { stepId: s.id, originalText: s.text, done: s.done, byLabel: s.doneBy, userId: null, at: s.doneAt, note: s.note, events: s.history.map(h => ({ eventId: h.eventId, done: h.done, byLabel: h.by, at: h.at, note: h.note })), candidateExecution: "not_inherited" });
  for (const r of view.readings) {
    const historyOmitted = Math.max(0, r.history.length - 8); detailsOmitted += historyOmitted;
    const history = historyOmitted ? [r.history[0], ...r.history.slice(-7)] : r.history;
    add(`reading:${r.id}`, "reading", { what: r.what, current: r.current, history, historyOmitted, source: r.source, origin: "technician_observation", userId: null });
  }
  for (const q of view.questions) add(`question:${q.id}`, "question", { ...q, userId: null });
  for (const n of view.notes) add(`note:${n.id}`, "note", { ...n, userId: null });
  for (const p of view.parts) add(`part:${p.id}`, "performed_part", { ...p, userId: null });
  for (const p of view.photos) add(`photo:${p.id}`, "photo_reference", { fileId: p.fileId, caption: p.caption, byLabel: p.by, at: p.at, eventId: p.eventId, userId: null });
  if (view.handover.current) add("handover", "handover", { ...view.handover.current, userId: null });
  const originalFields = new Map(metadata ? qcTargets(metadata.originalPacket).map(({ path, field }) => [path, field]) : []);
  if (metadata) for (const { path, field } of qcTargets(metadata.packet)) {
    const history = fieldGuideHistory(metadata.packet, path);
    const values = fieldValueChanges(metadata.packet, path);
    const latestValue = values[values.length - 1];
    const exclusions = history.filter(change => change.entry.action === "strike");
    const latestExclusion = exclusions[exclusions.length - 1];
    const selectedIndices = new Set([...history.slice(-4), ...(latestValue ? [latestValue] : []), ...(latestExclusion ? [latestExclusion] : [])].map(c => c.index));
    const retained = history.filter(c => selectedIndices.has(c.index));
    detailsOmitted += history.length - retained.length;
    add(`field:${path}`, "instruction_claim", { path, value: field.value, state: field.struck ? "excluded" : field.value === null ? "unknown" : "proposed", source: field.source, basis: field.basis,
      originalValue: scalar(values.length ? values[0].entry.previous : originalFields.has(path) ? originalFields.get(path)!.value : field.value), historyOmitted: history.length - retained.length,
      changes: retained.map(({ entry, index }) => ({ action: entry.action, previous: scalar(entry.previous), next: scalar(entry.next), source: entry.source ?? null, byClaim: entry.by, at: entry.at, origin: correctionOrigin(metadata, index, view.jobId) })) });
  }
  else for (const s of view.template.steps) add(`instruction:${s.id}`, "instruction_claim", { text: s.text, source: s.source, state: "proposed" });
  facts.push(...overlay.facts);
  const categories: AssetMemoryProjection["coverage"]["categories"] = {};
  for (const fact of facts) { categories[fact.category] ??= { available: 0, included: 0 }; categories[fact.category].available++; }
  const bounded = facts.filter(f => { const c = categories[f.category]; if (c.included >= 40) return false; c.included++; return true; }).map(f => ({ ...f, data: compact(f.data) as Record<string, unknown> }));
  const projection: AssetMemoryProjection = { kind: "asset_memory", adapterVersion: ADAPTER, selector, contentHash: "sha256:" + "0".repeat(64),
    capture: { startedAt: overlay.startedAt, finishedAt: overlay.finishedAt },
    source: { label: "Authenticated saved Living Sheet record", href: `/api/equipment-notebooks/${encodeURIComponent(record.lineage.notebookId)}/sheets/${encodeURIComponent(view.jobId)}/?format=instruction-record-v2&assetMemory=1&memorySelector=${encodeURIComponent(JSON.stringify(selector))}` },
    historical: { notebookId: record.lineage.notebookId, jobId: view.jobId, asset: { entityId: view.machine.entityId, name: compact(view.machine.name) as string | null,
      capturedUnsPath: record.sourceEvidence?.imported.asset.entityId === view.machine.entityId && (record.sourceEvidence.imported.asset.unsPath.length <= 512) ? record.sourceEvidence.imported.asset.unsPath : null }, finished: view.finished !== null },
    current: { binding: overlay.binding, ...overlay.statuses }, facts: bounded,
    coverage: { available: facts.length, included: bounded.length, omitted: facts.length - bounded.length, stringsClipped: clipped, detailsOmitted, categories },
    limits: { utf8Bytes: ASSET_MEMORY_MAX_BYTES, stringCharacters: 240, perCategory: 40 },
    gaps: ["bounded_summary_not_complete_procedure", "reduced_actor_user_ids_unknown", "graph_edge_reviewer_version_metadata_unknown", "current_overlay_is_not_historical_replay", "provider_asset_link_and_uns_delivery_not_established", ...overlay.gaps],
    safety: "not_established", reusableAcceptance: "not_recorded" };
  while (Buffer.byteLength(JSON.stringify(projection), "utf8") > ASSET_MEMORY_MAX_BYTES && projection.facts.length) {
    const removed = projection.facts.pop()!; categories[removed.category].included--; projection.coverage.included--; projection.coverage.omitted++;
  }
  for (const key of ["graph", "observations", "documents", "workOrder"] as const) {
    if (projection.current[key] === "ready" && Object.entries(categories).some(([category, count]) => category.startsWith(key) && count.included < count.available)) projection.current[key] = "limited";
  }
  const { capture: _capture, contentHash: _hash, ...content } = projection; void _capture; void _hash;
  projection.contentHash = candidateBodyHash(content);
  return projection;
}

export async function loadAssetMemory(tenantId: string, notebookId: string, jobId: string, options: { selector?: unknown; atSeq?: number; forChat?: boolean; authorizedNotebookId?: string; now?: () => Date } = {}): Promise<AssetMemoryResult> {
  const parsed = options.selector === undefined ? undefined : validateAssetMemorySelector(options.selector);
  if (parsed && !parsed.ok || parsed?.ok && options.atSeq !== undefined && options.atSeq !== parsed.value.seq) return { status: "invalid_selector" };
  // Only server callers that already proved this tenant/notebook may bypass
  // the existing getter (which also touches notebook-open metadata).
  if (options.authorizedNotebookId !== notebookId && !await getNotebook(tenantId, notebookId)) return { status: "notebook_not_found" };
  const pin = parsed?.ok ? parsed.value : undefined;
  const loaded = await loadJob(tenantId, notebookId, jobId, pin?.seq ?? options.atSeq);
  if (loaded.status !== "ok" || loaded.view.jobId !== jobId) return { status: "job_not_found" };
  const view = loaded.view;
  if (typeof view.machine.entityId !== "string" || !view.machine.entityId || view.machine.entityId.length > 512) return { status: "asset_mismatch" };
  const snapshotId = instructionRecord(notebookId, view).snapshotId;
  if (pin && (pin.seq !== view.seq || pin.snapshotId !== snapshotId) || options.atSeq !== undefined && options.atSeq !== view.seq) return { status: "snapshot_conflict" };
  let selected: CloseoutCandidate | null = null;
  if (!pin) selected = await latestCloseout(tenantId, notebookId, jobId, view.seq);
  else if (pin.candidate) {
    const found = await getJobSheetRevision(tenantId, pin.candidate.id);
    if (found.status !== "ok" || found.revision.id !== pin.candidate.id || found.revision.revision !== pin.candidate.revision || candidateBodyHash(found.revision.body) !== pin.candidate.hash) return { status: "candidate_conflict" };
    selected = found.revision as CloseoutCandidate;
  }
  if (selected && !candidateMatches(selected, view, notebookId, snapshotId)) return { status: "candidate_conflict" };
  const selector: AssetMemorySelector = { seq: view.seq, snapshotId, candidate: selected ? { id: selected.id, revision: selected.revision, hash: candidateBodyHash(selected.body) } : null };
  let bound: ResolvedAsset; let bindingFailed = false;
  try { bound = await resolveBoundAsset(tenantId, notebookId); }
  catch { bindingFailed = true; bound = { state: "unresolvable", entityId: view.machine.entityId }; }
  const same = bound.state === "resolved" && bound.entityId === view.machine.entityId;
  if (options.forChat && (!same || bound.state !== "resolved" || !bound.confirmedAt)) return { status: "asset_mismatch" };
  const binding: AssetMemoryProjection["current"]["binding"] = bound.state === "unbound" ? "unbound" : bound.state !== "resolved" ? "unavailable" : !same ? "different_asset" : bound.confirmedAt ? "same_confirmed_asset" : "same_unconfirmed_asset";
  const now = options.now ?? (() => new Date()); const startedAt = now().toISOString();
  const facts: AssetMemoryFact[] = []; const gaps: string[] = bindingFailed ? ["current_binding_unavailable"] : [];
  const statuses: Omit<AssetMemoryProjection["current"], "binding"> = { graph: "empty", observations: "disabled", documents: "empty", workOrder: "empty" };
  const current = (id: string, category: string, data: Record<string, unknown>) => facts.push({ id, category, period: "current", data });
  const documentIds = new Set<string>();
  const record = instructionRecordV2(notebookId, view, selected);
  const metadata = selected?.body.instruction ?? record.sourceEvidence;
  for (const d of metadata?.packet.documents ?? []) if (UUID.test(d.docId)) documentIds.add(d.docId);
  if (metadata) for (const { field } of qcTargets(metadata.packet)) if (field.source && UUID.test(field.source.docId)) documentIds.add(field.source.docId);
  try {
    const graph = await maintenanceContext(tenantId, view.machine.entityId, { includeSimilar: false, maxWorkOrders: 5 });
    if (graph) {
      const root = graph.equipment;
      if (root.tenantId !== tenantId || root.entityType !== "equipment" || root.entityId !== view.machine.entityId && root.id !== view.machine.entityId) throw new Error("graph_identity_mismatch");
      const node = (n: typeof root, relation: string, types: string[]) => {
        if (!n || n.tenantId !== tenantId || !types.includes(n.entityType) || !n.id || !n.entityId || (n as unknown as { approvalState?: string }).approvalState && (n as unknown as { approvalState?: string }).approvalState !== "verified") { gaps.push("graph_reference_omitted_scope_or_state"); return; }
        current(`graph:${n.id}`, "graph_reference", { id: n.id, entityId: n.entityId, entityType: n.entityType, name: n.name, currentUnsPath: n.unsPath ?? null, addressRole: "dated_address_not_identity_or_delivery", createdAt: iso(n.createdAt), updatedAt: iso(n.updatedAt), relation, source: "verified_principal_graph_query", relationshipId: null, reviewer: null, version: null, installedComponentInstanceId: null });
        if (n.entityType === "manual" && UUID.test(n.entityId)) documentIds.add(n.entityId);
      };
      node(root, "equipment", ["equipment"]);
      for (const n of Object.values(graph.hierarchy)) if (n) node(n, "parent_of", ["plant", "area", "line"]);
      for (const n of graph.components) node(n, "has_component", ["component", "electrical_component", "equipment", "part"]);
      for (const n of graph.manuals) node(n, "manual_reference", ["manual"]);
      for (const n of graph.recentWorkOrders) node(n, "has_work_order", ["work_order"]);
      statuses.graph = "limited";
      current("graph-coverage", "graph_coverage", { producerCaps: { ancestorDepth: 5, components: 20, manuals: 10, workOrders: 5 }, omittedByProducer: "unknown", metadata: "edge IDs, reviewer, approval time and immutable version not exposed" });
      gaps.push("graph_pm_similar_properties_and_recommendations_not_projected");
    }
  } catch { statuses.graph = "unavailable"; gaps.push("graph_unavailable"); }
  if (observationStateEnabled()) {
    try {
      // Current lower-level contract is ObservationRow[] (#5104 owns its later
      // extension). No raw reports/private turns are read by this adapter.
      const rows: ObservationRow[] = await listProjectionRows(tenantId, view.machine.entityId);
      const observed = summaryOf(deriveObservedState(rows, { now: now() }));
      const producerLimited = rows.some(row => rows.filter(other => other.factKey === row.factKey && other.factValue === row.factValue).length >= 20);
      statuses.observations = observed.facts.length ? producerLimited || observed.contributingObservationIds.length > 8 || observed.facts.some(f => f.conflicting.length > 8) ? "limited" : "ready" : "empty";
      if (producerLimited) gaps.push("observation_producer_per_fact_value_cap_20_omissions_unknown");
      for (const fact of observed.facts) current(`observation:${fact.factKey}`, "observations", { ...fact, projectorVersion: observed.projectorVersion, stateVersion: observed.stateVersion, contributingObservationIds: observed.contributingObservationIds, historyCoverage: "bounded_producer_projection_only" });
    } catch { statuses.observations = "unavailable"; gaps.push("observations_unavailable"); }
  }
  const requested = [...documentIds].sort().slice(0, 8);
  if (documentIds.size > requested.length) gaps.push("document_admission_set_limited_to_8");
  if (requested.length) try {
    const admitted = await validateChatSources(tenantId, notebookId, requested);
    statuses.documents = admitted.ok ? "ready" : "unavailable";
    current("document-admission", "documents", { requested, admitted: admitted.ok ? admitted.docIds : [], remapped: admitted.ok ? admitted.remapped ?? {} : {}, admission: admitted.ok ? "admitted_by_existing_notebook_gate" : "refused", error: admitted.ok ? null : admitted.error, sourceHashes: "unknown", chunkContent: "not_loaded" });
  } catch { statuses.documents = "unavailable"; gaps.push("document_admission_unavailable"); }
  try {
    const request = await deliveryStatusForWorkOrderRequest(tenantId, jobId);
    statuses.workOrder = request ? "ready" : "empty";
    current("work-order-request", "workOrder", { request: request ? { eventId: request.eventId, requestedAt: request.requestedAt, state: request.state, externalRef: request.externalRef, attempts: request.attempts, updatedAt: request.updatedAt, blockedBy: request.blockedBy } : null,
      coverage: "Living Sheet create-request status only", absence: request ? null : "no Living Sheet work-order request recorded", externalAssetId: { value: null, state: "unknown_not_exposed_by_reader" }, unsPropagation: "not_established", repairOrCompletion: "not_established" });
  } catch { statuses.workOrder = "unavailable"; gaps.push("work_order_request_status_unavailable"); }
  return { status: "ok", record: { ...record, assetMemory: projectAssetMemory(record, selector, { binding, statuses, facts, gaps: [...new Set(gaps)], startedAt, finishedAt: now().toISOString() }) } };
}

export function isAssetMemoryEntry(value: unknown): value is { kind: "asset_memory"; projection: AssetMemoryProjection } {
  return object(value) && value.kind === "asset_memory" && object(value.projection) && value.projection.kind === "asset_memory" && value.projection.adapterVersion === ADAPTER && validateAssetMemorySelector(value.projection.selector).ok;
}

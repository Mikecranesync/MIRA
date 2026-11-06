import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ notebook: vi.fn(), binding: vi.fn(), job: vi.fn(), latest: vi.fn(), revision: vi.fn(), graph: vi.fn(), rows: vi.fn(), observations: vi.fn(), admission: vi.fn(), workOrder: vi.fn() }));
vi.mock("@/lib/equipment-notebooks", () => ({ getNotebook: mocks.notebook, resolveBoundAsset: mocks.binding, validateChatSources: mocks.admission }));
vi.mock("../store", () => ({ loadJob: mocks.job }));
vi.mock("../intake-closeout-store", () => ({ latestCloseout: mocks.latest }));
vi.mock("../job-sheet-store", () => ({ getJobSheetRevision: mocks.revision }));
vi.mock("@/lib/knowledge-graph/traversal", () => ({ maintenanceContext: mocks.graph }));
vi.mock("@/capabilities/observations/store", () => ({ listProjectionRows: mocks.rows }));
vi.mock("@/capabilities/observations/flag", () => ({ observationStateEnabled: mocks.observations }));
vi.mock("@/capabilities/cmms-dispatch/status", () => ({ deliveryStatusForWorkOrderRequest: mocks.workOrder }));
import { loadAssetMemory, candidateBodyHash, validateAssetMemorySelector, ASSET_MEMORY_MAX_BYTES, projectAssetMemory } from "../asset-memory";
import { instructionRecord } from "../instruction-record";
import { reduceSheet } from "../reduce";
import { applyCloseoutDecisions, packetBody, qcTargets } from "../packet-intake";
import { instructionRecordV2 } from "../instruction-record-v2";
import { correctedMeasurementPacket } from "./packet-fixture";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingInstructionGuide } from "@/factorylm-ui/LivingInstructionGuide";
import { packetFixture } from "./packet-fixture";
const tenant = "11111111-1111-4111-8111-111111111111", nb = "22222222-2222-4222-8222-222222222222", job = "33333333-3333-4333-8333-333333333333", revisionId = "44444444-4444-4444-8444-444444444444";
const template = packetBody(packetFixture(nb));
const sourceEvents = [
  { id: "start", seq: 1, kind: "job_started" as const, payload: { title: template.title, machine: { entityId: "PUMP-01", name: "Synthetic pump" }, templateRevisionId: null, template }, actorUserId: "tech", actorLabel: "Tech", occurredAt: "2026-11-06T00:00:00Z", recordedAt: "2026-11-06T00:00:01Z", workOrderId: null },
  { id: "done", seq: 2, kind: "step_marked" as const, payload: { stepId: "packet-step-0", done: true, note: "Synthetic work" }, actorUserId: "tech", actorLabel: "Tech", occurredAt: "2026-11-06T00:01:00Z", recordedAt: "2026-11-06T00:01:01Z", workOrderId: null },
  { id: "finish", seq: 3, kind: "job_finished" as const, payload: { summary: "Synthetic finish", openItemsAcknowledged: true }, actorUserId: "tech", actorLabel: "Tech", occurredAt: "2026-11-06T00:02:00Z", recordedAt: "2026-11-06T00:02:01Z", workOrderId: null },
];
const view = reduceSheet(sourceEvents, job);
const snapshotId = instructionRecord(nb, view).snapshotId;
const candidate = () => {
  const originalPacket = packetFixture(nb);
  const decisions = qcTargets(originalPacket).map(({ path }) => path === "steps[0].text" ? { path, action: "settle" as const, value: "Replace fictional bearing", source: "Synthetic closeout correction" } : { path, action: "confirm" as const });
  const packet = applyCloseoutDecisions(originalPacket, decisions, "tech", "2026-11-06T00:03:00Z");
  return { id: revisionId, jobSheetId: job, revision: 1, status: "draft" as const, body: { ...packetBody(packet), instruction: { schemaVersion: 1 as const, kind: "packet_intake" as const, imported: { userId: "tech", at: "2026-11-06T00:00:00Z", notebookId: nb, asset: { entityId: "PUMP-01", name: "Synthetic pump", unsPath: "site/pump" }, identity: { manufacturer: "Example", model: "M1", catalogNumber: null, serialNumber: null, status: "user_confirmed" } }, originalPacket, packet, originalRecord: null, stepMap: [], closeout: { userId: "tech", at: "2026-11-06T00:03:00Z", notebookId: nb, jobId: job, seq: view.seq, snapshotId, decisions, historyStart: originalPacket.approval.technicianReview.entries.length, requestFingerprint: "synthetic" } } } };
};
beforeEach(() => {
  vi.resetAllMocks(); mocks.notebook.mockResolvedValue({ id: nb }); mocks.binding.mockResolvedValue({ state: "resolved", entityId: "PUMP-01", confirmedAt: "2026-11-06", unsPath: "current/pump" });
  mocks.job.mockResolvedValue({ status: "ok", view }); mocks.latest.mockResolvedValue(candidate()); mocks.revision.mockImplementation(async () => ({ status: "ok", revision: candidate() }));
  mocks.graph.mockResolvedValue(null); mocks.rows.mockResolvedValue([]); mocks.observations.mockReturnValue(false); mocks.admission.mockResolvedValue({ ok: true, docIds: [], nodeId: "node" }); mocks.workOrder.mockResolvedValue(null);
});
describe("bounded asset memory exact selection", () => {
  it("keeps imported work, measurements and unresolved reports separate from this job in chat and both guide copies", async () => {
    const c = candidate();
    const imported = { version: 1, packetId: c.body.instruction.originalPacket.packetId,
      steps: { 0: { performed: true, text: "Imported label inspection", by: "Imported performer", at: "2026-11-01T01:00:00Z" } },
      measurements: { 0: { value: "Imported 29 demo units", by: "Imported measurer", at: "2026-11-01T01:01:00Z" } },
      notes: [{ id: "open-issue", kind: "issue", text: "Imported leak remains unresolved", stepIndex: 0, by: "Imported reporter", at: "2026-11-01T01:02:00Z" }],
      photos: [{ id: "inspection-photo", image: "data:image/png;base64,PRIVATE_IMAGE_BYTES", caption: "Imported inspection image", stepIndex: 0, by: "Imported photographer", at: "2026-11-01T01:03:00Z" }] };
    Object.assign(c.body.instruction, { originalRecord: imported });
    mocks.latest.mockResolvedValue(c);
    const sourceMetadata = structuredClone(c.body.instruction);
    delete (sourceMetadata as { closeout?: unknown }).closeout;
    const sourceView = { ...view, template: { ...view.template, instruction: sourceMetadata } };
    c.body.instruction.closeout.snapshotId = instructionRecord(nb, sourceView).snapshotId;
    mocks.job.mockResolvedValue({ status: "ok", view: sourceView });
    const a = await loadAssetMemory(tenant, nb, job); expect(a.status).toBe("ok"); if (a.status !== "ok") return;
    const facts = a.record.assetMemory.facts;
    expect(facts.find(f => f.category === "imported_execution")?.data).toMatchObject({ origin: "imported_report", performed: true, text: "Imported label inspection", by: "Imported performer", at: "2026-11-01T01:00:00Z", currentJobExecution: "not_inherited", userId: null });
    expect(facts.find(f => f.category === "imported_reading")?.data).toMatchObject({ value: "Imported 29 demo units", by: "Imported measurer", origin: "imported_report" });
    expect(facts.find(f => f.category === "imported_note")?.data).toMatchObject({ kind: "issue", text: "Imported leak remains unresolved", resolved: false, by: "Imported reporter" });
    expect(facts.find(f => f.category === "imported_photo_reference")?.data).toMatchObject({ id: "inspection-photo", caption: "Imported inspection image" });
    expect(JSON.stringify(a.record.assetMemory)).not.toContain("PRIVATE_IMAGE_BYTES");
    const html = renderToStaticMarkup(createElement(LivingInstructionGuide, { record: a.record }));
    const summaries = [...html.matchAll(/data-testid="asset-memory-summary"[\s\S]*?(?=<details)/g)].map(m => m[0]); expect(summaries).toHaveLength(2);
    for (const copy of summaries) for (const text of ["Imported label inspection", "Imported performer", "Imported 29 demo units", "Imported leak remains unresolved", "unresolved", "Imported inspection image"]) expect(copy).toContain(text);
  });
  it("counts omitted imported reports while retaining the full imported record", async () => {
    const c = candidate();
    Object.assign(c.body.instruction, { originalRecord: { version: 1, packetId: c.body.instruction.originalPacket.packetId, steps: {}, measurements: {}, photos: [],
      notes: Array.from({ length: 80 }, (_, i) => ({ id: `imported-${i}`, kind: "issue", text: "界".repeat(500), stepIndex: null, by: "Imported reporter", at: "2026-11-01" })) } });
    mocks.latest.mockResolvedValue(c);
    const a = await loadAssetMemory(tenant, nb, job); expect(a.status).toBe("ok"); if (a.status !== "ok") return;
    const p = a.record.assetMemory;
    expect(p.coverage.categories.imported_note.available).toBe(80);
    expect(p.coverage.categories.imported_note.included).toBeLessThan(80);
    expect(p.coverage.omitted).toBeGreaterThan(0);
    expect(p.coverage.stringsClipped).toBeGreaterThan(0);
    expect(Buffer.byteLength(JSON.stringify(p), "utf8")).toBeLessThanOrEqual(ASSET_MEMORY_MAX_BYTES);
    expect(a.record.closeout!.body.instruction!.originalRecord!.notes).toHaveLength(80);
  });
  it("selects latest only initially, pins an exact revision, and retains explicit source-only null", async () => {
    const first = await loadAssetMemory(tenant, nb, job);
    expect(first.status).toBe("ok"); if (first.status !== "ok") return;
    expect(first.record.assetMemory.selector.candidate).toEqual({ id: revisionId, revision: 1, hash: candidateBodyHash(candidate().body) });
    mocks.latest.mockResolvedValue({ ...candidate(), id: "55555555-5555-4555-8555-555555555555", revision: 2 });
    const pinned = await loadAssetMemory(tenant, nb, job, { selector: first.record.assetMemory.selector });
    expect(pinned.status).toBe("ok"); if (pinned.status === "ok") expect(pinned.record.closeout?.id).toBe(revisionId);
    const source = await loadAssetMemory(tenant, nb, job, { selector: { seq: view.seq, snapshotId, candidate: null } });
    expect(source.status).toBe("ok"); if (source.status === "ok") expect(source.record.closeout).toBeNull();
    expect(mocks.latest).toHaveBeenCalledTimes(1);
  });
  it("rejects incomplete/foreign pins before overlays and permits historical preview after rebind", async () => {
    expect(validateAssetMemorySelector({ seq: view.seq, snapshotId }).ok).toBe(false);
    const pin = { seq: view.seq, snapshotId, candidate: { id: revisionId, revision: 1, hash: candidateBodyHash(candidate().body) } };
    for (const invalid of [{ ...pin, seq: 2 }, { ...pin, snapshotId: `sha256:${"0".repeat(64)}` }, { ...pin, candidate: { ...pin.candidate, revision: 7 } }]) expect((await loadAssetMemory(tenant, nb, job, { selector: invalid })).status).not.toBe("ok");
    mocks.revision.mockResolvedValue({ status: "ok", revision: { ...candidate(), jobSheetId: "foreign-job" } });
    expect((await loadAssetMemory(tenant, nb, job, { selector: pin })).status).not.toBe("ok");
    expect(mocks.graph).not.toHaveBeenCalled();
    mocks.revision.mockResolvedValue({ status: "ok", revision: candidate() }); mocks.binding.mockResolvedValue({ state: "resolved", entityId: "OTHER", confirmedAt: "now" });
    expect((await loadAssetMemory(tenant, nb, job, { selector: pin, forChat: true })).status).toBe("asset_mismatch");
    expect((await loadAssetMemory(tenant, nb, job, { selector: pin })).status).toBe("ok");
  });
  it("keeps interrupted prefixes source-only and never pairs corrected instructions with old completion", async () => {
    const prefix = reduceSheet(sourceEvents.slice(0, 1), job);
    mocks.job.mockResolvedValueOnce({ status: "ok", view: prefix });
    const source = await loadAssetMemory(tenant, nb, job, { selector: { seq: 1, snapshotId: instructionRecord(nb, prefix).snapshotId, candidate: null } });
    expect(source.status).toBe("ok"); if (source.status === "ok") { expect(source.record.closeout).toBeNull(); expect(source.record.assetMemory.historical.finished).toBe(false); }
    const completed = await loadAssetMemory(tenant, nb, job);
    expect(completed.status).toBe("ok"); if (completed.status !== "ok") return;
    const facts = completed.record.assetMemory.facts;
    expect(facts.find(f => f.id === "execution:packet-step-0")?.data).toMatchObject({ originalText: "Read the fixture label", done: true, userId: null, candidateExecution: "not_inherited" });
    expect(facts.find(f => f.id === "field:steps[0].text")?.data).toMatchObject({ value: "Replace fictional bearing", state: "proposed" });
  });
  it("projects principal graph references without arbitrary properties, PM or cross-tenant children", async () => {
    const node = { id: "kg-root", entityId: "PUMP-01", tenantId: tenant, entityType: "equipment", name: "Pump", properties: { injected: "SECRET_PROPERTY" }, createdAt: new Date(0), updatedAt: new Date(0) };
    mocks.graph.mockResolvedValue({ equipment: node, hierarchy: { plant: null, area: null, line: null }, components: [{ ...node, entityType: "component", entityId: "COMP-1", id: "component" }, { ...node, tenantId: "FOREIGN", entityId: "SECRET_FOREIGN" }], manuals: [], recentWorkOrders: [], pmMismatches: [{ text: "SECRET_PM" }], similarEquipment: [node] });
    const result = await loadAssetMemory(tenant, nb, job);
    expect(result.status).toBe("ok"); if (result.status !== "ok") return;
    const json = JSON.stringify(result.record.assetMemory);
    expect(json).toContain("COMP-1"); for (const secret of ["SECRET_PROPERTY", "SECRET_PM", "SECRET_FOREIGN"]) expect(json).not.toContain(secret);
    expect(mocks.graph).toHaveBeenCalledWith(tenant, "PUMP-01", { includeSimilar: false, maxWorkOrders: 5 });
  });
  it("bounds UTF-8 prompt/manifest with explicit omissions and hashes facts independently of read clocks", async () => {
    mocks.job.mockResolvedValue({ status: "ok", view: { ...view, notes: Array.from({ length: 150 }, (_, i) => ({ id: `note-${i}`, text: "界".repeat(2000), by: "Tech", at: "2026-11-06", eventId: `event-${i}` })) } });
    mocks.latest.mockResolvedValue(null);
    const a = await loadAssetMemory(tenant, nb, job, { now: () => new Date("2026-11-06") });
    const b = await loadAssetMemory(tenant, nb, job, { now: () => new Date("2026-11-07") });
    expect(a.status).toBe("ok"); expect(b.status).toBe("ok"); if (a.status !== "ok" || b.status !== "ok") return;
    expect(Buffer.byteLength(JSON.stringify(a.record.assetMemory), "utf8")).toBeLessThanOrEqual(ASSET_MEMORY_MAX_BYTES);
    expect(a.record.assetMemory.contentHash).toBe(b.record.assetMemory.contentHash);
    expect(a.record.assetMemory.coverage.omitted).toBeGreaterThan(0);
    expect(a.record.snapshot.notes).toHaveLength(150);
    expect(JSON.stringify(a.record.assetMemory)).toContain("not_established");
  });
  it("keeps current source admission remap separate from immutable historical citation", async () => {
    const sourceId = "66666666-6666-4666-8666-666666666666", newId = "77777777-7777-4777-8777-777777777777";
    const c = candidate(); c.body.instruction.packet.scope[0].source = { docId: sourceId, fileId: null, filename: "Original-A.pdf", page: 2, line: "Original source A" };
    mocks.latest.mockResolvedValue(c); mocks.revision.mockResolvedValue({ status: "ok", revision: c });
    mocks.admission.mockResolvedValue({ ok: true, docIds: [newId], nodeId: "node", remapped: { [sourceId]: newId } });
    const a = await loadAssetMemory(tenant, nb, job); expect(a.status).toBe("ok"); if (a.status !== "ok") return;
    const b = await loadAssetMemory(tenant, nb, job, { selector: a.record.assetMemory.selector }); expect(b.status).toBe("ok"); if (b.status !== "ok") return;
    expect(b.record.closeout!.body.instruction!.packet.scope[0].source!.docId).toBe(sourceId);
    expect(b.record.assetMemory.facts.find(f => f.category === "documents")?.data).toMatchObject({ requested: [sourceId], admitted: [newId], remapped: { [sourceId]: newId }, sourceHashes: "unknown" });
    expect(b.record.assetMemory.facts.find(f => f.id === "field:scope[0]")?.data.source).toMatchObject({ docId: sourceId });
    expect(b.record.assetMemory.source.href).toContain("memorySelector=");
    expect(JSON.parse(new URL(b.record.assetMemory.source.href, "http://test").searchParams.get("memorySelector")!)).toEqual(a.record.assetMemory.selector);
  });
  it("reports observation state with both clocks, author, conflict and uncertainty; distinguishes disabled/empty/unavailable", async () => {
    mocks.observations.mockReturnValue(true);
    mocks.rows.mockResolvedValue([{ id: "obs-a", factKey: "seal_leak", factValue: "present", observedAt: "2026-11-06T00:01:00Z", recordedAt: "2026-11-06T00:03:00Z", recordedBy: "tech-a", verificationMethod: "visual", uncertainty: "reported", supersedesId: null }, { id: "obs-b", factKey: "seal_leak", factValue: "absent", observedAt: "2026-11-06T00:02:00Z", recordedAt: "2026-11-06T00:04:00Z", recordedBy: "tech-b", verificationMethod: "visual", uncertainty: "reported", supersedesId: null }]);
    const a = await loadAssetMemory(tenant, nb, job); expect(a.status).toBe("ok"); if (a.status !== "ok") return;
    expect(a.record.assetMemory.current.observations).toBe("ready");
    expect(a.record.assetMemory.facts.find(f => f.category === "observations")?.data).toMatchObject({ contested: true, current: { author: "tech-b", observedAt: "2026-11-06T00:02:00Z", recordedAt: "2026-11-06T00:04:00Z", uncertainty: "reported" }, contributingObservationIds: ["obs-a", "obs-b"] });
    const visible = renderToStaticMarkup(createElement(LivingInstructionGuide, { record: a.record }));
    const summaries = [...visible.matchAll(/data-testid="asset-memory-summary"[\s\S]*?(?=<details)/g)].map(m => m[0]);
    for (const copy of summaries) for (const text of ["CONTESTED technician reports", "seal leak", "self-reported verification method: visual", "tech-a", "tech-b", "2026-11-06T00:03:00Z", "2026-11-06T00:04:00Z"]) expect(copy).toContain(text);
    mocks.rows.mockResolvedValue([]); const empty = await loadAssetMemory(tenant, nb, job); if (empty.status === "ok") expect(empty.record.assetMemory.current.observations).toBe("empty");
    mocks.rows.mockRejectedValue(new Error("offline")); mocks.binding.mockRejectedValue(new Error("offline"));
    const unavailable = await loadAssetMemory(tenant, nb, job); if (unavailable.status === "ok") { expect(unavailable.record.assetMemory.current.observations).toBe("unavailable"); expect(unavailable.record.assetMemory.current.binding).toBe("unavailable"); }
    expect((await loadAssetMemory(tenant, nb, job, { forChat: true })).status).toBe("asset_mismatch");
  });
  it("retains latest correction plus exclusion beyond four edits with explicit imported/prior/current origin", () => {
    const c = candidate(); const m = c.body.instruction; m.packet = correctedMeasurementPacket(nb); m.originalPacket = structuredClone(m.packet);
    const path = "measurements[0].value";
    m.packet.approval.technicianReview.entries.push({ path, action: "strike", previous: "50 demo units", next: "50 demo units", by: "Exclusion actor", at: "2026-11-06T01:00:00Z" });
    for (let i = 0; i < 8; i++) m.packet.approval.technicianReview.entries.push({ path, action: "strike", previous: "50 demo units", next: "50 demo units", by: `later-${i}`, at: "2026-11-06T02:00:00Z" });
    m.closeout.historyStart = 2;
    const record = instructionRecordV2(nb, view, c);
    const projected = projectAssetMemory(record, { seq: view.seq, snapshotId, candidate: null }, { binding: "same_confirmed_asset", statuses: { graph: "empty", documents: "empty", observations: "disabled", workOrder: "empty" }, facts: [], gaps: [], startedAt: "2026-11-06", finishedAt: "2026-11-06" });
    const claim = projected.facts.find(f => f.id === `field:${path}`)!.data;
    expect(claim.historyOmitted).toBeGreaterThan(0); expect(JSON.stringify(claim)).toContain("later-7"); expect(JSON.stringify(claim)).toContain("Synthetic correction source"); expect(JSON.stringify(claim)).toContain("Imported correction claim"); expect(JSON.stringify(claim)).toContain("Current technician QC correction");
  });
  it("renders actual legacy work, resolution and corrected reading history with original sources in both operational copies", async () => {
    const sourceView = { ...view, template: { ...view.template, instruction: undefined }, parts: [{ id: "part", item: "Fictional seal kit", action: "installed" as const, qty: 2, by: "Part reporter", at: "2026-11-06T01:00:00Z", eventId: "part-event" }], questions: [{ id: "q", text: "Fictional question", by: "Asker", at: "2026-11-06T01:00:00Z", eventId: "q-event", resolved: true, resolution: "Fictional resolution", resolvedBy: "Resolver", resolvedAt: "2026-11-06T02:00:00Z" }], readings: [{ id: "r", what: "Fictional reading", current: { value: 50, unit: "demo units", by: "Corrector", at: "2026-11-06T02:00:00Z", eventId: "read-b" }, source: { kind: "tech" as const, ref: "Synthetic correction observation" }, history: [{ value: 30, unit: "demo units", by: "Original reporter", at: "2026-11-06T01:00:00Z", eventId: "read-a", superseded: true, source: { kind: "manual" as const, ref: "Synthetic original reference" } }, { value: 50, unit: "demo units", by: "Corrector", at: "2026-11-06T02:00:00Z", eventId: "read-b", superseded: false, source: { kind: "tech" as const, ref: "Synthetic correction observation" } }] }] };
    mocks.job.mockResolvedValue({ status: "ok", view: sourceView }); mocks.latest.mockResolvedValue(null);
    const a = await loadAssetMemory(tenant, nb, job); expect(a.status).toBe("ok"); if (a.status !== "ok") return;
    const html = renderToStaticMarkup(createElement(LivingInstructionGuide, { record: a.record }));
    const summaries = [...html.matchAll(/data-testid="asset-memory-summary"[\s\S]*?(?=<details)/g)].map(m => m[0]); expect(summaries).toHaveLength(2);
    for (const copy of summaries) for (const text of ["Fictional seal kit", "installed", "quantity 2", "Part reporter", "Fictional resolution", "Resolver", "30 demo units", "Original reporter", "Synthetic original reference", "50 demo units", "Corrector", "Synthetic correction observation", "superseded"]) expect(copy).toContain(text);
  });

  it("refuses a foreign imported notebook or current closeout even on the same asset", async () => {
    const c = candidate(); c.body.instruction.imported.notebookId = "88888888-8888-4888-8888-888888888888";
    mocks.latest.mockResolvedValue(c); mocks.revision.mockResolvedValue({ status: "ok", revision: c });
    expect((await loadAssetMemory(tenant, nb, job)).status).toBe("candidate_conflict");
    expect((await loadAssetMemory(tenant, nb, job, { selector: { seq: view.seq, snapshotId, candidate: { id: c.id, revision: c.revision, hash: candidateBodyHash(c.body) } } })).status).toBe("candidate_conflict");
    c.body.instruction.imported.notebookId = nb; c.body.instruction.closeout.notebookId = "99999999-9999-4999-8999-999999999999";
    expect((await loadAssetMemory(tenant, nb, job)).status).toBe("candidate_conflict"); expect(mocks.graph).not.toHaveBeenCalled();
  });
  it("rejects cross-job reducer output and absent notebook scope before any overlays", async () => {
    mocks.notebook.mockResolvedValueOnce(null); expect((await loadAssetMemory(tenant, nb, job)).status).toBe("notebook_not_found"); expect(mocks.job).not.toHaveBeenCalled();
    mocks.job.mockResolvedValueOnce({ status: "ok", view: { ...view, jobId: "foreign-job" } });
    expect((await loadAssetMemory(tenant, nb, job)).status).toBe("job_not_found"); expect(mocks.graph).not.toHaveBeenCalled();
  });

  it("keeps inherited source-job QC separate from fresh execution and current review", async () => {
    const freshJob = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"; const c = candidate();
    const fresh = reduceSheet([{ ...sourceEvents[0], kind: "job_started", payload: { title: c.body.title, machine: view.machine, templateRevisionId: null, template: c.body } }], freshJob);
    mocks.job.mockResolvedValue({ status: "ok", view: fresh }); mocks.latest.mockResolvedValue(null);
    const a = await loadAssetMemory(tenant, nb, freshJob, { selector: { seq: 1, snapshotId: instructionRecord(nb, fresh).snapshotId, candidate: null }, forChat: true });
    expect(a.status).toBe("ok"); if (a.status !== "ok") return;
    expect(a.record.closeout).toBeNull(); expect(a.record.review.technicianCloseout).toBe("not_recorded");
    expect(a.record.assetMemory.facts.find(f => f.category === "qc")?.data).toMatchObject({ scope: "imported source-job lineage", jobId: job });
    expect(a.record.assetMemory.facts.find(f => f.id === "execution:packet-step-0")?.data).toMatchObject({ originalText: "Replace fictional bearing", done: false, byLabel: null, at: null });
    const html = renderToStaticMarkup(createElement(LivingInstructionGuide, { record: a.record }));
    expect(html.match(/Source-job QC lineage:/g)).toHaveLength(2); expect(html.match(/This does not review the current job./g)).toHaveLength(2);
    expect(html).not.toContain("Recorded performed: Replace fictional bearing");
  });

});

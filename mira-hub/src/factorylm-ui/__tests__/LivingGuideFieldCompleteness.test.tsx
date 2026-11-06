import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingInstructionGuide } from "../LivingInstructionGuide";
import { packetFixture, field } from "@/capabilities/living-sheet/__tests__/packet-fixture";
import { applyCloseoutDecisions, packetBody, qcTargets, validatePacketIntake } from "@/capabilities/living-sheet/packet-intake";
import { instructionRecordV2 } from "@/capabilities/living-sheet/instruction-record-v2";
import type { InstructionMetadata } from "@/capabilities/living-sheet/instruction-metadata";
import type { PacketEdit } from "@/capabilities/work-packet/types";
import { reduceSheet, type StoredEvent } from "@/capabilities/living-sheet/reduce";

const cited = (value: string | null, id: string) => ({ ...field(value), basis: "Equal synthetic basis", source: { docId: id, fileId: null, filename: `${id}.pdf`, page: 1, line: `Exact synthetic citation ${id}` } });
function sourcePacket() {
  const p = packetFixture("notebook-test");
  // Exposed synthetic developer fixture; never a held-out task benchmark.
  p.workOrder.title = "EXPOSED SYNTHETIC guide field fixture";
  p.workOrder.description = "Exposed fictional test input; not workplace evidence or a held-out benchmark.";
  p.steps = [0, 1].map(i => ({ ...structuredClone(p.steps[0]), text: cited(`Original step ${i}`, `step-${i}`), inclusion: cited(`Original inclusion ${i}`, `inclusion-${i}`) }));
  p.figures = [1, 0, null].map((step, i) => ({ section: "Inspection", docId: `image-${i}`, filename: "Repeated-caption.pdf", page: 1, image: null, caption: ["Same synthetic caption"], step, placement: cited(`Original placement ${i}`, `placement-${i}`) }));
  p.measurements = [0, 1].map(i => ({ name: cited(`Original measurement ${i}`, `name-${i}`), value: cited(`${30 + i} demo units`, `spec-${i}`), tool: cited(null, `tool-${i}`), link: cited(null, `link-${i}`), measured: cited(null, `measured-${i}`), steps: [i] }));
  return p;
}
function sourceView(metadata: InstructionMetadata, fresh = false) {
  const template = { ...packetBody(metadata.packet), instruction: metadata };
  const base = { actorUserId: "performer", actorLabel: "Synthetic performer", occurredAt: "2026-11-06T00:00:00Z", recordedAt: "2026-11-06T00:00:00Z", workOrderId: null };
  const events: StoredEvent[] = [{ ...base, id: "started", seq: 1, kind: "job_started", payload: { title: template.title, machine: { entityId: "fixture", name: "Synthetic fixture" }, templateRevisionId: null, template } }];
  if (!fresh) events.push({ ...base, id: "performed", seq: 2, kind: "step_marked", payload: { stepId: "packet-step-0", done: true, note: "Original work evidence" } });
  return reduceSheet(events, fresh ? "fresh-job" : "source-job");
}
function guideRecord(stage: "settled" | "repeated" | "inherited", overrides: Record<string, PacketEdit> = {}, packet = sourcePacket()) {
  const metadata: InstructionMetadata = { schemaVersion: 1, kind: "packet_intake", imported: { userId: "importer", at: "2026-11-06", notebookId: "notebook-test", asset: { entityId: "fixture", name: "Synthetic fixture", unsPath: "synthetic/site/fixture" }, identity: { manufacturer: "Example", model: "M1", catalogNumber: null, serialNumber: null, status: "user_confirmed" } }, originalPacket: structuredClone(packet), packet, originalRecord: null, stepMap: packet.steps.map((_, i) => ({ stepId: `packet-step-${i}`, packetIndex: i })) };
  const view = sourceView(metadata);
  const changes: Record<string, PacketEdit> = {};
  for (const [path, value] of [
    ["steps[0].inclusion", "Include alpha only"], ["steps[1].inclusion", "Include beta only"],
    ["figures[0].placement", "Placement zero beside beta"], ["figures[1].placement", "Placement one beside alpha"], ["figures[2].placement", "Unplaced placement two"],
    ["measurements[0].name", "Effective alpha measurement"], ["measurements[0].tool", "Effective alpha tool"], ["measurements[0].link", "Effective alpha link"], ["measurements[0].measured", "Reported alpha reading"],
    ["measurements[1].name", "Effective beta measurement"], ["measurements[1].tool", "Effective beta tool"], ["measurements[1].link", "Effective beta link"], ["measurements[1].measured", "Reported beta reading"],
  ]) changes[path] = { path, action: "settle", value, source: `Correction source for ${path}` };
  Object.assign(changes, overrides);
  let decisions = qcTargets(packet).map(({ path }) => changes[path] ?? { path, action: "confirm" as const });
  let corrected = applyCloseoutDecisions(packet, decisions, "performer", "2026-11-06T01:00:00Z");
  let historyStart = packet.approval.technicianReview.entries.length;
  if (stage !== "settled") {
    historyStart = corrected.approval.technicianReview.entries.length;
    decisions = qcTargets(corrected).map(({ path }) => ({ path, action: "confirm" as const }));
    corrected = applyCloseoutDecisions(corrected, decisions, "performer", "2026-11-06T02:00:00Z");
  }
  const saved = { ...metadata, packet: corrected, closeout: { userId: "performer", at: "2026-11-06T02:00:00Z", notebookId: "notebook-test", jobId: "source-job", seq: view.seq, snapshotId: "synthetic-snapshot", baseCandidateId: null, historyStart, decisions, requestFingerprint: "synthetic" } };
  return stage === "inherited" ? instructionRecordV2("notebook-test", sourceView(saved, true)) : instructionRecordV2("notebook-test", view, { id: "candidate", jobSheetId: "source-job", revision: stage === "settled" ? 1 : 2, status: "draft", body: { ...packetBody(corrected), instruction: saved } });
}

/** Extract just one balanced operational element, excluding unrelated audit/JSON. */
function elements(html: string, marker: string): string[] {
  const result: string[] = []; let offset = 0;
  while (true) {
    const at = html.indexOf(marker, offset); if (at < 0) break;
    const start = html.lastIndexOf("<", at); const tag = /^<([a-z0-9]+)/i.exec(html.slice(start))![1];
    const tokens = new RegExp(`<\\/?${tag}(?:\\s[^>]*|)>`, "gi"); tokens.lastIndex = start;
    let depth = 0; let token: RegExpExecArray | null;
    while ((token = tokens.exec(html))) {
      depth += token[0].startsWith("</") ? -1 : 1;
      if (depth === 0) { result.push(html.slice(start, tokens.lastIndex)); offset = tokens.lastIndex; break; }
    }
    if (depth !== 0) throw new Error(`Unbalanced test element: ${marker}`);
  }
  return result;
}

/** Print-operational content only: ignore hidden folds and the later QC/audit
 * summary, so a serialized decision cannot stand in for a visible guide Field. */
function operationalCopies(html: string) {
  return elements(html, 'data-testid="living-instruction-guide"').map(copy => {
    let visible = copy.replace(/<style[^>]*>[\s\S]*?<\/style>/g, "");
    for (const hidden of elements(visible, "data-no-print")) visible = visible.replace(hidden, "");
    const audit = visible.indexOf("<h2>Performing technician closeout QC</h2>");
    return audit < 0 ? visible : visible.slice(0, visible.lastIndexOf("<section", audit));
  });
}

function completePacket() {
  const p = sourcePacket();
  p.equipment = { ...p.equipment, manufacturer: cited("Example", "manufacturer"), model: cited("M1", "model"), serial: cited(null, "serial") };
  p.parts = [{ kit: null, item: 1, partNumber: cited("Synthetic part", "part-number"), description: cited("Synthetic part description", "part-description"), qty: cited("1", "part-qty") }];
  p.jha = [{ task: cited("Synthetic task", "jha-task"), hazard: cited("Synthetic hazard", "jha-hazard"), controls: cited(null, "jha-controls") }];
  p.qualifications = [cited(null, "qualification")]; p.restoration = [cited(null, "restoration")];
  p.blockers = [cited(null, "blocker")]; p.leftOut = [cited(null, "left-out")];
  p.documents = [{ docId: "synthetic-doc", fileId: null, filename: "Synthetic.pdf", role: "other", modelFoundOn: [1], via: "chunks", revision: cited(null, "revision") }];
  p.steps[0].applicability = cited(null, "step-applicability");
  p.steps[0].notes![0].applicability = cited(null, "note-applicability");
  p.measurements[1].steps = [];
  return p;
}

describe("supported guide QC fields remain operationally visible", () => {
  it.each(["settled", "repeated", "inherited"] as const)("shows effective identity claims without replacing captured identity after %s QC", stage => {
    const changes: Record<string, PacketEdit> = {};
    for (const name of ["manufacturer", "model", "serial"]) changes[`equipment.${name}`] = { path: `equipment.${name}`, action: "settle", value: `Proposed identity ${name}`, source: `Identity correction source ${name}` };
    const record = guideRecord(stage, changes, completePacket()); const captured = structuredClone(record.sourceEvidence!.imported);
    const html = renderToStaticMarkup(<LivingInstructionGuide record={record} />);
    for (const copy of operationalCopies(html)) {
      expect(copy).toContain("Proposed packet identity claims");
      for (const name of ["manufacturer", "model", "serial"]) {
        const fieldBlock = elements(copy, `data-guide-field="equipment.${name}"`); expect(fieldBlock).toHaveLength(1);
        expect(fieldBlock[0]).toContain(`Proposed identity ${name}`); expect(fieldBlock[0]).toContain(`Identity correction source ${name}`);
      }
      expect(copy).toContain("synthetic/site/fixture"); expect(copy).toContain("Example M1");
      expect(copy).toContain("do not change the captured identity or address");
    }
    expect(record.sourceEvidence!.imported).toEqual(captured);
  });
  it.each(["settled", "repeated", "inherited"] as const)("renders every supported QC target's effective value and correction source operationally after %s QC", stage => {
    const packet = completePacket();
    expect(validatePacketIntake({ clientRequestId: "11111111-1111-4111-8111-111111111111", packet, record: null }, "notebook-test").ok).toBe(true);
    const targets = qcTargets(packet); expect(targets).toHaveLength(40);
    const overrides: Record<string, PacketEdit> = {};
    for (const { path } of targets) overrides[path] = { path, action: "settle", value: `Effective value for ${path}`, source: `Effective correction source for ${path}` };
    const record = guideRecord(stage, overrides, packet);
    const copies = operationalCopies(renderToStaticMarkup(<LivingInstructionGuide record={record} />)); expect(copies).toHaveLength(2);
    for (const copy of copies) {
      const missing = targets.flatMap(({ path }) => [
        ...(!copy.includes(`Effective value for ${path}`) ? [`${path}: effective value`] : []),
        ...(!copy.includes(`Effective correction source for ${path}`) ? [`${path}: correction source`] : []),
      ]);
      expect(missing).toEqual([]);
    }
  });
  it("shows unknown/excluded effective identity claims alongside their own provenance", () => {
    const record = guideRecord("repeated", { "equipment.model": { path: "equipment.model", action: "mark_unknown" }, "equipment.serial": { path: "equipment.serial", action: "strike" } }, completePacket());
    for (const copy of operationalCopies(renderToStaticMarkup(<LivingInstructionGuide record={record} />))) {
      expect(elements(copy, 'data-guide-field="equipment.model"')[0]).toContain("Unknown — no answer recorded");
      const serial = elements(copy, 'data-guide-field="equipment.serial"')[0];
      expect(serial).toContain("EXCLUDED. Do not use."); expect(serial).toContain("exclusion"); expect(serial).toContain("reported by performer");
    }
  });
  it.each(["settled", "repeated", "inherited"] as const)("shows values and sources beside the exact steps/figures after %s QC", stage => {
    const record = guideRecord(stage); const before = structuredClone(record.snapshot);
    const html = renderToStaticMarkup(<LivingInstructionGuide record={record} />);
    for (const step of elements(html, 'data-testid="wp-step-1"')) {
      for (const value of ["Include alpha only", "Effective alpha measurement", "Effective alpha tool", "Effective alpha link", "Reported alpha reading", "Placement one beside alpha", "Correction source for measurements[0].tool", "Exact synthetic citation tool-0"]) expect(step).toContain(value);
      for (const wrong of ["Include beta only", "Effective beta tool", "Placement zero beside beta", "Unplaced placement two"]) expect(step).not.toContain(wrong);
      expect(step).toContain("Equal synthetic basis");
      expect(step).toContain("Reported reading");
      if (stage !== "inherited") { expect(step).toContain("Revised instruction: not marked performed"); expect(step).toContain("Original execution evidence: “Original step 0”"); }
    }
    expect(elements(html, 'data-testid="wp-step-1"')).toHaveLength(2);
    for (const step of elements(html, 'data-testid="wp-step-2"')) {
      expect(step).toContain("Include beta only"); expect(step).toContain("Effective beta tool"); expect(step).toContain("Placement zero beside beta"); expect(step).not.toContain("Effective alpha tool");
    }
    for (const figure of elements(html, 'data-guide-figure="2"')) { expect(figure).toContain("Unplaced placement two"); expect(figure).toContain("Correction source for figures[2].placement"); expect(figure).not.toContain("Placement one beside alpha"); }
    expect(elements(html, 'data-guide-figure="2"')).toHaveLength(2);
    for (const i of [0, 1]) for (const figure of elements(html, `data-guide-figure="${i}"`)) {
      expect(figure).toContain(`Correction source for figures[${i}].placement`);
      expect(figure).not.toContain(`Correction source for figures[${1 - i}].placement`);
    }
    expect(record.snapshot).toEqual(before);
  });
  it("shows unlinked measurement details without depending on an audit appendix", () => {
    const p = sourcePacket(); p.measurements[1].steps = [];
    const html = renderToStaticMarkup(<LivingInstructionGuide record={guideRecord("settled", {}, p)} />);
    const details = elements(html, 'data-testid="wp-measure-details-1"'); expect(details).toHaveLength(2);
    for (const detail of details) for (const value of ["Effective beta tool", "Effective beta link", "Reported beta reading", "Correction source for measurements[1].measured", "Exact synthetic citation measured-1"]) expect(detail).toContain(value);
    for (const step of elements(html, 'data-testid="wp-step-2"')) expect(step).not.toContain("Effective beta tool");
  });
  it("keeps unknown and excluded states attached to each effective field", () => {
    const overrides: Record<string, PacketEdit> = {
      "steps[0].inclusion": { path: "steps[0].inclusion", action: "strike" },
      "steps[1].inclusion": { path: "steps[1].inclusion", action: "mark_unknown" },
      "figures[1].placement": { path: "figures[1].placement", action: "strike" },
      "measurements[0].name": { path: "measurements[0].name", action: "strike" },
      "measurements[0].tool": { path: "measurements[0].tool", action: "mark_unknown" },
      "measurements[0].link": { path: "measurements[0].link", action: "strike" },
      "measurements[0].measured": { path: "measurements[0].measured", action: "mark_unknown" },
    };
    const html = renderToStaticMarkup(<LivingInstructionGuide record={guideRecord("repeated", overrides)} />);
    for (const path of Object.keys(overrides)) {
      const fields = elements(html, `data-guide-field="${path}"`); expect(fields.length, path).toBeGreaterThanOrEqual(2);
      for (const content of fields) {
        expect(content).toContain(overrides[path].action === "strike" ? "EXCLUDED. Do not use." : "Unknown — no answer recorded");
        if (overrides[path].action === "strike") { expect(content).toContain("exclusion"); expect(content).toContain("reported by performer"); }
      }
    }
  });
  it("preserves the source index of legacy figures that match no step section", () => {
    const packet = sourcePacket(); packet.version = 1;
    packet.steps.forEach(s => { delete s.phase; });
    packet.figures![2].section = "Unmatched source section";
    const html = renderToStaticMarkup(<LivingInstructionGuide record={guideRecord("settled", {}, packet)} />);
    const orphan = elements(html, 'data-guide-figure="2"'); expect(orphan).toHaveLength(2);
    for (const figure of orphan) { expect(figure).toContain("Unplaced placement two"); expect(figure).toContain("Correction source for figures[2].placement"); }
    for (const step of elements(html, 'data-testid="wp-step-2"')) expect(step).not.toContain("Unplaced placement two");
  });
  it("keeps a settled value's correction source when a later QC excludes that field and another QC confirms it", () => {
    const record = guideRecord("settled"); const metadata = record.closeout!.body.instruction!;
    const paths = ["steps[0].inclusion", "figures[1].placement", "measurements[0].tool", "measurements[0].link", "measurements[0].measured"];
    const excluded = applyCloseoutDecisions(metadata.packet, qcTargets(metadata.packet).map(({ path }) => ({ path, action: paths.includes(path) ? "strike" : "confirm" })), "performer", "2026-11-06T03:00:00Z");
    const decisions = qcTargets(excluded).map(({ path }) => ({ path, action: "confirm" as const }));
    record.closeout!.body.instruction = { ...metadata, packet: applyCloseoutDecisions(excluded, decisions, "performer", "2026-11-06T04:00:00Z"), closeout: { ...metadata.closeout!, historyStart: excluded.approval.technicianReview.entries.length, decisions } };
    const html = renderToStaticMarkup(<LivingInstructionGuide record={record} />);
    for (const path of paths) for (const content of elements(html, `data-guide-field="${path}"`)) {
      expect(content).toContain("EXCLUDED. Do not use.");
      expect(content).toContain(`Correction source for ${path}`);
      expect(content).toContain("exclusion");
    }
  });
  it("labels the address as captured without claiming CMMS propagation", () => {
    const html = renderToStaticMarkup(<LivingInstructionGuide record={guideRecord("settled")} />);
    expect(html).toContain("Captured UNS address:"); expect(html).toContain("synthetic/site/fixture");
    expect(html).toContain("CMMS delivery is not established by this guide");
    expect(html).not.toContain("Delivered to CMMS");
  });
});

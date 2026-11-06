import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingInstructionGuideContent, LivingInstructionGuide, GUIDE_PRINT_CSS } from "../LivingInstructionGuide";
import { CloseoutQCForm } from "../LivingInstructionControls";
import { packetFixture, field, correctedMeasurementPacket } from "@/capabilities/living-sheet/__tests__/packet-fixture";
import { applyCloseoutDecisions, packetBody, qcTargets } from "@/capabilities/living-sheet/packet-intake";
import { instructionRecordV2 } from "@/capabilities/living-sheet/instruction-record-v2";
import { reduceSheet } from "@/capabilities/living-sheet/reduce";
import { guidePacket } from "@/capabilities/living-sheet/instruction-fields";

export function guideFixture() {
  const packet = packetFixture("notebook-test");
  packet.safety.cautions[0] = { ...field("Stop the fixture"), label: "verified", source: { docId: "synthetic", fileId: null, filename: "Synthetic.pdf", page: 1, line: "Stop the fixture" } };
  packet.figures = [{ section: "Inspection", docId: "synthetic", filename: "Synthetic.pdf", page: 1, caption: ["Synthetic fixture illustration"], image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", step: 0 }];
  packet.qualifications = [field(null)]; packet.restoration = [field("Site decides return to service")]; packet.blockers = [field(null)];
  packet.approval.supervisor = { state: "approved", by: "imported name", at: "imported time" };
  const body = packetBody(packet);
  body.instruction = { schemaVersion: 1, kind: "packet_intake", imported: { userId: "authenticated-id", at: "2026-11-06T01:00:00Z", notebookId: "notebook-test", asset: { entityId: "fixture", name: "Fictional fixture", unsPath: "example/fixture" }, identity: { manufacturer: "Example", model: "M1", catalogNumber: null, serialNumber: null, status: "user_confirmed" } }, originalPacket: packet, packet, originalRecord: { version: 1, packetId: packet.packetId, steps: { 0: { performed: true, by: "reported name", at: "reported time", text: "Old step text" } }, measurements: {}, notes: [], photos: [] }, stepMap: [{ stepId: "packet-step-0", packetIndex: 0 }] };
  const view = reduceSheet([{ id: "event", seq: 1, kind: "job_started", payload: { title: body.title, machine: { entityId: "fixture", name: "Fictional fixture" }, templateRevisionId: null, template: body }, actorUserId: "authenticated-id", actorLabel: "Tech", occurredAt: "2026-11-06", recordedAt: "2026-11-06", workOrderId: null }], "job-test");
  return instructionRecordV2("notebook-test", view);
}

describe("saved illustrated instruction guide", () => {
  it("lets a single illustrated step fragment while keeping its heading/action and figure together", () => {
    const html = renderToStaticMarkup(<LivingInstructionGuideContent record={guideFixture()} />);
    expect(html).toMatch(/data-testid="wp-step-1"[^>]*break-inside:auto/);
    expect(html).toMatch(/data-guide-figure="0"[^>]*break-inside:avoid/);
    expect(html).toContain('break-inside:avoid"><h4>Step 1');
  });

  it.each(["import", "all-confirm QC", "fresh inherited job"])("keeps value lineage and correction authority separate on screen and print after %s", stage => {
    const record = guideFixture(); const packet = correctedMeasurementPacket("notebook-test");
    record.sourceEvidence!.packet = packet; record.sourceEvidence!.originalPacket = packet;
    if (stage !== "import") {
      const decisions = qcTargets(packet).map(({ path }) => ({ path, action: "confirm" as const }));
      const corrected = applyCloseoutDecisions(packet, decisions, "authenticated-current-user", "2026-11-06T00:00:00Z");
      const metadata = { ...record.sourceEvidence!, packet: corrected, closeout: { userId: "authenticated-current-user", at: "2026-11-06T00:00:00Z", notebookId: "notebook-test", jobId: "job-test", seq: 1, snapshotId: record.snapshotId,
        baseCandidateId: null, historyStart: packet.approval.technicianReview.entries.length, decisions, requestFingerprint: "synthetic" } };
      if (stage === "all-confirm QC") record.closeout = { id: "candidate-id", jobSheetId: "job-test", revision: 1, status: "draft", body: { ...record.snapshot.template, instruction: metadata } };
      else { record.sourceEvidence = metadata; record.snapshot.jobId = "fresh-job"; record.lineage.jobId = "fresh-job"; }
    }
    const html = renderToStaticMarkup(<LivingInstructionGuide record={record} />);
    const rows = [...html.matchAll(/data-testid="wp-measure-row-0"[\s\S]*?<\/tr>/g)].map(m => m[0]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatch(/<td[^>]*>30 demo units/);
      expect(row).toMatch(/<td[^>]*>50 demo units/);
      expect(row).toContain("Synthetic correction source");
      expect(row).toContain("Imported correction claim");
      expect(row).not.toContain("Approved by Imported approval claim");
    }
    if (stage === "fresh inherited job") { expect(html).toContain("Source-job QC lineage:"); expect(html).toContain("This does not review the current job."); }
  });
  it("reviews the same effective candidate that the reopened guide displays", () => {
    const record = guideFixture(); const body = structuredClone(record.snapshot.template);
    body.instruction!.packet.steps[0].text.value = "Candidate step correction";
    record.closeout = { id: "candidate-id", jobSheetId: "job-test", revision: 1, status: "draft", body };
    const html = renderToStaticMarkup(<CloseoutQCForm record={record} scopeId="tech" onSaved={async () => {}} />);
    expect(html).toContain("<legend>steps[0].text</legend><p>Candidate step correction</p>");
  });
  it("recovers preserved imported value provenance when reopening a pre-fix candidate with cleared packet history", () => {
    const record = guideFixture(); const original = correctedMeasurementPacket("notebook-test");
    record.sourceEvidence!.originalPacket = original;
    record.sourceEvidence!.packet = structuredClone(original);
    record.sourceEvidence!.packet.approval.technicianReview.entries = [];
    delete record.sourceEvidence!.packet.measurements[0].value.review;
    const html = renderToStaticMarkup(<LivingInstructionGuideContent record={record} />);
    const row = html.match(/data-testid="wp-measure-row-0"[\s\S]*?<\/tr>/)![0];
    expect(row).toMatch(/<td[^>]*>30 demo units/);
    expect(row).toMatch(/<td[^>]*>50 demo units/);
    expect(row).toContain("Synthetic correction source");
  });
  it("keeps source execution evidence without applying its completion to corrected instructions on screen or print", () => {
    const record = guideFixture(); const body = structuredClone(record.snapshot.template);
    record.snapshot.steps[0].done = true; record.snapshot.steps[0].doneBy = "Original technician"; record.snapshot.steps[0].doneAt = "2026-11-06T00:00:00Z";
    body.instruction!.packet.steps[0].text.value = "Corrected fictional instruction";
    record.closeout = { id: "candidate-id", jobSheetId: "job-test", revision: 1, status: "draft", body };
    const html = renderToStaticMarkup(<LivingInstructionGuide record={record} />);
    expect(html.match(/Revised instruction: not marked performed/g)).toHaveLength(2);
    expect(html.match(/Original execution evidence: “Read the fixture label”/g)).toHaveLength(2);
    expect(html).toContain("Original technician");
    expect(record.snapshot.steps[0].done).toBe(true);
  });
  it("also keeps completion scoped to the source snapshot when only a note or linked measurement changes", () => {
    const record = guideFixture(); const packet = correctedMeasurementPacket("notebook-test");
    record.sourceEvidence!.packet = packet; record.snapshot.steps[0].done = true;
    const body = structuredClone(record.snapshot.template);
    body.instruction!.packet = packet;
    body.instruction!.packet.steps[0].notes![0].text.value = "Changed prerequisite note";
    body.instruction!.packet.measurements[0].value.value = "60 demo units";
    record.closeout = { id: "candidate-id", jobSheetId: "job-test", revision: 1, status: "draft", body };
    const html = renderToStaticMarkup(<LivingInstructionGuide record={record} />);
    expect(html.match(/Revised instruction: not marked performed/g)).toHaveLength(2);
    expect(html).toContain("Changed prerequisite note");
    expect(record.snapshot.steps[0].done).toBe(true);
  });
  it("reopens numbered figures, safety, sources, unknowns and imported work separately from fresh execution", () => {
    const record = guideFixture(); const html = renderToStaticMarkup(<LivingInstructionGuideContent record={record} />);
    for (const text of ["DRAFT REPAIR GUIDE", "reusable acceptance not recorded", "Read the fixture label", "Synthetic fixture illustration", "Stop the fixture", "Unknown", "Synthetic.pdf", "Imported/reported work evidence", "not marked performed", "Old step text", "Qualifications", "Return-to-service questions", "Private work material"]) expect(html).toContain(text);
    expect(html).toContain('data-testid="wp-step-1"'); expect(html).toContain("data:image/png;base64");
    expect(html).not.toContain(">Verified<");
    expect(record.sourceEvidence!.packet.approval.supervisor.state).toBe("approved");
    expect(guidePacket(record.sourceEvidence!.packet).approval.supervisor.state).toBe("pending");
  });
  it("uses the existing print portal while explicitly suppressing legacy print roots", () => {
    const html = renderToStaticMarkup(<LivingInstructionGuide record={guideFixture()} />);
    expect(html).toContain('class="fl-print-portal living-guide-print"');
    expect(GUIDE_PRINT_CSS).toContain("body:has(.living-guide-print) .ls-print-root");
    expect(GUIDE_PRINT_CSS).toContain(".wp-print-root { display: none !important; }");
  });
  it("requires an explicit choice for every QC target rather than prechecking imported reviews", () => {
    const html = renderToStaticMarkup(<CloseoutQCForm record={guideFixture()} scopeId="tech" onSaved={async () => {}} />);
    expect(html).toContain("Choose a decision"); expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Unknowns may stay unknown"); expect(html).not.toContain("selected=\"\">Checked");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LivingInstructionGuideContent, LivingInstructionGuide, GUIDE_PRINT_CSS } from "../LivingInstructionGuide";
import { CloseoutQCForm } from "../LivingInstructionControls";
import { packetFixture, field } from "@/capabilities/living-sheet/__tests__/packet-fixture";
import { packetBody } from "@/capabilities/living-sheet/packet-intake";
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

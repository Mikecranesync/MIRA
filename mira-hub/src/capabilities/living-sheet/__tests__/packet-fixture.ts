import type { Field, WorkPacket } from "@/capabilities/work-packet/types";
import { applyEdit } from "@/capabilities/work-packet/edits";
export const field = (value: string | null): Field => ({ value, label: value === null ? "unknown" : "proposed", source: null, basis: "Fictional test fixture" });
export function packetFixture(notebookId: string): WorkPacket {
  return {
    version: 2, packetId: "fixture-packet", notebookId, generatedAt: "2026-11-01T00:00:00Z",
    disclaimer: "Fictional draft. Requires qualified review.",
    equipment: { manufacturer: field("Example"), model: field("M1"), serial: field(null), identityStatus: "user_confirmed" },
    identitySnapshot: { manufacturer: "Example", model: "M1", catalogNumber: null },
    workOrder: { id: "fixture", title: "Fictional illustrated inspection", description: "Inspect fixture", assetTag: null, site: null, synthetic: true },
    documents: [], scope: [field("Inspection")], safety: { cautions: [field("Stop the fixture")], siteIsolation: field(null), hazardFlags: [] },
    parts: [], tools: [field("Inspection lamp")], measurements: [],
    steps: [{ section: "Inspection", topic: "other", phase: "service", n: 1, text: field("Read the fixture label"), notes: [{ kind: "NOTE", text: field("Keep original source text"), placement: "before" }] }],
    unknowns: [field(null)], approval: { technicianReview: { state: "draft", entries: [] }, supervisor: { state: "pending", by: null, at: null } },
  };
}

export function correctedMeasurementPacket(notebookId: string): WorkPacket {
  const packet = packetFixture(notebookId);
  packet.measurements = [{ name: field("Fictional fixture torque"), value: { ...field("30 demo units"), label: "verified",
    source: { docId: "synthetic", fileId: null, filename: "Synthetic.pdf", page: 1, line: "Fictional fixture torque: 30 demo units" } }, tool: field(null), steps: [0] }];
  const next = applyEdit(packet, { path: "measurements[0].value", action: "settle", value: "50 demo units", source: "Synthetic correction source" }, "Imported technician claim", "2026-11-01T00:00:00Z");
  next.approval.supervisor = { state: "approved", by: "Imported approval claim", at: "2026-11-01" };
  return next;
}

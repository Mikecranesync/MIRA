import type { WorkPacket, Field } from "@/capabilities/work-packet/types";
import { collectFields } from "@/capabilities/work-packet/verify";
import type { InstructionMetadata } from "./instruction-metadata";
import type { InstructionRecordV2 } from "./instruction-record-v2";

/** Document revisions are Fields but the legacy collector omits them. */
export function qcTargets(packet: WorkPacket): { path: string; field: Field }[] {
  return [...collectFields(packet), ...packet.documents.map((d, i) => ({ path: `documents[${i}].revision`, field: d.revision }))].filter(({ field }) => !field.copyOf);
}

/** Value lineage survives projection. Review authority comes from the separate
 * server QC receipt, never the packet's historical names or approval flags. */
export function guidePacket(packet: WorkPacket): WorkPacket {
  const next = structuredClone(packet);
  next.approval.technicianReview.state = "draft";
  next.approval.supervisor = { state: "pending", by: null, at: null };
  for (const { field } of [...collectFields(next), ...next.documents.map(d => ({ field: d.revision }))]) {
    if (field.label === "verified") field.label = "proposed";
  }
  return next;
}

export function effectiveInstruction(record: Pick<InstructionRecordV2, "sourceEvidence" | "closeout">): InstructionMetadata | null {
  return record.closeout?.body.instruction ?? record.sourceEvidence;
}

export function fieldValueChanges(packet: WorkPacket, path: string) {
  return packet.approval.technicianReview.entries.flatMap((entry, index) =>
    entry.path === path && ["set", "settle", "mark_unknown"].includes(entry.action) ? [{ entry, index }] : []);
}

export function correctionOrigin(metadata: InstructionMetadata, index: number, currentJobId: string): string {
  // historyStart is server-owned. Older receipts without it make no stronger
  // authority claim than preserved provenance, even if their names look real.
  if (metadata.closeout?.historyStart === undefined) return metadata.closeout ? "Preserved correction provenance" : "Imported correction claim";
  if (index < metadata.originalPacket.approval.technicianReview.entries.length) return "Imported correction claim";
  if (index < metadata.closeout.historyStart) return "Prior guide correction";
  return metadata.closeout.jobId === currentJobId ? "Current technician QC correction" : "Source-job technician QC correction";
}

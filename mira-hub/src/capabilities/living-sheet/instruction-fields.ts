import type { WorkPacket, Field } from "@/capabilities/work-packet/types";
import { collectFields } from "@/capabilities/work-packet/verify";

/** Document revisions are Fields but the legacy collector omits them. */
export function qcTargets(packet: WorkPacket): { path: string; field: Field }[] {
  return [...collectFields(packet), ...packet.documents.map((d, i) => ({ path: `documents[${i}].revision`, field: d.revision }))].filter(({ field }) => !field.copyOf);
}

/** Display projections ignore imported approval/reviewer authority. Originals
 * remain intact in server evidence; source matches are labelled explicitly. */
export function guidePacket(packet: WorkPacket, serverQC = false): WorkPacket {
  const next = structuredClone(packet);
  next.approval = { technicianReview: serverQC ? next.approval.technicianReview : { state: "draft", entries: [] }, supervisor: { state: "pending", by: null, at: null } };
  for (const { field } of [...collectFields(next), ...next.documents.map(d => ({ field: d.revision }))]) {
    if (field.label === "verified") field.label = "proposed";
    if (!serverQC) delete field.review;
  }
  return next;
}

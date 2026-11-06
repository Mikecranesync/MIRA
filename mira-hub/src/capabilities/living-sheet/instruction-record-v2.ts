import { instructionRecord } from "./instruction-record";
import type { SheetView } from "./reduce";
import type { CloseoutCandidate } from "./intake-closeout-store";

/** An explicit v2 envelope. v1 remains unchanged and is never an import format. */
export function instructionRecordV2(notebookId: string, view: SheetView, closeout: CloseoutCandidate | null = null) {
  const v1 = instructionRecord(notebookId, view);
  return {
    kind: "living_instruction_record" as const, schemaVersion: 2 as const, status: "draft" as const,
    snapshotId: v1.snapshotId, lineage: v1.lineage, snapshot: v1.snapshot,
    sourceEvidence: structuredClone(view.template.instruction ?? null),
    closeout: structuredClone(closeout),
    review: { technicianCloseout: closeout ? "recorded" as const : "not_recorded" as const,
      reusableAcceptance: "not_recorded" as const, safetyClearance: "not_granted" as const },
    capture: { schemaVersion: 1 as const, privacy: "private" as const, benchmarkExposure: "unknown" as const,
      exactConversationLinkage: "unknown" as const },
    gaps: [...v1.gaps.filter(g => !closeout || !["per_fact_and_step_review_not_recorded", "technician_closeout_review_not_recorded"].includes(g)), "exact_questions_and_answers_not_linked", "benchmark_exposure_unknown"],
  };
}
export type InstructionRecordV2 = ReturnType<typeof instructionRecordV2>;

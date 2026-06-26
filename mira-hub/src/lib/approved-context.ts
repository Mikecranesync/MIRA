import type { MissingContextItem } from "./health-score";

export interface ApprovedContextSummary {
  approvedSourceCount: number;
  verifiedRelationshipCount: number;
  approvedLiveSignalCount: number;
}

export interface ApprovedContextRefusal {
  gate: "approved_context";
  reason: string;
  approved_source_count: number;
  verified_relationship_count: number;
  approved_live_signal_count: number;
  missingContext: MissingContextItem[];
}

type ApprovedAskEnv = Record<string, string | undefined>;

export function approvedAskEnforcementEnabled(
  env: ApprovedAskEnv = process.env,
): boolean {
  return env.MIRA_ENFORCE_APPROVED_ASK === "true" || env.MIRA_ENFORCE_APPROVED_RETRIEVAL === "true";
}

export function approvedContextReady(summary: ApprovedContextSummary): boolean {
  return (
    summary.approvedSourceCount > 0 ||
    summary.verifiedRelationshipCount > 0 ||
    summary.approvedLiveSignalCount > 0
  );
}

export function buildApprovedContextRefusal(summary: ApprovedContextSummary): ApprovedContextRefusal {
  return {
    gate: "approved_context",
    reason: "MIRA needs approved asset context before answering.",
    approved_source_count: summary.approvedSourceCount,
    verified_relationship_count: summary.verifiedRelationshipCount,
    approved_live_signal_count: summary.approvedLiveSignalCount,
    missingContext: [
      {
        key: "approved_documents",
        label: "Approved document context",
        status: summary.approvedSourceCount > 0 ? "ready" : "missing",
        count: summary.approvedSourceCount,
        required: 1,
        action: "Upload and approve a manual, PLC tag list, or evidence document.",
      },
      {
        key: "verified_relationships",
        label: "Verified relationships",
        status: summary.verifiedRelationshipCount > 0 ? "ready" : "needs_review",
        count: summary.verifiedRelationshipCount,
        required: 1,
        action: "Accept grounded proposals until at least one relationship is verified.",
      },
    ],
  };
}

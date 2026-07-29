// Pure asset-status logic, split out of page.tsx so it's unit-testable without
// loading the client component. The Assets page badge and the status filter chips
// both consume this single source — see #1985 (filter labels used to disagree
// with the badge vocabulary, and the "Active" chip filtered the unrelated
// `criticality` field, returning 0 for operational assets).

export type AssetStatus = "operational" | "warning" | "critical" | "idle";

/** The subset of an Asset that status derivation reads. */
export interface AssetStatusInput {
  downtimeHours: number;
  lastFault: string | null;
  criticality: string;
  workOrderCount: number;
  lastWorkOrder: string | null;
}

export function deriveStatus(a: AssetStatusInput): AssetStatus {
  if (a.downtimeHours > 0 && a.lastFault) return "warning";
  if (a.criticality === "critical" && a.lastFault) return "critical";
  if (a.workOrderCount === 0 && !a.lastWorkOrder) return "idle";
  return "operational";
}

// Display label per status. The badge and the filter chips both render from this
// map, so chip text can never drift from badge text again (#1985). The status
// vocabulary is English here as it is in the badge; localizing the whole set is a
// separate follow-up.
export const STATUS_LABELS: Record<AssetStatus, string> = {
  operational: "Operational",
  warning: "Warning",
  critical: "Critical",
  idle: "Idle",
};

/** A status filter matches when it's "all" or equals the asset's derived status. */
export function assetMatchesStatusFilter(a: AssetStatusInput, filter: string): boolean {
  return filter === "all" || deriveStatus(a) === filter;
}

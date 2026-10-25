/**
 * Work-order status values accepted by PATCH /api/work-orders/[id] (#4731).
 *
 * `workorderstatus` is declared by the Atlas CMMS backend (see
 * `.enum-drift-allowlist.txt`) plus `needs_completion` from hub migration 005.
 * A value outside the enum used to reach the `::workorderstatus` cast and make
 * Postgres throw, which the route reported as a 500. Resolving the value here,
 * before any query, turns a bad value into a 400.
 *
 * `closed` is what the phone's "Close & archive" button sends. The enum has no
 * such value; `completed` is its terminal state and both are already treated as
 * closing statuses (`CLOSING_STATUSES`), so `closed` is stored as `completed`.
 */
export const WORK_ORDER_STATUSES = [
  "open",
  "in_progress",
  "on_hold",
  "needs_completion",
  "completed",
  "cancelled",
] as const;

export type WorkOrderStatus = (typeof WORK_ORDER_STATUSES)[number];

const ALIASES: Readonly<Record<string, WorkOrderStatus>> = { closed: "completed" };

export type StatusResult =
  | { ok: true; status: WorkOrderStatus }
  | { ok: false; error: string; allowed: WorkOrderStatus[] };

export function normalizeWorkOrderStatus(value: unknown): StatusResult {
  if (typeof value === "string") {
    if ((WORK_ORDER_STATUSES as readonly string[]).includes(value)) {
      return { ok: true, status: value as WorkOrderStatus };
    }
    if (Object.prototype.hasOwnProperty.call(ALIASES, value)) {
      return { ok: true, status: ALIASES[value] };
    }
  }
  // Never String() a non-string: a JSON object can make that conversion throw
  // (Codex #4766 F1), which would surface as the very 500 this module prevents.
  const shown =
    typeof value === "string" ? `"${value}"` : value === null ? "null" : Array.isArray(value) ? "array" : `of type ${typeof value}`;
  return {
    ok: false,
    error: `Unknown work order status ${shown}`,
    allowed: [...WORK_ORDER_STATUSES],
  };
}

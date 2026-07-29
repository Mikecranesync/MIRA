// Pure helpers for the platform-accounts admin page (#1945). Kept JSX-free so
// the count / accessible-label / confirmation logic is unit-testable under
// vitest's node environment (the page itself is a "use client" component).

// Target status a row action moves a user to. "approved" is one-click;
// "pending" (Revoke) and "expired" (Expire) are destructive → confirm first.
export type MutationStatus = "approved" | "pending" | "expired";

/**
 * Header count copy. Search-aware: when a query is active, lead with the
 * filtered result count so the operator sees how many of the total matched
 * ("1 result · 49 total") instead of a bare, misleading unfiltered total.
 */
export function formatCountLabel(opts: {
  total: number;
  visible: number;
  hasQuery: boolean;
  pending: number;
}): string {
  const { total, visible, hasQuery, pending } = opts;
  if (hasQuery) {
    return `${visible} result${visible === 1 ? "" : "s"} · ${total} total`;
  }
  return `${total} total${pending > 0 ? ` · ${pending} pending review` : ""}`;
}

/**
 * Confirmation prompt for a status mutation, or null when the action is
 * non-destructive. Approval stays one-click (returns null) per the issue;
 * Revoke and Expire return a prompt naming the target user.
 */
export function confirmMessage(status: MutationStatus, label: string): string | null {
  switch (status) {
    case "pending":
      return `Revoke access for ${label}?`;
    case "expired":
      return `Expire trial for ${label}?`;
    default:
      return null;
  }
}

/** Accessible name for a row action button, disambiguated by target user. */
export function actionAriaLabel(status: MutationStatus, label: string): string {
  switch (status) {
    case "approved":
      return `Approve ${label}`;
    case "pending":
      return `Revoke access for ${label}`;
    case "expired":
      return `Expire trial for ${label}`;
  }
}

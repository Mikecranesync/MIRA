/** Warning shown before sign-out discards work that could not reach the API. */
export function signOutWarningCopy(pending: number, rejected: number): string | null {
  if (pending === 0) return null;
  const detail = rejected > 0 ? ` (${rejected} rejected by the server)` : "";
  return `${pending} work order${pending === 1 ? "" : "s"} couldn't sync${detail} and will be deleted. Sign out anyway?`;
}

export function signOutSyncInProgressCopy(): string {
  return "Work orders are still syncing. Wait a moment, then sign out again.";
}

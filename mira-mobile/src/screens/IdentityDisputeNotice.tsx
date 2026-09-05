/**
 * 086 §3 — the server withheld this notebook's bound machine for a turn
 * because the client's asset claim did not match the confirmed binding. The
 * answer was served as general/document guidance with no machine history, and
 * the technician must be told so — live and after reload. Shared by ChatV2 and
 * the classic screen (same discipline as SafetyNotice) so the two surfaces
 * cannot drift apart.
 */
export function IdentityDisputeNotice() {
  return (
    <div className="meta identity-dispute" role="status" data-testid="identity-dispute">
      Answered as general guidance — the machine this question was asked about is not the
      machine this notebook is bound to, so its history was not used.
    </div>
  );
}

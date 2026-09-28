/**
 * 086 §3 — the server withheld this notebook's bound machine for a turn
 * because the client's asset claim did not match the confirmed binding. Only
 * the machine identity/history is withheld — the reply may still be general
 * guidance, cited from the manuals, or an abstention — so the copy states
 * ONLY what is true on every path (what was withheld), and leaves how the
 * reply was grounded to the basis badge / citations. The technician must be
 * told live and after reload. Shared by ChatV2 and
 * the classic screen (same discipline as SafetyNotice) so the two surfaces
 * cannot drift apart.
 */
export function IdentityDisputeNotice() {
  return (
    <div className="meta identity-dispute" role="status" data-testid="identity-dispute">
      The machine this question was asked about is not the machine this notebook is bound to, so
      its machine history was not used for this reply.
    </div>
  );
}

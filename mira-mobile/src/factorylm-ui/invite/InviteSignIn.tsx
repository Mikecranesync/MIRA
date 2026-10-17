import { useState } from "react";
import { resolveApiBase } from "../../plugins/build-config";
import { parseInviteLink } from "./invite-link";
import { confirmInviteSession, signInWithMagicToken } from "./invite-sign-in";
import { inviteLinkErrorCopy, inviteSignInFailureCopy } from "./invite-copy";

/**
 * Lets an invited technician sign in by pasting their invitation link
 * instead of a password (#4364 — invited users have no password_hash, so the
 * native app's email+password form alone can't authenticate them). The link
 * is only ever parsed locally; the app talks to its own trusted backend, not
 * to the host the technician pasted (see invite-link.ts).
 */
export function InviteSignIn({
  onSignedIn,
  onSignInStarted,
  onBusyChange,
}: {
  onSignedIn: () => Promise<void>;
  onSignInStarted?: () => void;
  /** #4470 F2: reports this component's busy window to the parent Login
   *  screen. Login disables the password/invite mode toggle while either
   *  flow is busy — otherwise switching modes mid-attempt unmounts this
   *  component while its in-flight async submit() keeps running, and a
   *  later-arriving response from THIS abandoned attempt can still apply
   *  its cookie and call onSignedIn after a different account already
   *  signed in. Disabling the toggle while busy removes the only way to
   *  create that interleaving from the UI. */
  onBusyChange?: (busy: boolean) => void;
}) {
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // #4470 F1: true once a prior exchange has already consumed the token and
  // set a fresh session — a later /api/me-only failure must be retried via
  // confirmInviteSession(), never by wiping state and resubmitting the
  // (now-consumed) token.
  const [sessionEstablished, setSessionEstablished] = useState(false);

  function beginBusy() {
    setBusy(true);
    onBusyChange?.(true);
  }
  function endBusy() {
    setBusy(false);
    onBusyChange?.(false);
  }

  async function submit() {
    beginBusy();
    setError("");
    // #4470 F2 gap: busy (and the lifted onBusyChange signal) must stay
    // active through onSignedIn — account hydration — not just the network
    // exchange. endBusy() used to run BEFORE that await, so the mode toggle
    // (and this component's own textarea) re-enabled while the app was still
    // hydrating the newly-signed-in account; a technician could edit the
    // pasted link or switch modes in that window. try/finally guarantees
    // endBusy() only runs once the ENTIRE attempt — including hydration —
    // is fully resolved, on every return path.
    try {
      if (sessionEstablished) {
        onSignInStarted?.();
        const r = await confirmInviteSession();
        if (r.ok) {
          await onSignedIn();
          return;
        }
        setSessionEstablished(Boolean(r.sessionEstablished));
        setError(inviteSignInFailureCopy(r.reason));
        return;
      }

      let trustedOrigin: string;
      try {
        trustedOrigin = await resolveApiBase();
      } catch {
        setError("Could not verify the app's backend — try again.");
        return;
      }

      const parsed = parseInviteLink(pasted, trustedOrigin);
      if ("error" in parsed) {
        setError(inviteLinkErrorCopy(parsed.error));
        return;
      }

      onSignInStarted?.();
      const r = await signInWithMagicToken(parsed.token);
      if (r.ok) {
        await onSignedIn();
        return;
      }
      setSessionEstablished(Boolean(r.sessionEstablished));
      setError(inviteSignInFailureCopy(r.reason));
    } finally {
      endBusy();
    }
  }

  return (
    <div className="card">
      <h3>Use an invitation link</h3>
      <p className="meta">
        No password needed — paste the invitation link from your invite email
        and we&apos;ll sign you in.
      </p>
      <label htmlFor="invite-link-input">Invitation link</label>
      <textarea
        id="invite-link-input"
        value={pasted}
        disabled={busy}
        // #4470 F2 gap: disabled while an exchange is pending, so the
        // pasted token cannot be edited out from under an attempt in
        // flight — a late-arriving result for token A must never become
        // the confirmation for an edited token B.
        onChange={(e) => {
          setPasted(e.target.value);
          setSessionEstablished(false);
          setError("");
        }}
        placeholder="https://app.factorylm.com/hub/magic?token=…"
      />
      <div style={{ marginTop: 14 }}>
        <button
          className="btn-primary"
          disabled={busy || !pasted.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Signing in…" : sessionEstablished ? "Finish signing in" : "Use invite link"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

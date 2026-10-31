import { useRef, useState } from "react";
import { resolveApiBase } from "../../plugins/build-config";
import { inviteTokenIdentity, parseInviteLink } from "./invite-link";
import { confirmInviteSession, signInWithMagicToken } from "./invite-sign-in";
import { INVITE_HYDRATION_FAILED_COPY, inviteLinkErrorCopy, inviteSignInFailureCopy } from "./invite-copy";

/**
 * Lets an invited technician sign in by pasting their invitation link
 * instead of a password (#4364 — invited users have no password_hash, so the
 * native app's email+password form alone can't authenticate them). The link
 * is only ever parsed locally; the app talks to its own trusted backend, not
 * to the host the technician pasted (see invite-link.ts).
 */
/** #4470 round 2: the pasted link plus the token whose exchange already set
 *  a fresh session. Lifted to Login so a password/invite mode switch (which
 *  remounts this component) cannot drop it. */
export type InviteRecovery = { pasted: string; establishedToken: string | null };
export const EMPTY_INVITE_RECOVERY: InviteRecovery = { pasted: "", establishedToken: null };

export function InviteSignIn({
  onSignedIn,
  onSignInStarted,
  onBusyChange,
  recovery,
  onRecoveryChange,
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
  /** Controlled recovery state; when omitted the component keeps its own. */
  recovery?: InviteRecovery;
  onRecoveryChange?: (next: InviteRecovery) => void;
}) {
  const [localRecovery, setLocalRecovery] = useState<InviteRecovery>(EMPTY_INVITE_RECOVERY);
  const current = recovery ?? localRecovery;
  // Writes go to the latest value so two updates in one attempt (pasted is
  // unchanged mid-attempt, the textarea is disabled) never clobber each other.
  const latest = useRef(current);
  latest.current = current;
  function update(patch: Partial<InviteRecovery>) {
    const next = { ...latest.current, ...patch };
    latest.current = next;
    if (onRecoveryChange) onRecoveryChange(next);
    else setLocalRecovery(next);
  }
  const { pasted, establishedToken } = current;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // #4470 F1/F4: the session is already established ONLY for the token that
  // established it. A later /api/me-only failure for that same token is
  // retried via confirmInviteSession(), never by wiping state and replaying
  // the consumed token; any OTHER pasted link (a different invite, or an
  // invalid one) must never confirm that earlier account.
  const pastedToken = inviteTokenIdentity(pasted);
  const canConfirm = establishedToken !== null && pastedToken === establishedToken;

  function beginBusy() {
    setBusy(true);
    onBusyChange?.(true);
  }
  function endBusy() {
    setBusy(false);
    onBusyChange?.(false);
  }

  // Gate-7 (#4470): the session is already real once the exchange or
  // re-confirmation succeeded, and the invite token is single-use. If the
  // parent's account hydration (onSignedIn) throws, e.g. a network blip on
  // getMe(), keep the established session and surface a retry message, so the
  // next tap re-confirms via confirmInviteSession() instead of replaying the
  // spent token (which would wrongly read "already used"), and the rejection
  // never escapes `void submit()` as an unhandled promise.
  async function hydrate(token: string) {
    try {
      await onSignedIn();
    } catch {
      update({ establishedToken: token });
      setError(INVITE_HYDRATION_FAILED_COPY);
    }
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
      if (canConfirm && establishedToken) {
        const token = establishedToken;
        onSignInStarted?.();
        const r = await confirmInviteSession();
        if (r.ok) {
          await hydrate(token);
          return;
        }
        update({ establishedToken: r.sessionEstablished ? token : null });
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
      const token = inviteTokenIdentity(pasted) ?? parsed.token;
      // A new exchange replaces any earlier established session.
      update({ establishedToken: null });
      const r = await signInWithMagicToken(parsed.token);
      if (r.ok) {
        await hydrate(token);
        return;
      }
      update({ establishedToken: r.sessionEstablished ? token : null });
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
          // Editing never clears the recovery state: whether a retry confirms
          // or exchanges is decided at submit time by comparing the pasted
          // token with establishedToken, so a stray space keeps the retry and
          // a different (or cleared-then-repasted) invite starts a new one.
          update({ pasted: e.target.value });
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
          {busy ? "Signing in…" : canConfirm ? "Finish signing in" : "Use invite link"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

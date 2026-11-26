import { useSyncExternalStore } from "react";
import { getSignInLinkState, sendSignInLink, subscribeSignInLink } from "./sign-in-link-controller";
import { signInLinkFailureCopy, signInLinkSentCopy } from "./invite-copy";

/**
 * #5942: "Email me a sign-in link" for a technician with no password. Verified
 * onboarding creates passwordless accounts, so without this a stranger who signed
 * up on the web has no way to sign in on the phone.
 *
 * It reads the email already typed in the sign-in form rather than adding a
 * second email field: one field is clearer, and a second input whose name
 * contains "email" would be indistinguishable to anything that finds the field
 * by its label. The emailed link is pasted into invite mode (`onHaveLink`),
 * which already redeems it.
 *
 * The request's state lives in sign-in-link-controller.ts, not here, so it
 * survives the remount every mode switch causes.
 */
export function EmailSignInLink({
  email,
  disabled,
  onHaveLink,
}: {
  email: string;
  disabled: boolean;
  onHaveLink: () => void;
}) {
  const { pending, outcome } = useSyncExternalStore(subscribeSignInLink, getSignInLinkState);
  const busy = pending !== null;
  const address = email.trim();
  // An outcome names the address it was for; once the field holds a different
  // address it no longer describes what is typed, so it is hidden.
  const current = outcome !== null && outcome.address === address ? outcome : null;

  return (
    <div className="card">
      <p className="meta">
        No password? Enter your email above to request a single-use sign-in link.
      </p>
      <button
        type="button"
        className="btn-primary"
        disabled={disabled || busy || !address}
        onClick={() => void sendSignInLink(address)}
      >
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
      {current?.ok && (
        <>
          <p className="meta">{signInLinkSentCopy(address)}</p>
          <button type="button" className="btn-link" disabled={disabled} onClick={onHaveLink}>
            Paste the link from the email
          </button>
        </>
      )}
      {current && !current.ok && <div className="error">{signInLinkFailureCopy(current.reason)}</div>}
    </div>
  );
}

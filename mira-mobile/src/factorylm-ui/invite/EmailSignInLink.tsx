import { useState } from "react";
import { requestSignInLink } from "./sign-in-link";
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const address = email.trim();

  async function send() {
    setBusy(true);
    setError("");
    setSentTo(null);
    try {
      const r = await requestSignInLink(address);
      if (r.ok) setSentTo(address);
      else setError(signInLinkFailureCopy(r.reason));
    } finally {
      setBusy(false);
    }
  }

  // The notice names the address it was sent to; once the field changes it no
  // longer describes what is typed, so it is hidden.
  const sent = sentTo !== null && sentTo === address;

  return (
    <div className="card">
      <p className="meta">
        No password? Enter your email above and we&apos;ll send you a single-use sign-in link.
      </p>
      <button
        type="button"
        className="btn-primary"
        disabled={disabled || busy || !address}
        onClick={() => void send()}
      >
        {busy ? "Sending…" : "Email me a sign-in link"}
      </button>
      {sent && (
        <>
          <p className="meta">{signInLinkSentCopy(address)}</p>
          <button type="button" className="btn-link" disabled={disabled} onClick={onHaveLink}>
            Paste the link from the email
          </button>
        </>
      )}
      {error && <div className="error">{error}</div>}
    </div>
  );
}

import { useState } from "react";
import { resolveApiBase } from "../../plugins/build-config";
import { parseInviteLink } from "./invite-link";
import { signInWithMagicToken } from "./invite-sign-in";
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
}: {
  onSignedIn: () => Promise<void>;
  onSignInStarted?: () => void;
}) {
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setBusy(true);
    setError("");

    let trustedOrigin: string;
    try {
      trustedOrigin = await resolveApiBase();
    } catch {
      setBusy(false);
      setError("Could not verify the app's backend — try again.");
      return;
    }

    const parsed = parseInviteLink(pasted, trustedOrigin);
    if ("error" in parsed) {
      setBusy(false);
      setError(inviteLinkErrorCopy(parsed.error));
      return;
    }

    onSignInStarted?.();
    const r = await signInWithMagicToken(parsed.token);
    setBusy(false);
    if (r.ok) await onSignedIn();
    else setError(inviteSignInFailureCopy(r.reason));
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
        onChange={(e) => setPasted(e.target.value)}
        placeholder="https://app.factorylm.com/hub/magic?token=…"
      />
      <div style={{ marginTop: 14 }}>
        <button
          className="btn-primary"
          disabled={busy || !pasted.trim()}
          onClick={() => void submit()}
        >
          {busy ? "Signing in…" : "Use invite link"}
        </button>
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

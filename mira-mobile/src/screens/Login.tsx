import { useState } from "react";
import { signIn } from "../api/resources";
import { signInFailureCopy } from "../lib/resource-copy";
// #4364: invited technicians are created with no password_hash (ensureInvitedUser
// in mira-hub never sets one), so the password form alone cannot authenticate
// them. The new invitation-link path is new presentation and lives under
// factorylm-ui per the Unified UI Cutover; this screen stays a thin canonical
// adapter — a toggle mount, not a reimplementation — passing through the same
// onSignedIn/onSignInStarted contract both paths already share.
import { InviteSignIn } from "../factorylm-ui/invite/InviteSignIn";

export function Login({
  onSignedIn,
  onSignInStarted,
}: {
  onSignedIn: () => Promise<void>;
  // Fired the instant the technician commits to a sign-in, BEFORE any network
  // work. App uses it to retire a boot-time getMe() still in flight (#3799): a
  // late success body for the previously-persisted session must not render its
  // account while a different sign-in is pending or after it fails.
  onSignInStarted?: () => void;
}) {
  const [mode, setMode] = useState<"password" | "invite">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // #4470 F2: InviteSignIn's own busy state is internal to that component
  // and is simply discarded on unmount — it does NOT cancel the in-flight
  // async submit(), which keeps running and can still apply its cookie and
  // call onSignedIn after a different account signs in. Lifting its busy
  // signal up here lets BOTH toggle buttons below disable for the whole
  // window of either flow, removing the only UI path to abandon one attempt
  // mid-flight and start another.
  const [inviteBusy, setInviteBusy] = useState(false);
  const anyBusy = busy || inviteBusy;

  if (mode === "invite") {
    return (
      <div className="shell">
        <div className="topbar">FactoryLM</div>
        <div className="content bottompad">
          <InviteSignIn
            onSignedIn={onSignedIn}
            onSignInStarted={onSignInStarted}
            onBusyChange={setInviteBusy}
          />
          <button
            type="button"
            className="btn-link"
            style={{ marginTop: 10 }}
            disabled={anyBusy}
            onClick={() => setMode("password")}
          >
            Have a password instead? Sign in that way
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <div className="topbar">FactoryLM</div>
      <div className="content bottompad">
        <div className="card">
          <h3>Sign in</h3>
          <label>Email</label>
          <input
            inputMode="email"
            autoCapitalize="none"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div style={{ marginTop: 14 }}>
            <button
              className="btn-primary"
              disabled={busy || !email || !password}
              onClick={async () => {
                setBusy(true);
                setError("");
                onSignInStarted?.();
                try {
                  const r = await signIn(email, password);
                  if (r.ok) await onSignedIn();
                  else setError(signInFailureCopy(r.reason));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
        <button
          type="button"
          className="btn-link"
          style={{ marginTop: 10 }}
          disabled={anyBusy}
          onClick={() => setMode("invite")}
        >
          Have an invitation link instead? No password needed
        </button>
      </div>
    </div>
  );
}

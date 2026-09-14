import { useState } from "react";
import { signIn } from "../api/resources";
import { signInFailureCopy } from "../lib/resource-copy";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
                const r = await signIn(email, password);
                setBusy(false);
                if (r.ok) await onSignedIn();
                else setError(signInFailureCopy(r.reason));
              }}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </div>
          {error && <div className="error">{error}</div>}
        </div>
      </div>
    </div>
  );
}

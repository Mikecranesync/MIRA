import { useState } from "react";
import { signIn } from "../api/resources";

export function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
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
                const r = await signIn(email, password);
                setBusy(false);
                if (r.ok) await onSignedIn();
                else setError(r.error ?? "sign-in failed");
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

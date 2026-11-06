"use client";
import { CV101WalkthroughLauncher } from "./CV101WalkthroughLauncher";

/** #4693: the drawer footer on web /v3 — who is signed in, and a way out. Mirrors the mobile host's footer. */
export function HubAccountFooter({ email, signingOut, onSignOut }: {
  email: string | null | undefined;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <>
      {email ? <CV101WalkthroughLauncher viewerScope={email} /> : <button type="button" disabled>CV-101 walkthrough — waiting for account</button>}
      {email ? <p className="fl-card__meta">{email}</p> : null}
      <button type="button" disabled={signingOut} onClick={onSignOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </>
  );
}

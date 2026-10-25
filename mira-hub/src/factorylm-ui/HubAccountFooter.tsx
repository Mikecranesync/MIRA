"use client";

/** #4693: the drawer footer on web /v3 — who is signed in, and a way out. Mirrors the mobile host's footer. */
export function HubAccountFooter({ email, signingOut, onSignOut }: {
  email: string | null | undefined;
  signingOut: boolean;
  onSignOut: () => void;
}) {
  return (
    <>
      {email ? <p className="fl-card__meta">{email}</p> : null}
      <button type="button" disabled={signingOut} onClick={onSignOut}>
        {signingOut ? "Signing out…" : "Sign out"}
      </button>
    </>
  );
}

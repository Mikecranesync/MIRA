# Enterprise SSO & Shared-Device Auth — Support Status

> Companion to issue #1955 ("improve shop-floor login usability"). This doc
> satisfies the acceptance criteria that ask us to *document* enterprise SSO
> support and to *consider* shared-device session behavior, rather than ship
> the full feature now. It is the canonical answer to "does FactoryLM support
> Microsoft/Entra sign-in?" and "what about shared shop terminals?".

## Sign-in methods we ship today

The Hub (`app.factorylm.com`, `mira-hub`) authenticates through NextAuth with
three providers wired in `mira-hub/src/auth.ts`:

| Method | Provider id | How it works | Best for |
|---|---|---|---|
| **Email + password** | `credentials` | bcrypt-verified against `users.passwordHash` | Returning users, shared terminals (fast re-entry) |
| **Email magic link** | `magic-token` | One-time 15-min token emailed, verified at `/magic` | Users without a saved password |
| **Google** | `google` | Google OAuth (`openid email profile`), enabled when `GOOGLE_CLIENT_ID`/`SECRET` are set | Orgs on Google Workspace |

All three are surfaced on `/login`; password + Google + magic link on `/signup`.

## Microsoft / Entra ID — NOT a sign-in method (yet)

**There is a `mira-hub/src/app/api/auth/microsoft/` route, but it is a *data
connector*, not authentication.** It calls `sessionOr401()` (you must already
be signed in), and its scopes are `Files.Read.All Sites.Read.All Mail.Read
User.Read offline_access` — it exists to ingest OneDrive/SharePoint documents
into the knowledge base, not to log a user in. Do not assume Entra SSO sign-in
ships because this route exists.

### What enterprise SSO sign-in would require

Real "Sign in with Microsoft" (and SAML/OIDC for industrial orgs on
Microsoft/Entra) is a deliberate follow-up, not a one-line change:

1. An **Azure app registration** for *authentication* (delegated `openid email
   profile` sign-in scopes) — separate from the existing data-connector app.
2. Doppler secrets (`factorylm/prd`) for the auth client id/secret. These
   cannot be provisioned from a code session.
3. A NextAuth provider (`next-auth/providers/azure-ad` or a generic OIDC
   provider) added to the `providers` array in `mira-hub/src/auth.ts`, plus a
   "Continue with Microsoft" button on `/login` and `/signup`.
4. Redirect-URI registration mirrored in `docs/auth/oauth-redirect-uris.md`
   and the OAuth redirect canary.
5. For SAML-only enterprise IdPs (Okta/Entra SAML), an adapter or a hosted
   identity broker — larger scope, gated behind an enterprise plan.

**Status: documented, not implemented.** Tracking is the parent issue #1955
("Consider Microsoft/Entra ID sign-in"); when an enterprise customer requires
it, file a dedicated implementation issue referencing this section.

## Shared-device / kiosk session behavior

Shop-floor reality: a single tablet or terminal is shared across a shift, often
in gloves, often signed in as whoever touched it last. Current behavior and the
follow-up needed:

### Today
- Sessions are NextAuth JWTs in the `next-auth.session-token` cookie. There is a
  **Sign out** affordance in the Hub shell once authenticated.
- Email + password is the fastest re-entry method for a shared terminal (no
  email round-trip, unlike magic link).
- No auto-logout / inactivity timeout, and no per-device "switch user" fast path
  yet.

### Recommended follow-up (not in this PR)
- **Inactivity auto-logout** on shared/kiosk devices (configurable idle timeout)
  so a walk-away doesn't leave a tech's session open.
- **Fast user-switching** ("Not you? Switch user") on the login screen for
  shared terminals.
- **Badge / PIN / QR technician login** for the floor — the `qr-onboarding`
  skill (`.claude/skills/qr-onboarding/`) already establishes the QR-deep-link
  pattern for binding a session to an asset; the same mechanism can carry a
  technician identity for fast, glove-friendly kiosk sign-in. This is the
  natural home for the issue's "kiosk/shared-device mode, badge/PIN/QR login"
  ask.
- **Kiosk session scoping** so a shared-terminal session can't accidentally
  inherit admin/approval rights — pair with the train-before-deploy read-only
  posture (`.claude/rules/train-before-deploy.md`).

**Status: considered, follow-up captured here.** File a dedicated issue when a
customer deploys shared shop terminals.

## Cross-references
- `mira-hub/src/auth.ts` — the NextAuth provider wiring described above.
- `mira-hub/src/app/login/login-form.tsx`, `mira-hub/src/app/signup/page.tsx` — the surfaces.
- `docs/auth/oauth-redirect-uris.md` — canonical authorized redirect URIs (Google today; Microsoft auth would join it).
- `.claude/skills/qr-onboarding/` — QR deep-link pattern for the badge/PIN/QR follow-up.
- Issue #1955 — shop-floor login usability (parent).
